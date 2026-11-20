import { useState, type FormEvent } from 'react';
import { callApi } from '../lib/api';
import { setToken, getToken } from '../lib/session';
import { landingFor } from '../lib/nav';
import { APP_NAME, HOTEL_NAME } from '../lib/brand';
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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-slate-100 via-white to-slate-200 p-6">
      <div className="pointer-events-none absolute -left-20 -top-20 h-72 w-72 rounded-full bg-sky-200/40 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-16 h-80 w-80 rounded-full bg-amber-200/30 blur-3xl" />

      <div className="anim-fade-up relative w-full max-w-sm">
        <div className="mb-6 text-center">
          <span className="group mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-slate-900 text-white shadow-lg ring-4 ring-white transition duration-300 hover:-translate-y-0.5 hover:scale-105 hover:shadow-xl">
            <Icon name="building" size={30} className="transition duration-300 group-hover:scale-110" />
          </span>
          <h2 className="mt-4 text-2xl font-bold tracking-tight text-slate-900">{HOTEL_NAME}</h2>
          <p className="mt-1 flex items-center justify-center gap-1.5 text-sm font-medium text-slate-500">
            <Icon name="shield" size={14} />
            {APP_NAME}
          </p>
        </div>

        <form onSubmit={submit} className="anim-pop rounded-2xl bg-white p-8 shadow-xl ring-1 ring-slate-200 transition duration-300 hover:shadow-2xl">
          <div className="mb-6">
            <h1 className="text-lg font-semibold text-slate-900">Staff sign in</h1>
            <p className="text-sm text-slate-500">Enter the username and password your administrator gave you.</p>
          </div>

          {error && <Notice kind="error">{error}</Notice>}
          {getToken() && <Notice kind="info">You have an active session in this tab.</Notice>}

          <div className="space-y-4">
            <Field label="Username">
              <div className="group relative">
                <span className="pointer-events-none absolute inset-y-0 left-3 my-auto grid h-5 w-5 place-items-center text-slate-400 transition group-focus-within:text-slate-900">
                  <Icon name="user" size={16} />
                </span>
                <input className={`${inputClass} pl-10`} autoComplete="username" value={username} autoFocus
                  onChange={(e) => setUsername(e.target.value)} required />
              </div>
            </Field>
            <Field label="Password">
              <SecretInput value={password} onChange={setPassword} autoComplete="current-password" required leftIcon="lock" />
            </Field>
            <Button type="submit" loading={busy} icon="logIn" className="w-full py-2.5">
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
            <p className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
              <Icon name="info" size={14} className="mt-0.5 text-slate-400" />
              New here or using a temporary password? Sign in, and you will be asked to choose your own.
            </p>
          </div>
        </form>

        <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-slate-400">
          <Icon name="lock" size={12} />
          Secure access. Every action is recorded in the audit log.
        </p>
      </div>
    </div>
  );
}
