import { useState, type FormEvent } from 'react';
import { callApi } from '../lib/api';
import { setToken, getToken } from '../lib/session';
import type { Me } from '../lib/hooks';
import { Button, Field, Notice, inputClass, errorText } from '../components/ui';

/** Sends the user to the first portal their grants allow. */
function landingFor(me: Me): string {
  const fns = Object.keys(me.grants);
  if (me.is_system_admin || fns.some((f) => f.startsWith('ADMIN.'))) return 'admin.html';
  if (fns.some((f) => f.startsWith('RES.') || f.startsWith('FO.'))) return 'frontdesk.html';
  if (fns.some((f) => f.startsWith('CASH.'))) return 'cashier.html';
  if (fns.some((f) => f.startsWith('AUDIT.') || f.startsWith('RPT.'))) return 'audit.html';
  if (fns.some((f) => f.startsWith('CFG.'))) return 'property.html';
  return 'index.html';
}

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
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <form onSubmit={submit} className="w-full max-w-sm rounded-lg bg-white p-8 shadow">
        <h1 className="mb-1 text-xl font-semibold">Sign in</h1>
        <p className="mb-6 text-sm text-slate-500">Hotel PMS and ERP</p>
        {error && <Notice kind="error">{error}</Notice>}
        {getToken() && <Notice kind="info">You have an active session in this tab.</Notice>}
        <div className="space-y-4">
          <Field label="Username">
            <input className={inputClass} autoComplete="username" value={username}
              onChange={(e) => setUsername(e.target.value)} required />
          </Field>
          <Field label="Password">
            <input className={inputClass} type="password" autoComplete="current-password" value={password}
              onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <Button type="submit" disabled={busy} className="w-full py-2">
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </div>
      </form>
    </div>
  );
}
