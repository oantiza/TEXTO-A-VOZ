"""Lip-sync con MuseTalk 1.5 sobre los fotogramas ya animados por LivePortrait.

MuseTalk (MIT, pesos aptos para uso comercial) regenera la mitad inferior de la cara a partir
del audio. Del repositorio original solo se usan la red (UNet), el VAE sd-vae-ft-mse (MIT) y
Whisper-tiny (Apache 2.0). Se sustituyen sus piezas auxiliares:

* DWPose + S3FD (recuadro de la cara, requieren mmcv/mmpose) -> MediaPipe Face Landmarker.
* face-parse-bisent (máscara de fusión, entrenado con CelebAMask-HQ, solo no comercial)
  -> máscara geométrica construida con los puntos de MediaPipe.
"""

from __future__ import annotations

import json
import math
import os
from pathlib import Path

import cv2
import librosa
import numpy as np
import torch
from diffusers import AutoencoderKL, UNet2DConditionModel
from mediapipe import Image as MpImage, ImageFormat
from mediapipe.tasks.python import BaseOptions, vision
from transformers import AutoFeatureExtractor, WhisperModel

SERVICE_DIR = Path(__file__).resolve().parent
MUSETALK_MODELS = SERVICE_DIR / "MuseTalk" / "models"

CROP_SIZE = 256
AUDIO_FPS = 50  # fotogramas de características de Whisper por segundo
AUDIO_PADDING = 2  # contexto de audio a cada lado (igual que MuseTalk)
AUDIO_WINDOW = 2 * (2 * AUDIO_PADDING + 1)

# Puntos de MediaPipe usados (malla de 478).
JAW = [127, 234, 93, 132, 58, 172, 136, 150, 149, 176, 148, 152,
       377, 400, 378, 379, 365, 397, 288, 361, 323, 454, 356]
NOSE_BRIDGE_LOW = 5  # equivale al punto 29 de los 68 de DWPose que usa MuseTalk
SUBNASALE = 2  # base de la nariz: límite superior de la zona que se regenera
# Radio (relativo al ancho del recuadro) que separa "forma" (MuseTalk) de "textura" (original):
# mayor = más densidad y tono de barba recuperados.
DETAIL_SIGMA = float(os.environ.get("AVATAR_DETAIL_SIGMA", "0.03"))
OUTER_LIPS = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185]


class PositionalEncoding(torch.nn.Module):
    """Codificación posicional de MuseTalk para las características de audio (d_model=384).

    Adaptada de MuseTalk (musetalk/models/unet.py), © TMElyralab, licencia MIT; igual que el
    troceado de audio de audio_prompts() y la geometría del recuadro de _mouth_geometry().
    """

    def __init__(self, d_model: int = 384, max_len: int = 5000):
        super().__init__()
        position = torch.arange(0, max_len, dtype=torch.float).unsqueeze(1)
        div_term = torch.exp(torch.arange(0, d_model, 2).float() * (-math.log(10000.0) / d_model))
        pe = torch.zeros(max_len, d_model)
        pe[:, 0::2] = torch.sin(position * div_term)
        pe[:, 1::2] = torch.cos(position * div_term)
        self.register_buffer("pe", pe.unsqueeze(0))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return x + self.pe[:, : x.size(1), :].to(x.dtype)


class _Smoother:
    """Media exponencial para que el recuadro y la máscara no tiemblen entre fotogramas."""

    def __init__(self, alpha: float):
        self.alpha = alpha
        self.value = None

    def __call__(self, value: np.ndarray) -> np.ndarray:
        self.value = value if self.value is None else self.alpha * value + (1 - self.alpha) * self.value
        return self.value


class MuseTalkLipSync:
    def __init__(self, device: str, landmarker_model: Path, dtype: torch.dtype = torch.float16):
        self.device = device
        self.dtype = dtype
        self.vae = AutoencoderKL.from_pretrained(MUSETALK_MODELS / "sd-vae", torch_dtype=dtype).to(device).eval()
        with open(MUSETALK_MODELS / "musetalkV15" / "musetalk.json", encoding="utf-8") as config:
            self.unet = UNet2DConditionModel(**json.load(config))
        state = torch.load(MUSETALK_MODELS / "musetalkV15" / "unet.pth", map_location="cpu", weights_only=True)
        self.unet.load_state_dict(state)
        del state
        self.unet = self.unet.to(device, dtype).eval()
        self.pe = PositionalEncoding().to(device)
        self.feature_extractor = AutoFeatureExtractor.from_pretrained(MUSETALK_MODELS / "whisper")
        self.whisper = WhisperModel.from_pretrained(MUSETALK_MODELS / "whisper", torch_dtype=dtype).to(device).eval()
        self.landmarker_model = landmarker_model
        self._timestamp_ms = 0

    # ---------------------------------------------------------------- audio
    @torch.inference_mode()
    def audio_prompts(self, audio_path: str, fps: int, frame_count: int) -> torch.Tensor:
        """Características de Whisper por fotograma: [frame_count, 50, 384]."""
        wav, _ = librosa.load(audio_path, sr=16000)
        segment = 30 * 16000
        features = []
        for start in range(0, len(wav), segment):
            mel = self.feature_extractor(wav[start:start + segment], sampling_rate=16000, return_tensors="pt").input_features
            hidden = self.whisper.encoder(mel.to(self.device, self.dtype), output_hidden_states=True).hidden_states
            features.append(torch.stack(hidden, dim=2))  # [1, 1500, 5, 384]
        features = torch.cat(features, dim=1)[:, : math.floor(len(wav) / 16000 * AUDIO_FPS)]

        step = AUDIO_FPS / fps
        pad = math.ceil(step)
        features = torch.cat([
            torch.zeros_like(features[:, : pad * AUDIO_PADDING]),
            features,
            torch.zeros_like(features[:, : pad * 3 * AUDIO_PADDING]),
        ], dim=1)
        last_start = features.shape[1] - AUDIO_WINDOW
        prompts = [
            features[:, min(math.floor(index * step), last_start): min(math.floor(index * step), last_start) + AUDIO_WINDOW]
            for index in range(frame_count)
        ]
        prompts = torch.cat(prompts, dim=0)  # [T, 10, 5, 384]
        return prompts.reshape(prompts.shape[0], -1, prompts.shape[-1])  # [T, 50, 384]

    # ---------------------------------------------------------------- geometría
    def new_tracker(self) -> "_FaceTracker":
        return _FaceTracker(self)

    def _create_landmarker(self):
        options = vision.FaceLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(self.landmarker_model)),
            running_mode=vision.RunningMode.VIDEO,
            num_faces=1,
            min_face_detection_confidence=0.3,
            min_face_presence_confidence=0.3,
            min_tracking_confidence=0.3,
        )
        return vision.FaceLandmarker.create_from_options(options)

    # ---------------------------------------------------------------- red
    @torch.inference_mode()
    def generate(self, crops: np.ndarray, audio: torch.Tensor) -> np.ndarray:
        """crops: [B, 256, 256, 3] uint8 RGB -> bocas regeneradas con la misma forma."""
        pixels = torch.from_numpy(crops).to(self.device).permute(0, 3, 1, 2).to(self.dtype) / 255.0
        masked = pixels.clone()
        masked[:, :, CROP_SIZE // 2:, :] = 0  # MuseTalk tapa la mitad inferior
        scaling = self.vae.config.scaling_factor
        masked_latents = self.vae.encode(masked * 2 - 1).latent_dist.mode() * scaling
        ref_latents = self.vae.encode(pixels * 2 - 1).latent_dist.mode() * scaling
        latents = torch.cat([masked_latents, ref_latents], dim=1)
        audio_features = self.pe(audio.to(self.dtype))
        timesteps = torch.zeros(1, device=self.device)
        predicted = self.unet(latents, timesteps, encoder_hidden_states=audio_features).sample
        images = self.vae.decode(predicted / scaling).sample
        images = ((images.float() / 2 + 0.5).clamp(0, 1) * 255).round().to(torch.uint8)
        return images.permute(0, 2, 3, 1).cpu().numpy()

    def warmup(self, batch_size: int) -> None:
        crops = np.full((batch_size, CROP_SIZE, CROP_SIZE, 3), 127, dtype=np.uint8)
        audio = torch.zeros(batch_size, AUDIO_WINDOW * 5, 384, device=self.device)
        self.generate(crops, audio)


class _FaceTracker:
    """Recuadro y máscara de la boca por fotograma, con seguimiento y suavizado."""

    def __init__(self, lipsync: MuseTalkLipSync):
        self.lipsync = lipsync
        self.landmarker = lipsync._create_landmarker()
        self.points = _Smoother(alpha=0.6)
        self.last = None

    def close(self) -> None:
        self.landmarker.close()

    def locate(self, frame: np.ndarray):
        """Devuelve (bbox, máscara del recuadro) o la última conocida si no se detecta la cara."""
        height, width = frame.shape[:2]
        self.lipsync._timestamp_ms += 33
        result = self.landmarker.detect_for_video(
            MpImage(image_format=ImageFormat.SRGB, data=np.ascontiguousarray(frame)), self.lipsync._timestamp_ms
        )
        if result.face_landmarks:
            points = np.array([[p.x * width, p.y * height] for p in result.face_landmarks[0]], dtype=np.float32)
            self.last = _mouth_geometry(self.points(points), width, height)
        return self.last


def _mouth_geometry(points: np.ndarray, width: int, height: int):
    """Recuadro al estilo MuseTalk y máscara de fusión de la parte baja de la cara."""
    jaw = points[JAW]
    nose_y = points[NOSE_BRIDGE_LOW, 1]
    chin_y = jaw[:, 1].max()
    half_face = chin_y - nose_y
    x1, x2 = int(jaw[:, 0].min()), int(math.ceil(jaw[:, 0].max()))
    y1 = int(max(0, nose_y - half_face))
    y2 = int(min(height, chin_y + 0.04 * (chin_y - y1)))  # margen extra de MuseTalk 1.5
    x1, x2 = max(0, x1), min(width, x2)
    box_w, box_h = x2 - x1, y2 - y1
    if box_w < 32 or box_h < 32:
        return None

    # Polígono: mandíbula por debajo de la base de la nariz, algo estrechado por los lados
    # (como la erosión de mejillas de MuseTalk) y bajado un poco para dejar abrir la boca.
    top = points[SUBNASALE, 1]
    center_x = points[SUBNASALE, 0]
    below = jaw[jaw[:, 1] >= top]
    polygon = below.copy()
    polygon[:, 0] = center_x + (polygon[:, 0] - center_x) * 0.88
    polygon[:, 1] = top + (polygon[:, 1] - top) * 1.06
    # Orden por ángulo desde la base de la nariz: derecha -> barbilla -> izquierda, y se cierra
    # con la línea horizontal a la altura de la nariz.
    order = np.argsort(np.arctan2(polygon[:, 1] - top, polygon[:, 0] - center_x))
    polygon = np.vstack([[[polygon[:, 0].max(), top]], polygon[order], [[polygon[:, 0].min(), top]]])

    mask = np.zeros((box_h, box_w), dtype=np.float32)
    cv2.fillPoly(mask, [np.round(polygon - [x1, y1]).astype(np.int32)], 1.0)
    blur = int(0.08 * box_w) | 1
    mask = cv2.GaussianBlur(mask, (blur, blur), 0)
    # Nunca tocar los bordes del recuadro: evita costuras.
    ramp = max(2, int(0.04 * min(box_w, box_h)))
    columns = np.minimum(np.arange(box_w), np.arange(box_w)[::-1])[None, :]
    rows = np.minimum(np.arange(box_h), np.arange(box_h)[::-1])[:, None]
    edge = np.minimum(columns, rows).astype(np.float32)
    mask *= np.clip(edge / ramp, 0, 1)

    # Zona de la boca (labios y lo que ocupa al abrirse): ahí manda solo MuseTalk. Fuera de ella
    # se recupera la textura fina del fotograma original (barba, bigote, poros).
    lips = points[OUTER_LIPS]
    lips_center = lips.mean(axis=0)
    lips_width = np.ptp(lips[:, 0])
    mouth = lips.copy()
    mouth[:, 0] = lips_center[0] + (mouth[:, 0] - lips_center[0]) * 1.12
    below = mouth[:, 1] > lips_center[1]
    mouth[below, 1] += 0.45 * lips_width  # espacio para que la mandíbula baje al hablar
    mouth[~below, 1] -= 0.04 * lips_width
    mouth_mask = np.zeros((box_h, box_w), dtype=np.float32)
    cv2.fillPoly(mouth_mask, [np.round(cv2.convexHull(mouth) - [x1, y1]).astype(np.int32)], 1.0)
    mouth_blur = int(0.25 * lips_width) | 1
    mouth_mask = cv2.GaussianBlur(mouth_mask, (mouth_blur, mouth_blur), 0)
    detail_mask = 1.0 - mouth_mask
    return (x1, y1, x2, y2), mask[..., None], detail_mask[..., None]


def crop_for_model(frame: np.ndarray, box) -> np.ndarray:
    x1, y1, x2, y2 = box
    return cv2.resize(frame[y1:y2, x1:x2], (CROP_SIZE, CROP_SIZE), interpolation=cv2.INTER_LANCZOS4)


def blend(frame: np.ndarray, generated: np.ndarray, box, mask: np.ndarray, detail_mask: np.ndarray) -> np.ndarray:
    """Funde la parte baja regenerada. MuseTalk trabaja a 256 px (latentes de 32×32) y pierde la
    textura fina, así que fuera de la boca se le suma el detalle de alta frecuencia del original."""
    x1, y1, x2, y2 = box
    patch = cv2.resize(generated, (x2 - x1, y2 - y1), interpolation=cv2.INTER_LANCZOS4).astype(np.float32)
    region = frame[y1:y2, x1:x2].astype(np.float32)
    sigma = max(1.5, DETAIL_SIGMA * (x2 - x1))
    detail = region - cv2.GaussianBlur(region, (0, 0), sigma)
    patch_low = cv2.GaussianBlur(patch, (0, 0), sigma)
    restored = patch + detail_mask * (patch_low + detail - patch)
    out = frame.copy()
    out[y1:y2, x1:x2] = np.clip(mask * restored + (1 - mask) * region, 0, 255).astype(np.uint8)
    return out
