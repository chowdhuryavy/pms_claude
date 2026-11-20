import { useEffect, useState, type FormEvent } from 'react';
import { Shell, Can, usePortal } from '../components/Shell';
import { Badge, Button, Field, Notice, Panel, Table, Tabs, inputClass, errorText, type TabDef } from '../components/ui';
import { EmailSettingsPanel } from '../components/EmailSettings';
import { useApiAction, useApiQuery, type Page } from '../lib/hooks';
import { normalizeMoneyInput, todayIso } from '../lib/format';

const LEVELS = ['View', 'Create', 'Edit', 'Delete', 'Approve', 'Execute', 'Export', 'Full Access'];
const MODULES = ['CONFIG', 'RESERVATIONS', 'FRONT_OFFICE', 'CASHIERING', 'NIGHT_AUDIT', 'REPORTING'];

interface Org { org_id: string; name: string; status: string }
interface Property {
  property_id: string; org_id: string; code: string; name: string; status: string; currency: string;
  timezone: string; business_date: string; license_rooms: number; user_limit: number; version: number;
}
interface UserRow {
  user_id: string; username: string; display_name: string; email: string; status: string;
  must_change_password: boolean; role_ids: string[]; property_ids: string[]; version: number;
}
interface CreateResult { email_sent: boolean; provider: string; reason: string }
interface Role { role_id: string; name: string; approval_limit_minor: number; is_system: string; version: number }
interface Flag { flag_id: string; module_key: string; enabled: string }
interface AuditRow { at: string; user_id: string; function_id: string; action: string; entity: string; entity_id: string }
interface CatalogRow { function_id: string; label: string; module: string | null }
interface PermRow { perm_id: string; function_id: string; levels: string }

function OrgSection() {
  const orgs = useApiQuery<Page<Org>>('admin.orgs.list', {}, true);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const create = useApiAction('admin.orgs.create', () => setName(''));
  return (
    <Panel title="Organizations">
      {error && <Notice kind="error">{error}</Notice>}
      <Can fn="ADMIN.ORG" level="Create">
        <form className="mb-4 flex gap-2" onSubmit={(e: FormEvent) => {
          e.preventDefault(); setError(null);
          create.mutate({ name }, { onError: (err) => setError(errorText(err)) });
        }}>
          <input className={inputClass} placeholder="Organization name" value={name} onChange={(e) => setName(e.target.value)} required />
          <Button type="submit" loading={create.isPending}>Add</Button>
        </form>
      </Can>
      <Table<Org> rowKey={(o) => o.org_id} rows={orgs.data?.items ?? []} columns={[
        { header: 'Name', render: (o) => o.name },
        { header: 'Status', render: (o) => o.status },
        { header: 'ID', render: (o) => <code className="text-xs">{o.org_id}</code> }
      ]} />
    </Panel>
  );
}

function PropertySection() {
  const { me } = usePortal();
  const props = useApiQuery<Page<Property>>('admin.properties.list', {}, true);
  const orgs = useApiQuery<Page<Org>>('admin.orgs.list', {}, me.is_system_admin);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    org_id: '', code: '', name: '', currency: 'USD', timezone: 'UTC',
    business_date: todayIso(), license_rooms: '20', user_limit: '10'
  });
  const create = useApiAction('admin.properties.create');
  const setStatus = useApiAction('admin.properties.status');

  const submit = (e: FormEvent) => {
    e.preventDefault(); setError(null);
    create.mutate({
      ...form,
      license_rooms: Number(form.license_rooms),
      user_limit: Number(form.user_limit)
    }, { onError: (err) => setError(errorText(err)) });
  };

  return (
    <Panel title="Properties and licensing">
      {error && <Notice kind="error">{error}</Notice>}
      {me.is_system_admin && (
        <form onSubmit={submit} className="mb-6 grid gap-3 md:grid-cols-4">
          <Field label="Organization">
            <select className={inputClass} required value={form.org_id} onChange={(e) => setForm({ ...form, org_id: e.target.value })}>
              <option value="">Select</option>
              {(orgs.data?.items ?? []).map((o) => <option key={o.org_id} value={o.org_id}>{o.name}</option>)}
            </select>
          </Field>
          <Field label="Code"><input className={inputClass} required maxLength={12} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field>
          <Field label="Name"><input className={inputClass} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Currency"><input className={inputClass} required maxLength={3} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} /></Field>
          <Field label="Timezone"><input className={inputClass} value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} /></Field>
          <Field label="Business date"><input type="date" className={inputClass} required value={form.business_date} onChange={(e) => setForm({ ...form, business_date: e.target.value })} /></Field>
          <Field label="Licensed rooms"><input type="number" min={1} className={inputClass} value={form.license_rooms} onChange={(e) => setForm({ ...form, license_rooms: e.target.value })} /></Field>
          <Field label="User limit"><input type="number" min={1} className={inputClass} value={form.user_limit} onChange={(e) => setForm({ ...form, user_limit: e.target.value })} /></Field>
          <div className="md:col-span-4"><Button type="submit" loading={create.isPending}>Create property</Button></div>
        </form>
      )}
      <Table<Property> rowKey={(p) => p.property_id} rows={props.data?.items ?? []} empty="No properties you can see" columns={[
        { header: 'Code', render: (p) => p.code },
        { header: 'Name', render: (p) => p.name },
        { header: 'Business date', render: (p) => p.business_date },
        { header: 'Rooms licensed', align: 'right', render: (p) => p.license_rooms },
        { header: 'User limit', align: 'right', render: (p) => p.user_limit },
        { header: 'Status', render: (p) => p.status },
        {
          header: '',
          render: (p) => me.is_system_admin ? (
            <Button variant="secondary" loading={setStatus.isPending} onClick={() => setStatus.mutate({
              property_id: p.property_id, version: p.version,
              status: p.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'
            }, { onError: (err) => setError(errorText(err)) })}>
              {p.status === 'ACTIVE' ? 'Suspend' : 'Activate'}
            </Button>
          ) : null
        }
      ]} />
    </Panel>
  );
}

function UserSection() {
  const { me } = usePortal();
  const users = useApiQuery<Page<UserRow>>('admin.users.list', {}, true);
  const roles = useApiQuery<Page<Role>>('admin.roles.list', {}, true);
  const props = useApiQuery<Page<Property>>('admin.properties.list', {}, true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ kind: 'ok' | 'info'; text: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [form, setForm] = useState({ username: '', display_name: '', email: '', role_id: '', property_id: '' });
  const create = useApiAction<CreateResult>('admin.users.create');
  const setStatus = useApiAction('admin.users.status');
  const reset = useApiAction<{ email_sent: boolean; provider: string; reason: string }>('admin.users.reset_password');

  const describe = (r: { email_sent: boolean; provider: string; reason: string }, email: string) =>
    r.email_sent
      ? { kind: 'ok' as const, text: `Temporary password emailed to ${email} through ${r.provider === 'RESEND' ? 'Resend' : 'Google mail'}. The user must change it at first sign-in.` }
      : { kind: 'info' as const, text: `Saved, but the email was not sent: ${r.reason}. Fix the email settings, then use Reset password for this user.` };

  useEffect(() => {
    if (!confirming) return;
    const t = window.setTimeout(() => setConfirming(null), 4000);
    return () => window.clearTimeout(t);
  }, [confirming]);

  return (
    <Panel title="Users" icon="users">
      {error && <Notice kind="error">{error}</Notice>}
      {result && <Notice kind={result.kind}>{result.text}</Notice>}
      <Can fn="ADMIN.USER" level="Create">
        <form className="mb-6 grid gap-3 md:grid-cols-6" onSubmit={(e) => {
          e.preventDefault(); setError(null); setResult(null);
          create.mutate({
            username: form.username, display_name: form.display_name, email: form.email,
            role_ids: [form.role_id], property_ids: [form.property_id]
          }, {
            onSuccess: (r) => {
              setResult(describe(r, form.email));
              setForm({ ...form, username: '', display_name: '', email: '' });
            },
            onError: (err) => setError(errorText(err))
          });
        }}>
          <Field label="Username"><input className={inputClass} required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></Field>
          <Field label="Display name"><input className={inputClass} required value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} /></Field>
          <Field label="Email" hint="Temporary password is sent here"><input type="email" className={inputClass} required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Role">
            <select className={inputClass} required value={form.role_id} onChange={(e) => setForm({ ...form, role_id: e.target.value })}>
              <option value="">Select</option>
              {(roles.data?.items ?? []).map((r) => <option key={r.role_id} value={r.role_id}>{r.name}</option>)}
            </select>
          </Field>
          <Field label="Property">
            <select className={inputClass} required value={form.property_id} onChange={(e) => setForm({ ...form, property_id: e.target.value })}>
              <option value="">Select</option>
              {(props.data?.items ?? []).map((p) => <option key={p.property_id} value={p.property_id}>{p.code}</option>)}
            </select>
          </Field>
          <div className="flex items-end"><Button type="submit" icon="users" loading={create.isPending}>Create user</Button></div>
        </form>
      </Can>
      <Table<UserRow> rowKey={(u) => u.user_id} rows={users.data?.items ?? []} columns={[
        { header: 'Username', render: (u) => u.username },
        { header: 'Name', render: (u) => u.display_name },
        { header: 'Email', render: (u) => u.email || <span className="text-slate-400">none</span> },
        { header: 'Status', render: (u) => <Badge tone={u.status === 'ACTIVE' ? 'ok' : 'bad'}>{u.status}</Badge> },
        { header: 'Password', render: (u) => u.must_change_password
          ? <Badge tone="warn">Must change</Badge> : <Badge tone="muted">Set</Badge> },
        { header: 'Properties', render: (u) => u.property_ids.length },
        {
          header: '',
          render: (u) => (
            <span className="flex flex-wrap justify-end gap-2">
              <Can fn="ADMIN.USER" level="Edit">
                <Button variant="ghost" icon="refresh" loading={reset.isPending} disabled={!u.email}
                  className={confirming === u.user_id ? 'text-red-700 hover:bg-red-50' : ''}
                  title={u.email ? '' : 'Add an email address first'}
                  onClick={() => {
                    if (confirming !== u.user_id) { setConfirming(u.user_id); return; }
                    setConfirming(null); setError(null); setResult(null);
                    reset.mutate({ user_id: u.user_id, version: u.version }, {
                      onSuccess: (r) => setResult(describe(r, u.email)),
                      onError: (err) => setError(errorText(err))
                    });
                  }}>
                  {confirming === u.user_id ? 'Confirm reset' : 'Reset password'}
                </Button>
                <Button variant="secondary" loading={setStatus.isPending} onClick={() => setStatus.mutate({
                  user_id: u.user_id, status: u.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'
                }, { onError: (err) => setError(errorText(err)) })}>
                  {u.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                </Button>
              </Can>
            </span>
          )
        }
      ]} />
      {me.is_system_admin && <p className="mt-3 text-xs text-slate-500">System Administrator accounts are created by the project owner, not here.</p>}
    </Panel>
  );
}

function RoleSection() {
  const roles = useApiQuery<Page<Role>>('admin.roles.list', {}, true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [limits, setLimits] = useState<Record<string, string>>({});
  const create = useApiAction('admin.roles.create', () => setName(''));
  const setLimit = useApiAction('admin.roles.approval_limit');
  return (
    <Panel title="Roles and approval limits">
      {error && <Notice kind="error">{error}</Notice>}
      <Can fn="ADMIN.ROLE" level="Create">
        <form className="mb-4 flex gap-2" onSubmit={(e) => {
          e.preventDefault(); setError(null);
          create.mutate({ name }, { onError: (err) => setError(errorText(err)) });
        }}>
          <input className={inputClass} placeholder="Role name" required value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" loading={create.isPending}>Add role</Button>
        </form>
      </Can>
      <Table<Role> rowKey={(r) => r.role_id} rows={roles.data?.items ?? []} columns={[
        { header: 'Role', render: (r) => r.name },
        { header: 'Approval limit', align: 'right', render: (r) => (
          <Can fn="ADMIN.ROLE" level="Edit" fallback={<span>{(r.approval_limit_minor / 100).toFixed(2)}</span>}>
            <span className="flex justify-end gap-2">
              <input className="w-28 rounded border border-slate-300 px-2 py-1 text-right text-sm"
                value={limits[r.role_id] ?? (r.approval_limit_minor / 100).toFixed(2)}
                onChange={(e) => setLimits({ ...limits, [r.role_id]: e.target.value })} />
              <Button variant="secondary" loading={setLimit.isPending} onClick={() => {
                const v = normalizeMoneyInput(limits[r.role_id] ?? '');
                if (v === null) { setError('Approval limit must be a decimal such as 500.00'); return; }
                setLimit.mutate({ role_id: r.role_id, approval_limit: v, version: r.version }, { onError: (err) => setError(errorText(err)) });
              }}>Save</Button>
            </span>
          </Can>
        ) }
      ]} />
    </Panel>
  );
}

function PermissionMatrix() {
  const roles = useApiQuery<Page<Role>>('admin.roles.list', {}, true);
  const catalog = useApiQuery<CatalogRow[]>('admin.permissions.catalog', {}, true);
  const [roleId, setRoleId] = useState('');
  const perms = useApiQuery<PermRow[]>('admin.permissions.role', { role_id: roleId }, !!roleId);
  const setPerm = useApiAction('admin.permissions.set');
  const [error, setError] = useState<string | null>(null);

  const levelsFor = (fn: string) => {
    const row = (perms.data ?? []).find((p) => p.function_id === fn);
    return row ? row.levels.split(',').filter(Boolean) : [];
  };

  const toggle = (fn: string, level: string) => {
    const current = levelsFor(fn);
    const next = current.includes(level) ? current.filter((l) => l !== level) : [...current, level];
    setError(null);
    setPerm.mutate({ role_id: roleId, function_id: fn, levels: next }, { onError: (err) => setError(errorText(err)) });
  };

  return (
    <Panel title="Permission matrix" actions={
      <select className="rounded border border-slate-300 px-2 py-1 text-sm" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
        <option value="">Select a role</option>
        {(roles.data?.items ?? []).map((r) => <option key={r.role_id} value={r.role_id}>{r.name}</option>)}
      </select>
    }>
      {error && <Notice kind="error">{error}</Notice>}
      {!roleId ? <p className="text-sm text-slate-500">Choose a role. Unchecked functions are hidden for that role.</p> : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead><tr className="text-left text-slate-600">
              <th className="px-2 py-1">Function</th>
              {LEVELS.map((l) => <th key={l} className="px-2 py-1 text-center font-medium">{l}</th>)}
            </tr></thead>
            <tbody>
              {(catalog.data ?? []).map((c) => {
                const set = levelsFor(c.function_id);
                return (
                  <tr key={c.function_id} className="border-t border-slate-100">
                    <td className="px-2 py-1"><div>{c.label}</div><code className="text-xs text-slate-500">{c.function_id}</code></td>
                    {LEVELS.map((l) => (
                      <td key={l} className="px-2 py-1 text-center">
                        <input type="checkbox" checked={set.includes(l) || set.includes('Full Access') && l !== 'Full Access'}
                          onChange={() => toggle(c.function_id, l)} aria-label={`${c.label} ${l}`} />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function FlagSection() {
  const { me } = usePortal();
  const [propertyId, setPropertyId] = useState('');
  const props = useApiQuery<Page<Property>>('admin.properties.list', {}, true);
  const flags = useApiQuery<Flag[]>('admin.flags.list', { property_id: propertyId }, !!propertyId);
  const setFlag = useApiAction('admin.flags.set');
  const [error, setError] = useState<string | null>(null);
  const enabled = new Set((flags.data ?? []).filter((f) => f.enabled === 'true').map((f) => f.module_key));
  return (
    <Panel title="Module availability">
      {error && <Notice kind="error">{error}</Notice>}
      <select className="mb-4 rounded border border-slate-300 px-2 py-1 text-sm" value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
        <option value="">Select a property</option>
        {(props.data?.items ?? []).map((p) => <option key={p.property_id} value={p.property_id}>{p.code} · {p.name}</option>)}
      </select>
      {propertyId && (
        <div className="grid gap-2 md:grid-cols-3">
          {MODULES.map((m) => (
            <label key={m} className="flex items-center justify-between rounded border border-slate-200 px-3 py-2 text-sm">
              {m}
              <input type="checkbox" disabled={!me.is_system_admin} checked={enabled.has(m)}
                onChange={(e) => setFlag.mutate({ property_id: propertyId, module_key: m, enabled: e.target.checked },
                  { onError: (err) => setError(errorText(err)) })} />
            </label>
          ))}
        </div>
      )}
    </Panel>
  );
}

function AuditSection() {
  const [offset, setOffset] = useState(0);
  const audit = useApiQuery<Page<AuditRow>>('admin.audit.list', { limit: 25, offset }, true);
  return (
    <Panel title="Audit log" actions={
      <div className="flex gap-2">
        <Button variant="secondary" loading={audit.isFetching} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>Newer</Button>
        <Button variant="secondary" loading={audit.isFetching} disabled={audit.data?.next_offset == null} onClick={() => setOffset(audit.data?.next_offset ?? offset)}>Older</Button>
      </div>
    }>
      <Table<AuditRow> rowKey={(a) => a.at + a.entity_id + a.action} rows={audit.data?.items ?? []} columns={[
        { header: 'When', render: (a) => new Date(a.at).toLocaleString() },
        { header: 'Action', render: (a) => `${a.action} ${a.entity}` },
        { header: 'Function', render: (a) => <code className="text-xs">{a.function_id}</code> },
        { header: 'Record', render: (a) => <code className="text-xs">{a.entity_id}</code> }
      ]} />
    </Panel>
  );
}

const TABS: TabDef[] = [
  { id: 'overview', label: 'Organizations', icon: 'building' },
  { id: 'users', label: 'Users', icon: 'users' },
  { id: 'access', label: 'Roles and access', icon: 'shield' },
  { id: 'email', label: 'Email', icon: 'mail' },
  { id: 'audit', label: 'Audit log', icon: 'chart' }
];

export default function AdminPage() {
  const [tab, setTab] = useState('overview');
  return (
    <Shell title="Administration">
      {() => (
        <>
          <Tabs tabs={TABS} active={tab} onChange={setTab} />
          <div key={tab} className="anim-fade-up">
            {tab === 'overview' && (<><OrgSection /><PropertySection /></>)}
            {tab === 'users' && <UserSection />}
            {tab === 'access' && (<><RoleSection /><PermissionMatrix /><FlagSection /></>)}
            {tab === 'email' && <EmailSettingsPanel />}
            {tab === 'audit' && <AuditSection />}
          </div>
        </>
      )}
    </Shell>
  );
}
