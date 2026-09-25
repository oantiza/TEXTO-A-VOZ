"""Prueba de línea de comandos del motor, sin servidor HTTP.

    .venv\\Scripts\\python cli.py --image busto.png --audio locucion.wav --out salida.mp4
"""

import argparse
import time
from pathlib import Path

import cv2


def main():
    parser = argparse.ArgumentParser(description="Genera un vídeo de presentador con lip-sync a partir de imagen + WAV.")
    parser.add_argument("--image", required=True, type=Path)
    parser.add_argument("--audio", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--fps", type=int, default=30)
    parser.add_argument("--format", default="16:9", choices=["16:9", "9:16", "original"],
                        help="16:9 = YouTube 1920x1080, 9:16 = vertical 1080x1920, original = proporción de la imagen.")
    parser.add_argument("--max-dim", type=int, default=1920)
    parser.add_argument("--cfg-scale", type=float, default=4.0)
    parser.add_argument("--lip-sync", default=None, choices=["none", "musetalk", "joyvasa"],
                        help="Solo con AVATAR_MOTION_ENGINE=joyvasa: quién mueve la boca (MuseTalk por defecto).")
    parser.add_argument("--pose-smoothing", type=float, default=None,
                        help="Solo con Ditto: suavizado temporal de la pose (sigma en fotogramas a 25 fps; 3 por defecto).")
    parser.add_argument("--seed", type=int, default=0, help="Solo con Ditto: semilla del muestreo.")
    parser.add_argument("--lip-smoothing", type=float, default=None,
                        help="Solo con Ditto: suavizado temporal de los labios (sigma en fotogramas a 25 fps).")
    parser.add_argument("--lip-scale", type=float, default=1.0, help="Amplificación de los labios (1 = JoyVASA original).")
    parser.add_argument("--expression-scale", type=float, default=0.6, help="Intensidad de ojos y cejas (1 = JoyVASA original).")
    parser.add_argument("--debug-crop", action="store_true", help="Guarda el recorte facial y los puntos detectados junto al vídeo.")
    args = parser.parse_args()

    from avatar_engine import OUTPUT_FORMATS, AvatarEngine, RenderSettings, reframe_to_format
    from src.utils.io import load_image_rgb, resize_to_limit

    started = time.perf_counter()
    engine = AvatarEngine()
    print(f"Modelos cargados en {time.perf_counter() - started:.1f}s ({engine.device_name})")

    if args.debug_crop:
        img = load_image_rgb(str(args.image))
        if args.format in OUTPUT_FORMATS:
            img = reframe_to_format(img, engine.cropper.detect_pt106(img), *OUTPUT_FORMATS[args.format])
        else:
            img = resize_to_limit(img, args.max_dim, 2)
        crop = engine.cropper.crop_source_image(img)
        if crop is None:
            raise SystemExit("No se detecta cara.")
        preview = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
        for x, y in crop["pt106"]:
            cv2.circle(preview, (int(x), int(y)), 3, (0, 255, 0), -1)
        for x, y in crop["lmk_crop"]:
            cv2.circle(preview, (int(x), int(y)), 2, (0, 0, 255), -1)
        cv2.imwrite(str(args.out.with_suffix(".landmarks.jpg")), preview)
        cv2.imwrite(str(args.out.with_suffix(".crop.jpg")), cv2.cvtColor(crop["img_crop"], cv2.COLOR_RGB2BGR))

    last_stage = [""]

    def progress(stage: str, fraction: float):
        if stage != last_stage[0]:
            print()
            last_stage[0] = stage
        print(f"\r{stage}: {fraction * 100:5.1f}%", end="", flush=True)

    started = time.perf_counter()
    result = engine.render(
        args.image, args.audio, args.out,
        RenderSettings(fps=args.fps, output_format=args.format, max_dim=args.max_dim,
                       cfg_scale=args.cfg_scale, expression_scale=args.expression_scale,
                       lip_sync=args.lip_sync or RenderSettings().lip_sync, lip_scale=args.lip_scale,
                       pose_smoothing=RenderSettings().pose_smoothing if args.pose_smoothing is None else args.pose_smoothing,
                       seed=args.seed,
                       lip_smoothing=RenderSettings().lip_smoothing if args.lip_smoothing is None else args.lip_smoothing),
        progress=progress,
    )
    elapsed = time.perf_counter() - started
    print(
        f"\n{result.output_path} · {result.width}x{result.height} · {result.fps} fps · {result.frames} fotogramas · "
        f"{result.duration_sec:.1f}s de audio en {elapsed:.1f}s ({result.duration_sec / elapsed:.2f}x tiempo real)"
    )


if __name__ == "__main__":
    main()
