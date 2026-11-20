import { useEffect, useState, type FormEvent } from 'react';
import { usePortal } from './Shell';
import { Badge, Button, Field, Notice, Panel, SecretInput, Toggle, errorText, inputClass } from './ui';
import { Icon, type IconName } from './Icon';
import { useApiAction, useApiQuery } from '../lib/hooks';

interface EmailSettingsRow {
  setting_id: string; provider: 'RESEND' | 'GOOGLE'; is_active: boolean; from_name: string; from_email: string;
  app_url: string; resend_configured: boolean; resend_key_hint: string; version: number | null;
}

const PROVIDERS: Array<{ id: 'RESEND' | 'GOOGLE'; label: string; detail: string; icon: IconName }> = [
  { id: 'RESEND', label: 'Resend API', detail: 'HTTPS sending service. Needs an API key and a verified sending domain.', icon: 'send' },
  { id: 'GOOGLE', label: 'Google account mail', detail: 'Sends from the Google account that deployed the web app. No key needed. Daily sending limit applies.', icon: 'mail' }
];

/** Email configuration. Only System Administrators can change it. The API key is never shown again after saving. */
export function EmailSettingsPanel() {
  const { me } = usePortal();
  const canEdit = me.is_system_admin;
  const settings = useApiQuery<EmailSettingsRow>('admin.email.get', {}, true);
  const save = useApiAction('admin.email.save');
  const clearKey = useApiAction('admin.email.clear_key');
  const sendTest = useApiAction<{ sent: boolean; provider: string }>('admin.email.test');

  const [provider, setProvider] = useState<'RESEND' | 'GOOGLE'>('RESEND');
  const [active, setActive] = useState(false);
  const [fromName, setFromName] = useState('Hotel PMS');
  const [fromEmail, setFromEmail] = useState('');
  const [appUrl, setAppUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [testTo, setTestTo] = useState('');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error' | 'info'; text: string } | null>(null);

  useEffect(() => {
    const s = settings.data;
    if (!s) return;
    setProvider(s.provider);
    setActive(s.is_active);
    setFromName(s.from_name || 'Hotel PMS');
    setFromEmail(s.from_email);
    setAppUrl(s.app_url);
  }, [settings.data]);

  const s = settings.data;
  const keyNeeded = provider === 'RESEND' && active && !s?.resend_configured && !apiKey.trim();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    save.mutate({
      provider, is_active: active, from_name: fromName, from_email: fromEmail, app_url: appUrl,
      resend_api_key: apiKey.trim(), version: s?.version ?? null
    }, {
      onSuccess: () => { setApiKey(''); setNotice({ kind: 'ok', text: 'Email settings saved.' }); },
      onError: (err) => setNotice({ kind: 'error', text: errorText(err) })
    });
  };

  return (
    <Panel title="Email configuration" icon="mail"
      actions={s && <Badge tone={s.is_active ? 'ok' : 'warn'}>{s.is_active ? `Active: ${s.provider === 'RESEND' ? 'Resend' : 'Google mail'}` : 'Inactive'}</Badge>}>
      {!canEdit && <Notice kind="info">Only the System Administrator can change email settings. You can see the current state.</Notice>}
      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
      {settings.error && <Notice kind="error">{errorText(settings.error)}</Notice>}

      <form onSubmit={submit} className="space-y-6">
        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">Provider</p>
          <div className="grid gap-3 md:grid-cols-2">
            {PROVIDERS.map((p) => {
              const selected = provider === p.id;
              return (
                <button key={p.id} type="button" disabled={!canEdit} onClick={() => setProvider(p.id)}
                  className={`press group rounded-lg border p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md disabled:cursor-not-allowed disabled:hover:translate-y-0 ${selected ? 'border-slate-900 bg-slate-50 ring-2 ring-slate-900/10' : 'border-slate-200 bg-white hover:border-slate-400'}`}>
                  <div className="flex items-center gap-3">
                    <span className={`grid h-9 w-9 place-items-center rounded-md transition-colors ${selected ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 group-hover:bg-slate-200'}`}>
                      <Icon name={p.icon} size={18} />
                    </span>
                    <span className="font-medium">{p.label}</span>
                    {selected && <span className="anim-pop ml-auto text-green-700"><Icon name="check" size={18} /></span>}
                  </div>
                  <p className="mt-2 text-xs text-slate-500">{p.detail}</p>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Plain SMTP servers cannot be used from Apps Script. For a custom mail server, use a relay that offers an HTTPS sending API.
          </p>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-slate-200 p-4 transition hover:border-slate-300">
          <div>
            <p className="font-medium">Use this provider for all emails</p>
            <p className="text-xs text-slate-500">When off, Resend is used if a key is saved.</p>
          </div>
          <Toggle checked={active} onChange={setActive} label="Active" disabled={!canEdit} />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="From name"><input className={inputClass} value={fromName} disabled={!canEdit} onChange={(e) => setFromName(e.target.value)} required /></Field>
          <Field label="From email" hint="Must be on a domain you have verified with the provider.">
            <input type="email" className={inputClass} value={fromEmail} disabled={!canEdit} onChange={(e) => setFromEmail(e.target.value)} required />
          </Field>
          <Field label="App address" hint="Used for the Sign in button in emails, e.g. https://your-app.vercel.app">
            <input className={inputClass} value={appUrl} disabled={!canEdit} onChange={(e) => setAppUrl(e.target.value)} placeholder="https://" />
          </Field>
          {provider === 'RESEND' && (
            <Field label="Resend API key"
              hint={s?.resend_configured ? `Saved (ends in ${s.resend_key_hint.slice(-4)}). Enter a new key to replace it.` : 'Stored encrypted by Google in Script Properties. Never shown again.'}>
              <SecretInput value={apiKey} onChange={setApiKey} placeholder={s?.resend_configured ? 'Saved. Leave blank to keep it.' : 're_…'} disabled={!canEdit} />
            </Field>
          )}
        </div>
        {keyNeeded && <Notice kind="info">Add a Resend API key before turning this provider on.</Notice>}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" icon="check" loading={save.isPending} disabled={!canEdit}>Save settings</Button>
          {provider === 'RESEND' && s?.resend_configured && (
            <Button type="button" variant="danger" icon="x" loading={clearKey.isPending} disabled={!canEdit}
              onClick={() => clearKey.mutate({}, {
                onSuccess: () => setNotice({ kind: 'ok', text: 'Resend key removed and Resend turned off.' }),
                onError: (err) => setNotice({ kind: 'error', text: errorText(err) })
              })}>
              Remove key
            </Button>
          )}
        </div>
      </form>

      <div className="mt-8 rounded-lg border border-dashed border-slate-300 p-4">
        <p className="mb-3 flex items-center gap-2 text-sm font-medium"><Icon name="zap" size={16} /> Send a test email</p>
        <div className="flex flex-wrap gap-2">
          <input type="email" className={`${inputClass} max-w-xs`} placeholder="you@example.com" value={testTo}
            onChange={(e) => setTestTo(e.target.value)} disabled={!canEdit} />
          <Button type="button" variant="secondary" icon="send" loading={sendTest.isPending} disabled={!canEdit || !testTo}
            onClick={() => sendTest.mutate({ to: testTo }, {
              onSuccess: (r) => setNotice({ kind: 'ok', text: `Test email sent through ${r.provider === 'RESEND' ? 'Resend' : 'Google mail'}.` }),
              onError: (err) => setNotice({ kind: 'error', text: errorText(err) })
            })}>
            Send test
          </Button>
        </div>
      </div>
    </Panel>
  );
}
