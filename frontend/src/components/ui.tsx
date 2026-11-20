import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function Panel({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Button({ variant = 'primary', className = '', ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' }) {
  const styles = {
    primary: 'bg-slate-900 text-white hover:bg-slate-700',
    secondary: 'border border-slate-300 bg-white hover:bg-slate-50',
    danger: 'bg-red-700 text-white hover:bg-red-600'
  }[variant];
  return (
    <button {...rest}
      className={`rounded px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${styles} ${className}`} />
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

export const inputClass = 'w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm';

export function Notice({ kind, children }: { kind: 'error' | 'ok' | 'info'; children: ReactNode }) {
  const styles = {
    error: 'border-red-200 bg-red-50 text-red-800',
    ok: 'border-green-200 bg-green-50 text-green-800',
    info: 'border-slate-200 bg-slate-50 text-slate-700'
  }[kind];
  return <div className={`mb-4 rounded border px-3 py-2 text-sm ${styles}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>;
}

export interface Column<T> {
  header: string;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right';
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
            <tr key={rowKey(row)} className="hover:bg-slate-50">
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

export function errorText(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: string }).message);
  return 'Something went wrong';
}
