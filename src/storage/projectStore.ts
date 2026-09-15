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
const DATABASE_VERSION = 2;
const PROJECT_STORE = 'projects';
const AUDIO_STORE = 'audios';

/**
 * Metadatos de un audio dentro del proyecto. Desde la versión 2 de la base de
 * datos el WAV vive en su propio almacén, de modo que escribir el proyecto al
 * teclear no reescribe megas de audio en cada pulsación.
 */
interface StoredAudioItem extends Omit<GeneratedAudioItem, 'audioUrl' | 'audioBlob'> {
  /** Solo presente en proyectos guardados con el formato antiguo (versión 1). */
  audioBlob?: Blob;
}

interface StoredAudioRecord {
  key: string;
  projectId: string;
  blob: Blob;
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

/** `crypto.randomUUID` solo existe en contexto seguro; sobre HTTP en red local no. */
export function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index++) bytes[index] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function audioKey(projectId: string, audioId: string): string {
  return `${projectId}::${audioId}`;
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
    // Los proyectos de la versión 1 conservan su audio incrustado y se migran
    // solos la primera vez que se vuelven a guardar.
    if (!database.objectStoreNames.contains(AUDIO_STORE)) {
      database.createObjectStore(AUDIO_STORE, { keyPath: 'key' });
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

async function splitHistory(
  project: ProjectSnapshot
): Promise<Array<{ audio: StoredAudioItem; blob: Blob }>> {
  return Promise.all(
    project.history.map(async ({ audioUrl: _audioUrl, audioBlob, ...audio }) => ({
      audio,
      blob: audioBlob ?? (await resolveAudioBlob({ ...audio, audioUrl: _audioUrl })),
    }))
  );
}

function fromStoredProject(project: StoredProject, blobs: Map<string, Blob>): ProjectSnapshot {
  return {
    ...project,
    history: project.history.flatMap((audio) => {
      const { audioBlob: legacyBlob, ...rest } = audio;
      const blob = blobs.get(audio.id) ?? legacyBlob;
      if (!blob) return [];
      return [{ ...rest, audioBlob: blob, audioUrl: URL.createObjectURL(blob) }];
    }),
  };
}

async function readAudioKeys(database: IDBDatabase): Promise<Set<string>> {
  const transaction = database.transaction(AUDIO_STORE, 'readonly');
  const keys = await requestToPromise(
    transaction.objectStore(AUDIO_STORE).getAllKeys() as IDBRequest<IDBValidKey[]>
  );
  await transactionToPromise(transaction);
  return new Set(keys.map(String));
}

export function createBlankProject(name = 'Nuevo proyecto'): ProjectSnapshot {
  const now = new Date().toISOString();
  return {
    id: createId(),
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

async function writeProject(database: IDBDatabase, project: ProjectSnapshot): Promise<void> {
  const historyWithBlobs = await splitHistory(project);
  const existingKeys = await readAudioKeys(database);
  const transaction = database.transaction([PROJECT_STORE, AUDIO_STORE], 'readwrite');
  const audioStore = transaction.objectStore(AUDIO_STORE);
  const currentKeys = new Set<string>();

  for (const { audio, blob } of historyWithBlobs) {
    const key = audioKey(project.id, audio.id);
    currentKeys.add(key);
    // Cada audio se escribe una sola vez: guardar el proyecto mientras se
    // escribe el guion solo reescribe los metadatos, no los WAV.
    if (!existingKeys.has(key)) {
      const record: StoredAudioRecord = { key, projectId: project.id, blob };
      audioStore.put(record);
    }
  }

  const prefix = `${project.id}::`;
  for (const key of existingKeys) {
    if (key.startsWith(prefix) && !currentKeys.has(key)) audioStore.delete(key);
  }

  const storedProject: StoredProject = {
    ...project,
    history: historyWithBlobs.map(({ audio }) => audio),
  };
  transaction.objectStore(PROJECT_STORE).put(storedProject);
  await transactionToPromise(transaction);
}

export async function saveProject(project: ProjectSnapshot): Promise<ProjectSnapshot> {
  const updatedProject = { ...project, updatedAt: new Date().toISOString() };
  const database = await openDatabase();
  try {
    await writeProject(database, updatedProject);
  } finally {
    database.close();
  }
  return updatedProject;
}

export async function loadProject(id: string): Promise<ProjectSnapshot | null> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([PROJECT_STORE, AUDIO_STORE], 'readonly');
    const stored = await requestToPromise(
      transaction.objectStore(PROJECT_STORE).get(id) as IDBRequest<StoredProject | undefined>
    );
    if (!stored) {
      await transactionToPromise(transaction);
      return null;
    }
    const audioStore = transaction.objectStore(AUDIO_STORE);
    // Todas las peticiones se lanzan antes de esperar para no cerrar la transacción.
    const pending = stored.history.map((audio) =>
      requestToPromise(audioStore.get(audioKey(id, audio.id)) as IDBRequest<StoredAudioRecord | undefined>)
    );
    const records = await Promise.all(pending);
    await transactionToPromise(transaction);

    const blobs = new Map<string, Blob>();
    stored.history.forEach((audio, index) => {
      const blob = records[index]?.blob;
      if (blob) blobs.set(audio.id, blob);
    });
    return fromStoredProject(stored, blobs);
  } finally {
    database.close();
  }
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(PROJECT_STORE, 'readonly');
    const stored = await requestToPromise(
      transaction.objectStore(PROJECT_STORE).getAll() as IDBRequest<StoredProject[]>
    );
    await transactionToPromise(transaction);
    return stored
      .map((project) => ({
        id: project.id,
        name: project.name,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        audioCount: project.history.length,
      }))
      .sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));
  } finally {
    database.close();
  }
}

export async function deleteProject(id: string): Promise<void> {
  const database = await openDatabase();
  try {
    const existingKeys = await readAudioKeys(database);
    const transaction = database.transaction([PROJECT_STORE, AUDIO_STORE], 'readwrite');
    const audioStore = transaction.objectStore(AUDIO_STORE);
    const prefix = `${id}::`;
    for (const key of existingKeys) {
      if (key.startsWith(prefix)) audioStore.delete(key);
    }
    transaction.objectStore(PROJECT_STORE).delete(id);
    await transactionToPromise(transaction);
  } finally {
    database.close();
  }
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
  const historyWithBlobs = await splitHistory(project);
  const history = await Promise.all(
    historyWithBlobs.map(async ({ audio, blob }) => ({
      ...audio,
      audioDataUrl: await blobToDataUrl(blob),
    }))
  );
  const { history: _history, ...projectFields } = project;
  const exported: ExportedProject = {
    ...projectFields,
    history,
    format: 'texto-a-voz-project',
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
  };
  return new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' });
}

export async function importProject(file: File): Promise<ProjectSnapshot> {
  const parsed = JSON.parse(await file.text()) as Partial<ExportedProject>;
  if (parsed.format !== 'texto-a-voz-project' || parsed.formatVersion !== 1 || !Array.isArray(parsed.history)) {
    throw new Error('El archivo no es un proyecto compatible de Texto a Voz.');
  }

  const now = new Date().toISOString();
  const imported: ProjectSnapshot = {
    id: createId(),
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
    history: parsed.history.map(({ audioDataUrl, ...audio }) => {
      const blob = dataUrlToBlob(audioDataUrl);
      return { ...audio, audioBlob: blob, audioUrl: URL.createObjectURL(blob) } as GeneratedAudioItem;
    }),
  };

  const database = await openDatabase();
  try {
    await writeProject(database, imported);
  } finally {
    database.close();
  }
  return imported;
}
