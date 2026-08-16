import React, { useState, useEffect, useRef } from 'react';
import {
  VoiceName,
  ToneEmotion,
  AccentOption,
  SpeakerConfig,
  ScriptChapter,
  ScriptLine,
  ParsedScript,
  GeneratedAudioItem,
} from '../types';
import {
  combineNaturalScriptAudioSegments,
  combineScriptAudioSegments,
  DEFAULT_NUVIA_SCRIPT,
  parseVideoScript,
  scriptToSrt,
  scriptToVtt,
  secondsToFrameTimecode,
  secondsToTimeString,
} from '../utils/scriptParser';
import { base64ToWavBlob, wavBlobToMp3Blob } from '../utils/audio';
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
  scriptText: string;
  onScriptTextChange: (text: string) => void;
  selectedVoice: VoiceName;
  selectedEmotion: ToneEmotion;
  selectedAccent: AccentOption;
  isMultiSpeaker: boolean;
  speakers: SpeakerConfig[];
  onAddToHistory?: (item: GeneratedAudioItem) => void;
}

export const VideoScriptStudio: React.FC<VideoScriptStudioProps> = ({
  scriptText,
  onScriptTextChange,
  selectedVoice,
  selectedEmotion,
  selectedAccent,
  isMultiSpeaker,
  speakers,
  onAddToHistory,
}) => {
  const [parsedScript, setParsedScript] = useState<ParsedScript>(() => parseVideoScript(scriptText));
  const [showScriptEditor, setShowScriptEditor] = useState<boolean>(false);

  // Generation state
  const [isGeneratingAll, setIsGeneratingAll] = useState<boolean>(false);
  const [generationMode, setGenerationMode] = useState<'none' | 'natural-blocks' | 'continuous' | 'exact'>('none');
  const [isCompilingMaster, setIsCompilingMaster] = useState<boolean>(false);
  const [progressCount, setProgressCount] = useState<number>(0);
  const [totalLinesCount, setTotalLinesCount] = useState<number>(0);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // Audio Playback state
  const [masterAudioUrl, setMasterAudioUrl] = useState<string | null>(null);
  const [masterAudioBlob, setMasterAudioBlob] = useState<Blob | null>(null);
  const [masterDurationSec, setMasterDurationSec] = useState<number | null>(null);
  const [masterIsPreciselySynced, setMasterIsPreciselySynced] = useState<boolean>(false);
  const [masterTimingCsv, setMasterTimingCsv] = useState<string | null>(null);
  const [isConvertingMasterMp3, setIsConvertingMasterMp3] = useState<boolean>(false);
  const [isPlayingMaster, setIsPlayingMaster] = useState<boolean>(false);
  const [currentTimeSec, setCurrentTimeSec] = useState<number>(0);
  const [activeLineId, setActiveLineId] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // File upload handler for the text and subtitle formats parsed by the app.
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = e.target.files?.[0];
    if (!file) return;

    const extension = file.name.split('.').pop()?.toLowerCase();
    if (!extension || !['txt', 'md', 'srt', 'vtt', 'docx'].includes(extension)) {
      setGlobalError('Formato no compatible. Utiliza TXT, Markdown, SRT, VTT o DOCX.');
      input.value = '';
      return;
    }

    try {
      const content = extension === 'docx'
        ? (await (await import('mammoth')).extractRawText({ arrayBuffer: await file.arrayBuffer() })).value
        : await file.text();

      if (content) {
        onScriptTextChange(content);
        setShowScriptEditor(true);
        setGlobalError(null);
      } else {
        setGlobalError('El archivo no contiene texto que se pueda importar.');
      }
    } catch {
      setGlobalError('No se ha podido leer el archivo. Comprueba que no esté dañado.');
    } finally {
      input.value = '';
    }
  };

  // Parse raw script text when it changes
  useEffect(() => {
    const timer = setTimeout(() => {
      setParsedScript(parseVideoScript(scriptText));
    }, 500);
    return () => clearTimeout(timer);
  }, [scriptText]);

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
  const isFrameTimedScript = parsedScript.sourceFormat === 'frame-timed-markdown';
  const speechTextFor = (line: ScriptLine) => line.spokenText || line.text;

  const updateLineState = (lineId: string, changes: Partial<ScriptLine>) => {
    setParsedScript((prev) => ({
      ...prev,
      chapters: prev.chapters.map((chapter) => ({
        ...chapter,
        lines: chapter.lines.map((line) => (line.id === lineId ? { ...line, ...changes } : line)),
      })),
    }));
  };

  const downloadSubtitles = (format: 'srt' | 'vtt') => {
    const content = format === 'srt' ? scriptToSrt(parsedScript) : scriptToVtt(parsedScript);
    const blob = new Blob([content], { type: format === 'srt' ? 'application/x-subrip' : 'text/vtt' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${parsedScript.title.replace(/[^a-z0-9áéíóúüñ_-]+/gi, '-').replace(/^-|-$/g, '') || 'subtitulos'}.${format}`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  // Generate entire script audio in 1 single API call (consumes only 1 request quota)
  const generateFullScriptSingleRequest = async () => {
    setIsGeneratingAll(true);
    setGenerationMode('continuous');
    setGlobalError(null);

    const fullText = parsedScript.chapters
      .map((chap) => chap.lines.map(speechTextFor).join(' '))
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
          // Natural narration is the production master. The video is retimed to
          // this delivery; the voice is never accelerated or padded to a slot.
          targetDuration: null,
          continuousNarration: true,
          isMultiSpeaker,
          speakers: isMultiSpeaker ? speakers : undefined,
        }),
      });

      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Error al generar locución completa');

      const { blob, blobUrl, duration } = base64ToWavBlob(
        data.audioBase64,
        data.mimeType || 'audio/pcm;rate=24000'
      );

      setMasterAudioUrl(blobUrl);
      setMasterAudioBlob(blob);
      setMasterDurationSec(duration);
      setMasterIsPreciselySynced(false);
      setMasterTimingCsv(null);

      if (onAddToHistory) {
        onAddToHistory({
          id: `master_script_direct_${Date.now()}`,
          text: `${parsedScript.title} (Locución completa en 1 paso)`,
          voice: selectedVoice,
          emotion: selectedEmotion,
          accent: selectedAccent,
          durationSeconds: duration,
          audioBlob: blob,
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
      setGenerationMode('none');
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

    const chapterText = chapter.lines.map(speechTextFor).join(' ');
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
          targetDuration: chapterDuration <= 300 ? chapterDuration : undefined,
          continuousNarration: isFrameTimedScript,
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
          text: speechTextFor(line),
          voice: selectedVoice,
          emotion: selectedEmotion,
          accent: selectedAccent,
          // Ask Gemini to approach the slot first; the local pitch-preserving
          // correction below then only has to make a small exact adjustment.
          targetDuration: line.targetDurationSec,
          continuousNarration: isFrameTimedScript,
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

  // Generate every block naturally with the fast voice model. Unlike exact
  // sync, this path never sends a target duration and never time-stretches PCM.
  const handleGenerateNaturalScriptLines = async () => {
    setIsGeneratingAll(true);
    setGenerationMode('natural-blocks');
    setGlobalError(null);
    setProgressCount(0);
    setTotalLinesCount(allLines.length);
    setMasterTimingCsv(null);

    const linesToProcess = parsedScript.chapters.flatMap((chapter) => chapter.lines).map((line) => ({
      ...line,
      audioUrl: undefined,
      actualDurationSec: undefined,
      speedFactor: 1,
    }));

    for (let index = 0; index < linesToProcess.length; index++) {
      const line = linesToProcess[index];
      setProgressCount(index + 1);
      updateLineState(line.id, { isGenerating: true, error: undefined });
      let success = false;
      let attempts = 0;

      while (!success && attempts < 3) {
        attempts += 1;
        try {
          const response = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: speechTextFor(line),
              voice: selectedVoice,
              emotion: selectedEmotion,
              accent: selectedAccent,
              targetDuration: null,
              continuousNarration: true,
              isMultiSpeaker,
              speakers: isMultiSpeaker ? speakers : undefined,
            }),
          });
          const data = await response.json();

          if (response.status === 429 || data.isQuotaExhausted) {
            const waitTime = data.retryAfterSec || 15;
            for (let second = waitTime; second > 0; second--) {
              setGlobalError(`Cuota temporal de voz: reanudando en ${second} segundos…`);
              await new Promise((resolve) => setTimeout(resolve, 1_000));
            }
            setGlobalError(null);
            continue;
          }
          if (!response.ok) throw new Error(data.error || 'Error sintetizando el bloque natural');

          const { blobUrl, duration } = base64ToWavBlob(
            data.audioBase64,
            data.mimeType || 'audio/pcm;rate=24000'
          );
          Object.assign(line, {
            audioUrl: blobUrl,
            actualDurationSec: duration,
            speedFactor: 1,
            isGenerating: false,
            error: undefined,
          });
          updateLineState(line.id, {
            audioUrl: blobUrl,
            actualDurationSec: duration,
            speedFactor: 1,
            isGenerating: false,
            error: undefined,
          });
          success = true;
          setGlobalError(null);
          await new Promise((resolve) => setTimeout(resolve, 1_000));
        } catch (error: any) {
          if (attempts >= 3) {
            const message = error.message || 'Error de conexión';
            Object.assign(line, { isGenerating: false, error: message });
            updateLineState(line.id, { isGenerating: false, error: message });
          } else {
            await new Promise((resolve) => setTimeout(resolve, 5_000));
          }
        }
      }
    }

    setIsGeneratingAll(false);
    setGenerationMode('none');
    await compileNaturalMasterAudioTrack(linesToProcess);
  };

  // Generate batch for all script lines with automatic retry for rate limits
  const handleGenerateAllScriptLines = async () => {
    setIsGeneratingAll(true);
    setGenerationMode('exact');
    setGlobalError(null);
    setProgressCount(0);
    setTotalLinesCount(allLines.length);

    // Keep a local snapshot updated alongside React state so the final compilation
    // never reads the stale state captured before the asynchronous generation loop.
    const linesToProcess = parsedScript.chapters.flatMap((c) => c.lines).map((line) => ({ ...line }));

    for (let i = 0; i < linesToProcess.length; i++) {
      const line = linesToProcess[i];
      setProgressCount(i + 1);

      // Skip if already generated
      if (line.audioUrl) continue;

      updateLineState(line.id, { isGenerating: true, error: undefined });

      let success = false;
      let attempts = 0;

      while (!success && attempts < 3) {
        attempts++;
        try {
          const resp = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: speechTextFor(line),
              voice: selectedVoice,
              emotion: selectedEmotion,
              accent: selectedAccent,
              targetDuration: line.targetDurationSec,
              continuousNarration: isFrameTimedScript,
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

          Object.assign(line, {
            audioUrl: blobUrl,
            actualDurationSec: duration,
            speedFactor,
            isGenerating: false,
            error: undefined,
          });
          updateLineState(line.id, {
            audioUrl: blobUrl,
            actualDurationSec: duration,
            speedFactor,
            isGenerating: false,
            error: undefined,
          });

          setGlobalError(null);
          success = true;

          // Gentle delay between requests to avoid rapid spikes
          await new Promise((res) => setTimeout(res, 1000));
        } catch (err: any) {
          console.error(`Error en la frase [${line.startSec}s] intento ${attempts}:`, err);

          if (attempts >= 3) {
            const error = err.message || 'Límite de API / error de conexión';
            Object.assign(line, { isGenerating: false, error });
            updateLineState(line.id, { isGenerating: false, error });
          } else {
            // Wait 5s before retry
            await new Promise((res) => setTimeout(res, 5000));
          }
        }
      }
    }

    setIsGeneratingAll(false);
    setGenerationMode('none');

    // After generating all available lines, stitch continuous master audio track
    await compileMasterAudioTrack(linesToProcess);
  };

  const compileNaturalMasterAudioTrack = async (sourceLines: ScriptLine[]) => {
    const linesWithAudio = sourceLines.filter((line) => line.audioUrl);
    if (linesWithAudio.length === 0) {
      setGlobalError('No hay bloques naturales válidos para unir.');
      return;
    }

    setIsCompilingMaster(true);
    setGlobalError(null);
    try {
      const { masterBlob, masterBlobUrl, durationSeconds, timings } =
        await combineNaturalScriptAudioSegments(linesWithAudio);
      setMasterAudioUrl(masterBlobUrl);
      setMasterAudioBlob(masterBlob);
      setMasterDurationSec(durationSeconds);
      setMasterIsPreciselySynced(false);

      const frameRate = parsedScript.frameRate || 30;
      const csvRows = ['plan,start_tc,end_tc,start_frame,end_frame,duration_frames,duration_seconds'];
      timings.forEach((timing, index) => {
        const startFrame = Math.round(timing.startSec * frameRate);
        const endFrame = index === timings.length - 1
          ? Math.ceil(timing.endSec * frameRate)
          : Math.round(timing.endSec * frameRate);
        csvRows.push([
          `P${String(index + 1).padStart(2, '0')}`,
          secondsToFrameTimecode(startFrame / frameRate, frameRate),
          secondsToFrameTimecode(endFrame / frameRate, frameRate),
          startFrame,
          endFrame,
          endFrame - startFrame,
          ((endFrame - startFrame) / frameRate).toFixed(3),
        ].join(','));
      });
      setMasterTimingCsv(csvRows.join('\n'));

      if (onAddToHistory) {
        onAddToHistory({
          id: `master_script_natural_blocks_${Date.now()}`,
          text: `${parsedScript.title} (${linesWithAudio.length} bloques naturales Flash)`,
          voice: selectedVoice,
          emotion: selectedEmotion,
          accent: selectedAccent,
          durationSeconds,
          audioBlob: masterBlob,
          audioUrl: masterBlobUrl,
          createdAt: new Date().toISOString(),
          isMultiSpeaker,
          speakers: isMultiSpeaker ? [...speakers] : undefined,
        });
      }
    } catch (error: any) {
      setGlobalError(error.message || 'No se han podido unir los bloques naturales.');
    } finally {
      setIsCompilingMaster(false);
    }
  };

  // Stitch master continuous WAV audio with rigid source timecodes.
  const compileMasterAudioTrack = async (sourceLines?: ScriptLine[]) => {
    const linesWithAudio = (sourceLines ?? parsedScript.chapters.flatMap((c) => c.lines)).filter(
      (line) => line.audioUrl
    );
    if (linesWithAudio.length === 0) {
      setGlobalError('No hay frases generadas para unir en un audio final.');
      return;
    }

    setIsCompilingMaster(true);
    setGlobalError(null);

    try {
      const { masterBlob, masterBlobUrl } = await combineScriptAudioSegments(
        linesWithAudio,
        parsedScript.totalDurationSec
      );
      setMasterAudioUrl(masterBlobUrl);
      setMasterAudioBlob(masterBlob);
      setMasterDurationSec(parsedScript.totalDurationSec);
      setMasterIsPreciselySynced(true);
      setMasterTimingCsv(null);

      if (onAddToHistory) {
        onAddToHistory({
          id: `master_script_${Date.now()}`,
          text: `${parsedScript.title} (${linesWithAudio.length} frases sincronizadas)`,
          voice: selectedVoice,
          emotion: selectedEmotion,
          accent: selectedAccent,
          durationSeconds: parsedScript.totalDurationSec,
          audioBlob: masterBlob,
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

  const downloadMasterMp3 = async () => {
    if (!masterAudioBlob) return;
    setIsConvertingMasterMp3(true);
    try {
      const mp3Blob = await wavBlobToMp3Blob(masterAudioBlob);
      const url = URL.createObjectURL(mp3Blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${parsedScript.title.replace(/[^a-z0-9áéíóúüñ_-]+/gi, '-').replace(/^-|-$/g, '') || 'locucion-master'}.mp3`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch {
      setGlobalError('No se ha podido convertir la pista máster a MP3.');
    } finally {
      setIsConvertingMasterMp3(false);
    }
  };

  const downloadMasterTiming = () => {
    if (!masterTimingCsv) return;
    const blob = new Blob([masterTimingCsv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'timing-locucion-natural-30fps.csv';
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
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

            <div className="flex flex-wrap items-center gap-2">
              <label className="cursor-pointer inline-flex items-center space-x-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 px-3.5 py-1.5 rounded-xl shadow-sm transition-all border border-indigo-400/30">
                <Upload className="w-3.5 h-3.5" />
                <span>Importar TXT / MD / SRT / VTT / DOCX</span>
                <input
                  type="file"
                  accept=".txt,.md,.srt,.vtt,.docx"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>

              {allLines.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => downloadSubtitles('srt')}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-100 hover:text-white bg-white/10 px-3 py-1.5 rounded-xl border border-white/15 hover:bg-white/20"
                  >
                    <Download className="w-3.5 h-3.5" /> SRT
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadSubtitles('vtt')}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-100 hover:text-white bg-white/10 px-3 py-1.5 rounded-xl border border-white/15 hover:bg-white/20"
                  >
                    <Download className="w-3.5 h-3.5" /> VTT
                  </button>
                </>
              )}

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
                {secondsToTimeString(parsedScript.totalDurationSec)}
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
              onClick={() => onScriptTextChange(DEFAULT_NUVIA_SCRIPT)}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 underline"
            >
              Restablecer Guión Original (Nuvia Academy)
            </button>
          </div>
          <textarea
            value={scriptText}
            onChange={(e) => onScriptTextChange(e.target.value)}
            rows={10}
            className="w-full font-mono text-xs p-3.5 bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none leading-relaxed text-slate-800"
            placeholder="Pega aquí tu guión con marcas de tiempo como [00:00] o 00:00–00:14..."
          />
          <p className="text-[11px] text-slate-500">
            Formato principal: bloques Markdown como `## P01 · 00:00:00:00–00:00:07:00 · 7 segundos`.
            También se admiten `[MM:SS]`, SRT y VTT. Las notas posteriores de pronunciación se aplican a la voz sin modificar los subtítulos.
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
                  {masterIsPreciselySynced ? 'Pista máster sincronizada' : 'Pista completa con voz natural'} ({secondsToTimeString(masterDurationSec ?? parsedScript.totalDurationSec)})
                </span>
                <h4 className="text-base font-bold text-white">Audio Completo del Vídeo Integrado</h4>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 self-end sm:self-auto">
              <a
                href={masterAudioUrl}
                download="locucion-master.wav"
                className="inline-flex items-center space-x-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-sm transition-all"
              >
                <Download className="w-4 h-4" />
                <span>Descargar WAV · 48 kHz</span>
              </a>
              {masterAudioBlob && (
                <button
                  type="button"
                  onClick={downloadMasterMp3}
                  disabled={isConvertingMasterMp3}
                  className="inline-flex items-center space-x-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-bold text-xs rounded-xl shadow-sm transition-all"
                >
                  {isConvertingMasterMp3 ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  <span>{isConvertingMasterMp3 ? 'Convirtiendo…' : 'Descargar MP3'}</span>
                </button>
              )}
              {masterTimingCsv && (
                <button
                  type="button"
                  onClick={downloadMasterTiming}
                  className="inline-flex items-center space-x-1.5 px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs rounded-xl shadow-sm transition-all"
                >
                  <Download className="w-4 h-4" />
                  <span>Descargar tiempos 30 fps</span>
                </button>
              )}
            </div>
          </div>

          {/* Scrubber Timeline */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-mono text-indigo-300">
              <span>{secondsToTimeString(currentTimeSec)}</span>
              <span>{secondsToTimeString(masterDurationSec ?? parsedScript.totalDurationSec)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={masterDurationSec ?? parsedScript.totalDurationSec}
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
      {isFrameTimedScript && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-xs sm:text-sm text-emerald-900 flex items-start gap-3 shadow-sm">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold block">Formato de producción reconocido</span>
            <p className="leading-relaxed">
              {allLines.length} bloques con código HH:MM:SS:FF a {parsedScript.frameRate} fps. Usa
              «Natural por bloques · Flash» para crear la locución maestra. Los códigos sirven como guía visual y la animación
              se reajusta después a los tiempos reales de la voz. El ajuste exacto queda disponible solo como alternativa.
            </p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="space-y-1 text-center md:text-left">
          <h3 className="text-sm font-bold text-slate-900 flex items-center justify-center md:justify-start space-x-2">
            <Sparkles className="w-4 h-4 text-indigo-600" />
            <span>Opciones de Generación de Locución</span>
          </h3>
          <p className="text-xs text-slate-500">
            {isFrameTimedScript
              ? 'Recomendado: Kore Flash por bloques, sin estirar la voz, con pausas breves y nivel homogéneo.'
              : 'Sintetiza todo el documento en 1 solo paso para ahorrar peticiones, o genera frase por frase para sincronización milimétrica.'}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row sm:flex-wrap items-center gap-2.5 w-full md:w-auto md:justify-end">
          <button
            onClick={handleGenerateNaturalScriptLines}
            disabled={isGeneratingAll || isCompilingMaster || allLines.length === 0}
            title="Genera cada bloque con Gemini Flash a velocidad natural y crea una sola pista continua, audible y sin estirado."
            className="w-full sm:w-auto inline-flex items-center justify-center space-x-2 px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl font-bold text-xs shadow-md transition-all disabled:opacity-50"
          >
            {generationMode === 'natural-blocks' ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-white" />
                <span>Bloque {progressCount} de {totalLinesCount}…</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>🎙️ Natural por bloques · Flash</span>
              </>
            )}
          </button>

          {/* Direct 1-Request Generation: useful as a comparison, not the NUVIA master. */}
          <button
            onClick={generateFullScriptSingleRequest}
            disabled={isGeneratingAll || allLines.length === 0}
            title="Genera todo en una petición con el modelo de larga duración. Puede sonar bajo o fragmentado y no se recomienda para NUVIA."
            className="w-full sm:w-auto inline-flex items-center justify-center space-x-2 px-4 py-2.5 bg-slate-600 hover:bg-slate-700 text-white rounded-xl font-bold text-xs shadow-sm transition-all disabled:opacity-50"
          >
            {generationMode === 'continuous' ? (
              <Loader2 className="w-4 h-4 animate-spin text-white" />
            ) : (
              <Volume2 className="w-4 h-4" />
            )}
            <span>Continuo experimental</span>
          </button>

          {/* Sentence by Sentence Batch */}
          <button
            onClick={handleGenerateAllScriptLines}
            disabled={isGeneratingAll || isCompilingMaster || allLines.length === 0}
            className="w-full sm:w-auto inline-flex items-center justify-center space-x-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs shadow-md transition-all disabled:opacity-50"
          >
            {generationMode === 'exact' ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-white" />
                <span>Frase {progressCount} de {totalLinesCount}...</span>
              </>
            ) : (
              <>
                <Layers className="w-4 h-4" />
                <span>
                  {generatedLinesCount > 0
                    ? 'Regenerar sincronizado'
                    : isFrameTimedScript
                      ? '⚠️ Ajustar voz a intervalos'
                      : '⚡ Generar Frase por Frase'}
                </span>
              </>
            )}
          </button>

          {/* Compile Master Audio Track */}
          {generatedLinesCount > 0 && (
            <button
              onClick={() => compileMasterAudioTrack()}
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
                    Marca temporal: <span className="font-mono text-indigo-700 font-bold">{chap.timeRange}</span> · {chap.lines.length} {chap.lines.length === 1 ? 'frase' : 'frases'}
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
                    disabled={chap.isGenerating || isGeneratingAll || chap.lines.length === 0}
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
                        [{line.sourceTimecode?.split('–')[0] || secondsToTimeString(line.startSec)}]
                      </div>

                      <div className="space-y-1 flex-1">
                        <p className="text-xs sm:text-sm font-medium text-slate-800 leading-relaxed">
                          {line.text}
                        </p>
                        <div className="flex items-center flex-wrap gap-2 text-[11px] text-slate-500">
                          <span className="inline-flex items-center text-indigo-700 font-semibold bg-indigo-50 px-2 py-0.5 rounded">
                            <Clock className="w-3 h-3 mr-1 text-indigo-600" />
                            Duración asignada: {Number(line.targetDurationSec.toFixed(3))} seg
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
