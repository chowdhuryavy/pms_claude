import { useState, type FormEvent } from 'react';
import { callApi } from '../lib/api';
import { setToken, getToken } from '../lib/session';
import { landingFor } from '../lib/nav';
import { APP_NAME, HOTEL_NAME, APP_VERSION } from '../lib/brand';
import type { Me } from '../lib/hooks';
import { Button, Field, Notice, inputClass, errorText, SecretInput } from '../components/ui';
import { Icon } from '../components/Icon';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await callApi<{ token: string }>('auth.login', { username, password });
      setToken(res.token);
      const me = await callApi<Me>('auth.me');
      window.location.replace(landingFor(me));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 p-6">
      {/* background: soft glowing shapes and a faint grid */}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.08)_1px,transparent_1px)] bg-[size:48px_48px]" />
      <div className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 animate-pulse rounded-full bg-sky-500/25 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -right-20 h-96 w-96 animate-pulse rounded-full bg-amber-400/20 blur-3xl" />

      <div className="anim-fade-up relative w-full max-w-md">
        <div className="mb-8 text-center">
          <span className="group mx-auto grid h-20 w-20 place-items-center rounded-3xl bg-gradient-to-br from-sky-400 to-indigo-600 text-white shadow-2xl shadow-sky-500/30 ring-4 ring-white/10 transition duration-300 hover:-translate-y-1 hover:scale-105">
            <Icon name="building" size={36} className="transition duration-300 group-hover:scale-110" />
          </span>
          <h2 className="mt-5 text-3xl font-bold tracking-tight text-white">{HOTEL_NAME}</h2>
          <p className="mt-1.5 flex items-center justify-center gap-1.5 text-sm font-medium text-slate-400">
            <Icon name="shield" size={14} />
            {APP_NAME}
          </p>
        </div>

        <form onSubmit={submit} className="anim-pop rounded-3xl bg-white p-8 shadow-2xl ring-1 ring-white/10 transition duration-300 hover:shadow-sky-500/10">
          <div className="mb-6">
            <h1 className="text-xl font-semibold text-slate-900">Staff sign in</h1>
            <p className="mt-1 text-sm text-slate-500">Use the username and password your administrator gave you.</p>
          </div>

          {error && <Notice kind="error">{error}</Notice>}
          {getToken() && <Notice kind="info">You have an active session in this tab.</Notice>}

          <div className="space-y-5">
            <Field label="Username">
              <div className="group relative">
                <span className="pointer-events-none absolute inset-y-0 left-3 my-auto grid h-5 w-5 place-items-center text-slate-400 transition group-focus-within:text-sky-600">
                  <Icon name="user" size={16} />
                </span>
                <input className={`${inputClass} pl-10`} autoComplete="username" value={username} autoFocus
                  onChange={(e) => setUsername(e.target.value)} required />
              </div>
            </Field>
            <Field label="Password">
              <SecretInput value={password} onChange={setPassword} autoComplete="current-password" required leftIcon="lock" />
            </Field>
            <Button type="submit" loading={busy} icon="logIn" className="w-full py-3 text-base">
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </div>
        </form>

        <div className="mt-6 space-y-1.5 text-center text-xs text-slate-500">
          <p className="flex items-center justify-center gap-1.5">
            <Icon name="lock" size={12} />
            Secure access. Every action is recorded in the audit log.
          </p>
          <p className="font-mono text-[11px] text-slate-600">Version {APP_VERSION}</p>
        </div>
      </div>
    </div>
  );
}
