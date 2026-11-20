import { useState, type FormEvent } from 'react';
import { callApi } from '../lib/api';
import { setToken, getToken } from '../lib/session';
import { landingFor } from '../lib/nav';
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
      <div className="pointer-events-none absolute -left-20 -top-20 h-72 w-72 rounded-full bg-slate-300/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-16 h-80 w-80 rounded-full bg-slate-400/20 blur-3xl" />
      <form onSubmit={submit} className="anim-pop relative w-full max-w-sm rounded-xl bg-white p-8 shadow-xl ring-1 ring-slate-200">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-slate-900 text-white"><Icon name="lock" size={18} /></span>
          <div>
            <h1 className="text-xl font-semibold">Sign in</h1>
            <p className="text-sm text-slate-500">Hotel PMS and ERP</p>
          </div>
        </div>
        {error && <Notice kind="error">{error}</Notice>}
        {getToken() && <Notice kind="info">You have an active session in this tab.</Notice>}
        <div className="space-y-4">
          <Field label="Username">
            <input className={inputClass} autoComplete="username" value={username} autoFocus
              onChange={(e) => setUsername(e.target.value)} required />
          </Field>
          <Field label="Password">
            <SecretInput value={password} onChange={setPassword} autoComplete="current-password" required />
          </Field>
          <Button type="submit" loading={busy} icon="logIn" className="w-full py-2.5">
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
          <p className="text-center text-xs text-slate-500">
            New here or using a temporary password? Sign in, then you will be asked to choose your own.
          </p>
        </div>
      </form>
    </div>
  );
}
