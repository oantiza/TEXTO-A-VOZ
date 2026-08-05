import React, { useRef, useState, useEffect } from 'react';
import { GeneratedAudioItem } from '../types';
import { formatTime } from '../utils/audio';
import {
  Play,
  Pause,
  Download,
  Volume2,
  VolumeX,
  RotateCcw,
  Sparkles,
  Share2,
  Check,
} from 'lucide-react';

interface AudioPlayerProps {
  currentAudio: GeneratedAudioItem | null;
}

export const AudioPlayer: React.FC<AudioPlayerProps> = ({ currentAudio }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    if (currentAudio) {
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(currentAudio.durationSeconds || 0);
      if (audioRef.current) {
        audioRef.current.playbackRate = playbackRate;
        audioRef.current.play().catch(() => {
          // Auto-play policy might require gesture
        });
      }
    }
  }, [currentAudio]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  // Audio wave visualization loop
  useEffect(() => {
    let animId: number;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const renderWaveform = () => {
      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      const numBars = 48;
      const barWidth = 3;
      const gap = (width - numBars * barWidth) / (numBars - 1);

      for (let i = 0; i < numBars; i++) {
        let barHeight = 8;
        if (isPlaying) {
          // Dynamic simulated visualizer based on playing time and bar index
          const frequency = Math.sin(i * 0.4 + Date.now() * 0.01) * 0.5 + 0.5;
          barHeight = 6 + frequency * (height - 12);
        } else if (currentTime > 0) {
          barHeight = 12 + (i % 5) * 4;
        }

        const x = i * (barWidth + gap);
        const y = (height - barHeight) / 2;

        const isPlayed = (i / numBars) <= (currentTime / (duration || 1));

        ctx.fillStyle = isPlayed ? '#4f46e5' : '#e2e8f0';
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, 2);
        ctx.fill();
      }

      if (isPlaying) {
        animId = requestAnimationFrame(renderWaveform);
      }
    };

    renderWaveform();

    return () => {
      if (animId) cancelAnimationFrame(animId);
    };
  }, [isPlaying, currentTime, duration]);

  if (!currentAudio) {
    return (
      <div className="bg-slate-50 border border-dashed border-slate-200 rounded-2xl p-8 text-center flex flex-col items-center justify-center space-y-3">
        <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
          <Volume2 className="w-6 h-6" />
        </div>
        <h3 className="text-sm font-semibold text-slate-800">Listo para generar tu audio</h3>
        <p className="text-xs text-slate-500 max-w-sm">
          Escribe un texto arriba y presiona el botón "Generar Voz AI" para escuchar el audio sintetizado en vivo.
        </p>
      </div>
    );
  }

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
      if (audioRef.current.duration && !isNaN(audioRef.current.duration)) {
        setDuration(audioRef.current.duration);
      }
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setCurrentTime(time);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
  };

  const toggleMute = () => {
    if (audioRef.current) {
      audioRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  const handleDownload = () => {
    if (!currentAudio.audioUrl) return;
    const a = document.createElement('a');
    a.href = currentAudio.audioUrl;
    a.download = `locucion-${currentAudio.voice.toLowerCase()}-${Date.now()}.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleShare = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(currentAudio.text);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-indigo-100 shadow-md p-6 space-y-5 relative overflow-hidden">
      {/* Decorative accent gradient header */}
      <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />

      {/* Audio Element */}
      <audio
        ref={audioRef}
        src={currentAudio.audioUrl}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleTimeUpdate}
      />

      {/* Title & Metadata Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center flex-wrap gap-2">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-100 text-indigo-700">
              <Sparkles className="w-3 h-3 mr-1 text-indigo-600" />
              Audio Generado
            </span>
            <span className="text-xs font-semibold text-slate-600">
              Voz: <span className="text-slate-900">{currentAudio.voice}</span>
            </span>
            <span className="text-xs text-slate-400">•</span>
            <span className="text-xs text-slate-500 capitalize">
              {currentAudio.emotion}
            </span>
            {currentAudio.speedFactor && currentAudio.speedFactor !== 1 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-purple-100 text-purple-700 border border-purple-200" title="Ajuste automático de duración">
                ⚡ {currentAudio.durationSeconds}s ({currentAudio.speedFactor}x)
              </span>
            )}
          </div>
          <p className="text-xs text-slate-600 line-clamp-1 italic">
            "{currentAudio.text}"
          </p>
        </div>

        {/* Download & Share Controls */}
        <div className="flex items-center space-x-2">
          <button
            onClick={handleShare}
            className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-medium flex items-center space-x-1.5 transition-all"
            title="Copiar texto de la locución"
          >
            {copiedLink ? (
              <>
                <Check className="w-4 h-4 text-emerald-600" />
                <span className="text-emerald-600 hidden sm:inline">Copiado</span>
              </>
            ) : (
              <>
                <Share2 className="w-4 h-4 text-slate-500" />
                <span className="hidden sm:inline">Compartir</span>
              </>
            )}
          </button>

          <button
            onClick={handleDownload}
            className="px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center space-x-1.5 shadow-sm transition-all"
          >
            <Download className="w-4 h-4" />
            <span>Descargar WAV</span>
          </button>
        </div>
      </div>

      {/* Waveform & Canvas */}
      <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 flex flex-col items-center space-y-3">
        <canvas
          ref={canvasRef}
          width={500}
          height={48}
          className="w-full h-12 rounded"
        />

        {/* Seek Bar Slider */}
        <div className="w-full flex items-center space-x-3">
          <span className="text-xs font-mono text-slate-500 w-10 text-right">
            {formatTime(currentTime)}
          </span>
          <input
            type="range"
            min={0}
            max={duration || 100}
            step={0.1}
            value={currentTime}
            onChange={handleSeek}
            className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
          />
          <span className="text-xs font-mono text-slate-500 w-10">
            {formatTime(duration)}
          </span>
        </div>
      </div>

      {/* Playback Action Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          {/* Main Play Button */}
          <button
            onClick={togglePlay}
            className="w-12 h-12 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center shadow-md shadow-indigo-200 transition-all transform active:scale-95"
          >
            {isPlaying ? (
              <Pause className="w-6 h-6 fill-current" />
            ) : (
              <Play className="w-6 h-6 fill-current ml-0.5" />
            )}
          </button>

          {/* Mute Button */}
          <button
            onClick={toggleMute}
            className="p-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors"
          >
            {isMuted ? (
              <VolumeX className="w-4 h-4 text-rose-500" />
            ) : (
              <Volume2 className="w-4 h-4" />
            )}
          </button>
        </div>

        {/* Speed Selector */}
        <div className="flex items-center space-x-1.5 bg-slate-100 p-1 rounded-xl text-xs">
          {[0.75, 1, 1.25, 1.5, 2].map((rate) => (
            <button
              key={rate}
              onClick={() => setPlaybackRate(rate)}
              className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                playbackRate === rate
                  ? 'bg-white text-indigo-700 shadow-sm font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {rate}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
