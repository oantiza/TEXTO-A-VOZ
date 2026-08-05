import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Download,
  FolderOpen,
  HardDrive,
  Loader2,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import { ProjectSummary } from '../types';

interface ProjectBarProps {
  projects: ProjectSummary[];
  currentProjectId: string;
  projectName: string;
  saveStatus: 'saved' | 'saving' | 'error';
  onSelect: (id: string) => void;
  onNameChange: (name: string) => void;
  onCreate: () => void;
  onDelete: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
}

export const ProjectBar: React.FC<ProjectBarProps> = ({
  projects,
  currentProjectId,
  projectName,
  saveStatus,
  onSelect,
  onNameChange,
  onCreate,
  onDelete,
  onExport,
  onImport,
}) => {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    setConfirmingDelete(false);
  }, [currentProjectId]);

  useEffect(() => {
    if (!confirmingDelete) return;
    const timer = window.setTimeout(() => setConfirmingDelete(false), 4_000);
    return () => window.clearTimeout(timer);
  }, [confirmingDelete]);

  return (
    <section className="border-b border-slate-200 bg-white shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="flex items-center gap-2 min-w-0 lg:flex-1">
          <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
            <FolderOpen className="w-4.5 h-4.5" />
          </div>
          <select
            aria-label="Seleccionar proyecto"
            value={currentProjectId}
            onChange={(event) => onSelect(event.target.value)}
            className="min-w-0 max-w-56 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 focus:outline-none focus:border-indigo-500"
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name} · {project.audioCount} audios
              </option>
            ))}
          </select>
          <input
            aria-label="Nombre del proyecto"
            value={projectName}
            maxLength={80}
            onChange={(event) => onNameChange(event.target.value)}
            className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-900 focus:outline-none focus:border-indigo-500"
            placeholder="Nombre del proyecto"
          />
          <div className="hidden sm:flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 shrink-0">
            {saveStatus === 'saving' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-500" />
            ) : saveStatus === 'error' ? (
              <HardDrive className="w-3.5 h-3.5 text-rose-500" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
            )}
            <span>{saveStatus === 'saving' ? 'Guardando' : saveStatus === 'error' ? 'Error al guardar' : 'Guardado local'}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onCreate}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold"
          >
            <Plus className="w-3.5 h-3.5" />
            Nuevo
          </button>
          <button
            type="button"
            onClick={onExport}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold"
          >
            <Download className="w-3.5 h-3.5" />
            Copia
          </button>
          <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold">
            <Upload className="w-3.5 h-3.5" />
            Importar
            <input
              type="file"
              accept=".tav.json,application/json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onImport(file);
                event.target.value = '';
              }}
            />
          </label>
          <button
            type="button"
            onClick={() => {
              if (confirmingDelete) {
                onDelete();
                setConfirmingDelete(false);
              } else {
                setConfirmingDelete(true);
              }
            }}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold ${
              confirmingDelete ? 'bg-rose-600 text-white hover:bg-rose-700' : 'text-rose-600 hover:bg-rose-50'
            }`}
            title={confirmingDelete ? `Confirmar eliminación de ${projectName}` : 'Eliminar proyecto'}
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span className={confirmingDelete ? '' : 'hidden sm:inline'}>
              {confirmingDelete ? 'Confirmar' : 'Eliminar'}
            </span>
          </button>
        </div>
      </div>
    </section>
  );
};
