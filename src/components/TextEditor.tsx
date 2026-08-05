import React from 'react';
import { SAMPLE_TEMPLATES } from '../data';
import { SampleTemplate } from '../types';
import {
  FileText,
  Trash2,
  Copy,
  Check,
  Radio,
  Sparkles,
  Users,
  Music,
  RotateCcw,
} from 'lucide-react';

interface TextEditorProps {
  text: string;
  setText: (text: string) => void;
  onSelectTemplate: (template: SampleTemplate) => void;
  isMultiSpeaker: boolean;
}

export const TextEditor: React.FC<TextEditorProps> = ({
  text,
  setText,
  onSelectTemplate,
  isMultiSpeaker,
}) => {
  const [copied, setCopied] = React.useState(false);

  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const charCount = text.length;
  // Average speaking speed in Spanish is ~130-150 words per minute
  const estimatedSeconds = Math.ceil((wordCount / 140) * 60);

  const handleCopy = () => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getTemplateIcon = (iconName: string) => {
    switch (iconName) {
      case 'Radio':
        return <Radio className="w-3.5 h-3.5" />;
      case 'Sparkles':
        return <Sparkles className="w-3.5 h-3.5" />;
      case 'Users':
        return <Users className="w-3.5 h-3.5" />;
      case 'Music':
        return <Music className="w-3.5 h-3.5" />;
      default:
        return <FileText className="w-3.5 h-3.5" />;
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5 flex flex-col space-y-4">
      {/* Top Header & Presets */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center space-x-2">
          <FileText className="w-5 h-5 text-indigo-600" />
          <h2 className="text-base font-semibold text-slate-900">Texto para Sintetizar</h2>
        </div>

        {/* Action Controls */}
        <div className="flex items-center space-x-2 text-xs">
          <button
            onClick={handleCopy}
            disabled={!text}
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 disabled:opacity-40 transition-colors"
            title="Copiar texto"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                <span className="text-emerald-600">Copiado</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-slate-500" />
                <span>Copiar</span>
              </>
            )}
          </button>

          <button
            onClick={() => setText('')}
            disabled={!text}
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-700 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 disabled:opacity-40 transition-colors"
            title="Borrar texto"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Borrar</span>
          </button>
        </div>
      </div>

      {/* Preset Badges Bar */}
      <div>
        <span className="text-xs font-medium text-slate-500 mb-2 block">
          Ejemplos rápidos y plantillas:
        </span>
        <div className="flex flex-wrap gap-2">
          {SAMPLE_TEMPLATES.map((tmpl) => (
            <button
              key={tmpl.id}
              onClick={() => onSelectTemplate(tmpl)}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50/80 hover:bg-indigo-50 hover:border-indigo-200 text-slate-700 hover:text-indigo-700 text-xs font-medium transition-all"
            >
              {getTemplateIcon(tmpl.icon)}
              <span>{tmpl.title}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Text Area Input */}
      <div className="relative">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            isMultiSpeaker
              ? 'Escribe el diálogo en formato de guion:\nCarlos: Hola María, ¿listos para la presentación?\nMaría: ¡Hola Carlos! Todo está listo.'
              : 'Escribe o pega aquí el texto que deseas convertir a voz. Admite acentos, signos de puntuación y números...'
          }
          rows={6}
          className="w-full rounded-xl border border-slate-200 p-4 text-slate-800 text-sm leading-relaxed placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 resize-y min-h-[160px] font-sans"
        />

        {isMultiSpeaker && (
          <div className="mt-1 px-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 flex items-center space-x-2">
            <Sparkles className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              <strong>Modo Diálogo Activo:</strong> Escribe el nombre de cada hablante seguido de dos puntos (ejemplo: <code>Carlos: ...</code> / <code>María: ...</code>) para intercalar las voces.
            </span>
          </div>
        )}
      </div>

      {/* Footer Metrics */}
      <div className="flex items-center justify-between text-xs text-slate-500 pt-1 border-t border-slate-100">
        <div className="flex items-center space-x-4">
          <span>
            <strong className="text-slate-700">{charCount}</strong> caracteres
          </span>
          <span>
            <strong className="text-slate-700">{wordCount}</strong> palabras
          </span>
        </div>

        <div>
          <span>
            Tiempo estimado:{' '}
            <strong className="text-indigo-600 font-semibold">
              ~{estimatedSeconds} seg
            </strong>
          </span>
        </div>
      </div>
    </div>
  );
};
