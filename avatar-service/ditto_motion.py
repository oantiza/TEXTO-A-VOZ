"""Movimiento facial a partir del audio con Ditto (Ant Group, Apache 2.0) y su renderizador.

Ditto = LMDM (difusión en el espacio de movimiento de LivePortrait, condicionada por HuBERT) +
los mismos renderizadores de LivePortrait. Del repositorio clonado en ./ditto se reutilizan sus
componentes atómicos sin modificarlos, con dos sustituciones:

* Detección de cara (InsightFace det_10g + 2d106det, solo uso no comercial) -> MediaPipe: se le
  pasan directamente los 106 puntos derivados de MediaPipe como "puntos de seguimiento".
* Mezclado de la cara sobre el fotograma (Cython, necesita compilador) -> GpuPasteBack del motor.
"""

from __future__ import annotations

import math
import os
import random
import sys
import types
from pathlib import Path
from typing import Callable, Optional

import librosa
import numpy as np
import torch

SERVICE_DIR = Path(__file__).resolve().parent
DITTO_DIR = Path(os.environ.get("DITTO_DIR", SERVICE_DIR / "ditto")).resolve()
DITTO_CHECKPOINTS = DITTO_DIR / "checkpoints"
DITTO_CFG = DITTO_CHECKPOINTS / "ditto_cfg" / "v0.4_hubert_cfg_pytorch.pkl"
DITTO_DATA_ROOT = DITTO_CHECKPOINTS / "ditto_pytorch"
MOTION_FPS = 25  # cadencia nativa del LMDM
POSE_DIMS = 202  # scale(1) + pitch/yaw/roll (66 bins cada uno) + t(3); después van los 63 de expresión
# Dimensiones de expresión (21 puntos × 3) que controlan los labios en LivePortrait.
LIP_DIMS = [POSE_DIMS + point * 3 + axis for point in (6, 12, 14, 17, 19, 20) for axis in range(3)]

if str(DITTO_DIR) not in sys.path:
    sys.path.insert(0, str(DITTO_DIR))


def _blend_images_numpy(mask, foreground, background, out):
    weight = mask[..., None]
    out[...] = np.clip(weight * foreground + (1 - weight) * background, 0, 255).astype(np.uint8)


# core.utils.blend compila un módulo Cython al importarse (pyximport): se sustituye antes de que
# putback.py lo importe. El motor no usa PutBack, pero stream_pipeline sí lo importa.
_blend_module = types.ModuleType("core.utils.blend")
_blend_module.blend_images_cy = _blend_images_numpy
sys.modules.setdefault("core.utils.blend", _blend_module)

import core.atomic_components.source2info as _source2info  # noqa: E402

_source2info.InsightFaceDet = lambda **kwargs: None  # noqa: E731
_source2info.Landmark106 = lambda **kwargs: None  # noqa: E731

from core.atomic_components.audio2motion import Audio2Motion  # noqa: E402
from core.atomic_components.cfg import parse_cfg  # noqa: E402
from core.atomic_components.condition_handler import ConditionHandler  # noqa: E402
from core.atomic_components.decode_f3d import DecodeF3D  # noqa: E402
from core.atomic_components.motion_stitch import MotionStitch  # noqa: E402
from core.atomic_components.source2info import Source2Info  # noqa: E402
from core.atomic_components.warp_f3d import WarpF3D  # noqa: E402
from core.atomic_components.wav2feat import Wav2Feat  # noqa: E402
from core.utils.get_mask import get_mask  # noqa: E402

ProgressCallback = Callable[[float], None]


class DittoMotion:
    def __init__(self, device: str = "cuda"):
        if not DITTO_CFG.exists() or not (DITTO_DATA_ROOT / "models" / "lmdm_v0.4_hubert.pth").exists():
            raise FileNotFoundError(f"Faltan los pesos de Ditto en {DITTO_CHECKPOINTS} (ejecuta npm run avatar:setup).")
        (registrar_cfg, condition_cfg, lmdm_cfg, stitch_cfg, warp_cfg, decoder_cfg,
         wav2feat_cfg, self.defaults) = parse_cfg(str(DITTO_CFG), str(DITTO_DATA_ROOT))
        self.device = device
        self.source2info = Source2Info(**registrar_cfg)
        self.condition_handler = ConditionHandler(**condition_cfg)
        self.audio2motion = Audio2Motion(lmdm_cfg)
        self.motion_stitch = MotionStitch(stitch_cfg)
        self.warp = WarpF3D(warp_cfg).warp_net.model
        self.decoder = DecodeF3D(decoder_cfg).decoder.model
        self.wav2feat = Wav2Feat(**wav2feat_cfg)
        # Máscara de mezclado de Ditto (degradado en los bordes del recorte de 512).
        self.mask_crop = np.repeat(get_mask(512, 512, 0.9, 0.9), 3, axis=2)

    # ------------------------------------------------------------------ fuente
    def register(self, img_rgb: np.ndarray, pt106: np.ndarray) -> dict:
        """Equivale a AvatarRegistrar.register para una imagen ya en memoria."""
        kwargs = self.defaults
        info = self.source2info(
            img_rgb, last_lmk=pt106,
            crop_scale=kwargs.get("crop_scale", 2.3), crop_vx_ratio=kwargs.get("crop_vx_ratio", 0),
            crop_vy_ratio=kwargs.get("crop_vy_ratio", -0.125), crop_flag_do_rot=kwargs.get("crop_flag_do_rot", True),
        )
        return {
            "x_s_info_lst": [info["x_s_info"]],
            "f_s_lst": [info["f_s"]],
            "M_c2o_lst": [info["M_c2o"]],
            "eye_open_lst": [info["eye_open"]],
            "eye_ball_lst": [info["eye_ball"]],
            "sc": info["x_s_info"]["kp"].flatten(),
            "is_image_flag": True,
            "img_rgb_lst": [img_rgb],
        }

    # ------------------------------------------------------------------ movimiento
    def motion_sequence(self, source_info: dict, audio_path: str, seed: int = 0,
                        sampling_steps: Optional[int] = None, progress: ProgressCallback | None = None) -> np.ndarray:
        """Secuencia de movimiento a 25 fps: [n, 265] (igual que _audio2motion_offline de Ditto)."""
        kwargs = self.defaults
        random.seed(seed)
        np.random.seed(seed)
        torch.manual_seed(seed)
        torch.cuda.manual_seed_all(seed)

        self.condition_handler.setup(source_info, kwargs["emo"], eye_f0_mode=kwargs.get("eye_f0_mode", False),
                                     ch_info=kwargs.get("ch_info"))
        self.audio2motion.setup(
            self.condition_handler.x_s_info_0,
            overlap_v2=kwargs.get("overlap_v2", 10),
            fix_kp_cond=kwargs.get("fix_kp_cond", 0),
            fix_kp_cond_dim=kwargs.get("fix_kp_cond_dim"),
            sampling_timesteps=sampling_steps or kwargs.get("sampling_timesteps", 50),
            online_mode=False,
            v_min_max_for_clip=kwargs.get("v_min_max_for_clip"),
            smo_k_d=kwargs.get("smo_k_d", 3),
        )
        # Ditto fija el ruido DDIM al llamar a setup() y lo reutiliza: se regenera con la semilla.
        self.audio2motion.lmdm.model.sampling_timesteps = None
        self.audio2motion.lmdm.setup(sampling_steps or kwargs.get("sampling_timesteps", 50))

        audio, _ = librosa.load(audio_path, sr=16000)
        aud_feat = self.wav2feat.wav2feat(audio)
        aud_cond_all = self.condition_handler(aud_feat, 0)
        seq_frames = self.audio2motion.seq_frames
        valid_clip_len = self.audio2motion.valid_clip_len
        num_frames = len(aud_cond_all)
        clip_count = max(1, math.ceil(max(0, num_frames - seq_frames) / valid_clip_len) + 1)
        res_kp_seq = None
        index = 0
        clip = 0
        while index < num_frames:
            aud_cond = aud_cond_all[index:index + seq_frames][None]
            if aud_cond.shape[1] < seq_frames:
                pad = np.stack([aud_cond[:, -1]] * (seq_frames - aud_cond.shape[1]), 1)
                aud_cond = np.concatenate([aud_cond, pad], 1)
            res_kp_seq = self.audio2motion(aud_cond, res_kp_seq)
            index += valid_clip_len
            clip += 1
            if progress is not None:
                progress(min(1.0, clip / clip_count))
        res_kp_seq = res_kp_seq[:, :num_frames]
        res_kp_seq = self.audio2motion._smo(res_kp_seq, 0, res_kp_seq.shape[1])
        return res_kp_seq[0]

    @staticmethod
    def smooth(sequence: np.ndarray, pose_sigma: float, lip_sigma: float = 0.0) -> np.ndarray:
        """Suaviza en el tiempo la pose (escala, giros y traslación) y, muy ligeramente, los labios.

        El LMDM produce la pose con ruido de un fotograma a otro (Ditto solo aplica una media de
        3); sin este filtro la cabeza tiembla. Los sigmas van en fotogramas a 25 fps.
        """
        from scipy.ndimage import gaussian_filter1d

        result = sequence.copy()
        if pose_sigma > 0:
            result[:, :POSE_DIMS] = gaussian_filter1d(sequence[:, :POSE_DIMS], pose_sigma, axis=0, mode="nearest")
        if lip_sigma > 0:
            result[:, LIP_DIMS] = gaussian_filter1d(sequence[:, LIP_DIMS], lip_sigma, axis=0, mode="nearest")
        return result

    @staticmethod
    def resample(sequence: np.ndarray, target_fps: int, frame_count: int) -> np.ndarray:
        """Interpola la secuencia de 25 fps a la cadencia de salida."""
        last = len(sequence) - 1
        positions = np.minimum(np.arange(frame_count) * MOTION_FPS / target_fps, last)
        low = np.floor(positions).astype(int)
        high = np.minimum(low + 1, last)
        weight = (positions - low)[:, None].astype(np.float32)
        return (1 - weight) * sequence[low] + weight * sequence[high]

    def driving_frames(self, sequence: np.ndarray) -> list:
        """[n, 265] -> lista de dicts de movimiento por fotograma (con el recorte de rango de Ditto)."""
        return self.audio2motion.cvt_fmt(sequence[None].astype(np.float32))

    # ------------------------------------------------------------------ render
    def setup_stitch(self, source_info: dict, frame_count: int) -> None:
        kwargs = self.defaults
        self.motion_stitch.setup(
            N_d=frame_count,
            use_d_keys=kwargs.get("use_d_keys"),
            relative_d=kwargs.get("relative_d", True),
            drive_eye=kwargs.get("drive_eye"),
            delta_eye_arr=kwargs.get("delta_eye_arr"),
            delta_eye_open_n=kwargs.get("delta_eye_open_n", 0),
            fade_out_keys=kwargs.get("fade_out_keys", ("exp",)),
            fade_type=kwargs.get("fade_type", ""),
            flag_stitching=kwargs.get("flag_stitching", True),
            is_image_flag=True,
            x_s_info=source_info["x_s_info_lst"][0],
            d0=None,
            ch_info=kwargs.get("ch_info"),
            overall_ctrl_info=kwargs.get("overall_ctrl_info", {}),
        )

    def keypoints(self, source_info: dict, x_d_info: dict):
        """Puntos fuente y conducidos (numpy [1, 21, 3]) tras el retoque de Ditto y el stitching."""
        return self.motion_stitch(source_info["x_s_info_lst"][0], dict(x_d_info))

    def feature_tensor(self, source_info: dict) -> torch.Tensor:
        return torch.from_numpy(source_info["f_s_lst"][0]).to(self.device)

    @torch.inference_mode()
    def render(self, f_s: torch.Tensor, x_s: np.ndarray, x_d: np.ndarray) -> torch.Tensor:
        """Cara animada, tensor [1, 3, 512, 512] en [0, 1] (se queda en la GPU)."""
        with torch.autocast(device_type="cuda", dtype=torch.float16, enabled=True):
            warped = self.warp(f_s, torch.from_numpy(x_s).to(self.device), torch.from_numpy(x_d).to(self.device))
            return self.decoder(warped).float()

    def warmup(self) -> None:
        """Calienta LMDM, HuBERT y renderizador con datos sintéticos (no hace falta una cara)."""
        import tempfile

        import soundfile

        kwargs = self.defaults
        fake_source = {"x_s_info_lst": [kwargs["ch_info"]["x_s_info_lst"][0]], "sc": kwargs["ch_info"]["sc"],
                       "eye_open_lst": kwargs["ch_info"]["eye_open_lst"], "eye_ball_lst": kwargs["ch_info"]["eye_ball_lst"]}
        with tempfile.TemporaryDirectory() as tmp:
            silence = Path(tmp) / "silence.wav"
            soundfile.write(silence, np.zeros(16000, dtype=np.float32), 16000)
            self.motion_sequence(fake_source, str(silence))
        gray = np.full((1, 3, 256, 256), 0.5, dtype=np.float32)
        f_s = torch.from_numpy(self.source2info.appearance_extractor(gray)).to(self.device)
        x_s_info = self.source2info.motion_extractor(gray)
        from core.atomic_components.motion_stitch import transform_keypoint

        x_s = transform_keypoint(x_s_info).astype(np.float32)
        for _ in range(2):
            self.render(f_s, x_s, x_s)
        torch.cuda.synchronize()
