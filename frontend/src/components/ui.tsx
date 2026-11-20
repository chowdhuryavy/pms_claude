import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export function Panel({ title, actions, children, icon }: {
  title: string; actions?: ReactNode; children: ReactNode; icon?: IconName;
}) {
  return (
    <section className="anim-fade-up mb-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition-shadow duration-300 hover:shadow-md">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          {icon && <span className="grid h-8 w-8 place-items-center rounded-md bg-slate-100 text-slate-700"><Icon name={icon} size={16} /></span>}
          {title}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return <span className={`spin inline-block h-4 w-4 rounded-full border-2 border-current border-t-transparent ${className}`} aria-hidden="true" />;
}

export function Button({ variant = 'primary', className = '', loading = false, icon, children, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
    loading?: boolean;
    icon?: IconName;
  }) {
  const styles = {
    primary: 'bg-slate-900 text-white shadow-sm hover:bg-slate-700 hover:shadow-md',
    secondary: 'border border-slate-300 bg-white text-slate-800 hover:border-slate-500 hover:bg-slate-50',
    danger: 'bg-red-700 text-white shadow-sm hover:bg-red-600 hover:shadow-md',
    ghost: 'text-slate-700 hover:bg-slate-100'
  }[variant];
  return (
    <button {...rest} disabled={rest.disabled || loading}
      className={`press inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition-all duration-200 hover:-translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 ${styles} ${className}`}>
      {loading ? <Spinner /> : icon ? <Icon name={icon} size={16} /> : null}
      {children}
    </button>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition duration-200 hover:border-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-200 disabled:bg-slate-100 disabled:text-slate-500';

const NOTICE_ICON: Record<'error' | 'ok' | 'info', IconName> = { error: 'alert', ok: 'check', info: 'info' };

export function Notice({ kind, children }: { kind: 'error' | 'ok' | 'info'; children: ReactNode }) {
  const styles = {
    error: 'border-red-200 bg-red-50 text-red-800',
    ok: 'border-green-200 bg-green-50 text-green-800',
    info: 'border-slate-200 bg-slate-50 text-slate-700'
  }[kind];
  return (
    <div className={`anim-pop mb-4 flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${styles}`}
      role={kind === 'error' ? 'alert' : 'status'}>
      <Icon name={NOTICE_ICON[kind]} size={16} className="mt-0.5" />
      <div>{children}</div>
    </div>
  );
}

export function Badge({ tone = 'muted', children }: { tone?: 'ok' | 'warn' | 'bad' | 'muted'; children: ReactNode }) {
  const styles = {
    ok: 'bg-green-100 text-green-800',
    warn: 'bg-amber-100 text-amber-800',
    bad: 'bg-red-100 text-red-800',
    muted: 'bg-slate-100 text-slate-700'
  }[tone];
  return <span className={`anim-pop inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${styles}`}>{children}</span>;
}

export interface TabDef { id: string; label: string; icon: IconName }

/** Tab bar with a sliding underline. Keyboard users can move between tabs with the arrow keys. */
export function Tabs({ tabs, active, onChange }: { tabs: TabDef[]; active: string; onChange: (id: string) => void }) {
  return (
    <div role="tablist" className="mb-6 flex flex-wrap gap-1 border-b border-slate-200">
      {tabs.map((t) => {
        const selected = t.id === active;
        return (
          <button key={t.id} role="tab" aria-selected={selected} tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
              const i = tabs.findIndex((x) => x.id === active);
              const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
              onChange(next.id);
            }}
            className={`group relative flex items-center gap-2 rounded-t-md px-4 py-2.5 text-sm font-medium transition-colors duration-200 hover:bg-slate-100 ${selected ? 'text-slate-900' : 'text-slate-500 hover:text-slate-800'}`}>
            <Icon name={t.icon} size={16} className={selected ? 'text-slate-900' : 'text-slate-400 transition-colors group-hover:text-slate-700'} />
            {t.label}
            <span className={`absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-slate-900 transition-all duration-300 ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-30'}`} />
          </button>
        );
      })}
    </div>
  );
}

/** On/off switch with an animated knob. */
export function Toggle({ checked, onChange, label, disabled = false }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean;
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-300 disabled:opacity-50 ${checked ? 'bg-green-600' : 'bg-slate-300'}`}>
      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-300 ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}

/** Eye button that shows or hides a secret input. */
export function SecretInput({ value, onChange, placeholder, autoComplete, id, required, disabled, leftIcon }: {
  value: string; onChange: (v: string) => void; placeholder?: string; autoComplete?: string;
  id?: string; required?: boolean; disabled?: boolean; leftIcon?: IconName;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="group relative">
      {leftIcon && (
        <span className="pointer-events-none absolute inset-y-0 left-3 my-auto grid h-5 w-5 place-items-center text-slate-400 transition group-focus-within:text-slate-900">
          <Icon name={leftIcon} size={16} />
        </span>
      )}
      <input id={id} type={shown ? 'text' : 'password'} className={`${inputClass} ${leftIcon ? 'pl-10' : ''} pr-10`} value={value}
        onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete={autoComplete}
        required={required} disabled={disabled} />
      <button type="button" onClick={() => setShown(!shown)} aria-label={shown ? 'Hide' : 'Show'}
        className="press absolute inset-y-0 right-1 my-auto grid h-7 w-7 place-items-center rounded text-slate-500 transition hover:bg-slate-100 hover:text-slate-900">
        <Icon name={shown ? 'eyeOff' : 'eye'} size={16} />
      </button>
    </div>
  );
}

export function Table<T>({ columns, rows, empty = 'No records', rowKey }: {
  columns: Column<T>[]; rows: T[]; empty?: string; rowKey: (row: T) => string;
}) {
  if (rows.length === 0) return <p className="text-sm text-slate-500">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            {columns.map((c) => (
              <th key={c.header} className={`px-3 py-2 font-medium text-slate-600 ${c.align === 'right' ? 'text-right' : 'text-left'}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={rowKey(row)} className="anim-fade-up transition-colors duration-150 hover:bg-slate-50">
              {columns.map((c) => (
                <td key={c.header} className={`px-3 py-2 ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface Column<T> {
  header: string;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right';
}

export function errorText(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: string }).message);
  return 'Something went wrong';
}
