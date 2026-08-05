import React from 'react';
import { GeneratedAudioItem } from '../types';
import { Play, Download, Trash2, History, Volume2, Clock } from 'lucide-react';
import { formatTime } from '../utils/audio';

interface HistoryListProps {
  history: GeneratedAudioItem[];
  onSelectAudio: (audio: GeneratedAudioItem) => void;
  onDeleteAudio: (id: string) => void;
  onClearHistory: () => void;
  currentAudioId?: string;
}

export const HistoryList: React.FC<HistoryListProps> = ({
  history,
  onSelectAudio,
  onDeleteAudio,
  onClearHistory,
  currentAudioId,
}) => {
  if (history.length === 0) {
    return null;
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
        <div className="flex items-center space-x-2">
          <History className="w-5 h-5 text-indigo-600" />
          <h2 className="text-base font-semibold text-slate-900">Historial de Locuciones</h2>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
            {history.length}
          </span>
        </div>

        <button
          onClick={onClearHistory}
          className="text-xs text-rose-600 hover:text-rose-700 font-medium flex items-center space-x-1 hover:underline"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Vaciar</span>
        </button>
      </div>

      {/* History Items List */}
      <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
        {history.map((item) => {
          const isSelected = item.id === currentAudioId;
          return (
            <div
              key={item.id}
              className={`p-3.5 rounded-xl border transition-all flex items-center justify-between gap-3 ${
                isSelected
                  ? 'border-indigo-600 bg-indigo-50/50 ring-1 ring-indigo-500/20'
                  : 'border-slate-200/80 hover:border-slate-300 bg-slate-50/40 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center space-x-3 min-w-0 flex-1">
                <button
                  onClick={() => onSelectAudio(item)}
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-transform active:scale-95 ${
                    isSelected
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-white text-indigo-600 border border-slate-200 hover:border-indigo-300'
                  }`}
                >
                  <Play className="w-4 h-4 fill-current ml-0.5" />
                </button>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-bold text-slate-900">{item.voice}</span>
                    <span className="text-[10px] font-medium text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded capitalize">
                      {item.emotion}
                    </span>
                    <span className="text-[10px] text-slate-400 flex items-center">
                      <Clock className="w-3 h-3 mr-0.5" />
                      {formatTime(item.durationSeconds)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 truncate mt-0.5">
                    {item.text}
                  </p>
                </div>
              </div>

              <div className="flex items-center space-x-1 shrink-0">
                <a
                  href={item.audioUrl}
                  download={`locucion-${item.voice.toLowerCase()}-${item.id}.wav`}
                  className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-white hover:text-slate-900 transition-colors"
                  title="Descargar audio"
                >
                  <Download className="w-3.5 h-3.5" />
                </a>
                <button
                  onClick={() => onDeleteAudio(item.id)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                  title="Eliminar de historial"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
