import React, { useEffect, useRef, useState } from 'react';
import { Clapperboard, Download, ImageUp, Loader2, MonitorOff, RotateCcw, UserRound, X } from 'lucide-react';
import {
  AVATAR_PRESENTER_URL,
  AVATAR_VIDEO_FORMATS,
  AvatarJob,
  AvatarServiceStatus,
  AvatarVideoFormat,
  cancelAvatarJob,
  createAvatarJob,
  downloadAvatarVideo,
  fetchAvatarJob,
  fetchAvatarStatus,
} from '../utils/avatarApi';

interface AvatarVideoExportProps {
  /** Devuelve el WAV ya generado que se va a animar. */
  getAudio: () => Promise<Blob>;
  /** Nombre del MP4 descargado, sin extensión. */
  fileBaseName: string;
  variant?: 'light' | 'dark';
}

// La imagen elegida se recuerda mientras la pestaña siga abierta, aunque cambie el audio.
let sessionPresenterImage: File | null = null;

const STATUS_RETRY_MS = 5_000;
const JOB_POLL_MS = 1_000;
const FORMAT_STORAGE_KEY = 'texto-a-voz:avatar-format';

function readStoredFormat(): AvatarVideoFormat {
  try {
    const stored = window.localStorage.getItem(FORMAT_STORAGE_KEY);
    if (AVATAR_VIDEO_FORMATS.some((option) => option.value === stored)) return stored as AvatarVideoFormat;
  } catch {
    // Sin almacenamiento disponible: se usa el formato por defecto.
  }
  return '16:9';
}

function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  return `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
}

export const AvatarVideoExport: React.FC<AvatarVideoExportProps> = ({ getAudio, fileBaseName, variant = 'light' }) => {
  const [service, setService] = useState<AvatarServiceStatus | null>(null);
  const [presenterImage, setPresenterImage] = useState<File | null>(sessionPresenterImage);
  const [presenterPreview, setPresenterPreview] = useState<string | null>(null);
  const [videoFormat, setVideoFormat] = useState<AvatarVideoFormat>(readStoredFormat);
  const [job, setJob] = useState<AvatarJob | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [video, setVideo] = useState<{ url: string; sizeBytes: number } | null>(null);
  const jobStartedAt = useRef(0);
  const activeJobId = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Estado del servicio local; se reintenta mientras arranca o está apagado.
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const check = async () => {
      const status = await fetchAvatarStatus();
      if (cancelled) return;
      setService(status);
      if (!status.available && (status.loading || status.serviceDown)) {
        timer = window.setTimeout(check, STATUS_RETRY_MS);
      }
    };
    check();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (presenterImage) {
      const url = URL.createObjectURL(presenterImage);
      setPresenterPreview(url);
      return () => URL.revokeObjectURL(url);
    }
    setPresenterPreview(service?.defaultPresenter ? AVATAR_PRESENTER_URL : null);
  }, [presenterImage, service?.defaultPresenter]);

  // Seguimiento del trabajo en curso.
  const jobId = job?.id;
  const jobFinished = job ? !['queued', 'running'].includes(job.status) : true;
  useEffect(() => {
    if (!jobId || jobFinished) return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const next = await fetchAvatarJob(jobId);
        if (cancelled) return;
        if (next.status === 'done') {
          // Se mantiene "running" hasta tener el MP4: marcarlo "done" antes cancelaría este efecto.
          setJob({ ...next, status: 'running', stage: 'Descargando el vídeo', progress: 0.99 });
          const blob = await downloadAvatarVideo(jobId);
          if (cancelled) return;
          setVideo({ url: URL.createObjectURL(blob), sizeBytes: blob.size });
          setJob(next);
          activeJobId.current = null;
          return;
        }
        setJob(next);
        if (next.status === 'error') {
          setError(next.error || 'No se pudo generar el vídeo.');
          activeJobId.current = null;
        } else if (next.status === 'cancelled') {
          activeJobId.current = null;
        } else {
          timer = window.setTimeout(poll, JOB_POLL_MS);
        }
      } catch (err) {
        if (cancelled) return;
        setError((err as Error).message);
        setJob((current) => (current ? { ...current, status: 'error' } : current));
        activeJobId.current = null;
      }
    };
    timer = window.setTimeout(poll, JOB_POLL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [jobId, jobFinished]);

  // Si el panel desaparece (otro audio, cerrar el estudio), se libera la GPU y la memoria.
  useEffect(() => () => {
    if (activeJobId.current) cancelAvatarJob(activeJobId.current);
  }, []);
  useEffect(() => () => {
    if (video) URL.revokeObjectURL(video.url);
  }, [video]);

  const handleImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setError('Usa una imagen PNG, JPG o WEBP.');
      return;
    }
    sessionPresenterImage = file;
    setPresenterImage(file);
    setError(null);
  };

  const startGeneration = async () => {
    setError(null);
    setVideo(null);
    setJob(null);
    setIsSubmitting(true);
    try {
      const audio = await getAudio();
      const created = await createAvatarJob(audio, presenterImage, videoFormat);
      jobStartedAt.current = Date.now();
      activeJobId.current = created.id;
      setJob(created);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const cancelGeneration = async () => {
    if (!job) return;
    await cancelAvatarJob(job.id);
    activeJobId.current = null;
    setJob({ ...job, status: 'cancelled', stage: 'Cancelado' });
  };

  const downloadVideo = () => {
    if (!video) return;
    const anchor = document.createElement('a');
    anchor.href = video.url;
    anchor.download = `${fileBaseName}.mp4`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  };

  const dark = variant === 'dark';
  const isBusy = isSubmitting || (job !== null && (job.status === 'queued' || job.status === 'running'));
  const canGenerate = Boolean(service?.available) && (Boolean(presenterImage) || Boolean(service?.defaultPresenter));

  if (service && !service.available && !service.loading && !service.serviceDown) {
    // Cloud Run u otro entorno sin GPU: aviso discreto, sin controles.
    return (
      <div
        className={`flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] ${
          dark ? 'bg-white/5 text-slate-300 border border-white/10' : 'bg-slate-50 text-slate-500 border border-slate-200'
        }`}
      >
        <MonitorOff className="w-3.5 h-3.5 shrink-0" />
        <span>{service.reason}</span>
      </div>
    );
  }

  const progressPercent = job ? Math.round(job.progress * 100) : 0;
  const elapsedSec = job ? (Date.now() - jobStartedAt.current) / 1000 : 0;
  const remainingSec = job && job.status === 'running' && job.progress > 0.2
    ? (elapsedSec / job.progress) * (1 - job.progress)
    : null;

  let subtitle: string;
  if (!service) subtitle = 'Comprobando el servicio de vídeo local…';
  else if (!service.available) subtitle = service.reason || 'Servicio de vídeo no disponible.';
  else if (!presenterImage && !service.defaultPresenter) subtitle = 'Elige la imagen del presentador para empezar.';
  else {
    const formatDetail = AVATAR_VIDEO_FORMATS.find((option) => option.value === videoFormat)?.detail;
    subtitle = `Lip-sync en tu GPU${service.device ? ` (${service.device.replace(/^NVIDIA GeForce /, '')})` : ''} · MP4 ${formatDetail} · 30 fps`;
  }

  const changeFormat = (value: AvatarVideoFormat) => {
    setVideoFormat(value);
    try {
      window.localStorage.setItem(FORMAT_STORAGE_KEY, value);
    } catch {
      // Preferencia no persistente; no afecta a la generación.
    }
  };

  const palette = dark
    ? {
        panel: 'bg-white/5 border border-white/10',
        title: 'text-white',
        subtitle: 'text-slate-300',
        secondary: 'border border-white/15 text-slate-200 hover:bg-white/10',
        track: 'bg-white/10',
        muted: 'text-slate-300',
      }
    : {
        panel: 'bg-slate-50 border border-slate-200',
        title: 'text-slate-800',
        subtitle: 'text-slate-500',
        secondary: 'border border-slate-200 text-slate-700 hover:bg-white',
        track: 'bg-slate-200',
        muted: 'text-slate-500',
      };

  return (
    <div className={`rounded-xl p-3 space-y-3 ${palette.panel}`}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-11 h-11 rounded-lg overflow-hidden bg-slate-200 flex items-center justify-center shrink-0">
          {presenterPreview ? (
            <img src={presenterPreview} alt="Presentador" className="w-full h-full object-cover" />
          ) : (
            <UserRound className="w-5 h-5 text-slate-500" />
          )}
        </div>
        <div className="flex-1 min-w-[10rem]">
          <p className={`text-xs font-bold ${palette.title}`}>Vídeo con presentador</p>
          <p className={`text-[11px] leading-snug ${palette.subtitle}`}>{subtitle}</p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={handleImageChange}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isBusy}
          className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all disabled:opacity-50 ${palette.secondary}`}
          title="Usar otra imagen del presentador para esta sesión"
        >
          <ImageUp className="w-4 h-4" />
          <span>{presenterImage ? 'Cambiar imagen' : 'Elegir imagen'}</span>
        </button>
        <select
          value={videoFormat}
          onChange={(event) => changeFormat(event.target.value as AvatarVideoFormat)}
          disabled={isBusy}
          aria-label="Formato del vídeo"
          className={`px-2 py-2 rounded-xl text-xs font-semibold bg-transparent disabled:opacity-50 ${palette.secondary}`}
        >
          {AVATAR_VIDEO_FORMATS.map((option) => (
            <option key={option.value} value={option.value} className="text-slate-900">
              {option.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={startGeneration}
          disabled={!canGenerate || isBusy}
          className="px-3 py-2 rounded-xl bg-fuchsia-600 hover:bg-fuchsia-700 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clapperboard className="w-4 h-4" />}
          <span>{isSubmitting ? 'Subiendo audio…' : 'Generar vídeo'}</span>
        </button>
      </div>

      {job && (job.status === 'queued' || job.status === 'running') && (
        <div className="space-y-1.5">
          <div className={`h-2 rounded-full overflow-hidden ${palette.track}`}>
            <div
              className="h-full bg-gradient-to-r from-fuchsia-500 to-indigo-500 transition-all duration-700"
              style={{ width: `${Math.max(2, progressPercent)}%` }}
            />
          </div>
          <div className={`flex items-center justify-between gap-2 text-[11px] ${palette.muted}`}>
            <span>
              {job.status === 'queued'
                ? `En cola${job.queuePosition > 1 ? ` (posición ${job.queuePosition})` : ''}…`
                : `${job.stage} · ${progressPercent}%`}
              {remainingSec !== null && ` · quedan ≈ ${formatSeconds(remainingSec)}`}
            </span>
            <button type="button" onClick={cancelGeneration} className="inline-flex items-center gap-1 font-semibold hover:underline">
              <X className="w-3.5 h-3.5" /> Cancelar
            </button>
          </div>
        </div>
      )}

      {job?.status === 'cancelled' && (
        <p className={`text-[11px] ${palette.muted}`}>Generación cancelada.</p>
      )}

      {error && (
        <div className="flex items-start justify-between gap-2 rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-[11px] text-rose-700">
          <span>{error}</span>
          {!isBusy && canGenerate && (
            <button type="button" onClick={startGeneration} className="inline-flex items-center gap-1 font-semibold shrink-0 hover:underline">
              <RotateCcw className="w-3.5 h-3.5" /> Reintentar
            </button>
          )}
        </div>
      )}

      {video && job?.result && (
        <div className="space-y-2">
          <video src={video.url} controls className="w-full max-h-80 rounded-lg bg-black" />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={`text-[11px] ${palette.muted}`}>
              {job.result.width}×{job.result.height} · {job.result.fps} fps · {(video.sizeBytes / 1_048_576).toFixed(1)} MB ·
              generado en {formatSeconds(job.result.renderSec)}
            </span>
            <button
              type="button"
              onClick={downloadVideo}
              className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-all"
            >
              <Download className="w-4 h-4" />
              <span>Descargar MP4</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
