import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { usePortal } from './Shell';
import { Badge, Button, Field, Notice, Panel, SecretInput, Toggle, errorText, inputClass } from './ui';
import { Icon, type IconName } from './Icon';
import { useApiAction, useApiQuery } from '../lib/hooks';

interface EmailSettingsRow {
  setting_id: string;
  smtp_active: boolean; smtp_host: string; smtp_port: number; smtp_secure: boolean; smtp_user: string;
  smtp_password_saved: boolean; relay_url: string; relay_secret_saved: boolean;
  resend_active: boolean; resend_key_saved: boolean; resend_key_hint: string;
  from_name: string; from_email: string; app_url: string; version: number | null;
}

type Notice_ = { kind: 'ok' | 'error' | 'info'; text: string } | null;

function Card({ title, icon, active, onToggle, disabled, children }: {
  title: string; icon: IconName; active: boolean; onToggle: (v: boolean) => void; disabled: boolean; children: ReactNode;
}) {
  return (
    <div className={`anim-fade-up rounded-lg border p-5 transition-colors duration-300 ${active ? 'border-slate-900 bg-slate-50' : 'border-slate-200 bg-white'}`}>
      <div className="mb-4 flex items-center gap-3">
        <span className={`grid h-9 w-9 place-items-center rounded-md transition-colors ${active ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}>
          <Icon name={icon} size={18} />
        </span>
        <h3 className="font-semibold">{title}</h3>
        <div className="ml-auto flex items-center gap-2 text-sm text-slate-600">
          {active ? 'On' : 'Off'}
          <Toggle checked={active} onChange={onToggle} label={`${title} active`} disabled={disabled} />
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

/** Email configuration. Only System Administrators can change it. Saved secrets are never shown again. */
export function EmailSettingsPanel() {
  const { me } = usePortal();
  const canEdit = me.is_system_admin;
  const settings = useApiQuery<EmailSettingsRow>('admin.email.get', {}, true);
  const save = useApiAction('admin.email.save');
  const clearSecret = useApiAction('admin.email.clear_secret');
  const sendTest = useApiAction<{ sent: boolean; provider: string }>('admin.email.test');

  const [smtpActive, setSmtpActive] = useState(false);
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPassword, setSmtpPassword] = useState('');
  const [relayUrl, setRelayUrl] = useState('');
  const [relaySecret, setRelaySecret] = useState('');
  const [resendActive, setResendActive] = useState(false);
  const [resendKey, setResendKey] = useState('');
  const [fromName, setFromName] = useState('Hotel PMS');
  const [fromEmail, setFromEmail] = useState('');
  const [appUrl, setAppUrl] = useState('');
  const [testTo, setTestTo] = useState('');
  const [notice, setNotice] = useState<Notice_>(null);

  useEffect(() => {
    const s = settings.data;
    if (!s) return;
    setSmtpActive(s.smtp_active); setSmtpHost(s.smtp_host); setSmtpPort(String(s.smtp_port));
    setSmtpSecure(s.smtp_secure); setSmtpUser(s.smtp_user); setRelayUrl(s.relay_url);
    setResendActive(s.resend_active); setFromName(s.from_name || 'Hotel PMS');
    setFromEmail(s.from_email); setAppUrl(s.app_url);
  }, [settings.data]);

  const s = settings.data;
  const reportError = (err: unknown) => setNotice({ kind: 'error', text: errorText(err) });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    save.mutate({
      smtp_active: smtpActive, smtp_host: smtpHost, smtp_port: Number(smtpPort), smtp_secure: smtpSecure,
      smtp_user: smtpUser, smtp_password: smtpPassword, relay_url: relayUrl, relay_secret: relaySecret,
      resend_active: resendActive, resend_api_key: resendKey,
      from_name: fromName, from_email: fromEmail, app_url: appUrl, version: s?.version ?? null
    }, {
      onSuccess: () => {
        setSmtpPassword(''); setRelaySecret(''); setResendKey('');
        setNotice({ kind: 'ok', text: 'Email settings saved. Saved secrets are encrypted and will not be shown again.' });
      },
      onError: reportError
    });
  };

  const clear = (which: 'smtp_password' | 'relay_secret' | 'resend', label: string) =>
    clearSecret.mutate({ which }, {
      onSuccess: () => setNotice({ kind: 'ok', text: `${label} removed.` }),
      onError: reportError
    });

  return (
    <Panel title="Email configuration" icon="mail"
      actions={s && <div className="flex gap-2">
        <Badge tone={s.smtp_active ? 'ok' : 'muted'}>SMTP {s.smtp_active ? 'on' : 'off'}</Badge>
        <Badge tone={s.resend_active ? 'ok' : 'muted'}>Resend {s.resend_active ? 'on' : 'off'}</Badge>
      </div>}>
      {!canEdit && <Notice kind="info">Only the System Administrator can change email settings. You can see the current state.</Notice>}
      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
      {settings.error && <Notice kind="error">{errorText(settings.error)}</Notice>}

      <form onSubmit={submit} className="space-y-6">
        <p className="text-sm text-slate-600">
          When SMTP is on, emails go through SMTP first. When SMTP is off, or SMTP fails, Resend is used if it is on.
        </p>

        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="SMTP" icon="send" active={smtpActive} onToggle={setSmtpActive} disabled={!canEdit}>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2"><Field label="Host"><input className={inputClass} value={smtpHost} disabled={!canEdit} placeholder="smtp.example.com" onChange={(e) => setSmtpHost(e.target.value)} /></Field></div>
              <Field label="Port"><input type="number" className={inputClass} value={smtpPort} disabled={!canEdit} onChange={(e) => setSmtpPort(e.target.value)} /></Field>
            </div>
            <Field label="Connection" hint={smtpSecure ? 'Implicit TLS (usually port 465).' : 'STARTTLS (usually port 587).'}>
              <div className="flex items-center gap-3 text-sm">
                <span>STARTTLS</span>
                <Toggle checked={smtpSecure} onChange={setSmtpSecure} label="Implicit TLS" disabled={!canEdit} />
                <span>Implicit TLS</span>
              </div>
            </Field>
            <Field label="Username"><input className={inputClass} value={smtpUser} disabled={!canEdit} onChange={(e) => setSmtpUser(e.target.value)} /></Field>
            <Field label="Password"
              hint={s?.smtp_password_saved ? 'Saved (encrypted). Enter a new one to replace it.' : 'Stored encrypted in the database.'}>
              <div className="flex gap-2">
                <div className="flex-1"><SecretInput value={smtpPassword} onChange={setSmtpPassword} disabled={!canEdit} autoComplete="new-password" /></div>
                {s?.smtp_password_saved && canEdit && (
                  <Button type="button" variant="ghost" icon="x" loading={clearSecret.isPending} onClick={() => clear('smtp_password', 'SMTP password')}>Clear</Button>
                )}
              </div>
            </Field>
            <Field label="Relay URL" hint="Your Vercel address with /api/send-smtp, e.g. https://your-app.vercel.app/api/send-smtp">
              <input className={inputClass} value={relayUrl} disabled={!canEdit} onChange={(e) => setRelayUrl(e.target.value)} placeholder="https://" />
            </Field>
            <Field label="Relay secret"
              hint={s?.relay_secret_saved ? 'Saved (encrypted). Must match MAIL_RELAY_SECRET in Vercel.' : 'Must match MAIL_RELAY_SECRET in Vercel.'}>
              <div className="flex gap-2">
                <div className="flex-1"><SecretInput value={relaySecret} onChange={setRelaySecret} disabled={!canEdit} autoComplete="off" /></div>
                {s?.relay_secret_saved && canEdit && (
                  <Button type="button" variant="ghost" icon="x" loading={clearSecret.isPending} onClick={() => clear('relay_secret', 'Relay secret')}>Clear</Button>
                )}
              </div>
            </Field>
          </Card>

          <Card title="Resend" icon="mail" active={resendActive} onToggle={setResendActive} disabled={!canEdit}>
            <Field label="API key"
              hint={s?.resend_key_saved ? `Saved (ends in ${s.resend_key_hint}). Enter a new key to replace it.` : 'Create a key in the Resend dashboard. Stored encrypted.'}>
              <div className="flex gap-2">
                <div className="flex-1"><SecretInput value={resendKey} onChange={setResendKey} placeholder={s?.resend_key_saved ? 'Saved. Leave blank to keep.' : 're_…'} disabled={!canEdit} autoComplete="off" /></div>
                {s?.resend_key_saved && canEdit && (
                  <Button type="button" variant="ghost" icon="x" loading={clearSecret.isPending} onClick={() => clear('resend', 'Resend key')}>Clear</Button>
                )}
              </div>
            </Field>
            <p className="text-xs text-slate-500">The sender domain must be verified in Resend.</p>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Field label="From name"><input className={inputClass} value={fromName} disabled={!canEdit} onChange={(e) => setFromName(e.target.value)} required /></Field>
          <Field label="From email"><input type="email" className={inputClass} value={fromEmail} disabled={!canEdit} onChange={(e) => setFromEmail(e.target.value)} required /></Field>
          <Field label="App address" hint="Used for the Sign in button in emails.">
            <input className={inputClass} value={appUrl} disabled={!canEdit} onChange={(e) => setAppUrl(e.target.value)} placeholder="https://" />
          </Field>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button type="submit" icon="check" loading={save.isPending} disabled={!canEdit}>Save settings</Button>
        </div>
      </form>

      <div className="mt-8 rounded-lg border border-dashed border-slate-300 p-4 transition hover:border-slate-400">
        <p className="mb-3 flex items-center gap-2 text-sm font-medium"><Icon name="zap" size={16} /> Send a test email</p>
        <div className="flex flex-wrap gap-2">
          <input type="email" className={`${inputClass} max-w-xs`} placeholder="you@example.com" value={testTo}
            onChange={(e) => setTestTo(e.target.value)} disabled={!canEdit} />
          <Button type="button" variant="secondary" icon="send" loading={sendTest.isPending} disabled={!canEdit || !testTo}
            onClick={() => sendTest.mutate({ to: testTo }, {
              onSuccess: (r) => setNotice({ kind: 'ok', text: `Test email sent through ${r.provider}.` }),
              onError: reportError
            })}>
            Send test
          </Button>
        </div>
      </div>
    </Panel>
  );
}
