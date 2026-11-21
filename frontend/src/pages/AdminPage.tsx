import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Icon } from '../components/Icon';
import { Shell, Can, usePortal } from '../components/Shell';
import { Badge, Button, Field, Notice, Panel, Table, Tabs, inputClass, errorText, type TabDef } from '../components/ui';
import { EmailSettingsPanel } from '../components/EmailSettings';
import { useApiAction, useApiQuery, type Page } from '../lib/hooks';
import { formatDate, normalizeMoneyInput, todayIso } from '../lib/format';

const LEVELS = ['View', 'Create', 'Edit', 'Delete', 'Approve', 'Execute', 'Export', 'Full Access'];
const MODULES = ['CONFIG', 'RESERVATIONS', 'FRONT_OFFICE', 'CASHIERING', 'NIGHT_AUDIT', 'REPORTING', 'ENGINEERING', 'HOUSEKEEPING'];

const GROUP_NAMES: Record<string, string> = {
  ADMIN: 'Administration', APPROVAL: 'Approvals', AUDIT: 'Night audit', CASH: 'Cashiering', CFG: 'Configuration',
  ENG: 'Engineering', FO: 'Front office', HK: 'Housekeeping', RES: 'Reservations', RPT: 'Reports'
};
function groupOf(fn: string): string {
  const key = fn.split('.')[0];
  return GROUP_NAMES[key] ?? key;
}

interface Org {
  org_id: string; name: string; status: string; license_start: string; license_end: string;
  property_count: number; version: number;
}
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
interface Flag { flag_id: string; module_key: string; enabled: string | boolean }
interface PropertyCreated extends Property { admin_user_id?: string; admin_role_id?: string; admin_email_sent?: boolean }
interface AuditRow { at: string; user_id: string; function_id: string; action: string; entity: string; entity_id: string }
interface CatalogRow { function_id: string; label: string; module: string | null }
interface PermRow { perm_id: string; function_id: string; levels: string }

function plusOneYearIso(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

function licenseState(o: Org): { label: string; tone: 'ok' | 'warn' | 'bad' } {
  const today = todayIso();
  if (!o.license_start || !o.license_end) return { label: 'No license dates', tone: 'bad' };
  if (today < o.license_start) return { label: 'Not started', tone: 'warn' };
  if (today > o.license_end) return { label: 'Expired', tone: 'bad' };
  return { label: 'Licensed', tone: 'ok' };
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words font-medium text-slate-900">{children}</dd>
    </div>
  );
}

function OrgSection() {
  const orgs = useApiQuery<Page<Org>>('admin.orgs.list', {}, true);
  const [form, setForm] = useState({ name: '', license_start: todayIso(), license_end: plusOneYearIso() });
  const [editing, setEditing] = useState<Org | null>(null);
  const [editForm, setEditForm] = useState({ name: '', license_start: '', license_end: '' });
  const [viewing, setViewing] = useState<Org | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const report = (e: unknown) => { setNotice(null); setError(errorText(e)); };
  const done = (text: string) => { setError(null); setNotice(text); };

  const create = useApiAction('admin.orgs.create', () => {
    setForm({ name: '', license_start: todayIso(), license_end: plusOneYearIso() });
    done('Organization added.');
  });
  const update = useApiAction('admin.orgs.update', () => { setEditing(null); done('Organization updated.'); });
  const setStatus = useApiAction('admin.orgs.status', () => done('Status changed.'));
  const remove = useApiAction('admin.orgs.delete', () => {
    setConfirming(null);
    setViewing(null);
    done('Organization deleted.');
  });

  const startEdit = (o: Org) => {
    setViewing(null);
    setEditing(o);
    setEditForm({ name: o.name, license_start: o.license_start || todayIso(), license_end: o.license_end || plusOneYearIso() });
    setError(null);
    setNotice(null);
  };

  return (
    <Panel title="Organizations" icon="building"
      actions={<span className="text-sm text-slate-500">{orgs.data?.total ?? 0} in total</span>}>
      {error && <Notice kind="error">{error}</Notice>}
      {notice && <Notice kind="ok">{notice}</Notice>}

      <Can fn="ADMIN.ORG" level="Create">
        <form className="mb-6 grid gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-4 md:grid-cols-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault(); setError(null);
            create.mutate({ ...form }, { onError: report });
          }}>
          <Field label="Organization name">
            <input className={inputClass} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="License start">
            <input type="date" className={inputClass} required value={form.license_start}
              onChange={(e) => setForm({ ...form, license_start: e.target.value })} />
          </Field>
          <Field label="License end">
            <input type="date" className={inputClass} required min={form.license_start} value={form.license_end}
              onChange={(e) => setForm({ ...form, license_end: e.target.value })} />
          </Field>
          <div className="flex items-end">
            <Button type="submit" icon="check" loading={create.isPending} className="w-full">Add organization</Button>
          </div>
        </form>
      </Can>

      {editing && (
        <form className="anim-pop mb-6 grid gap-3 rounded-lg border border-slate-300 bg-white p-4 shadow-sm md:grid-cols-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault(); setError(null);
            update.mutate({ org_id: editing.org_id, version: editing.version, ...editForm }, { onError: report });
          }}>
          <p className="flex items-center gap-2 text-sm font-semibold md:col-span-4">
            <Icon name="building" size={16} /> Editing {editing.name}
          </p>
          <Field label="Organization name">
            <input className={inputClass} required value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
          </Field>
          <Field label="License start">
            <input type="date" className={inputClass} required value={editForm.license_start}
              onChange={(e) => setEditForm({ ...editForm, license_start: e.target.value })} />
          </Field>
          <Field label="License end">
            <input type="date" className={inputClass} required min={editForm.license_start} value={editForm.license_end}
              onChange={(e) => setEditForm({ ...editForm, license_end: e.target.value })} />
          </Field>
          <div className="flex items-end gap-2">
            <Button type="submit" icon="check" loading={update.isPending} className="flex-1">Save</Button>
            <Button type="button" variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
          </div>
        </form>
      )}

      {viewing && (
        <div className="anim-pop mb-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h3 className="text-base font-semibold">{viewing.name}</h3>
            <Button variant="ghost" icon="x" onClick={() => setViewing(null)}>Close</Button>
          </div>
          <dl className="grid gap-4 text-sm sm:grid-cols-2 md:grid-cols-4">
            <Detail label="Status">{viewing.status === 'ACTIVE' ? 'Active' : 'Inactive'}</Detail>
            <Detail label="License start">{formatDate(viewing.license_start)}</Detail>
            <Detail label="License end">{formatDate(viewing.license_end)}</Detail>
            <Detail label="License state">{licenseState(viewing).label}</Detail>
            <Detail label="Properties">{viewing.property_count}</Detail>
            <Detail label="ID"><code className="text-xs">{viewing.org_id}</code></Detail>
          </dl>
        </div>
      )}

      <Table<Org> rowKey={(o) => o.org_id} rows={orgs.data?.items ?? []} columns={[
        { header: 'Name', render: (o) => (
          <div>
            <div className="font-medium">{o.name}</div>
            <div className="text-xs text-slate-500">{o.property_count} {o.property_count === 1 ? 'property' : 'properties'}</div>
          </div>
        ) },
        { header: 'Status', render: (o) => (
          <Badge tone={o.status === 'ACTIVE' ? 'ok' : 'warn'}>{o.status === 'ACTIVE' ? 'Active' : 'Inactive'}</Badge>
        ) },
        { header: 'License', render: (o) => {
          const st = licenseState(o);
          return (
            <div className="space-y-1">
              <Badge tone={st.tone}>{st.label}</Badge>
              <div className="text-xs text-slate-500">{formatDate(o.license_start)} to {formatDate(o.license_end)}</div>
            </div>
          );
        } },
        { header: 'Actions', align: 'right', render: (o) => (
          <div className="flex flex-wrap justify-end gap-1.5">
            <Button variant="ghost" icon="eye" onClick={() => { setEditing(null); setViewing(o); }}>View</Button>
            <Can fn="ADMIN.ORG" level="Edit">
              <Button variant="secondary" icon="sliders" onClick={() => startEdit(o)}>Edit</Button>
              <Button variant="ghost" loading={setStatus.isPending && setStatus.variables?.org_id === o.org_id}
                onClick={() => setStatus.mutate({
                  org_id: o.org_id, status: o.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE', version: o.version
                }, { onError: report })}>
                {o.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
              </Button>
            </Can>
            <Can fn="ADMIN.ORG" level="Delete">
              {confirming === o.org_id ? (
                <>
                  <Button variant="danger" loading={remove.isPending}
                    onClick={() => remove.mutate({ org_id: o.org_id, version: o.version }, { onError: report })}>
                    Confirm delete
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirming(null)}>Cancel</Button>
                </>
              ) : (
                <Button variant="ghost" onClick={() => setConfirming(o.org_id)}>Delete</Button>
              )}
            </Can>
          </div>
        ) }
      ]} />
    </Panel>
  );
}

function PropertySection() {
  const { me } = usePortal();
  const props = useApiQuery<Page<Property>>('admin.properties.list', {}, true);
  const orgs = useApiQuery<Page<Org>>('admin.orgs.list', {}, me.is_system_admin);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({
    org_id: '', code: '', name: '', currency: 'USD', timezone: 'UTC',
    business_date: todayIso(), license_rooms: '20', user_limit: '10'
  });
  const [admin, setAdmin] = useState({ username: '', display_name: '', email: '' });
  const create = useApiAction<PropertyCreated>('admin.properties.create', (data) => {
    setError(null);
    setNotice(
      `Property created. Property Admin "${admin.username}" was added with the role "Property Admin ${form.code.toUpperCase()}". ` +
      'Set what that role can do in the Permissions tab. ' +
      (data.admin_email_sent ? 'The temporary password was emailed.' : 'The temporary password could not be emailed. Check Email settings.')
    );
    setAdmin({ username: '', display_name: '', email: '' });
  });
  const setStatus = useApiAction('admin.properties.status');

  const submit = (e: FormEvent) => {
    e.preventDefault(); setError(null); setNotice(null);
    create.mutate({
      ...form,
      license_rooms: Number(form.license_rooms),
      user_limit: Number(form.user_limit),
      admin: { username: admin.username.trim().toLowerCase(), display_name: admin.display_name.trim(), email: admin.email.trim() }
    }, { onError: (err) => setError(errorText(err)) });
  };

  return (
    <Panel title="Properties and licensing">
      {error && <Notice kind="error">{error}</Notice>}
      {notice && <Notice kind="ok">{notice}</Notice>}
      {me.is_system_admin && (
        <form onSubmit={submit} className="mb-6 space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
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
          </div>
          <div className="rounded-lg border border-slate-200 p-4">
            <p className="mb-3 text-sm font-semibold text-slate-800">Property Admin</p>
            <p className="mb-3 text-xs text-slate-500">
              This person runs the property and creates its own staff. You set their permissions in the Permissions tab after the property is created.
            </p>
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Username"><input className={inputClass} required value={admin.username} onChange={(e) => setAdmin({ ...admin, username: e.target.value })} /></Field>
              <Field label="Full name"><input className={inputClass} required value={admin.display_name} onChange={(e) => setAdmin({ ...admin, display_name: e.target.value })} /></Field>
              <Field label="Email" hint="The temporary password is sent here."><input type="email" className={inputClass} required value={admin.email} onChange={(e) => setAdmin({ ...admin, email: e.target.value })} /></Field>
            </div>
          </div>
          <Button type="submit" loading={create.isPending}>Create property</Button>
        </form>
      )}
      <Table<Property> rowKey={(p) => p.property_id} rows={props.data?.items ?? []} empty="No properties you can see" columns={[
        { header: 'Code', render: (p) => p.code },
        { header: 'Name', render: (p) => p.name },
        { header: 'Business date', render: (p) => formatDate(p.business_date) },
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
  // Shows a tick at once; if the server refuses, the tick goes back and the reason is shown.
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const serverLevels = (fn: string) => {
    const row = (perms.data ?? []).find((p) => p.function_id === fn);
    return row ? row.levels.split(',').filter(Boolean) : [];
  };
  const levelsFor = (fn: string) => draft[fn] ?? serverLevels(fn);

  const toggle = (fn: string, level: string) => {
    const current = levelsFor(fn);
    const next = current.includes(level) ? current.filter((l) => l !== level) : [...current, level];
    setDraft((d) => ({ ...d, [fn]: next }));
    setError(null);
    setSaved(null);
    setPerm.mutate({ role_id: roleId, function_id: fn, levels: next }, {
      onSuccess: () => setSaved('Saved.'),
      onError: (err) => {
        setDraft((d) => { const copy = { ...d }; delete copy[fn]; return copy; });
        setError(errorText(err));
      }
    });
  };

  const rows = catalog.data ?? [];
  const groups = Array.from(new Set(rows.map((c) => groupOf(c.function_id))));

  return (
    <Panel title="Permissions">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select className="rounded border border-slate-300 px-3 py-2 text-sm" value={roleId}
          onChange={(e) => { setRoleId(e.target.value); setDraft({}); setError(null); setSaved(null); }}>
          <option value="">Select a role</option>
          {(roles.data?.items ?? []).map((r) => <option key={r.role_id} value={r.role_id}>{r.name}</option>)}
        </select>
        {setPerm.isPending && <span className="text-sm text-slate-500">Saving…</span>}
        {saved && !setPerm.isPending && <span className="text-sm text-emerald-700">{saved}</span>}
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      {!roleId ? (
        <p className="text-sm text-slate-500">Choose a role. Tick the levels it may use for each function. A function with no tick is hidden for that role.</p>
      ) : groups.map((g) => (
        <div key={g} className="mb-6">
          <h4 className="mb-2 text-sm font-semibold text-slate-800">{g}</h4>
          <div className="overflow-x-auto rounded border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2">Function</th>
                  {LEVELS.map((l) => <th key={l} className="px-2 py-2 text-center font-medium">{l}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.filter((c) => groupOf(c.function_id) === g).map((c) => {
                  const set = levelsFor(c.function_id);
                  return (
                    <tr key={c.function_id} className="border-t border-slate-100">
                      <td className="px-3 py-2"><div>{c.label}</div><code className="text-xs text-slate-500">{c.function_id}</code></td>
                      {LEVELS.map((l) => {
                        const on = set.includes(l) || (set.includes('Full Access') && l !== 'Full Access');
                        return (
                          <td key={l} className="px-2 py-2 text-center">
                            <input type="checkbox" className="h-4 w-4 cursor-pointer accent-slate-900" checked={on}
                              disabled={setPerm.isPending && setPerm.variables?.function_id === c.function_id}
                              onChange={() => toggle(c.function_id, l)} aria-label={`${c.label} ${l}`} />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
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
  // The sheet can hand back the text "true" or a real TRUE value; both mean on.
  const isOn = (v: string | boolean) => String(v).toLowerCase() === 'true';
  const enabled = new Set((flags.data ?? []).filter((f) => isOn(f.enabled)).map((f) => f.module_key));
  return (
    <Panel title="Modules">
      {error && <Notice kind="error">{error}</Notice>}
      <p className="mb-4 text-sm text-slate-500">Turn a module on or off for one property. Off hides it from every user of that property.</p>
      <select className="mb-4 rounded border border-slate-300 px-3 py-2 text-sm" value={propertyId} onChange={(e) => { setPropertyId(e.target.value); setError(null); }}>
        <option value="">Select a property</option>
        {(props.data?.items ?? []).map((p) => <option key={p.property_id} value={p.property_id}>{p.code} · {p.name}</option>)}
      </select>
      {propertyId && (
        <div className="grid gap-2 md:grid-cols-3">
          {MODULES.map((m) => (
            <label key={m} className="flex cursor-pointer items-center justify-between rounded border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
              <span>{m.replace('_', ' ')}</span>
              <input type="checkbox" className="h-4 w-4 cursor-pointer accent-slate-900" disabled={!me.is_system_admin || setFlag.isPending}
                checked={enabled.has(m)}
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
  { id: 'orgs', label: 'Organizations', icon: 'building' },
  { id: 'properties', label: 'Properties', icon: 'sliders' },
  { id: 'users', label: 'Users', icon: 'users' },
  { id: 'roles', label: 'Roles and limits', icon: 'shield' },
  { id: 'permissions', label: 'Permissions', icon: 'key' },
  { id: 'flags', label: 'Modules', icon: 'zap' },
  { id: 'email', label: 'Email', icon: 'mail' },
  { id: 'audit', label: 'Audit log', icon: 'chart' }
];

export default function AdminPage() {
  // The tab is kept in the address (#orgs, #users, ...) so a refresh stays on the same section.
  const fromHash = window.location.hash.slice(1);
  const [tab, setTabState] = useState(TABS.some((t) => t.id === fromHash) ? fromHash : 'orgs');
  const setTab = (id: string) => {
    setTabState(id);
    window.history.replaceState(null, '', '#' + id);
  };
  return (
    <Shell title="Administration">
      {() => (
        <>
          <Tabs tabs={TABS} active={tab} onChange={setTab} />
          <div key={tab} className="anim-fade-up">
            {tab === 'orgs' && <OrgSection />}
            {tab === 'properties' && <PropertySection />}
            {tab === 'users' && <UserSection />}
            {tab === 'roles' && <RoleSection />}
            {tab === 'permissions' && <PermissionMatrix />}
            {tab === 'flags' && <FlagSection />}
            {tab === 'email' && <EmailSettingsPanel />}
            {tab === 'audit' && <AuditSection />}
          </div>
        </>
      )}
    </Shell>
  );
}
