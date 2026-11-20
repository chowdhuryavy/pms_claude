import { useState, type FormEvent } from 'react';
import { Shell } from '../components/Shell';
import { callApi } from '../lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { landingFor } from '../lib/nav';
import type { Me } from '../lib/hooks';
import { Button, Field, Notice, errorText, SecretInput } from '../components/ui';
import { Icon } from '../components/Icon';
import { PasswordRules, checkPassword } from '../components/PasswordTools';

const MIN_LENGTH = 12;

function ChangeForm({ forced }: { forced: boolean }) {
  const qc = useQueryClient();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const checks = checkPassword(next, confirm, current, MIN_LENGTH);
  const allOk = checks.every((c) => c.ok) && current.length > 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!allOk) return;
    setBusy(true);
    setError(null);
    try {
      await callApi('auth.change_password', { current_password: current, new_password: next });
      const me = await callApi<Me>('auth.me');
      qc.setQueryData(['auth.me'], me);
      setDone(true);
      window.setTimeout(() => window.location.replace(landingFor(me)), 900);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="anim-pop flex flex-col items-center gap-3 rounded-xl bg-white p-10 text-center shadow-sm">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-green-100 text-green-700"><Icon name="check" size={28} /></span>
        <h2 className="text-lg font-semibold">Password updated</h2>
        <p className="text-sm text-slate-500">Taking you to your workspace…</p>
      </div>
    );
  }

  return (
    <div className="anim-fade-up mx-auto grid max-w-4xl gap-6 md:grid-cols-5">
      <form onSubmit={submit} className="space-y-4 rounded-xl bg-white p-6 shadow-sm md:col-span-3">
        {forced && (
          <Notice kind="info">
            Your administrator sent you a temporary password. Choose your own password to continue.
          </Notice>
        )}
        {error && <Notice kind="error">{error}</Notice>}
        <Field label="Current password">
          <SecretInput value={current} onChange={setCurrent} autoComplete="current-password" required />
        </Field>
        <Field label="New password" hint={`At least ${MIN_LENGTH} characters, with a letter and a digit.`}>
          <SecretInput value={next} onChange={setNext} autoComplete="new-password" required />
        </Field>
        <Field label="Confirm new password">
          <SecretInput value={confirm} onChange={setConfirm} autoComplete="new-password" required />
        </Field>
        <Button type="submit" icon="key" loading={busy} disabled={!allOk} className="w-full py-2.5">
          {busy ? 'Saving…' : 'Update password'}
        </Button>
        <p className="text-xs text-slate-500">Changing your password signs out your other sessions.</p>
      </form>
      <aside className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm md:col-span-2">
        <h2 className="mb-4 text-sm font-semibold text-slate-700">Password rules</h2>
        <PasswordRules checks={checks} pwd={next} />
      </aside>
    </div>
  );
}

export default function PasswordPage() {
  return (
    <Shell title="Change password" allowWhenMustChange>
      {({ me }) => <ChangeForm forced={me.user.must_change_password} />}
    </Shell>
  );
}
