import React, { useState } from 'react';
import { Loader2, LockKeyhole, Volume2 } from 'lucide-react';

interface LoginScreenProps {
  onAuthenticated: () => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onAuthenticated }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo iniciar sesión.');
      onAuthenticated();
    } catch (loginError: any) {
      setError(loginError?.message || 'No se pudo iniciar sesión.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-5">
      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-white border border-slate-200 rounded-3xl shadow-xl p-7 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-600 to-purple-500 text-white flex items-center justify-center shadow-md">
            <Volume2 className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-900">Texto a Voz AI</h1>
            <p className="text-xs text-slate-500">Acceso privado</p>
          </div>
        </div>

        <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 text-sm text-indigo-900 flex gap-2.5">
          <LockKeyhole className="w-4 h-4 shrink-0 mt-0.5" />
          <p>Introduce la contraseña configurada por el propietario de la aplicación.</p>
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs font-bold text-slate-700">Contraseña</span>
          <input
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
          />
        </label>

        {error && <p className="text-xs font-semibold text-rose-600">{error}</p>}

        <button
          type="submit"
          disabled={isLoading || !password}
          className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white py-3 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
          Entrar
        </button>
      </form>
    </main>
  );
};
