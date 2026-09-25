"""Motor de presentador parlante: JoyVASA (audio -> movimiento) + LivePortrait (render).

Se reutiliza el código de JoyVASA clonado en ./JoyVASA sin modificarlo, con dos cambios de
comportamiento respecto a su pipeline original:

* La detección facial de InsightFace (modelos solo para uso no comercial) se sustituye por
  MediaPipe Face Landmarker (Apache 2.0). Sus 478 puntos se reducen al esquema de 106 puntos
  que espera el recorte de LivePortrait.
* Los fotogramas se envían a ffmpeg según se generan (el original los acumula todos en RAM)
  y el movimiento, generado a 25 fps, se interpola a la cadencia de salida pedida.
"""

from __future__ import annotations

import argparse
import math
import os
import pathlib
import queue
import shutil
import subprocess
import sys
import threading
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

import cv2
import numpy as np
import torch
import torch.nn.functional as F

SERVICE_DIR = Path(__file__).resolve().parent
JOYVASA_DIR = Path(os.environ.get("JOYVASA_DIR", SERVICE_DIR / "JoyVASA")).resolve()
WEIGHTS_DIR = JOYVASA_DIR / "pretrained_weights"
FACE_LANDMARKER_MODEL = WEIGHTS_DIR / "mediapipe" / "face_landmarker.task"
MUSETALK_UNET = SERVICE_DIR / "MuseTalk" / "models" / "musetalkV15" / "unet.pth"
LIPSYNC_BATCH = 16
# "ditto": Ditto genera boca y pose y LivePortrait renderiza los labios a plena resolución.
# "joyvasa": JoyVASA + MuseTalk (alternativa; la boca sale más blanda y tiembla más).
MOTION_ENGINE = os.environ.get("AVATAR_MOTION_ENGINE", "ditto").strip().lower()

if str(JOYVASA_DIR) not in sys.path:
    sys.path.insert(0, str(JOYVASA_DIR))

from mediapipe import Image as MpImage, ImageFormat  # noqa: E402
from mediapipe.tasks.python import BaseOptions  # noqa: E402
from mediapipe.tasks.python import vision  # noqa: E402

from src.config.crop_config import CropConfig  # noqa: E402
from src.config.inference_config import InferenceConfig  # noqa: E402
from src.live_portrait_wmg_wrapper import LivePortraitWrapper  # noqa: E402
from src.utils.camera import get_rotation_matrix  # noqa: E402
from src.utils.crop import crop_image, prepare_paste_back  # noqa: E402
from src.utils.helper import calc_motion_multiplier, dct2device  # noqa: E402
from src.utils.human_landmark_runner import LandmarkRunner  # noqa: E402
from src.utils.io import load_image_rgb, resize_to_limit  # noqa: E402

torch.backends.cudnn.benchmark = True

MOTION_FPS = 25
# Índices de expresión de LivePortrait que controlan los labios (igual que en JoyVASA) y los
# párpados (los de LivePortrait; comprobados midiendo su correlación con el parpadeo).
LIP_EXP_INDICES = [6, 12, 14, 17, 19, 20]
EYE_EXP_INDICES = [11, 13, 15, 16, 18]
FACE_EXP_INDICES = [index for index in range(21) if index not in LIP_EXP_INDICES + EYE_EXP_INDICES]

ProgressCallback = Callable[[str, float], None]


class AvatarError(RuntimeError):
    """Error esperado (imagen sin cara, audio vacío...) con mensaje apto para el usuario."""


class RenderCancelled(AvatarError):
    pass


@contextmanager
def _motion_checkpoint_loadable():
    # El checkpoint de JoyVASA guarda sus hiperparámetros como argparse.Namespace y se creó en
    # Linux (contiene PosixPath). torch.load(weights_only=True) los rechaza por defecto: se
    # permiten solo esos tipos en lugar de desactivar la protección.
    path_type = pathlib.WindowsPath if os.name == "nt" else pathlib.PosixPath
    with torch.serialization.safe_globals([argparse.Namespace, (path_type, "pathlib.PosixPath")]):
        yield


def find_ffmpeg() -> str:
    candidate = os.environ.get("FFMPEG_BINARY") or shutil.which("ffmpeg")
    if candidate:
        return candidate
    import imageio_ffmpeg

    return imageio_ffmpeg.get_ffmpeg_exe()


# --------------------------------------------------------------------------------------
# MediaPipe -> esquema de 106 puntos de InsightFace
# --------------------------------------------------------------------------------------
# LivePortrait solo usa de esos 106 puntos: el centro de ambos ojos (índices 33/35/39/40 y
# 87/89/93/94), el centro de la boca (52 y 61) y la envolvente de todos los puntos (contorno,
# cejas) para calcular el tamaño y la rotación del recorte. El resto de huecos se rellena con
# puntos interiores equivalentes.
_JAW_PATH = [127, 234, 93, 132, 58, 172, 136, 150, 149, 176, 148, 152,
             377, 400, 378, 379, 365, 397, 288, 361, 323, 454, 356]
_SLOT_TO_MEDIAPIPE = {
    # ojo A: 33, 35, 39, 40 determinan su centro
    33: 33, 35: 159, 39: 133, 40: 145,
    34: 160, 36: 158, 37: 157, 38: 173, 41: 153, 42: 144,
    # ceja A
    43: 70, 44: 63, 45: 105, 46: 66, 47: 107, 48: 55, 49: 65, 50: 52, 51: 53,
    # boca: 52 y 61 son las comisuras
    52: 61, 61: 291,
    53: 185, 54: 40, 55: 39, 56: 37, 57: 0, 58: 267, 59: 269, 60: 270,
    62: 409, 63: 321, 64: 405, 65: 314, 66: 17, 67: 84, 68: 181, 69: 91, 70: 13, 71: 14,
    # nariz
    72: 168, 73: 6, 74: 197, 75: 195, 76: 5, 77: 4, 78: 1, 79: 19, 80: 94, 81: 2,
    82: 98, 83: 97, 84: 326, 85: 327, 86: 294,
    # ojo B: 87, 89, 93, 94 determinan su centro
    87: 362, 89: 386, 93: 263, 94: 374,
    88: 385, 90: 387, 91: 388, 92: 466, 95: 380, 96: 381,
    # ceja B
    97: 300, 98: 293, 99: 334, 100: 296, 101: 336, 102: 285, 103: 295, 104: 282, 105: 283,
}


def _resample_polyline(points: np.ndarray, count: int) -> np.ndarray:
    segment_lengths = np.linalg.norm(np.diff(points, axis=0), axis=1)
    distances = np.concatenate([[0.0], np.cumsum(segment_lengths)])
    targets = np.linspace(0.0, distances[-1], count)
    return np.stack([np.interp(targets, distances, points[:, axis]) for axis in (0, 1)], axis=1)


def mediapipe_to_pt106(landmarks_px: np.ndarray) -> np.ndarray:
    pt106 = np.zeros((106, 2), dtype=np.float32)
    pt106[0:33] = _resample_polyline(landmarks_px[_JAW_PATH], 33)
    for slot, mp_index in _SLOT_TO_MEDIAPIPE.items():
        pt106[slot] = landmarks_px[mp_index]
    return pt106


class MediaPipeCropper:
    """Sustituto de src.utils.cropper.Cropper para retratos humanos, sin InsightFace."""

    def __init__(self, crop_cfg: CropConfig, device_id: int = 0):
        if not FACE_LANDMARKER_MODEL.exists():
            raise FileNotFoundError(f"Falta el modelo de MediaPipe: {FACE_LANDMARKER_MODEL}")
        options = vision.FaceLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(FACE_LANDMARKER_MODEL)),
            running_mode=vision.RunningMode.IMAGE,
            num_faces=4,
            min_face_detection_confidence=0.3,
            min_face_presence_confidence=0.3,
        )
        self.landmarker = vision.FaceLandmarker.create_from_options(options)
        self.crop_cfg = crop_cfg
        self.human_landmark_runner = LandmarkRunner(
            ckpt_path=crop_cfg.landmark_ckpt_path,
            onnx_provider="cuda",
            device_id=device_id,
        )
        self.human_landmark_runner.warmup()

    def detect_pt106(self, img_rgb: np.ndarray) -> Optional[np.ndarray]:
        height, width = img_rgb.shape[:2]
        result = self.landmarker.detect(MpImage(image_format=ImageFormat.SRGB, data=np.ascontiguousarray(img_rgb)))
        if not result.face_landmarks:
            return None
        faces = [
            np.array([[point.x * width, point.y * height] for point in face], dtype=np.float32)
            for face in result.face_landmarks
        ]
        # Igual que la regla "large-small" de LivePortrait: la cara más grande.
        largest = max(faces, key=lambda pts: np.ptp(pts[:, 0]) * np.ptp(pts[:, 1]))
        return mediapipe_to_pt106(largest)

    def crop_source_image(self, img_rgb: np.ndarray) -> Optional[dict]:
        pt106 = self.detect_pt106(img_rgb)
        if pt106 is None:
            return None
        cfg = self.crop_cfg
        crop = crop_image(
            img_rgb,
            pt106,
            dsize=cfg.dsize,
            scale=cfg.scale,
            vx_ratio=cfg.vx_ratio,
            vy_ratio=cfg.vy_ratio,
            flag_do_rot=cfg.flag_do_rot,
        )
        crop["img_crop_256x256"] = cv2.resize(crop["img_crop"], (256, 256), interpolation=cv2.INTER_AREA)
        crop["lmk_crop"] = self.human_landmark_runner.run(img_rgb, pt106)  # 203 puntos, espacio original
        crop["pt106"] = pt106
        return crop


# --------------------------------------------------------------------------------------
# Motor
# --------------------------------------------------------------------------------------
class GpuPasteBack:
    """Equivalente en GPU de src.utils.crop.paste_back para una imagen fuente fija.

    El recorte facial no se mueve entre fotogramas (la fuente es una foto), así que la malla de
    muestreo y la máscara se calculan una sola vez y solo se procesa la zona de la cara.
    """

    def __init__(self, img_rgb: np.ndarray, mask_ori: np.ndarray, M_c2o: np.ndarray, crop_size: int, device: str):
        height, width = img_rgb.shape[:2]
        active = np.argwhere(mask_ori[..., 0] > 0)
        if active.size == 0:
            raise AvatarError("La cara detectada queda fuera de la imagen.")
        (y0, x0), (y1, x1) = active.min(axis=0), active.max(axis=0) + 1
        self.box = (int(y0), int(y1), int(x0), int(x1))

        ys, xs = np.mgrid[y0:y1, x0:x1].astype(np.float64)
        M_o2c = np.linalg.inv(M_c2o)
        crop_x = M_o2c[0, 0] * xs + M_o2c[0, 1] * ys + M_o2c[0, 2]
        crop_y = M_o2c[1, 0] * xs + M_o2c[1, 1] * ys + M_o2c[1, 2]
        # align_corners=True: -1 y 1 son los centros del primer y último píxel, como en cv2.
        grid = np.stack([crop_x, crop_y], axis=-1) / (crop_size - 1) * 2 - 1
        self.grid = torch.from_numpy(grid[None].astype(np.float32)).to(device)
        self.mask = torch.from_numpy(mask_ori[y0:y1, x0:x1].transpose(2, 0, 1)[None].copy()).to(device)
        self.base = torch.from_numpy(img_rgb).to(device)
        self.base_region = self.base[y0:y1, x0:x1].permute(2, 0, 1)[None].float()
        self.base_region_weighted = (1 - self.mask) * self.base_region
        self.height, self.width = height, width

    def __call__(self, face: torch.Tensor) -> np.ndarray:
        """face: 1x3x512x512 en [0, 1] (salida de LivePortrait). Devuelve HxWx3 uint8."""
        warped = F.grid_sample(face.float().clamp(0, 1) * 255, self.grid, mode="bilinear",
                               padding_mode="zeros", align_corners=True)
        region = (self.mask * warped + self.base_region_weighted).clamp(0, 255).round().to(torch.uint8)
        y0, y1, x0, x1 = self.box
        frame = self.base.clone()
        frame[y0:y1, x0:x1] = region[0].permute(1, 2, 0)
        return frame.cpu().numpy()


OUTPUT_FORMATS = {
    "16:9": (1920, 1080),  # YouTube
    "9:16": (1080, 1920),  # Shorts / Reels
}


def reframe_to_format(img_rgb: np.ndarray, pt106: np.ndarray, target_w: int, target_h: int) -> np.ndarray:
    """Recorta la mayor ventana con la proporción pedida, encuadrada en la cara, y la escala.

    Horizontalmente se centra en los ojos. Verticalmente se busca dejar los ojos algo por encima
    del centro, pero nunca a costa de cortar el pelo (se estima la coronilla desde cejas y barbilla).
    """
    height, width = img_rgb.shape[:2]
    aspect = target_w / target_h
    crop_w = min(width, height * aspect)
    crop_h = crop_w / aspect

    eyes = np.concatenate([pt106[[33, 35, 39, 40]], pt106[[87, 89, 93, 94]]])
    eyes_x, eyes_y = eyes[:, 0].mean(), eyes[:, 1].mean()
    brows_y = np.concatenate([pt106[43:52, 1], pt106[97:106, 1]]).mean()
    chin_y = pt106[0:33, 1].max()
    # Coronilla estimada con margen para peinados con volumen.
    head_top = brows_y - 0.9 * (chin_y - brows_y)

    x0 = float(np.clip(eyes_x - crop_w / 2, 0, width - crop_w))
    top = min(eyes_y - 0.4 * crop_h, head_top - 0.08 * crop_h)
    y0 = float(np.clip(top, 0, height - crop_h))

    x0, y0, crop_w, crop_h = (int(round(value)) for value in (x0, y0, crop_w, crop_h))
    window = img_rgb[y0:y0 + crop_h, x0:x0 + crop_w]
    interpolation = cv2.INTER_AREA if crop_w > target_w else cv2.INTER_LANCZOS4
    return np.ascontiguousarray(cv2.resize(window, (target_w, target_h), interpolation=interpolation))


@dataclass
class RenderSettings:
    fps: int = 30
    # "16:9" (1920×1080), "9:16" (1080×1920) u "original" (proporción de la imagen, lado mayor ≤ max_dim).
    output_format: str = "16:9"
    max_dim: int = 1920
    cfg_scale: float = 4.0
    # Intensidad de los gestos que no son de la boca (ojos, cejas): 1 = la de JoyVASA.
    expression_scale: float = 0.6
    # Suavizado temporal (sigma en fotogramas a 25 fps) de la expresión que no es de la boca.
    # JoyVASA la genera con ruido fotograma a fotograma: sin filtrar, la cara "tiembla".
    # Medido (temblor de puntos rígidos de la cabeza): 1,11 px sin filtro -> 0,48 px con 6/1,
    # conservando los parpadeos (con expresión congelada: 0,32 px, pero sin parpadeos).
    expression_smoothing: float = 6.0
    eye_smoothing: float = 1.0
    # "musetalk": la boca la regenera MuseTalk a partir del audio (LivePortrait deja los labios
    # quietos). "joyvasa": labios de JoyVASA, articulan poco; solo como alternativa.
    lip_sync: str = "musetalk" if MOTION_ENGINE == "joyvasa" else "none"
    # Solo con Ditto: suavizado temporal de la pose (sigma en fotogramas a 25 fps) y semilla del
    # muestreo por difusión (mismo audio + misma semilla = mismo vídeo).
    # Medido (temblor en píxeles de la zona frente/gafas): 0,17 px sin filtro, 0,11 con 3, 0,07 con 6.
    pose_smoothing: float = float(os.environ.get("AVATAR_POSE_SMOOTHING", "6.0"))
    # Medido: la vibración de la anchura de la boca (>8 Hz) baja de 1,5 % a 1,0 % con 1,2 y el
    # recorrido de los labios solo un 5 %; el filtro es simétrico, así que no retrasa la boca.
    lip_smoothing: float = float(os.environ.get("AVATAR_LIP_SMOOTHING", "1.2"))
    seed: int = 0
    # Elevación del labio superior (fracción de la apertura de la boca), solo con MuseTalk: este
    # mueve sobre todo mandíbula y labio inferior (medido: superior ~8,8 px de recorrido frente a
    # ~17 px del inferior; con 0,6 el superior pasa a ~11,9 px sin deformar el bigote).
    upper_lip_lift: float = float(os.environ.get("AVATAR_UPPER_LIP_LIFT", "0.6"))
    # Amplificación de los labios de JoyVASA (solo con lip_sync="joyvasa").
    lip_scale: float = 1.0
    crf: int = 18


@dataclass
class RenderResult:
    output_path: Path
    width: int
    height: int
    fps: int
    frames: int
    duration_sec: float


def _generate_mouths(lipsync, tracker, frames: list[np.ndarray], audio_prompts: torch.Tensor, first_index: int):
    """Parte de GPU del lip-sync para un lote: localiza la cara y regenera la boca con MuseTalk.

    Devuelve [(fotograma, boca, geometría)] para fundir después (en otro hilo). El lote se rellena
    siempre hasta LIPSYNC_BATCH: cada tamaño nuevo obliga a cuDNN a recalibrar (segundos).
    """
    from lipsync import audio_lead_frames, crop_for_model

    geometry = [tracker.locate(frame) for frame in frames]
    valid = [position for position, found in enumerate(geometry) if found is not None]
    mouths: list = [None] * len(frames)
    if valid:
        crops = [crop_for_model(frames[position], geometry[position][0]) for position in valid]
        lead = audio_lead_frames()
        audio_indices = [min(first_index + position + lead, len(audio_prompts) - 1) for position in valid]
        padding = LIPSYNC_BATCH - len(crops)
        crops += [crops[-1]] * padding
        audio_indices += [audio_indices[-1]] * padding
        generated = lipsync.generate(np.stack(crops), audio_prompts[audio_indices])
        for mouth, position in zip(generated, valid):
            mouths[position] = mouth
    return list(zip(frames, mouths, geometry))


def _blend_mouths(items, lifter=None) -> list[np.ndarray]:
    """Parte de CPU: funde cada boca regenerada con su fotograma (recuperando la barba) y, si
    procede, eleva el labio superior según la apertura de la boca."""
    from lipsync import blend

    result = []
    for frame, mouth, geometry in items:
        if mouth is None:
            result.append(frame)
            continue
        box, mask, detail_mask = geometry
        blended = blend(frame, mouth, box, mask, detail_mask)
        result.append(lifter(blended) if lifter is not None else blended)
    return result


class _FrameWriter:
    """Hilo que funde las bocas y envía los fotogramas a ffmpeg mientras la GPU sigue
    renderizando el lote siguiente (la fusión y la escritura son CPU)."""

    def __init__(self, encoder: subprocess.Popen, lifter_factory=None):
        self.encoder = encoder
        self.lifter_factory = lifter_factory
        self.queue: "queue.Queue" = queue.Queue(maxsize=2)
        self.error: BaseException | None = None
        self.thread = threading.Thread(target=self._run, name="frame-writer", daemon=True)
        self.thread.start()

    def _run(self) -> None:
        # El detector de MediaPipe del elevador de labio se crea y se usa solo en este hilo.
        lifter = self.lifter_factory() if self.lifter_factory is not None else None
        try:
            while True:
                item = self.queue.get()
                if item is None:
                    return
                if self.error is not None:
                    continue
                try:
                    frames = _blend_mouths(item, lifter) if isinstance(item[0], tuple) else item
                    for frame in frames:
                        self.encoder.stdin.write(np.ascontiguousarray(frame, dtype=np.uint8).tobytes())
                except BaseException as exc:  # se relanza en el hilo principal
                    self.error = exc
        finally:
            if lifter is not None:
                lifter.close()

    def put(self, item) -> None:
        if self.error is not None:
            raise self.error
        self.queue.put(item)

    def finish(self) -> None:
        self.queue.put(None)
        self.thread.join()
        if self.error is not None:
            raise self.error


def _smooth_expression(motion: list[dict], sigma_face: float, sigma_eyes: float) -> list[dict]:
    """Filtro gaussiano temporal de la expresión, salvo los labios (la pose ya viene suavizada).

    Los párpados llevan un filtro mucho más ligero: un parpadeo dura 3-4 fotogramas y con el
    filtro del resto de la cara se vería a cámara lenta.
    """
    from scipy.ndimage import gaussian_filter1d

    expressions = np.stack([frame["exp"] for frame in motion])  # [T, 1, 21, 3]
    for indices, sigma in ((FACE_EXP_INDICES, sigma_face), (EYE_EXP_INDICES, sigma_eyes)):
        if sigma > 0:
            expressions[:, :, indices] = gaussian_filter1d(expressions[:, :, indices], sigma, axis=0, mode="nearest")
    return [{**frame, "exp": expressions[index]} for index, frame in enumerate(motion)]


def _resample_motion(motion: list[dict], source_fps: int, target_fps: int, frame_count: int) -> list[dict]:
    """Interpola la secuencia de movimiento (25 fps) a la cadencia de salida."""
    last = len(motion) - 1
    resampled = []
    for index in range(frame_count):
        position = min(index * source_fps / target_fps, last)
        low = int(math.floor(position))
        high = min(low + 1, last)
        weight = position - low
        frame = {
            key: (1 - weight) * motion[low][key] + weight * motion[high][key]
            for key in ("exp", "scale", "t", "pitch", "yaw", "roll")
        }
        frame["R"] = (
            get_rotation_matrix(
                torch.from_numpy(frame["pitch"].reshape(1)),
                torch.from_numpy(frame["yaw"].reshape(1)),
                torch.from_numpy(frame["roll"].reshape(1)),
            )
            .reshape(1, 3, 3)
            .numpy()
            .astype(np.float32)
        )
        resampled.append(frame)
    return resampled


class AvatarEngine:
    def __init__(self, device_id: int = 0, half_precision: bool = True):
        if not torch.cuda.is_available():
            raise AvatarError("PyTorch no detecta ninguna GPU CUDA.")
        self.device_id = device_id
        self.motion_engine = MOTION_ENGINE
        self.crop_cfg = CropConfig(device_id=device_id)
        self.cropper = MediaPipeCropper(self.crop_cfg, device_id=device_id)
        self.ffmpeg = find_ffmpeg()
        self._lock = threading.Lock()
        self.wrapper = None
        self.lipsync = None
        self.ditto = None
        if self.motion_engine == "ditto":
            from ditto_motion import DittoMotion

            self.ditto = DittoMotion(device="cuda")
            return
        self.inference_cfg = InferenceConfig(
            device_id=device_id,
            flag_use_half_precision=half_precision,
            flag_do_crop=True,
            flag_pasteback=True,
            flag_stitching=True,
            flag_relative_motion=True,
            flag_normalize_lip=True,
            driving_option="expression-friendly",
            driving_multiplier=1.0,
            animation_region="all",
        )
        with _motion_checkpoint_loadable():
            self.wrapper = LivePortraitWrapper(inference_cfg=self.inference_cfg)
        if MUSETALK_UNET.exists():
            from lipsync import MuseTalkLipSync

            self.lipsync = MuseTalkLipSync(self.wrapper.device, FACE_LANDMARKER_MODEL)

    @property
    def device_name(self) -> str:
        return torch.cuda.get_device_name(self.device_id)

    def warmup(self) -> None:
        """Primera pasada con datos sintéticos: cuDNN elige sus algoritmos (≈20 s) al arrancar
        el servicio y no durante el primer vídeo del usuario."""
        import tempfile

        import soundfile

        if self.ditto is not None:
            with self._lock, torch.inference_mode():
                self.ditto.warmup()
            return

        wrapper = self.wrapper
        with self._lock, torch.inference_mode():
            I_s = wrapper.prepare_source(np.full((256, 256, 3), 127, dtype=np.uint8))
            x_s = wrapper.transform_keypoint(wrapper.get_kp_info(I_s))
            f_s = wrapper.extract_feature_3d(I_s)
            for _ in range(2):
                wrapper.warp_decode(f_s, x_s, wrapper.stitching(x_s, x_s))
            with tempfile.TemporaryDirectory() as tmp:
                silence = Path(tmp) / "silence.wav"
                soundfile.write(silence, np.zeros(16000, dtype=np.float32), 16000)
                wrapper.gen_motion_sequence(_MotionArgs(audio=str(silence)))
                if self.lipsync is not None:
                    self.lipsync.audio_prompts(str(silence), 30, 30)
                    self.lipsync.warmup(LIPSYNC_BATCH)
            torch.cuda.synchronize()

    def render(
        self,
        image_path: str | Path,
        audio_path: str | Path,
        output_path: str | Path,
        settings: RenderSettings | None = None,
        progress: ProgressCallback | None = None,
        cancel_event: threading.Event | None = None,
    ) -> RenderResult:
        # Una sola GPU: los trabajos se serializan.
        renderer = self._render_ditto if self.ditto is not None else self._render
        with self._lock, torch.inference_mode():
            return renderer(
                Path(image_path), Path(audio_path), Path(output_path),
                settings or RenderSettings(), progress or (lambda stage, fraction: None), cancel_event,
            )

    def _prepare_image(self, image_path: Path, settings: "RenderSettings"):
        """Carga, encuadra al formato pedido y localiza la cara. Devuelve (imagen RGB, 106 puntos)."""
        img_rgb = load_image_rgb(str(image_path))
        target_size = OUTPUT_FORMATS.get(settings.output_format)
        if target_size is not None:
            pt106 = self.cropper.detect_pt106(img_rgb)
            if pt106 is None:
                raise AvatarError("No se ha detectado ninguna cara en la imagen del presentador.")
            img_rgb = reframe_to_format(img_rgb, pt106, *target_size)
        else:
            img_rgb = resize_to_limit(img_rgb, settings.max_dim, 2)
        pt106 = self.cropper.detect_pt106(img_rgb)
        if pt106 is None:
            raise AvatarError("No se ha detectado ninguna cara en la imagen del presentador.")
        return np.ascontiguousarray(img_rgb), pt106

    def _start_encoder(self, width: int, height: int, fps: int, audio_path: Path, output_path: Path, crf: int):
        output_path.parent.mkdir(parents=True, exist_ok=True)
        return subprocess.Popen(
            [
                self.ffmpeg, "-y", "-loglevel", "error",
                "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{width}x{height}", "-r", str(fps), "-i", "-",
                "-i", str(audio_path),
                "-map", "0:v", "-map", "1:a",
                "-c:v", "libx264", "-preset", "medium", "-crf", str(crf), "-pix_fmt", "yuv420p",
                # Conversión y etiquetas BT.709 (ffmpeg usaría BT.601 por defecto): YouTube y los
                # reproductores muestran los tonos de piel tal cual.
                "-vf", "scale=out_color_matrix=bt709:out_range=tv,"
                       "setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv",
                "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
                "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
                "-movflags", "+faststart",
                str(output_path),
            ],
            stdin=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

    def _render_ditto(self, image_path, audio_path, output_path, settings, report, cancel_event) -> RenderResult:
        from ditto_motion import DittoMotion

        def check_cancelled():
            if cancel_event is not None and cancel_event.is_set():
                raise RenderCancelled("Generación cancelada.")

        ditto = self.ditto
        report("Analizando la imagen", 0.0)
        img_rgb, pt106 = self._prepare_image(image_path, settings)
        height, width = img_rgb.shape[:2]
        source_info = ditto.register(img_rgb, pt106)
        M_c2o = source_info["M_c2o_lst"][0]
        mask_ori = cv2.warpAffine(ditto.mask_crop, M_c2o[:2, :], dsize=(width, height), flags=cv2.INTER_LINEAR)
        paste_back_gpu = GpuPasteBack(img_rgb, np.clip(mask_ori, 0, 1), M_c2o, 512, "cuda")
        check_cancelled()

        audio_duration = _probe_duration(audio_path)
        if audio_duration <= 0.05:
            raise AvatarError("El audio está vacío o es demasiado corto.")
        frame_count = max(1, math.ceil(audio_duration * settings.fps))
        report("Generando el movimiento a partir del audio", 0.05)
        sequence = ditto.motion_sequence(
            source_info, str(audio_path), seed=settings.seed,
            progress=lambda fraction: report("Generando el movimiento a partir del audio", 0.05 + 0.1 * fraction),
        )
        sequence = DittoMotion.smooth(sequence, settings.pose_smoothing, settings.lip_smoothing)
        sequence = DittoMotion.resample(sequence, settings.fps, frame_count)
        driving = ditto.driving_frames(sequence)
        ditto.setup_stitch(source_info, frame_count)
        f_s = ditto.feature_tensor(source_info)
        check_cancelled()

        encoder = self._start_encoder(width, height, settings.fps, audio_path, output_path, settings.crf)
        writer = _FrameWriter(encoder)
        pending: list[np.ndarray] = []
        try:
            for index, x_d_info in enumerate(driving):
                if index % 15 == 0:
                    check_cancelled()
                    report("Renderizando el vídeo", 0.15 + 0.8 * index / frame_count)
                x_s, x_d = ditto.keypoints(source_info, x_d_info)
                face = ditto.render(f_s, x_s.astype(np.float32), x_d.astype(np.float32))
                pending.append(paste_back_gpu(face))
                if len(pending) == LIPSYNC_BATCH:
                    writer.put(pending)
                    pending = []
            if pending:
                writer.put(pending)
            writer.finish()

            report("Codificando el MP4", 0.96)
            encoder.stdin.close()
            stderr = encoder.stderr.read().decode(errors="replace")
            if encoder.wait() != 0:
                raise AvatarError(f"ffmpeg no pudo codificar el vídeo: {stderr.strip()[-400:]}")
        except BaseException:
            encoder.kill()
            if writer.thread.is_alive():
                writer.queue.put(None)
                writer.thread.join(timeout=10)
            encoder.wait()
            output_path.unlink(missing_ok=True)
            raise

        report("Listo", 1.0)
        return RenderResult(output_path, width, height, settings.fps, frame_count, audio_duration)

    def _render(self, image_path, audio_path, output_path, settings, report, cancel_event) -> RenderResult:
        def check_cancelled():
            if cancel_event is not None and cancel_event.is_set():
                raise RenderCancelled("Generación cancelada.")

        wrapper = self.wrapper
        cfg = self.inference_cfg
        device = wrapper.device

        report("Analizando la imagen", 0.0)
        img_rgb = load_image_rgb(str(image_path))
        target_size = OUTPUT_FORMATS.get(settings.output_format)
        if target_size is not None:
            pt106 = self.cropper.detect_pt106(img_rgb)
            if pt106 is None:
                raise AvatarError("No se ha detectado ninguna cara en la imagen del presentador.")
            img_rgb = reframe_to_format(img_rgb, pt106, *target_size)
        else:
            img_rgb = resize_to_limit(img_rgb, settings.max_dim, 2)
        height, width = img_rgb.shape[:2]
        crop = self.cropper.crop_source_image(img_rgb)
        if crop is None:
            raise AvatarError("No se ha detectado ninguna cara en la imagen del presentador.")

        source_lmk = crop["lmk_crop"]
        I_s = wrapper.prepare_source(crop["img_crop_256x256"])
        x_s_info = wrapper.get_kp_info(I_s)
        x_c_s = x_s_info["kp"]
        R_s = get_rotation_matrix(x_s_info["pitch"], x_s_info["yaw"], x_s_info["roll"])
        f_s = wrapper.extract_feature_3d(I_s)
        x_s = wrapper.transform_keypoint(x_s_info)

        lip_delta_before_animation = None
        if cfg.flag_normalize_lip:
            lip_ratio = wrapper.calc_combined_lip_ratio([0.0], source_lmk)
            if lip_ratio[0][0] >= cfg.lip_normalize_threshold:
                lip_delta_before_animation = wrapper.retarget_lip(x_s, lip_ratio)

        mask_ori = prepare_paste_back(cfg.mask_crop, crop["M_c2o"], dsize=(width, height))
        paste_back_gpu = GpuPasteBack(img_rgb, mask_ori, crop["M_c2o"], self.crop_cfg.dsize, device)
        check_cancelled()

        report("Generando el movimiento a partir del audio", 0.05)
        motion_args = _MotionArgs(audio=str(audio_path), cfg_scale=settings.cfg_scale)
        motion = wrapper.gen_motion_sequence(motion_args)["motion"]
        if settings.expression_smoothing > 0 or settings.eye_smoothing > 0:
            motion = _smooth_expression(motion, settings.expression_smoothing, settings.eye_smoothing)
        audio_duration = _probe_duration(audio_path)
        if audio_duration <= 0.05:
            raise AvatarError("El audio está vacío o es demasiado corto.")
        frame_count = max(1, math.ceil(audio_duration * settings.fps))
        motion = _resample_motion(motion, MOTION_FPS, settings.fps, frame_count)
        check_cancelled()

        use_musetalk = settings.lip_sync == "musetalk"
        if use_musetalk and self.lipsync is None:
            raise AvatarError("Faltan los modelos de MuseTalk: ejecuta npm run avatar:setup.")
        audio_prompts = self.lipsync.audio_prompts(str(audio_path), settings.fps, frame_count) if use_musetalk else None
        # Con MuseTalk los labios de LivePortrait se quedan en reposo: la boca se regenera después.
        lip_scale = 0.0 if use_musetalk else settings.lip_scale

        # Referencia "neutra" del movimiento generado. JoyVASA usa el primer fotograma para todo;
        # aquí los labios siguen usándolo (el audio empieza con silencio: boca cerrada), pero ojos
        # y cejas se miden respecto a la expresión media de la secuencia. Si el primer fotograma
        # salía con los ojos entornados, el resto del vídeo parecía una mirada de sorpresa.
        # dct2device modifica el diccionario que recibe: se le pasan copias.
        reference = dct2device(dict(motion[0]), device)
        non_lip = [index for index in range(21) if index not in LIP_EXP_INDICES]
        mean_exp = torch.from_numpy(np.mean([frame["exp"] for frame in motion], axis=0)).to(device)
        reference["exp"] = reference["exp"].clone()
        reference["exp"][:, non_lip, :] = mean_exp[:, non_lip, :]
        R_d_0 = reference["R"]

        def driving_keypoints(info: dict) -> torch.Tensor:
            R_new = (info["R"] @ R_d_0.permute(0, 2, 1)) @ R_s
            delta_new = x_s_info["exp"] + (info["exp"] - reference["exp"]) * settings.expression_scale
            # Labios: movimiento respecto a la boca de referencia (silencio inicial) × lip_scale.
            reference_lips = reference["exp"][:, LIP_EXP_INDICES, :]
            delta_new[:, LIP_EXP_INDICES, :] = reference_lips + (
                info["exp"][:, LIP_EXP_INDICES, :] - reference_lips
            ) * lip_scale
            scale_new = x_s_info["scale"] * (info["scale"] / reference["scale"])
            t_new = x_s_info["t"] + (info["t"] - reference["t"])
            t_new[..., 2] = 0
            return scale_new * (x_c_s @ R_new + delta_new) + t_new

        x_d_ref_new = driving_keypoints(reference)
        motion_multiplier = calc_motion_multiplier(x_s, x_d_ref_new)

        output_path.parent.mkdir(parents=True, exist_ok=True)
        encoder = subprocess.Popen(
            [
                self.ffmpeg, "-y", "-loglevel", "error",
                "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{width}x{height}", "-r", str(settings.fps), "-i", "-",
                "-i", str(audio_path),
                "-map", "0:v", "-map", "1:a",
                "-c:v", "libx264", "-preset", "medium", "-crf", str(settings.crf), "-pix_fmt", "yuv420p",
                # Conversión y etiquetas BT.709 (ffmpeg usaría BT.601 por defecto): YouTube y los
                # reproductores muestran los tonos de piel tal cual.
                "-vf", "scale=out_color_matrix=bt709:out_range=tv,"
                       "setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv",
                "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
                "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
                "-movflags", "+faststart",
                str(output_path),
            ],
            stdin=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

        tracker = self.lipsync.new_tracker() if use_musetalk else None
        lifter_factory = None
        if use_musetalk and settings.upper_lip_lift > 0:
            from lipsync import UpperLipLifter

            lifter_factory = lambda: UpperLipLifter(FACE_LANDMARKER_MODEL, settings.upper_lip_lift)  # noqa: E731
        writer = _FrameWriter(encoder, lifter_factory)
        pending: list[np.ndarray] = []

        def write_frames(frames: list[np.ndarray], first_index: int) -> None:
            if tracker is not None:
                writer.put(_generate_mouths(self.lipsync, tracker, frames, audio_prompts, first_index))
            else:
                writer.put(frames)

        stage = "Renderizando el vídeo y sincronizando los labios" if use_musetalk else "Renderizando el vídeo"
        try:
            for index, frame_motion in enumerate(motion):
                if index % 15 == 0:
                    check_cancelled()
                    report(stage, 0.15 + 0.8 * index / frame_count)
                x_d_i_new = driving_keypoints(dct2device(dict(frame_motion), device))
                x_d_i_new = (x_d_i_new - x_d_ref_new) * motion_multiplier + x_s

                x_d_i_new = wrapper.stitching(x_s, x_d_i_new)
                if lip_delta_before_animation is not None:
                    x_d_i_new = x_d_i_new + lip_delta_before_animation
                x_d_i_new = x_s + (x_d_i_new - x_s) * cfg.driving_multiplier

                out = wrapper.warp_decode(f_s, x_s, x_d_i_new)
                pending.append(paste_back_gpu(out["out"]))
                if len(pending) == LIPSYNC_BATCH:
                    write_frames(pending, index + 1 - len(pending))
                    pending = []
            if pending:
                write_frames(pending, frame_count - len(pending))
            writer.finish()

            report("Codificando el MP4", 0.96)
            encoder.stdin.close()
            stderr = encoder.stderr.read().decode(errors="replace")
            if encoder.wait() != 0:
                raise AvatarError(f"ffmpeg no pudo codificar el vídeo: {stderr.strip()[-400:]}")
        except BaseException:
            encoder.kill()
            if writer.thread.is_alive():
                writer.queue.put(None)
                writer.thread.join(timeout=10)
            encoder.wait()
            output_path.unlink(missing_ok=True)
            raise
        finally:
            if tracker is not None:
                tracker.close()

        report("Listo", 1.0)
        return RenderResult(output_path, width, height, settings.fps, frame_count, audio_duration)


@dataclass
class _MotionArgs:
    """Subconjunto de ArgumentConfig que usa LivePortraitWrapper.gen_motion_sequence."""

    audio: str
    cfg_scale: float = 4.0
    cfg_mode: str = "incremental"
    cfg_cond: Optional[list] = None
    is_smooth_motion: bool = True


def _probe_duration(audio_path: Path) -> float:
    import soundfile

    try:
        info = soundfile.info(str(audio_path))
        return info.frames / float(info.samplerate)
    except RuntimeError:
        import librosa

        return float(librosa.get_duration(path=str(audio_path)))
