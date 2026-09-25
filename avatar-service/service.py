"""Microservicio local de vídeo con presentador (lip-sync) para la app Texto a Voz.

Arranque (desde avatar-service/):
    .venv\\Scripts\\python service.py

Solo escucha en 127.0.0.1: lo consume el servidor Node (/api/avatar), nunca el navegador.
"""

from __future__ import annotations

import io
import logging
import os
import queue
import shutil
import threading
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import soundfile
import uvicorn
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from PIL import Image, ImageColor, ImageOps

SERVICE_DIR = Path(__file__).resolve().parent


def _load_avatar_settings_from_project_env() -> None:
    # Comparte con la app Node las variables AVATAR_* del .env de la raíz (p. ej. el token),
    # sin cargar nada más (la clave de Gemini no pinta nada aquí).
    env_file = SERVICE_DIR.parent / ".env"
    if not env_file.is_file():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        key, separator, value = line.partition("=")
        key = key.strip()
        if separator and key.startswith("AVATAR_") and key not in os.environ:
            os.environ[key] = value.strip().strip('"').strip("'")


_load_avatar_settings_from_project_env()
HOST = os.environ.get("AVATAR_HOST", "127.0.0.1")
PORT = int(os.environ.get("AVATAR_PORT", "8765"))
JOBS_DIR = Path(os.environ.get("AVATAR_JOBS_DIR", SERVICE_DIR / "jobs"))
PRESENTER_DIR = SERVICE_DIR / "presenter"
TOKEN = os.environ.get("AVATAR_SERVICE_TOKEN", "").strip()
MAX_AUDIO_SEC = float(os.environ.get("AVATAR_MAX_AUDIO_SEC", "1200"))
MAX_UPLOAD_MB = float(os.environ.get("AVATAR_MAX_UPLOAD_MB", "400"))
JOB_TTL_SEC = float(os.environ.get("AVATAR_JOB_TTL_HOURS", "24")) * 3600
MAX_DIM = int(os.environ.get("AVATAR_MAX_DIM", "1920"))
EXPRESSION_SCALE = float(os.environ.get("AVATAR_EXPRESSION_SCALE", "0.6"))
ALLOWED_FPS = {24, 25, 30}
ALLOWED_FORMATS = {"16:9", "9:16", "original"}
IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp")

log = logging.getLogger("avatar-service")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [avatar] %(message)s")


# --------------------------------------------------------------------------------------
# Estado del motor y de los trabajos
# --------------------------------------------------------------------------------------
@dataclass
class EngineState:
    status: str = "loading"  # loading | ready | error
    error: str = ""
    device: str = ""
    engine: object = None


@dataclass
class Job:
    id: str
    folder: Path
    image_path: Path
    audio_path: Path
    fps: int
    output_format: str
    audio_duration: float
    created_at: float = field(default_factory=time.time)
    status: str = "queued"  # queued | running | done | error | cancelled
    stage: str = "En cola"
    progress: float = 0.0
    error: str = ""
    result: Optional[dict] = None
    cancel_event: threading.Event = field(default_factory=threading.Event)

    @property
    def output_path(self) -> Path:
        return self.folder / "presentador.mp4"

    def public(self) -> dict:
        return {
            "id": self.id,
            "status": self.status,
            "stage": self.stage,
            "progress": round(self.progress, 4),
            "error": self.error or None,
            "audioDurationSec": round(self.audio_duration, 2),
            "queuePosition": queue_position(self.id),
            "result": self.result,
        }


engine_state = EngineState()
jobs: dict[str, Job] = {}
jobs_lock = threading.Lock()
work_queue: "queue.Queue[str]" = queue.Queue()


def queue_position(job_id: str) -> int:
    with jobs_lock:
        waiting = [job for job in jobs.values() if job.status == "queued"]
    waiting.sort(key=lambda job: job.created_at)
    for position, job in enumerate(waiting, start=1):
        if job.id == job_id:
            return position
    return 0


def load_engine() -> None:
    try:
        from avatar_engine import AvatarEngine

        started = time.perf_counter()
        engine = AvatarEngine()
        log.info("Modelos cargados en %.1fs; calentando la GPU…", time.perf_counter() - started)
        engine.warmup()
        engine_state.engine = engine
        engine_state.device = engine.device_name
        engine_state.status = "ready"
        log.info("Motor listo en %s (%.1fs)", engine.device_name, time.perf_counter() - started)
    except Exception as exc:  # el servicio sigue vivo para informar del error en /health
        log.exception("No se pudo cargar el motor")
        engine_state.status = "error"
        engine_state.error = str(exc)


def worker() -> None:
    # La carga y el calentamiento se hacen en este mismo hilo: la caché de algoritmos de cuDNN
    # de PyTorch es por hilo, y calentar en otro dejaba el primer vídeo ~25 s más lento.
    load_engine()
    from avatar_engine import AvatarError, RenderCancelled, RenderSettings

    while True:
        job_id = work_queue.get()
        job = jobs.get(job_id)
        if job is None or job.status != "queued":
            continue
        if engine_state.status != "ready":
            job.status, job.error = "error", f"El motor de vídeo no está disponible: {engine_state.error}"
            continue

        job.status = "running"

        def progress(stage: str, fraction: float, job=job) -> None:
            job.stage, job.progress = stage, fraction

        started = time.perf_counter()
        try:
            result = engine_state.engine.render(
                job.image_path, job.audio_path, job.output_path,
                RenderSettings(fps=job.fps, output_format=job.output_format, max_dim=MAX_DIM,
                               expression_scale=EXPRESSION_SCALE),
                progress=progress, cancel_event=job.cancel_event,
            )
            job.result = {
                "width": result.width,
                "height": result.height,
                "fps": result.fps,
                "frames": result.frames,
                "durationSec": round(result.duration_sec, 2),
                "renderSec": round(time.perf_counter() - started, 1),
                "sizeBytes": job.output_path.stat().st_size,
            }
            job.status, job.stage, job.progress = "done", "Listo", 1.0
            log.info("Trabajo %s listo: %s", job.id, job.result)
        except RenderCancelled:
            job.status, job.stage = "cancelled", "Cancelado"
        except AvatarError as exc:
            job.status, job.error = "error", str(exc)
        except Exception as exc:
            log.exception("Fallo en el trabajo %s", job.id)
            job.status, job.error = "error", f"Error inesperado al generar el vídeo: {exc}"
        finally:
            for path in (job.image_path, job.audio_path):
                path.unlink(missing_ok=True)


def purge_old_jobs() -> None:
    now = time.time()
    with jobs_lock:
        expired = [job for job in jobs.values()
                   if job.status not in ("queued", "running") and now - job.created_at > JOB_TTL_SEC]
        for job in expired:
            jobs.pop(job.id, None)
    for job in expired:
        shutil.rmtree(job.folder, ignore_errors=True)
    # Carpetas huérfanas de ejecuciones anteriores del servicio.
    if JOBS_DIR.exists():
        for folder in JOBS_DIR.iterdir():
            if folder.is_dir() and folder.name not in jobs and now - folder.stat().st_mtime > JOB_TTL_SEC:
                shutil.rmtree(folder, ignore_errors=True)


# --------------------------------------------------------------------------------------
# Validación de entradas
# --------------------------------------------------------------------------------------
def default_presenter() -> Optional[Path]:
    configured = os.environ.get("AVATAR_DEFAULT_IMAGE")
    if configured:
        path = Path(configured)
        return path if path.is_file() else None
    if PRESENTER_DIR.is_dir():
        for name in sorted(PRESENTER_DIR.iterdir()):
            if name.suffix.lower() in IMAGE_EXTENSIONS and name.is_file():
                return name
    return None


def prepare_image(data: bytes, destination: Path, background: str) -> None:
    """Normaliza la imagen: orientación EXIF, transparencia aplanada sobre `background`, RGB."""
    try:
        image = Image.open(io.BytesIO(data))
        image = ImageOps.exif_transpose(image)
    except Exception as exc:
        raise HTTPException(400, "La imagen del presentador no es válida (usa PNG, JPG o WEBP).") from exc
    if min(image.size) < 256:
        raise HTTPException(400, "La imagen del presentador es demasiado pequeña (mínimo 256 px).")
    try:
        fill = ImageColor.getrgb(background)
    except ValueError as exc:
        raise HTTPException(400, "El color de fondo no es válido.") from exc
    if image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info):
        rgba = image.convert("RGBA")
        canvas = Image.new("RGB", rgba.size, fill)
        canvas.paste(rgba, mask=rgba.getchannel("A"))
        image = canvas
    image.convert("RGB").save(destination, format="PNG")


def audio_duration(path: Path) -> float:
    try:
        info = soundfile.info(str(path))
    except RuntimeError as exc:
        raise HTTPException(400, "El audio no es válido (usa WAV, FLAC u OGG).") from exc
    return info.frames / float(info.samplerate)


def check_token(provided: Optional[str]) -> None:
    if TOKEN and provided != TOKEN:
        raise HTTPException(401, "Token del servicio de vídeo incorrecto.")


def get_job(job_id: str) -> Job:
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(404, "Ese trabajo de vídeo no existe o ya caducó.")
    return job


# --------------------------------------------------------------------------------------
# API
# --------------------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(_: FastAPI):
    JOBS_DIR.mkdir(parents=True, exist_ok=True)
    purge_old_jobs()
    threading.Thread(target=worker, name="render-worker", daemon=True).start()
    yield
    for job in jobs.values():
        job.cancel_event.set()


app = FastAPI(title="Texto a Voz · Presentador", lifespan=lifespan)


@app.get("/health")
def health():
    presenter = default_presenter()
    return {
        "status": engine_state.status,
        "error": engine_state.error or None,
        "device": engine_state.device or None,
        "engine": getattr(engine_state.engine, "motion_engine", None),
        "defaultPresenter": presenter is not None,
        "queued": sum(1 for job in jobs.values() if job.status == "queued"),
        "running": any(job.status == "running" for job in jobs.values()),
        "maxAudioSec": MAX_AUDIO_SEC,
    }


@app.get("/presenter")
def presenter_image(x_avatar_token: Optional[str] = Header(default=None)):
    check_token(x_avatar_token)
    presenter = default_presenter()
    if presenter is None:
        raise HTTPException(404, "No hay imagen de presentador por defecto en avatar-service/presenter/.")
    return FileResponse(presenter, headers={"Cache-Control": "no-store"})


@app.post("/jobs", status_code=202)
async def create_job(
    audio: UploadFile = File(...),
    image: Optional[UploadFile] = File(default=None),
    fps: int = Form(default=30),
    format: str = Form(default="16:9"),
    background: str = Form(default="#ffffff"),
    x_avatar_token: Optional[str] = Header(default=None),
):
    check_token(x_avatar_token)
    if engine_state.status == "error":
        raise HTTPException(503, f"El motor de vídeo no se pudo cargar: {engine_state.error}")
    if fps not in ALLOWED_FPS:
        raise HTTPException(400, f"Fotogramas por segundo no admitidos: {fps}.")
    if format not in ALLOWED_FORMATS:
        raise HTTPException(400, f"Formato de vídeo no admitido: {format}.")
    purge_old_jobs()

    job_id = uuid.uuid4().hex
    folder = JOBS_DIR / job_id
    folder.mkdir(parents=True)
    try:
        audio_path = folder / "audio.wav"
        with audio_path.open("wb") as target:
            shutil.copyfileobj(audio.file, target, length=1024 * 1024)
        if audio_path.stat().st_size > MAX_UPLOAD_MB * 1024 * 1024:
            raise HTTPException(413, f"El audio supera {MAX_UPLOAD_MB:.0f} MB.")
        duration = audio_duration(audio_path)
        if duration < 0.3:
            raise HTTPException(400, "El audio es demasiado corto.")
        if duration > MAX_AUDIO_SEC:
            raise HTTPException(
                413, f"El audio dura {duration / 60:.1f} min; el máximo para vídeo es {MAX_AUDIO_SEC / 60:.0f} min."
            )

        image_path = folder / "presentador.png"
        if image is not None and image.filename:
            image_bytes = await image.read()
        else:
            presenter = default_presenter()
            if presenter is None:
                raise HTTPException(
                    400, "No hay imagen de presentador: súbela en la app o colócala en avatar-service/presenter/."
                )
            image_bytes = presenter.read_bytes()
        prepare_image(image_bytes, image_path, background)
    except BaseException:
        shutil.rmtree(folder, ignore_errors=True)
        raise

    job = Job(id=job_id, folder=folder, image_path=image_path, audio_path=audio_path, fps=fps,
              output_format=format, audio_duration=duration)
    with jobs_lock:
        jobs[job_id] = job
    work_queue.put(job_id)
    log.info("Trabajo %s en cola (%.1fs de audio, %s, %d fps)", job_id, duration, format, fps)
    return job.public()


@app.get("/jobs/{job_id}")
def job_status(job_id: str, x_avatar_token: Optional[str] = Header(default=None)):
    check_token(x_avatar_token)
    return get_job(job_id).public()


@app.get("/jobs/{job_id}/video")
def job_video(job_id: str, x_avatar_token: Optional[str] = Header(default=None)):
    check_token(x_avatar_token)
    job = get_job(job_id)
    if job.status != "done" or not job.output_path.exists():
        raise HTTPException(409, "El vídeo todavía no está listo.")
    return FileResponse(job.output_path, media_type="video/mp4", filename="presentador.mp4")


@app.delete("/jobs/{job_id}")
def cancel_job(job_id: str, x_avatar_token: Optional[str] = Header(default=None)):
    check_token(x_avatar_token)
    job = get_job(job_id)
    if job.status in ("queued", "running"):
        job.cancel_event.set()
        if job.status == "queued":
            job.status, job.stage = "cancelled", "Cancelado"
        return job.public()
    with jobs_lock:
        jobs.pop(job_id, None)
    shutil.rmtree(job.folder, ignore_errors=True)
    return {"id": job_id, "status": "deleted"}


if __name__ == "__main__":
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
