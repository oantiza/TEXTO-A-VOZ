import {
  AccentOption,
  AppMode,
  GeneratedAudioItem,
  ProjectSnapshot,
  ProjectSummary,
  SpeakerConfig,
  ToneEmotion,
  VoiceName,
} from '../types';

const DATABASE_NAME = 'texto-a-voz-local';
const DATABASE_VERSION = 1;
const PROJECT_STORE = 'projects';

interface StoredAudioItem extends Omit<GeneratedAudioItem, 'audioUrl' | 'audioBlob'> {
  audioBlob: Blob;
}

interface StoredProject extends Omit<ProjectSnapshot, 'history'> {
  history: StoredAudioItem[];
}

interface ExportedAudioItem extends Omit<StoredAudioItem, 'audioBlob'> {
  audioDataUrl: string;
}

interface ExportedProject extends Omit<StoredProject, 'history'> {
  format: 'texto-a-voz-project';
  formatVersion: 1;
  exportedAt: string;
  history: ExportedAudioItem[];
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('No se pudo acceder al almacenamiento local.'));
  });
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('No se pudo guardar el proyecto.'));
    transaction.onabort = () => reject(transaction.error || new Error('Se canceló el guardado del proyecto.'));
  });
}

async function openDatabase(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) throw new Error('Este navegador no permite guardar proyectos localmente.');
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(PROJECT_STORE)) {
      const store = database.createObjectStore(PROJECT_STORE, { keyPath: 'id' });
      store.createIndex('updatedAt', 'updatedAt');
    }
  };
  return requestToPromise(request);
}

async function resolveAudioBlob(audio: GeneratedAudioItem): Promise<Blob> {
  if (audio.audioBlob) return audio.audioBlob;
  const response = await fetch(audio.audioUrl);
  if (!response.ok) throw new Error('No se pudo recuperar uno de los audios del proyecto.');
  return response.blob();
}

async function toStoredProject(project: ProjectSnapshot): Promise<StoredProject> {
  const history = await Promise.all(
    project.history.map(async ({ audioUrl: _audioUrl, audioBlob, ...audio }) => ({
      ...audio,
      audioBlob: audioBlob ?? (await resolveAudioBlob({ ...audio, audioUrl: _audioUrl })),
    }))
  );
  return { ...project, history };
}

function fromStoredProject(project: StoredProject): ProjectSnapshot {
  return {
    ...project,
    history: project.history.map((audio) => ({
      ...audio,
      audioBlob: audio.audioBlob,
      audioUrl: URL.createObjectURL(audio.audioBlob),
    })),
  };
}

export function createBlankProject(name = 'Nuevo proyecto'): ProjectSnapshot {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    appMode: 'standard',
    text: '',
    scriptText: '',
    selectedVoice: 'Kore',
    selectedEmotion: 'natural',
    selectedAccent: 'spain',
    useTargetDuration: false,
    targetDurationSeconds: 12,
    isMultiSpeaker: false,
    speakers: [
      { name: 'Carlos', voiceName: 'Puck' },
      { name: 'María', voiceName: 'Kore' },
    ],
    history: [],
  };
}

export async function saveProject(project: ProjectSnapshot): Promise<ProjectSnapshot> {
  const updatedProject = { ...project, updatedAt: new Date().toISOString() };
  const storedProject = await toStoredProject(updatedProject);
  const database = await openDatabase();
  const transaction = database.transaction(PROJECT_STORE, 'readwrite');
  transaction.objectStore(PROJECT_STORE).put(storedProject);
  await transactionToPromise(transaction);
  database.close();
  return updatedProject;
}

export async function loadProject(id: string): Promise<ProjectSnapshot | null> {
  const database = await openDatabase();
  const transaction = database.transaction(PROJECT_STORE, 'readonly');
  const stored = await requestToPromise(
    transaction.objectStore(PROJECT_STORE).get(id) as IDBRequest<StoredProject | undefined>
  );
  await transactionToPromise(transaction);
  database.close();
  return stored ? fromStoredProject(stored) : null;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const database = await openDatabase();
  const transaction = database.transaction(PROJECT_STORE, 'readonly');
  const stored = await requestToPromise(
    transaction.objectStore(PROJECT_STORE).getAll() as IDBRequest<StoredProject[]>
  );
  await transactionToPromise(transaction);
  database.close();
  return stored
    .map((project) => ({
      id: project.id,
      name: project.name,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      audioCount: project.history.length,
    }))
    .sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));
}

export async function deleteProject(id: string): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(PROJECT_STORE, 'readwrite');
  transaction.objectStore(PROJECT_STORE).delete(id);
  await transactionToPromise(transaction);
  database.close();
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return blob.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32_768) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
    }
    return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
  });
}

function dataUrlToBlob(dataUrl: string): Blob {
  const match = dataUrl.match(/^data:([^;,]+)?;base64,(.+)$/);
  if (!match) throw new Error('El archivo del proyecto contiene un audio no válido.');
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: match[1] || 'application/octet-stream' });
}

export async function exportProject(project: ProjectSnapshot): Promise<Blob> {
  const stored = await toStoredProject(project);
  const history = await Promise.all(
    stored.history.map(async ({ audioBlob, ...audio }) => ({
      ...audio,
      audioDataUrl: await blobToDataUrl(audioBlob),
    }))
  );
  const exported: ExportedProject = {
    ...stored,
    format: 'texto-a-voz-project',
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    history,
  };
  return new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' });
}

export async function importProject(file: File): Promise<ProjectSnapshot> {
  const parsed = JSON.parse(await file.text()) as Partial<ExportedProject>;
  if (parsed.format !== 'texto-a-voz-project' || parsed.formatVersion !== 1 || !Array.isArray(parsed.history)) {
    throw new Error('El archivo no es un proyecto compatible de Texto a Voz.');
  }

  const now = new Date().toISOString();
  const stored: StoredProject = {
    id: crypto.randomUUID(),
    name: `${String(parsed.name || 'Proyecto')} (importado)`,
    createdAt: now,
    updatedAt: now,
    appMode: (parsed.appMode === 'script' ? 'script' : 'standard') as AppMode,
    text: String(parsed.text || ''),
    scriptText: String(parsed.scriptText || ''),
    selectedVoice: (parsed.selectedVoice || 'Kore') as VoiceName,
    selectedEmotion: (parsed.selectedEmotion || 'natural') as ToneEmotion,
    selectedAccent: (parsed.selectedAccent || 'spain') as AccentOption,
    useTargetDuration: Boolean(parsed.useTargetDuration),
    targetDurationSeconds: Number(parsed.targetDurationSeconds) || 12,
    isMultiSpeaker: Boolean(parsed.isMultiSpeaker),
    speakers: (Array.isArray(parsed.speakers) ? parsed.speakers : []) as SpeakerConfig[],
    history: parsed.history.map(({ audioDataUrl, ...audio }) => ({
      ...audio,
      audioBlob: dataUrlToBlob(audioDataUrl),
    })) as StoredAudioItem[],
  };

  const database = await openDatabase();
  const transaction = database.transaction(PROJECT_STORE, 'readwrite');
  transaction.objectStore(PROJECT_STORE).put(stored);
  await transactionToPromise(transaction);
  database.close();
  return fromStoredProject(stored);
}
