import React, { useEffect, useRef, useState } from 'react';
import { VOICE_OPTIONS, TONE_EMOTIONS, ACCENT_OPTIONS } from '../data';
import { VoiceName, ToneEmotion, AccentOption, SpeakerConfig, VoiceOption } from '../types';
import { base64ToWavBlob } from '../utils/audio';
import {
  Mic,
  Sliders,
  Users,
  User,
  Sparkles,
  Check,
  ChevronDown,
  Globe2,
  Clock,
  Minus,
  Plus,
  Gauge,
  Volume2,
  Play,
  Loader2,
} from 'lucide-react';

interface VoiceSettingsProps {
  selectedVoice: VoiceName;
  setSelectedVoice: (voice: VoiceName) => void;
  selectedEmotion: ToneEmotion;
  setSelectedEmotion: (emotion: ToneEmotion) => void;
  selectedAccent: AccentOption;
  setSelectedAccent: (accent: AccentOption) => void;
  useTargetDuration: boolean;
  setUseTargetDuration: (use: boolean) => void;
  targetDurationSeconds: number;
  setTargetDurationSeconds: (sec: number) => void;
  isMultiSpeaker: boolean;
  setIsMultiSpeaker: (multi: boolean) => void;
  speakers: SpeakerConfig[];
  setSpeakers: React.Dispatch<React.SetStateAction<SpeakerConfig[]>>;
}

export const VoiceSettings: React.FC<VoiceSettingsProps> = ({
  selectedVoice,
  setSelectedVoice,
  selectedEmotion,
  setSelectedEmotion,
  selectedAccent,
  setSelectedAccent,
  useTargetDuration,
  setUseTargetDuration,
  targetDurationSeconds,
  setTargetDurationSeconds,
  isMultiSpeaker,
  setIsMultiSpeaker,
  speakers,
  setSpeakers,
}) => {
  const [sampleCache, setSampleCache] = useState<Record<string, string>>({});
  const [loadingSampleVoice, setLoadingSampleVoice] = useState<string | null>(null);
  const [playingSampleVoice, setPlayingSampleVoice] = useState<string | null>(null);
  const [activeAudioObj, setActiveAudioObj] = useState<HTMLAudioElement | null>(null);
  const [sampleNotice, setSampleNotice] = useState<string | null>(null);
  const sampleUrlsRef = useRef<Set<string>>(new Set());
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      activeAudioRef.current?.pause();
      sampleUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const updateSpeaker = (index: number, key: 'name' | 'voiceName', value: string) => {
    setSpeakers((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [key]: value };
      return next;
    });
  };

  const handlePlayVoiceSample = async (voice: VoiceOption, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedVoice(voice.id);
    setSampleNotice(null);

    // If already playing this voice, stop it
    if (playingSampleVoice === voice.id && activeAudioObj) {
      activeAudioObj.pause();
      setPlayingSampleVoice(null);
      return;
    }

    if (activeAudioObj) {
      activeAudioObj.pause();
    }

    if (sampleCache[voice.id]) {
      const audio = new Audio(sampleCache[voice.id]);
      activeAudioRef.current = audio;
      setActiveAudioObj(audio);
      setPlayingSampleVoice(voice.id);
      audio.play();
      audio.onended = () => setPlayingSampleVoice(null);
      return;
    }

    setLoadingSampleVoice(voice.id);
    try {
      const resp = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: voice.sampleText || `Hola, soy ${voice.name} y esta es una muestra de mi voz en castellano.`,
          voice: voice.id,
          emotion: 'natural',
          accent: 'spain',
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        if (resp.status === 429 || data.isQuotaExhausted) {
          setSampleNotice(
            data.error || 'Límite de solicitudes de la API gratuita alcanzado. Por favor espera unos segundos para escuchar la muestra.'
          );
          return;
        }
        throw new Error(data.error || 'Error al generar muestra');
      }

      const { blobUrl } = base64ToWavBlob(
        data.audioBase64,
        data.mimeType || 'audio/pcm;rate=24000'
      );

      sampleUrlsRef.current.add(blobUrl);
      setSampleCache((prev) => ({ ...prev, [voice.id]: blobUrl }));
      const audio = new Audio(blobUrl);
      activeAudioRef.current = audio;
      setActiveAudioObj(audio);
      setPlayingSampleVoice(voice.id);
      audio.play();
      audio.onended = () => setPlayingSampleVoice(null);
    } catch (err: any) {
      setSampleNotice(err?.message || 'No se pudo reproducir la muestra de voz en este momento.');
    } finally {
      setLoadingSampleVoice(null);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5 flex flex-col space-y-5">
      {/* Header & Mode Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
        <div className="flex items-center space-x-2">
          <Sliders className="w-5 h-5 text-indigo-600" />
          <h2 className="text-base font-semibold text-slate-900">Configuración de Voz</h2>
        </div>

        {/* Mode Toggle */}
        <div className="inline-flex p-1 bg-slate-100 rounded-xl text-xs font-medium self-start sm:self-auto">
          <button
            onClick={() => setIsMultiSpeaker(false)}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg transition-all ${
              !isMultiSpeaker
                ? 'bg-white text-indigo-700 shadow-sm font-semibold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <User className="w-3.5 h-3.5" />
            <span>Voz Individual</span>
          </button>
          <button
            onClick={() => setIsMultiSpeaker(true)}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg transition-all ${
              isMultiSpeaker
                ? 'bg-white text-indigo-700 shadow-sm font-semibold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Multi-Hablante (2 Voces)</span>
          </button>
        </div>
      </div>

      {/* Castellano Accent Indicator */}
      <div className="bg-gradient-to-r from-emerald-50 via-teal-50 to-emerald-50 border border-emerald-200/80 rounded-xl p-3.5 flex items-center justify-between shadow-2xs">
        <div className="flex items-center space-x-3">
          <span className="text-2xl">🇪🇸</span>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Acento preferente: Castellano (España)
              </h3>
              <span className="bg-emerald-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                Activo
              </span>
            </div>
            <p className="text-xs text-slate-600 mt-0.5">
              La locución recibe instrucciones específicas de pronunciación en castellano de España.
            </p>
          </div>
        </div>
      </div>

      {sampleNotice && (
        <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl text-xs flex items-center justify-between">
          <span>⚠️ {sampleNotice}</span>
          <button
            onClick={() => setSampleNotice(null)}
            className="text-amber-600 hover:text-amber-900 font-bold ml-2 underline text-[11px]"
          >
            Cerrar
          </button>
        </div>
      )}

      {!isMultiSpeaker ? (
        <>
          {/* Single Voice Selection & Samples */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                Seleccionar Voz Principal y Muestras de Audio
              </label>
              <span className="text-[11px] text-indigo-600 font-semibold flex items-center space-x-1">
                <Volume2 className="w-3.5 h-3.5" />
                <span>Haz clic en "Muestra de Voz" para escuchar cada una</span>
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {VOICE_OPTIONS.map((v) => {
                const isSelected = selectedVoice === v.id;
                const isLoadingThis = loadingSampleVoice === v.id;
                const isPlayingThis = playingSampleVoice === v.id;

                return (
                  <div
                    key={v.id}
                    onClick={() => setSelectedVoice(v.id)}
                    className={`relative p-3.5 rounded-2xl border text-left cursor-pointer transition-all flex flex-col justify-between ${
                      isSelected
                        ? 'border-indigo-600 bg-indigo-50/40 ring-2 ring-indigo-500/20 shadow-xs'
                        : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/60'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center space-x-2.5">
                          <div
                            className={`w-9 h-9 rounded-xl bg-gradient-to-tr ${v.avatarColor} text-white flex items-center justify-center font-bold text-xs shadow-sm`}
                          >
                            {v.name[0]}
                          </div>
                          <div>
                            <h3 className="text-sm font-bold text-slate-900">{v.name}</h3>
                            <span className="text-[10px] font-medium text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                              {v.gender}
                            </span>
                          </div>
                        </div>
                        {isSelected && (
                          <div className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center">
                            <Check className="w-3 h-3 stroke-[3]" />
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-slate-600 leading-snug line-clamp-2">
                        {v.description}
                      </p>
                    </div>

                    {/* Audio Preview Button */}
                    <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between">
                      <span className="text-[10px] font-medium text-slate-400">Muestra en castellano</span>
                      <button
                        type="button"
                        onClick={(e) => handlePlayVoiceSample(v, e)}
                        className={`inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition-all shadow-2xs ${
                          isPlayingThis
                            ? 'bg-emerald-600 text-white ring-2 ring-emerald-300 animate-pulse'
                            : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200/80'
                        }`}
                      >
                        {isLoadingThis ? (
                          <>
                            <Loader2 className="w-3 h-3 animate-spin text-indigo-600" />
                            <span>Generando...</span>
                          </>
                        ) : isPlayingThis ? (
                          <>
                            <Volume2 className="w-3.5 h-3.5 text-white animate-bounce" />
                            <span>Escuchando...</span>
                          </>
                        ) : (
                          <>
                            <Play className="w-3 h-3 text-indigo-600 fill-indigo-600" />
                            <span>Escuchar Muestra</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Tone & Emotion Selector */}
          <div>
            <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider block mb-2">
              Estilo / Tono de Expresión
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {TONE_EMOTIONS.map((tone) => {
                const isSelected = selectedEmotion === tone.id;
                return (
                  <button
                    key={tone.id}
                    onClick={() => setSelectedEmotion(tone.id as ToneEmotion)}
                    className={`p-2.5 rounded-xl border text-left transition-all ${
                      isSelected
                        ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm'
                        : 'border-slate-200 bg-slate-50/50 hover:bg-slate-100 text-slate-700'
                    }`}
                  >
                    <div className="text-xs font-semibold">{tone.label}</div>
                    <div
                      className={`text-[10px] mt-0.5 truncate ${
                        isSelected ? 'text-indigo-100' : 'text-slate-400'
                      }`}
                    >
                      {tone.desc}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      ) : (
        /* Multi-Speaker Settings */
        <div className="space-y-4">
          <div className="p-3 bg-indigo-50/60 border border-indigo-100 rounded-xl text-xs text-indigo-900">
            <p>
              Elige el nombre y la voz para cada uno de los dos hablantes de tu conversación en castellano.
              Asegúrate de formatear el texto como: <code>Hablante 1: ...</code> y <code>Hablante 2: ...</code>.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Speaker 1 */}
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center space-x-1">
                  <User className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Hablante 1</span>
                </span>
                <span className="text-[10px] font-semibold bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">
                  Personaje 1
                </span>
              </div>

              <div>
                <label className="text-[11px] font-medium text-slate-600 block mb-1">
                  Nombre en el guion
                </label>
                <input
                  type="text"
                  value={speakers[0]?.name || 'Carlos'}
                  onChange={(e) => updateSpeaker(0, 'name', e.target.value)}
                  className="w-full text-xs rounded-lg border border-slate-200 p-2 text-slate-800 bg-white focus:outline-none focus:border-indigo-500"
                  placeholder="Ej. Carlos"
                />
              </div>

              <div>
                <label className="text-[11px] font-medium text-slate-600 block mb-1">
                  Voz asignada
                </label>
                <select
                  value={speakers[0]?.voiceName || 'Puck'}
                  onChange={(e) => updateSpeaker(0, 'voiceName', e.target.value as VoiceName)}
                  className="w-full text-xs rounded-lg border border-slate-200 p-2 text-slate-800 bg-white focus:outline-none focus:border-indigo-500"
                >
                  {VOICE_OPTIONS.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} ({v.gender}) - {v.description.substring(0, 30)}...
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Speaker 2 */}
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center space-x-1">
                  <User className="w-3.5 h-3.5 text-purple-600" />
                  <span>Hablante 2</span>
                </span>
                <span className="text-[10px] font-semibold bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                  Personaje 2
                </span>
              </div>

              <div>
                <label className="text-[11px] font-medium text-slate-600 block mb-1">
                  Nombre en el guion
                </label>
                <input
                  type="text"
                  value={speakers[1]?.name || 'María'}
                  onChange={(e) => updateSpeaker(1, 'name', e.target.value)}
                  className="w-full text-xs rounded-lg border border-slate-200 p-2 text-slate-800 bg-white focus:outline-none focus:border-indigo-500"
                  placeholder="Ej. María"
                />
              </div>

              <div>
                <label className="text-[11px] font-medium text-slate-600 block mb-1">
                  Voz asignada
                </label>
                <select
                  value={speakers[1]?.voiceName || 'Kore'}
                  onChange={(e) => updateSpeaker(1, 'voiceName', e.target.value as VoiceName)}
                  className="w-full text-xs rounded-lg border border-slate-200 p-2 text-slate-800 bg-white focus:outline-none focus:border-indigo-500"
                >
                  {VOICE_OPTIONS.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} ({v.gender}) - {v.description.substring(0, 30)}...
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Target Duration Control Section */}
      <div className="pt-4 border-t border-slate-100 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center space-x-2">
            <Clock className="w-4 h-4 text-indigo-600" />
            <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
              Duración Objetivo (Segundos Exactos)
            </label>
          </div>

          {/* Toggle Switch */}
          <label className="relative inline-flex items-center cursor-pointer select-none">
            <input
              type="checkbox"
              checked={useTargetDuration}
              onChange={(e) => setUseTargetDuration(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
            <span className="ml-2.5 text-xs font-semibold text-slate-700">
              {useTargetDuration ? 'Ajustar Duración Exacta' : 'Duración Libre (Natural)'}
            </span>
          </label>
        </div>

        {useTargetDuration && (
          <div className="p-4 rounded-xl border border-indigo-200 bg-indigo-50/40 space-y-3.5 animate-fade-in">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center space-x-2.5">
                <button
                  type="button"
                  onClick={() => setTargetDurationSeconds(Math.max(2, targetDurationSeconds - 1))}
                  className="w-8 h-8 rounded-lg border border-slate-300 bg-white text-slate-700 font-bold hover:bg-slate-100 flex items-center justify-center transition-colors shadow-sm"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>

                <div className="flex items-baseline space-x-1.5 bg-white px-3.5 py-1.5 rounded-xl border border-indigo-200 shadow-sm">
                  <input
                    type="number"
                    min={2}
                    max={180}
                    value={targetDurationSeconds}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      if (!isNaN(val)) setTargetDurationSeconds(Math.max(1, Math.min(300, val)));
                    }}
                    className="w-14 text-center text-lg font-extrabold text-indigo-900 focus:outline-none"
                  />
                  <span className="text-xs font-bold text-indigo-600">seg</span>
                </div>

                <button
                  type="button"
                  onClick={() => setTargetDurationSeconds(Math.min(180, targetDurationSeconds + 1))}
                  className="w-8 h-8 rounded-lg border border-slate-300 bg-white text-slate-700 font-bold hover:bg-slate-100 flex items-center justify-center transition-colors shadow-sm"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Quick preset chips */}
              <div className="flex items-center flex-wrap gap-1.5">
                <span className="text-[11px] text-slate-500 font-medium mr-1">Preajustes:</span>
                {[5, 8, 10, 12, 14, 15, 20, 30].map((sec) => (
                  <button
                    key={sec}
                    type="button"
                    onClick={() => setTargetDurationSeconds(sec)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                      targetDurationSeconds === sec
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {sec}s
                  </button>
                ))}
              </div>
            </div>

            {/* Dynamic explanation box */}
            <div className="flex items-start space-x-2 text-xs text-indigo-900 bg-white/90 p-3 rounded-xl border border-indigo-100 shadow-2xs">
              <Gauge className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
              <p className="leading-relaxed">
                <strong>Ajuste Automático de Velocidad:</strong> La locución durará exactamente{' '}
                <span className="font-bold text-indigo-700 underline decoration-indigo-300 decoration-2">{targetDurationSeconds} segundos</span>.
                La velocidad del audio se acelerará o reducirá en tiempo real para calzar exactamente en el tiempo indicado.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
