// Cliente del puente /api/avatar (vídeo con presentador y lip-sync, solo en local).

export interface AvatarServiceStatus {
  available: boolean;
  reason?: string;
  /** El servicio arranca o está apagado: tiene sentido volver a preguntar. */
  loading?: boolean;
  serviceDown?: boolean;
  device?: string;
  defaultPresenter?: boolean;
  maxAudioSec?: number;
}

export type AvatarJobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled';

export interface AvatarJob {
  id: string;
  status: AvatarJobStatus;
  stage: string;
  progress: number;
  error: string | null;
  audioDurationSec: number;
  queuePosition: number;
  result: {
    width: number;
    height: number;
    fps: number;
    frames: number;
    durationSec: number;
    renderSec: number;
    sizeBytes: number;
  } | null;
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof body?.error === 'string' ? body.error : `Error ${response.status} del servicio de vídeo.`);
  }
  return body as T;
}

export async function fetchAvatarStatus(): Promise<AvatarServiceStatus> {
  try {
    return await readJson<AvatarServiceStatus>(await fetch('/api/avatar/status'));
  } catch (err) {
    return { available: false, reason: (err as Error).message };
  }
}

export const AVATAR_PRESENTER_URL = '/api/avatar/presenter';

export type AvatarVideoFormat = '16:9' | '9:16' | 'original';

export const AVATAR_VIDEO_FORMATS: Array<{ value: AvatarVideoFormat; label: string; detail: string }> = [
  { value: '16:9', label: 'YouTube 16:9', detail: '1920×1080' },
  { value: '9:16', label: 'Vertical 9:16', detail: '1080×1920' },
  { value: 'original', label: 'Como la imagen', detail: 'hasta 1920 px' },
];

export async function createAvatarJob(
  audio: Blob,
  image: Blob | null,
  format: AvatarVideoFormat
): Promise<AvatarJob> {
  const form = new FormData();
  form.append('audio', audio, 'locucion.wav');
  if (image) form.append('image', image, image instanceof File ? image.name : 'presentador.png');
  form.append('fps', '30');
  form.append('format', format);
  return readJson<AvatarJob>(await fetch('/api/avatar', { method: 'POST', body: form }));
}

export async function fetchAvatarJob(jobId: string): Promise<AvatarJob> {
  return readJson<AvatarJob>(await fetch(`/api/avatar/${jobId}`));
}

export async function cancelAvatarJob(jobId: string): Promise<void> {
  await fetch(`/api/avatar/${jobId}`, { method: 'DELETE' }).catch(() => undefined);
}

export async function downloadAvatarVideo(jobId: string): Promise<Blob> {
  const response = await fetch(`/api/avatar/${jobId}/video`);
  if (!response.ok) await readJson(response);
  return response.blob();
}
