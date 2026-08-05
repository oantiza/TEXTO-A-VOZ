import React, { useState, useEffect, useRef } from 'react';
import { VoiceName, ToneEmotion, AccentOption, ScriptChapter, ScriptLine, ParsedScript } from '../types';
import { parseVideoScript, DEFAULT_NUVIA_SCRIPT, combineScriptAudioSegments, secondsToTimeString } from '../utils/scriptParser';
import { base64ToWavBlob } from '../utils/audio';
import {
  Video,
  Play,
  Pause,
  RotateCcw,
  Sparkles,
  Clock,
  Download,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ListOrdered,
  FileText,
  Sliders,
  Volume2,
  Layers,
  ChevronRight,
  ChevronDown,
  Upload,
  FileUp,
} from 'lucide-react';

interface VideoScriptStudioProps {
  selectedVoice: VoiceName;
  selectedEmotion: ToneEmotion;
  selectedAccent: AccentOption;
  isMultiSpeaker: boolean;
  speakers: SpeakerConfig[];
  onAddToHistory?: (item: any) => void;
}

export const VideoScriptStudio: React.FC<VideoScriptStudioProps> = ({
  selectedVoice,
  selectedEmotion,
  selectedAccent,
  isMultiSpeaker,
  speakers,
  onAddToHistory,
}) => {
  const [rawScriptText, setRawScriptText] = useState<string>(DEFAULT_NUVIA_SCRIPT);
  const [parsedScript, setParsedScript] = useState<ParsedScript>(() => parseVideoScript(DEFAULT_NUVIA_SCRIPT));
  const [showScriptEditor, setShowScriptEditor] = useState<boolean>(false);

  // Generation state
  const [isGeneratingAll, setIsGeneratingAll] = useState<boolean>(false);
  const [isCompilingMaster, setIsCompilingMaster] = useState<boolean>(false);
  const [progressCount, setProgressCount] = useState<number>(0);
  const [totalLinesCount, setTotalLinesCount] = useState<number>(0);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // Audio Playback state
  const [masterAudioUrl, setMasterAudioUrl] = useState<string | null>(null);
  const [isPlayingMaster, setIsPlayingMaster] = useState<boolean>(false);
  const [currentTimeSec, setCurrentTimeSec] = useState<number>(0);
  const [activeLineId, setActiveLineId] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // File upload handler for text documents (.txt, .md, .srt, .vtt, etc.)
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        setRawScriptText(content);
        setShowScriptEditor(true);
      }
    };
    reader.readAsText(file);
  };

  // Parse raw script text when it changes
  useEffect(() => {
    const timer = setTimeout(() => {
      setParsedScript(parseVideoScript(rawScriptText));
    }, 500);
    return () => clearTimeout(timer);
  }, [rawScriptText]);

  // Audio timeupdate listener
  useEffect(() => {
    if (!audioRef.current) return;
    const audio = audioRef.current;

    const handleTimeUpdate = () => {
      const cur = audio.currentTime;
      setCurrentTimeSec(cur);

      // Highlight active line based on timestamp
      let foundLineId: string | null = null;
      for (const chap of parsedScript.chapters) {
        for (const line of chap.lines) {
          if (cur >= line.startSec && cur < line.endSec) {
            foundLineId = line.id;
            break;
          }
        }
        if (foundLineId) break;
      }
      setActiveLineId(foundLineId);
    };

    const handleEnded = () => {
      setIsPlayingMaster(false);
      setCurrentTimeSec(0);
      setActiveLineId(null);
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [parsedScript]);

  // Count lines
  const allLines = parsedScript.chapters.flatMap((c) => c.lines);
  const generatedLinesCount = allLines.filter((l) => l.audioUrl).length;

  // Generate entire script audio in 1 single API call (consumes only 1 request quota)
  const generateFullScriptSingleRequest = async () => {
    setIsGeneratingAll(true);
    setGlobalError(null);

    const fullText = parsedScript.chapters
      .map((chap) => chap.lines.map((l) => l.text).join(' '))
      .join('\n\n');

    try {
      const resp = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: fullText,
          voice: selectedVoice,
          emotion: selectedEmotion,
          accent: selectedAccent,
          targetDuration: undefined,
          isMultiSpeaker,
          speakers: isMultiSpeaker ? speakers : undefined,
        }),
      });

      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Error al generar locución completa');

      const { blobUrl } = base64ToWavBlob(
        data.audioBase64,
        data.mimeType || 'audio/pcm;rate=24000',
        parsedScript.totalDurationSec
      );

      setMasterAudioUrl(blobUrl);

      if (onAddToHistory) {
        onAddToHistory({
          id: `master_script_direct_${Date.now()}`,
          text: `${parsedScript.title} (Locución completa en 1 paso)`,
          voice: selectedVoice,
          emotion: selectedEmotion,
          accent: selectedAccent,
          durationSeconds: parsedScript.totalDurationSec,
          audioUrl: blobUrl,
          createdAt: new Date().toISOString(),
          isMultiSpeaker,
          speakers: isMultiSpeaker ? [...speakers] : undefined,
        });
      }
    } catch (err: any) {
      setGlobalError(err.message || 'Error al conectar con la API de voz');
    } finally {
      setIsGeneratingAll(false);
    }
  };

  // Generate single chapter audio in 1 API call
  const generateChapterAudio = async (chapter: ScriptChapter) => {
    setParsedScript((prev) => {
      const updated = { ...prev };
      const foundChap = updated.chapters.find((c) => c.id === chapter.id);
      if (foundChap) {
        foundChap.isGenerating = true;
        foundChap.error = undefined;
      }
      return updated;
    });

    const chapterText = chapter.lines.map((l) => l.text).join(' ');
    const chapterDuration = chapter.lines.reduce((acc, l) => acc + l.targetDurationSec, 0);

    try {
      const resp = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: chapterText,
          voice: selectedVoice,
          emotion: selectedEmotion,
          accent: selectedAccent,
          targetDuration: undefined,
          isMultiSpeaker,
          speakers: isMultiSpeaker ? speakers : undefined,
        }),
      });

      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Error al generar locución del capítulo');

      const { blobUrl } = base64ToWavBlob(
        data.audioBase64,
        data.mimeType || 'audio/pcm;rate=24000',
        chapterDuration
      );

      setParsedScript((prev) => {
        const updated = { ...prev };
        const foundChap = updated.chapters.find((c) => c.id === chapter.id);
        if (foundChap) {
          foundChap.audioUrl = blobUrl;
          foundChap.isGenerating = false;
        }
        return updated;
      });
    } catch (err: any) {
      setParsedScript((prev) => {
        const updated = { ...prev };
        const foundChap = updated.chapters.find((c) => c.id === chapter.id);
        if (foundChap) {
          foundChap.isGenerating = false;
          foundChap.error = err.message || 'Error de conexión';
        }
        return updated;
      });
    }
  };

  // Single line generator
  const generateSingleLine = async (line: ScriptLine) => {
    setParsedScript((prev) => {
      const updated = { ...prev };
      for (const chap of updated.chapters) {
        const found = chap.lines.find((l) => l.id === line.id);
        if (found) {
          found.isGenerating = true;
          found.error = undefined;
        }
      }
      return updated;
    });

    try {
      const resp = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: line.text,
          voice: selectedVoice,
          emotion: selectedEmotion,
          accent: selectedAccent,
          targetDuration: undefined,
          isMultiSpeaker,
          speakers: isMultiSpeaker ? speakers : undefined,
        }),
      });

      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Error al generar locución de la frase');

      const { blobUrl, duration, speedFactor } = base64ToWavBlob(
        data.audioBase64,
        data.mimeType || 'audio/pcm;rate=24000',
        line.targetDurationSec
      );

      setParsedScript((prev) => {
        const updated = { ...prev };
        for (const chap of updated.chapters) {
          const found = chap.lines.find((l) => l.id === line.id);
          if (found) {
            found.audioUrl = blobUrl;
            found.actualDurationSec = duration;
            found.speedFactor = speedFactor;
            found.isGenerating = false;
          }
        }
        return updated;
      });
    } catch (err: any) {
      setParsedScript((prev) => {
        const updated = { ...prev };
        for (const chap of updated.chapters) {
          const found = chap.lines.find((l) => l.id === line.id);
          if (found) {
            found.isGenerating = false;
            found.error = err.message || 'Error de conexión';
          }
        }
        return updated;
      });
    }
  };

  // Generate batch for all script lines with automatic retry for rate limits
  const handleGenerateAllScriptLines = async () => {
    setIsGeneratingAll(true);
    setGlobalError(null);
    setProgressCount(0);
    setTotalLinesCount(allLines.length);

    const linesToProcess = parsedScript.chapters.flatMap((c) => c.lines);

    for (let i = 0; i < linesToProcess.length; i++) {
      const line = linesToProcess[i];
      setProgressCount(i + 1);

      // Skip if already generated
      if (line.audioUrl) continue;

      setParsedScript((prev) => {
        const updated = { ...prev };
        for (const chap of updated.chapters) {
          const found = chap.lines.find((l) => l.id === line.id);
          if (found) {
            found.isGenerating = true;
            found.error = undefined;
          }
        }
        return updated;
      });

      let success = false;
      let attempts = 0;

      while (!success && attempts < 3) {
        attempts++;
        try {
          const resp = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: line.text,
              voice: selectedVoice,
              emotion: selectedEmotion,
              accent: selectedAccent,
              targetDuration: undefined,
              isMultiSpeaker,
              speakers: isMultiSpeaker ? speakers : undefined,
            }),
          });

          const data = await resp.json();

          if (resp.status === 429 || data.isQuotaExhausted) {
            const waitTime = data.retryAfterSec || 15;
            for (let sec = waitTime; sec > 0; sec--) {
              setGlobalError(
                `Límite por minuto de la API gratuita alcanzado. Pausando automáticamente ${sec} segundos antes de continuar con la siguiente frase...`
              );
              await new Promise((res) => setTimeout(res, 1000));
            }
            setGlobalError(null);
            continue; // Retry attempt
          }

          if (!resp.ok) throw new Error(data.error || 'Error sintetizando frase');

          const { blobUrl, duration, speedFactor } = base64ToWavBlob(
            data.audioBase64,
            data.mimeType || 'audio/pcm;rate=24000',
            line.targetDurationSec
          );

          setParsedScript((prev) => {
            const updated = { ...prev };
            for (const chap of updated.chapters) {
              const found = chap.lines.find((l) => l.id === line.id);
              if (found) {
                found.audioUrl = blobUrl;
                found.actualDurationSec = duration;
                found.speedFactor = speedFactor;
                found.isGenerating = false;
                found.error = undefined;
              }
            }
            return updated;
          });

          setGlobalError(null);
          success = true;

          // Gentle delay between requests to avoid rapid spikes
          await new Promise((res) => setTimeout(res, 1000));
        } catch (err: any) {
          console.error(`Error en la frase [${line.startSec}s] intento ${attempts}:`, err);

          if (attempts >= 3) {
            setParsedScript((prev) => {
              const updated = { ...prev };
              for (const chap of updated.chapters) {
                const found = chap.lines.find((l) => l.id === line.id);
                if (found) {
                  found.isGenerating = false;
                  found.error = err.message || 'Límite de API / error de conexión';
                }
              }
              return updated;
            });
          } else {
            // Wait 5s before retry
            await new Promise((res) => setTimeout(res, 5000));
          }
        }
      }
    }

    setIsGeneratingAll(false);

    // After generating all available lines, stitch continuous master audio track
    await compileMasterAudioTrack();
  };

  // Stitch master continuous WAV audio
  const compileMasterAudioTrack = async () => {
    const linesWithAudio = parsedScript.chapters.flatMap((c) => c.lines).filter((l) => l.audioUrl);
    if (linesWithAudio.length === 0) {
      setGlobalError('No hay frases generadas para unir en un audio final.');
      return;
    }

    setIsCompilingMaster(true);
    setGlobalError(null);

    try {
      const { masterBlobUrl } = await combineScriptAudioSegments(linesWithAudio, parsedScript.totalDurationSec);
      setMasterAudioUrl(masterBlobUrl);

      if (onAddToHistory) {
        onAddToHistory({
          id: `master_script_${Date.now()}`,
          text: `${parsedScript.title} (${linesWithAudio.length} frases sincronizadas)`,
          voice: selectedVoice,
          emotion: selectedEmotion,
          accent: selectedAccent,
          durationSeconds: parsedScript.totalDurationSec,
          audioUrl: masterBlobUrl,
          createdAt: new Date().toISOString(),
          isMultiSpeaker,
          speakers: isMultiSpeaker ? [...speakers] : undefined,
        });
      }
    } catch (err: any) {
      console.error('Error al compilar audio master:', err);
      setGlobalError(err.message || 'Error al unir las frases generadas');
    } finally {
      setIsCompilingMaster(false);
    }
  };

  // Toggle master audio play/pause
  const togglePlayMaster = () => {
    if (!masterAudioUrl || !audioRef.current) return;
    if (isPlayingMaster) {
      audioRef.current.pause();
      setIsPlayingMaster(false);
    } else {
      audioRef.current.play();
      setIsPlayingMaster(true);
    }
  };

  // Seek master audio
  const handleSeekMaster = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setCurrentTimeSec(val);
    if (audioRef.current) {
      audioRef.current.currentTime = val;
    }
  };

  return (
    <div className="space-y-6">
      {/* Hidden Master Audio Element */}
      {masterAudioUrl && <audio ref={audioRef} src={masterAudioUrl} preload="auto" />}

      {/* Header Banner */}
      <div className="bg-gradient-to-r from-indigo-900 via-indigo-800 to-slate-900 rounded-3xl p-6 sm:p-8 text-white shadow-xl relative overflow-hidden">
        <div className="absolute right-0 top-0 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center space-x-2 bg-indigo-500/20 backdrop-blur-md px-3.5 py-1.5 rounded-full border border-indigo-400/30 text-xs font-bold text-indigo-200">
              <Video className="w-4 h-4 text-indigo-400" />
              <span>Estudio de Locución e Interpretación de Documentos</span>
            </div>

            <div className="flex items-center space-x-2">
              <label className="cursor-pointer inline-flex items-center space-x-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 px-3.5 py-1.5 rounded-xl shadow-sm transition-all border border-indigo-400/30">
                <Upload className="w-3.5 h-3.5" />
                <span>Subir Nuevo Documento (.txt / .doc / .md)</span>
                <input
                  type="file"
                  accept=".txt,.md,.srt,.vtt,.doc,.docx"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>

              <button
                onClick={() => setShowScriptEditor(!showScriptEditor)}
                className="inline-flex items-center space-x-1.5 text-xs font-semibold text-indigo-200 hover:text-white bg-white/10 px-3 py-1.5 rounded-xl border border-white/15 hover:bg-white/20 transition-all"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>{showScriptEditor ? 'Ocultar Editor' : 'Ver / Editar Guión'}</span>
              </button>
            </div>
          </div>

          <div>
            <h2 className="text-xl sm:text-2xl font-black tracking-tight">{parsedScript.title}</h2>
            <p className="text-xs sm:text-sm text-indigo-200 mt-1 max-w-2xl">
              Sincronización automatizada de voz con marcas de tiempo exactas para cada frase y capítulo. Duración total del vídeo: {' '}
              <span className="font-bold text-white underline decoration-indigo-400">
                {secondsToTimeString(parsedScript.totalDurationSec)} (3 minutos)
              </span>.
            </p>
          </div>

          {/* Quick Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
            <div className="bg-white/10 backdrop-blur-md rounded-xl p-3 border border-white/10">
              <span className="text-[10px] uppercase font-bold text-indigo-300 block">Frases Totales</span>
              <span className="text-lg font-extrabold">{allLines.length} frases</span>
            </div>

            <div className="bg-white/10 backdrop-blur-md rounded-xl p-3 border border-white/10">
              <span className="text-[10px] uppercase font-bold text-indigo-300 block">Capítulos / Pilares</span>
              <span className="text-lg font-extrabold">{parsedScript.chapters.length} bloques</span>
            </div>

            <div className="bg-white/10 backdrop-blur-md rounded-xl p-3 border border-white/10">
              <span className="text-[10px] uppercase font-bold text-indigo-300 block">Voz Seleccionada</span>
              <span className="text-lg font-extrabold">{selectedVoice} (Castellano España)</span>
            </div>

            <div className="bg-white/10 backdrop-blur-md rounded-xl p-3 border border-white/10">
              <span className="text-[10px] uppercase font-bold text-indigo-300 block">Progreso Locución</span>
              <span className="text-lg font-extrabold text-emerald-300">
                {generatedLinesCount} / {allLines.length}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Script Text Editor Modal / Collapsible */}
      {showScriptEditor && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-3 animate-fade-in">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
              <FileText className="w-4 h-4 text-indigo-600" />
              <span>Editor de Texto del Guión (Con Marcas de Tiempo)</span>
            </h3>
            <button
              onClick={() => setRawScriptText(DEFAULT_NUVIA_SCRIPT)}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 underline"
            >
              Restablecer Guión Original (Nuvia Academy)
            </button>
          </div>
          <textarea
            value={rawScriptText}
            onChange={(e) => setRawScriptText(e.target.value)}
            rows={10}
            className="w-full font-mono text-xs p-3.5 bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none leading-relaxed text-slate-800"
            placeholder="Pega aquí tu guión con marcas de tiempo como [00:00] o 00:00–00:14..."
          />
          <p className="text-[11px] text-slate-500">
            Formato soportado: Las líneas que empiezan por `[MM:SS]` o `MM:SS` se interpretarán como inicios de frase. Las cabeceras como `00:00–00:14 · TITULO` crean capítulos.
          </p>
        </div>
      )}

      {/* Global Rate Limit / Quota Banner */}
      {globalError && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs sm:text-sm text-amber-900 flex items-start space-x-3 shadow-sm animate-fade-in">
          <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-bold block">Gestión Automática de Cuota de API</span>
            <p className="leading-relaxed">{globalError}</p>
          </div>
        </div>
      )}

      {/* Master Video Timeline Player (If master audio exists) */}
      {masterAudioUrl && (
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white rounded-2xl p-6 shadow-lg border border-indigo-950/50 space-y-4 animate-fade-in">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-4">
            <div className="flex items-center space-x-3">
              <button
                onClick={togglePlayMaster}
                className="w-12 h-12 rounded-full bg-indigo-500 hover:bg-indigo-400 text-white flex items-center justify-center transition-all shadow-md shrink-0"
              >
                {isPlayingMaster ? <Pause className="w-6 h-6 fill-white" /> : <Play className="w-6 h-6 fill-white ml-0.5" />}
              </button>

              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-300 block">
                  Pista Máster Sincronizada (3:00 min)
                </span>
                <h4 className="text-base font-bold text-white">Audio Completo del Vídeo Integrado</h4>
              </div>
            </div>

            <div className="flex items-center space-x-2 self-end sm:self-auto">
              <a
                href={masterAudioUrl}
                download="Master_Locucion_Dinero_Con_Criterio_3min.wav"
                className="inline-flex items-center space-x-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-sm transition-all"
              >
                <Download className="w-4 h-4" />
                <span>Descargar Audio Máster (WAV 3:00)</span>
              </a>
            </div>
          </div>

          {/* Scrubber Timeline */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-mono text-indigo-300">
              <span>{secondsToTimeString(currentTimeSec)}</span>
              <span>{secondsToTimeString(parsedScript.totalDurationSec)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={parsedScript.totalDurationSec}
              step={0.1}
              value={currentTimeSec}
              onChange={handleSeekMaster}
              className="w-full accent-indigo-500 h-2 bg-slate-800 rounded-lg cursor-pointer"
            />
          </div>

          {/* Active Subtitle Display */}
          {activeLineId && (
            <div className="bg-indigo-900/60 border border-indigo-500/30 rounded-xl p-3.5 text-center animate-fade-in">
              <span className="text-[10px] uppercase font-bold text-indigo-300 tracking-wider block mb-1">
                Subtítulo Activo en Pantalla
              </span>
              <p className="text-sm font-semibold text-white italic">
                "{allLines.find((l) => l.id === activeLineId)?.text}"
              </p>
            </div>
          )}
        </div>
      )}

      {/* Action Bar: Batch Synthesize Options */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="space-y-1 text-center md:text-left">
          <h3 className="text-sm font-bold text-slate-900 flex items-center justify-center md:justify-start space-x-2">
            <Sparkles className="w-4 h-4 text-indigo-600" />
            <span>Opciones de Generación de Locución</span>
          </h3>
          <p className="text-xs text-slate-500">
            Sintetiza todo el documento en 1 solo paso para ahorrar peticiones, o genera frase por frase para sincronización milimétrica.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-2.5 w-full md:w-auto">
          {/* Direct 1-Request Generation */}
          <button
            onClick={generateFullScriptSingleRequest}
            disabled={isGeneratingAll}
            className="w-full sm:w-auto inline-flex items-center justify-center space-x-2 px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl font-bold text-xs shadow-md transition-all disabled:opacity-50"
          >
            {isGeneratingAll ? (
              <Loader2 className="w-4 h-4 animate-spin text-white" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            <span>🎙️ Generar Guión Completo (1 Petición - Rápido)</span>
          </button>

          {/* Sentence by Sentence Batch */}
          <button
            onClick={handleGenerateAllScriptLines}
            disabled={isGeneratingAll || isCompilingMaster}
            className="w-full sm:w-auto inline-flex items-center justify-center space-x-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs shadow-md transition-all disabled:opacity-50"
          >
            {isGeneratingAll ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-white" />
                <span>Frase {progressCount} de {totalLinesCount}...</span>
              </>
            ) : (
              <>
                <Layers className="w-4 h-4" />
                <span>
                  {generatedLinesCount > 0 ? 'Regenerar Frase por Frase' : '⚡ Generar Frase por Frase'}
                </span>
              </>
            )}
          </button>

          {/* Compile Master Audio Track */}
          {generatedLinesCount > 0 && (
            <button
              onClick={compileMasterAudioTrack}
              disabled={isGeneratingAll || isCompilingMaster}
              className="w-full sm:w-auto inline-flex items-center justify-center space-x-2 px-5 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-bold text-xs shadow-md transition-all disabled:opacity-50"
            >
              {isCompilingMaster ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  <span>Uniendo frases...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>🔗 Unir frases generadas en un solo audio</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Chapter Breakdown & Lines List */}
      <div className="space-y-6">
        {parsedScript.chapters.map((chap, chapIdx) => (
          <div key={chap.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            {/* Chapter Header */}
            <div className="bg-slate-50 px-5 py-3.5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center space-x-3">
                <span className="w-7 h-7 rounded-lg bg-indigo-600 text-white font-bold text-xs flex items-center justify-center shadow-xs">
                  {chapIdx + 1}
                </span>
                <div>
                  <h4 className="text-sm font-bold text-slate-900">{chap.title}</h4>
                  <span className="text-[11px] font-medium text-slate-500">
                    Marca temporal: <span className="font-mono text-indigo-700 font-bold">{chap.timeRange}</span> · {chap.lines.length} frases
                  </span>
                </div>
              </div>

              <div className="flex items-center space-x-2 self-end sm:self-center">
                {chap.audioUrl ? (
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => {
                        const audio = new Audio(chap.audioUrl);
                        audio.play();
                      }}
                      className="inline-flex items-center space-x-1 px-3 py-1 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-bold text-xs rounded-lg transition-colors border border-emerald-200"
                    >
                      <Play className="w-3.5 h-3.5 fill-emerald-700" />
                      <span>Escuchar Capítulo</span>
                    </button>
                    <a
                      href={chap.audioUrl}
                      download={`Capitulo_${chapIdx + 1}.wav`}
                      className="p-1.5 text-slate-400 hover:text-slate-700 transition-colors"
                      title="Descargar audio del capítulo"
                    >
                      <Download className="w-4 h-4" />
                    </a>
                  </div>
                ) : (
                  <button
                    onClick={() => generateChapterAudio(chap)}
                    disabled={chap.isGenerating || isGeneratingAll}
                    className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-xs rounded-lg transition-colors border border-indigo-200 disabled:opacity-50"
                  >
                    {chap.isGenerating ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                    )}
                    <span>🎙️ Sintetizar Capítulo (1 Petición)</span>
                  </button>
                )}
              </div>
            </div>

            {/* Lines List */}
            <div className="divide-y divide-slate-100">
              {chap.lines.map((line) => {
                const isCurrentActive = activeLineId === line.id;
                return (
                  <div
                    key={line.id}
                    className={`p-4 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                      isCurrentActive ? 'bg-indigo-50/70 border-l-4 border-indigo-600' : 'hover:bg-slate-50/50'
                    }`}
                  >
                    <div className="flex items-start space-x-3 flex-1 min-w-0">
                      {/* Timestamp Badge */}
                      <div className="bg-slate-100 px-2.5 py-1 rounded-lg font-mono text-xs font-bold text-slate-700 shrink-0 border border-slate-200">
                        [{secondsToTimeString(line.startSec)}]
                      </div>

                      <div className="space-y-1 flex-1">
                        <p className="text-xs sm:text-sm font-medium text-slate-800 leading-relaxed">
                          {line.text}
                        </p>
                        <div className="flex items-center flex-wrap gap-2 text-[11px] text-slate-500">
                          <span className="inline-flex items-center text-indigo-700 font-semibold bg-indigo-50 px-2 py-0.5 rounded">
                            <Clock className="w-3 h-3 mr-1 text-indigo-600" />
                            Duración asignada: {line.targetDurationSec} seg
                          </span>
                          {line.speedFactor && line.speedFactor !== 1 && (
                            <span className="bg-purple-100 text-purple-700 font-bold px-2 py-0.5 rounded">
                              Velocidad: {line.speedFactor}x
                            </span>
                          )}
                          {line.error && <span className="text-rose-600 font-bold">⚠️ {line.error}</span>}
                        </div>
                      </div>
                    </div>

                    {/* Line Action Control */}
                    <div className="flex items-center space-x-2 self-end sm:self-center shrink-0">
                      {line.audioUrl ? (
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => {
                              const audio = new Audio(line.audioUrl);
                              audio.play();
                            }}
                            className="inline-flex items-center space-x-1 px-3 py-1.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-bold text-xs rounded-lg transition-colors border border-indigo-200"
                          >
                            <Play className="w-3.5 h-3.5 fill-indigo-700" />
                            <span>Escuchar Frase</span>
                          </button>
                          <a
                            href={line.audioUrl}
                            download={`Frase_${secondsToTimeString(line.startSec)}.wav`}
                            className="p-1.5 text-slate-400 hover:text-slate-700 transition-colors"
                            title="Descargar clip de audio de la frase"
                          >
                            <Download className="w-4 h-4" />
                          </a>
                        </div>
                      ) : (
                        <button
                          onClick={() => generateSingleLine(line)}
                          disabled={line.isGenerating || isGeneratingAll}
                          className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-lg transition-colors border border-slate-300 disabled:opacity-50"
                        >
                          {line.isGenerating ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                          ) : (
                            <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                          )}
                          <span>Sintetizar</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
