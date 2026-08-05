import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { TextEditor } from './components/TextEditor';
import { VoiceSettings } from './components/VoiceSettings';
import { AudioPlayer } from './components/AudioPlayer';
import { HistoryList } from './components/HistoryList';
import { VideoScriptStudio } from './components/VideoScriptStudio';
import { ProjectBar } from './components/ProjectBar';
import { LoginScreen } from './components/LoginScreen';
import {
  AccentOption,
  AppMode,
  GeneratedAudioItem,
  ProjectSnapshot,
  ProjectSummary,
  SampleTemplate,
  SpeakerConfig,
  ToneEmotion,
  VoiceName,
} from './types';
import { base64ToWavBlob } from './utils/audio';
import {
  createBlankProject,
  deleteProject,
  exportProject,
  importProject,
  listProjects,
  loadProject,
  saveProject,
} from './storage/projectStore';
import {
  Volume2,
  Sparkles,
  Loader2,
  AlertCircle,
  Wand2,
  RotateCcw,
  ShieldCheck,
  Video,
  Mic,
} from 'lucide-react';

export default function App() {
  const initialProjectRef = React.useRef<ProjectSnapshot | null>(null);
  if (!initialProjectRef.current) initialProjectRef.current = createBlankProject('Mi primer proyecto');
  const initialProject = initialProjectRef.current;

  const [projectId, setProjectId] = useState(initialProject.id);
  const [projectName, setProjectName] = useState(initialProject.name);
  const [projectCreatedAt, setProjectCreatedAt] = useState(initialProject.createdAt);
  const [projectUpdatedAt, setProjectUpdatedAt] = useState(initialProject.updatedAt);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saving');
  const [isProjectReady, setIsProjectReady] = useState(false);

  const [appMode, setAppMode] = useState<AppMode>(initialProject.appMode);
  const [text, setText] = useState<string>(initialProject.text);
  const [scriptText, setScriptText] = useState<string>(initialProject.scriptText);
  const [selectedVoice, setSelectedVoice] = useState<VoiceName>(initialProject.selectedVoice);
  const [selectedEmotion, setSelectedEmotion] = useState<ToneEmotion>(initialProject.selectedEmotion);
  const [selectedAccent, setSelectedAccent] = useState<AccentOption>(initialProject.selectedAccent);
  const [useTargetDuration, setUseTargetDuration] = useState<boolean>(initialProject.useTargetDuration);
  const [targetDurationSeconds, setTargetDurationSeconds] = useState<number>(initialProject.targetDurationSeconds);
  const [isMultiSpeaker, setIsMultiSpeaker] = useState<boolean>(initialProject.isMultiSpeaker);
  const [speakers, setSpeakers] = useState<SpeakerConfig[]>(initialProject.speakers);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isHighDemand, setIsHighDemand] = useState<boolean>(false);
  const [serverStatus, setServerStatus] = useState<'connected' | 'checking' | 'error'>('checking');
  const [authStatus, setAuthStatus] = useState<'checking' | 'granted' | 'required'>('checking');

  const [currentAudio, setCurrentAudio] = useState<GeneratedAudioItem | null>(null);
  const [history, setHistory] = useState<GeneratedAudioItem[]>(initialProject.history);
  const historyRef = React.useRef<GeneratedAudioItem[]>([]);
  historyRef.current = history;

  useEffect(() => {
    return () => {
      historyRef.current.forEach((item) => URL.revokeObjectURL(item.audioUrl));
    };
  }, []);

  const makeProjectSnapshot = (): ProjectSnapshot => ({
    id: projectId,
    name: projectName.trim() || 'Proyecto sin título',
    createdAt: projectCreatedAt,
    updatedAt: projectUpdatedAt,
    appMode,
    text,
    scriptText,
    selectedVoice,
    selectedEmotion,
    selectedAccent,
    useTargetDuration,
    targetDurationSeconds,
    isMultiSpeaker,
    speakers,
    history,
  });

  const applyProjectSnapshot = (project: ProjectSnapshot) => {
    historyRef.current.forEach((item) => URL.revokeObjectURL(item.audioUrl));
    setProjectId(project.id);
    setProjectName(project.name);
    setProjectCreatedAt(project.createdAt);
    setProjectUpdatedAt(project.updatedAt);
    setAppMode(project.appMode);
    setText(project.text);
    setScriptText(project.scriptText);
    setSelectedVoice(project.selectedVoice);
    setSelectedEmotion(project.selectedEmotion);
    setSelectedAccent(project.selectedAccent);
    setUseTargetDuration(project.useTargetDuration);
    setTargetDurationSeconds(project.targetDurationSeconds);
    setIsMultiSpeaker(project.isMultiSpeaker);
    setSpeakers(project.speakers);
    setHistory(project.history);
    setCurrentAudio(project.history[0] ?? null);
  };

  const refreshProjects = async () => setProjects(await listProjects());

  useEffect(() => {
    let cancelled = false;
    const initializeProjects = async () => {
      try {
        let summaries = await listProjects();
        if (summaries.length === 0) {
          await saveProject(initialProjectRef.current!);
          summaries = await listProjects();
        }
        const project = summaries[0] ? await loadProject(summaries[0].id) : null;
        if (!cancelled && project) {
          applyProjectSnapshot(project);
          setProjects(summaries);
          setSaveStatus('saved');
          setIsProjectReady(true);
        }
      } catch (error: any) {
        if (!cancelled) {
          setErrorMsg(error?.message || 'No se pudieron abrir los proyectos locales.');
          setSaveStatus('error');
          setIsProjectReady(true);
        }
      }
    };
    initializeProjects();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isProjectReady) return;
    setSaveStatus('saving');
    const timer = window.setTimeout(async () => {
      try {
        const saved = await saveProject(makeProjectSnapshot());
        setProjectUpdatedAt(saved.updatedAt);
        await refreshProjects();
        setSaveStatus('saved');
      } catch (error: any) {
        setSaveStatus('error');
        setErrorMsg(error?.message || 'No se pudo guardar el proyecto localmente.');
      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [
    isProjectReady,
    projectId,
    projectName,
    appMode,
    text,
    scriptText,
    selectedVoice,
    selectedEmotion,
    selectedAccent,
    useTargetDuration,
    targetDurationSeconds,
    isMultiSpeaker,
    speakers,
    history,
  ]);

  const persistCurrentProject = async () => {
    if (!isProjectReady) return null;
    setSaveStatus('saving');
    const saved = await saveProject(makeProjectSnapshot());
    setProjectUpdatedAt(saved.updatedAt);
    setSaveStatus('saved');
    return saved;
  };

  const handleSelectProject = async (id: string) => {
    if (id === projectId) return;
    try {
      await persistCurrentProject();
      const project = await loadProject(id);
      if (project) applyProjectSnapshot(project);
      await refreshProjects();
    } catch (error: any) {
      setErrorMsg(error?.message || 'No se pudo abrir el proyecto.');
    }
  };

  const handleCreateProject = async () => {
    try {
      await persistCurrentProject();
      const project = await saveProject(createBlankProject(`Proyecto ${projects.length + 1}`));
      applyProjectSnapshot(project);
      await refreshProjects();
    } catch (error: any) {
      setErrorMsg(error?.message || 'No se pudo crear el proyecto.');
    }
  };

  const handleDeleteProject = async () => {
    try {
      await deleteProject(projectId);
      const remaining = await listProjects();
      if (remaining.length > 0) {
        const project = await loadProject(remaining[0].id);
        if (project) applyProjectSnapshot(project);
      } else {
        const project = await saveProject(createBlankProject('Mi primer proyecto'));
        applyProjectSnapshot(project);
      }
      await refreshProjects();
    } catch (error: any) {
      setErrorMsg(error?.message || 'No se pudo eliminar el proyecto.');
    }
  };

  const handleExportProject = async () => {
    try {
      const saved = await persistCurrentProject();
      if (!saved) return;
      const blob = await exportProject(saved);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${saved.name.replace(/[^a-z0-9áéíóúüñ_-]+/gi, '-').replace(/^-|-$/g, '') || 'proyecto'}.tav.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error: any) {
      setErrorMsg(error?.message || 'No se pudo exportar el proyecto.');
    }
  };

  const handleImportProject = async (file: File) => {
    try {
      await persistCurrentProject();
      const project = await importProject(file);
      applyProjectSnapshot(project);
      await refreshProjects();
    } catch (error: any) {
      setErrorMsg(error?.message || 'No se pudo importar el proyecto.');
    }
  };

  // Check backend server health
  useEffect(() => {
    const checkServer = async () => {
      try {
        const res = await fetch('/api/health');
        if (res.ok) {
          setServerStatus('connected');
        } else {
          setServerStatus('error');
        }
      } catch (err) {
        setServerStatus('error');
      }
    };
    checkServer();
  }, []);

  useEffect(() => {
    const checkAuthentication = async () => {
      try {
        const response = await fetch('/api/auth/status');
        const data = await response.json();
        setAuthStatus(data.required && !data.authenticated ? 'required' : 'granted');
      } catch {
        // Projects remain available offline even though new audio cannot be generated.
        setAuthStatus('granted');
      }
    };
    checkAuthentication();
  }, []);

  const handleSelectTemplate = (template: SampleTemplate) => {
    if (template.isScriptMode) {
      setAppMode('script');
      if (template.scriptContent) setScriptText(template.scriptContent);
      return;
    }
    setAppMode('standard');
    setText(template.text);
    if (template.voice) setSelectedVoice(template.voice);
    if (template.emotion) setSelectedEmotion(template.emotion);
    if (template.accent) setSelectedAccent(template.accent);
    if (template.targetDurationSeconds) {
      setUseTargetDuration(true);
      setTargetDurationSeconds(template.targetDurationSeconds);
    }
    if (template.isMultiSpeaker !== undefined) {
      setIsMultiSpeaker(template.isMultiSpeaker);
      if (template.speakers) setSpeakers(template.speakers);
    }
  };

  const handleGenerateTTS = async () => {
    if (!text.trim()) {
      setErrorMsg('Por favor introduce un texto para convertir a voz.');
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);
    setIsHighDemand(false);

    const activeTargetDuration = useTargetDuration ? targetDurationSeconds : null;

    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          voice: selectedVoice,
          emotion: selectedEmotion,
          accent: selectedAccent,
          targetDuration: activeTargetDuration,
          isMultiSpeaker,
          speakers,
        }),
      });

      let data: any = {};
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        data = await response.json();
      } else {
        const textErr = await response.text();
        if (response.status === 503 || response.status === 502 || response.status === 504 || textErr.includes('503') || textErr.includes('UNAVAILABLE')) {
          setIsHighDemand(true);
          throw new Error('El servicio de voz de Gemini está experimentando alta demanda momentánea. Por favor intenta de nuevo en unos segundos.');
        }
        throw new Error(`El servidor respondió con estado ${response.status}. Por favor reintenta.`);
      }

      if (!response.ok) {
        if (data.isHighDemand || response.status === 503) {
          setIsHighDemand(true);
        }
        throw new Error(data.error || 'Ocurrió un error al sintetizar la voz.');
      }

      const { blob, blobUrl, duration, speedFactor } = base64ToWavBlob(
        data.audioBase64,
        data.mimeType || 'audio/pcm;rate=24000',
        activeTargetDuration
      );

      const newAudioItem: GeneratedAudioItem = {
        id: Date.now().toString(),
        text,
        voice: selectedVoice,
        emotion: selectedEmotion,
        accent: selectedAccent,
        targetDurationSeconds: activeTargetDuration,
        speedFactor,
        isMultiSpeaker,
        speakers: isMultiSpeaker ? [...speakers] : undefined,
        audioBlob: blob,
        audioUrl: blobUrl,
        durationSeconds: duration,
        createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setCurrentAudio(newAudioItem);
      setHistory((prev) => [newAudioItem, ...prev]);
    } catch (err: any) {
      console.error('Error in TTS generation:', err);
      setErrorMsg(err.message || 'Error de conexión con el servidor de voz.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteAudio = (id: string) => {
    const itemToDelete = history.find((item) => item.id === id);
    if (itemToDelete) URL.revokeObjectURL(itemToDelete.audioUrl);
    setHistory((prev) => prev.filter((item) => item.id !== id));
    if (currentAudio?.id === id) {
      setCurrentAudio(null);
    }
  };

  const handleClearHistory = () => {
    history.forEach((item) => URL.revokeObjectURL(item.audioUrl));
    setHistory([]);
    setCurrentAudio(null);
  };

  if (authStatus === 'checking') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm font-semibold text-slate-500">
        Preparando Texto a Voz…
      </div>
    );
  }

  if (authStatus === 'required') {
    return <LoginScreen onAuthenticated={() => setAuthStatus('granted')} />;
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans flex flex-col selection:bg-indigo-500 selection:text-white">
      {/* Header */}
      <Header serverStatus={serverStatus} />

      {isProjectReady ? (
        <ProjectBar
          projects={projects}
          currentProjectId={projectId}
          projectName={projectName}
          saveStatus={saveStatus}
          onSelect={handleSelectProject}
          onNameChange={setProjectName}
          onCreate={handleCreateProject}
          onDelete={handleDeleteProject}
          onExport={handleExportProject}
          onImport={handleImportProject}
        />
      ) : (
        <div className="border-b border-slate-200 bg-white py-3 text-center text-xs font-semibold text-slate-500">
          Abriendo proyectos locales…
        </div>
      )}

      {/* Main Workspace */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Navigation Mode Switcher Tabs */}
        <div className="flex items-center justify-center sm:justify-start">
          <div className="bg-slate-200/80 p-1.5 rounded-2xl flex items-center space-x-2 border border-slate-300/50 shadow-inner">
            <button
              onClick={() => setAppMode('script')}
              className={`inline-flex items-center space-x-2 px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all ${
                appMode === 'script'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100/60'
              }`}
            >
              <Video className="w-4 h-4" />
              <span>🎬 Estudio de guion para vídeo</span>
            </button>

            <button
              onClick={() => setAppMode('standard')}
              className={`inline-flex items-center space-x-2 px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all ${
                appMode === 'standard'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100/60'
              }`}
            >
              <Mic className="w-4 h-4" />
              <span>🎙️ Generador de Texto a Voz Estándar</span>
            </button>
          </div>
        </div>

        {/* Error Banner */}
        {errorMsg && (
          <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 text-xs sm:text-sm text-rose-700 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-sm animate-fade-in">
            <div className="flex items-start space-x-2.5">
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5 sm:mt-0" />
              <div>
                <p className="font-semibold">{errorMsg}</p>
                {isHighDemand && (
                  <p className="text-xs text-rose-600 mt-1">
                    Los reintentos automáticos están activos. Puedes presionar "Reintentar" para solicitar de nuevo.
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center space-x-2 self-end sm:self-auto shrink-0">
              <button
                onClick={handleGenerateTTS}
                disabled={isLoading}
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-rose-600 text-white rounded-lg text-xs font-bold hover:bg-rose-700 transition-colors shadow-sm disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reintentar</span>
              </button>
              <button
                onClick={() => setErrorMsg(null)}
                className="text-xs font-semibold underline hover:text-rose-900 px-2 py-1"
              >
                Cerrar
              </button>
            </div>
          </div>
        )}

        {/* App Mode Conditional Views */}
        {appMode === 'script' ? (
          <VideoScriptStudio
            scriptText={scriptText}
            onScriptTextChange={setScriptText}
            selectedVoice={selectedVoice}
            selectedEmotion={selectedEmotion}
            selectedAccent={selectedAccent}
            isMultiSpeaker={isMultiSpeaker}
            speakers={speakers}
            onAddToHistory={(item) => setHistory((prev) => [item, ...prev])}
          />
        ) : (
          /* Primary 2-Column Grid for Standard TTS */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Left Column: Text Input & Voice Controls */}
            <div className="lg:col-span-7 space-y-6">
              <TextEditor
                text={text}
                setText={setText}
                onSelectTemplate={handleSelectTemplate}
                isMultiSpeaker={isMultiSpeaker}
              />

              <VoiceSettings
                selectedVoice={selectedVoice}
                setSelectedVoice={setSelectedVoice}
                selectedEmotion={selectedEmotion}
                setSelectedEmotion={setSelectedEmotion}
                selectedAccent={selectedAccent}
                setSelectedAccent={setSelectedAccent}
                useTargetDuration={useTargetDuration}
                setUseTargetDuration={setUseTargetDuration}
                targetDurationSeconds={targetDurationSeconds}
                setTargetDurationSeconds={setTargetDurationSeconds}
                isMultiSpeaker={isMultiSpeaker}
                setIsMultiSpeaker={setIsMultiSpeaker}
                speakers={speakers}
                setSpeakers={setSpeakers}
              />

              {/* Generate Action Button */}
              <button
                onClick={handleGenerateTTS}
                disabled={isLoading || !text.trim()}
                className="w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600 hover:from-indigo-700 hover:via-violet-700 hover:to-purple-700 text-white font-bold text-base shadow-lg shadow-indigo-200 hover:shadow-indigo-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform active:scale-[0.99] flex items-center justify-center space-x-2"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Sintetizando voz con Gemini AI...</span>
                  </>
                ) : (
                  <>
                    <Wand2 className="w-5 h-5" />
                    <span>Generar Voz AI</span>
                  </>
                )}
              </button>
            </div>

            {/* Right Column: Active Player & History */}
            <div className="lg:col-span-5 space-y-6 sticky top-24">
              <AudioPlayer currentAudio={currentAudio} />

              <HistoryList
                history={history}
                onSelectAudio={(item) => setCurrentAudio(item)}
                onDeleteAudio={handleDeleteAudio}
                onClearHistory={handleClearHistory}
                currentAudioId={currentAudio?.id}
              />

              {/* Feature Callout Box */}
              <div className="bg-gradient-to-br from-indigo-900 to-slate-900 rounded-2xl p-5 text-white space-y-3 shadow-md">
                <div className="flex items-center space-x-2 text-indigo-300 text-xs font-bold uppercase tracking-wider">
                  <Sparkles className="w-4 h-4 text-indigo-400" />
                  <span>Modelo de Síntesis Directa</span>
                </div>
                <h4 className="text-sm font-semibold leading-tight">
                  Voces Expresivas en Español e Inglés
                </h4>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Utiliza <code>gemini-3.1-flash-tts-preview</code> para producir pronunciación natural,
                  pausas intencionales y tono emotivo en locuciones comerciales, narraciones y podcasts.
                </p>
                <div className="pt-1 flex items-center space-x-2 text-[11px] text-indigo-300">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Clave de Gemini protegida en el servidor</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-6 mt-12 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center space-x-2">
            <Volume2 className="w-4 h-4 text-indigo-600" />
            <span className="font-semibold text-slate-700">Texto a Voz AI</span>
            <span>— Impulsado por Google AI Studio & Gemini API</span>
          </div>
          <p>© 2026 Convertidor de Texto a Voz. Todos los derechos reservados.</p>
        </div>
      </footer>
    </div>
  );
}
