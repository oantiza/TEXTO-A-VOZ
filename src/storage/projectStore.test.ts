import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createBlankProject,
  createId,
  deleteProject,
  exportProject,
  importProject,
  listProjects,
  loadProject,
  saveProject,
} from './projectStore';

function deleteTestDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('texto-a-voz-local');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}


function readRawProject(id: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('texto-a-voz-local');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const database = open.result;
      const request = database.transaction('projects', 'readonly').objectStore('projects').get(id);
      request.onsuccess = () => {
        database.close();
        resolve(request.result);
      };
      request.onerror = () => {
        database.close();
        reject(request.error);
      };
    };
  });
}

describe('projectStore', () => {
  beforeEach(async () => {
    await deleteTestDatabase();
  });

  it('saves, lists, loads and deletes a project with audio', async () => {
    const project = createBlankProject('Prueba local');
    const audioBlob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/wav' });
    project.text = 'Texto persistente';
    project.history = [
      {
        id: 'audio-1',
        text: 'Hola',
        voice: 'Kore',
        emotion: 'natural',
        isMultiSpeaker: false,
        audioBlob,
        audioUrl: URL.createObjectURL(audioBlob),
        durationSeconds: 1,
        createdAt: new Date().toISOString(),
      },
    ];

    await saveProject(project);
    expect(await listProjects()).toMatchObject([{ id: project.id, name: 'Prueba local', audioCount: 1 }]);

    const loaded = await loadProject(project.id);
    expect(loaded?.text).toBe('Texto persistente');
    expect(loaded?.history[0].audioBlob?.size).toBe(4);

    await deleteProject(project.id);
    expect(await listProjects()).toEqual([]);
  });

  it('exports and imports a self-contained project copy', async () => {
    const project = createBlankProject('Copia');
    const audioBlob = new Blob([new Uint8Array([8, 9, 10])], { type: 'audio/wav' });
    project.history = [
      {
        id: 'audio-2',
        text: 'Copia de audio',
        voice: 'Puck',
        emotion: 'calm',
        isMultiSpeaker: false,
        audioBlob,
        audioUrl: URL.createObjectURL(audioBlob),
        durationSeconds: 2,
        createdAt: new Date().toISOString(),
      },
    ];

    const exported = await exportProject(project);
    const imported = await importProject(new File([exported], 'copia.tav.json', { type: 'application/json' }));

    expect(imported.id).not.toBe(project.id);
    expect(imported.name).toBe('Copia (importado)');
    expect(imported.history[0].audioBlob?.size).toBe(3);
    expect(await listProjects()).toHaveLength(1);
  });

  it('guarda el audio aparte para que un cambio de texto no lo reescriba', async () => {
    const project = createBlankProject('Incremental');
    const audioBlob = new Blob([new Uint8Array([5, 6, 7, 8, 9])], { type: 'audio/wav' });
    project.history = [
      {
        id: 'audio-3',
        text: 'Bloque',
        voice: 'Kore',
        emotion: 'natural',
        isMultiSpeaker: false,
        audioBlob,
        audioUrl: URL.createObjectURL(audioBlob),
        durationSeconds: 1,
        createdAt: new Date().toISOString(),
      },
    ];

    const saved = await saveProject(project);
    const rawProject = await readRawProject(project.id);
    expect(rawProject.history[0].audioBlob).toBeUndefined();

    await saveProject({ ...saved, text: 'Texto editado' });
    const reloaded = await loadProject(project.id);
    expect(reloaded?.text).toBe('Texto editado');
    expect(reloaded?.history[0].audioBlob?.size).toBe(5);
  });
});

describe('createId', () => {
  it('devuelve identificadores únicos con forma de UUID', () => {
    const first = createId();
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(first).not.toBe(createId());
  });
});
