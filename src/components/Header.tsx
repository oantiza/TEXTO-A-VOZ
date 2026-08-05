import React, { useEffect, useState } from 'react';
import { Volume2, Sparkles, Cpu, CheckCircle2, AlertCircle, Download } from 'lucide-react';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface HeaderProps {
  serverStatus: 'connected' | 'checking' | 'error';
}

export const Header: React.FC<HeaderProps> = ({ serverStatus }) => {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const handleInstalled = () => setInstallPrompt(null);
    window.addEventListener('beforeinstallprompt', handleInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  return (
    <header className="border-b border-slate-200 bg-white/80 backdrop-blur-md sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Branding */}
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-violet-600 to-purple-500 flex items-center justify-center text-white shadow-md shadow-indigo-200">
            <Volume2 className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">Texto a Voz AI</h1>
              <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200/60">
                <Sparkles className="w-3 h-3 mr-1 text-indigo-500" />
                Gemini 3.1 Flash TTS
              </span>
            </div>
            <p className="text-xs text-slate-500 hidden sm:block">
              Generación de locuciones naturales con una o dos voces
            </p>
          </div>
        </div>

        {/* Status Indicator */}
        <div className="flex items-center space-x-3">
          {installPrompt && (
            <button
              type="button"
              onClick={async () => {
                await installPrompt.prompt();
                const choice = await installPrompt.userChoice;
                if (choice.outcome === 'accepted') setInstallPrompt(null);
              }}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100"
            >
              <Download className="w-3.5 h-3.5" /> Instalar
            </button>
          )}
          <div className="flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-medium border bg-slate-50 text-slate-700 border-slate-200">
            <Cpu className="w-3.5 h-3.5 text-slate-500" />
            <span className="hidden md:inline">Modelo:</span>
            <span className="font-semibold text-slate-900">gemini-3.1-flash-tts-preview</span>
          </div>

          <div
            className={`flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-medium ${
              serverStatus === 'connected'
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : serverStatus === 'error'
                ? 'bg-rose-50 text-rose-700 border border-rose-200'
                : 'bg-amber-50 text-amber-700 border border-amber-200'
            }`}
          >
            {serverStatus === 'connected' ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span className="hidden xs:inline">Servidor Online</span>
              </>
            ) : serverStatus === 'error' ? (
              <>
                <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
                <span>Error API</span>
              </>
            ) : (
              <>
                <div className="w-2 h-2 rounded-full bg-amber-500 animate-ping mr-1" />
                <span>Conectando...</span>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
