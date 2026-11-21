/**
 * Display and input helpers. Money is always integer minor units from the server.
 * Floats are never used for stored or summed amounts.
 */

export function formatMoney(minor: number | string | null | undefined, currency = ''): string {
  const n = Number(minor ?? 0);
  const negative = n < 0;
  const abs = Math.abs(n);
  const whole = Math.floor(abs / 100).toLocaleString('en-US');
  const frac = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${frac}${currency ? ' ' + currency : ''}`;
}

/** Accepts "12", "12.5", "12.50". Returns the normalized decimal string, or null if invalid. */
export function normalizeMoneyInput(value: string): string | null {
  const s = value.trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  return s;
}

export function formatPercent(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Shows a date as dd/mm/yyyy. Accepts "2026-11-20" or a server timestamp such as
 * "2026-11-20T00:00:00.000Z". Anything else is shown unchanged.
 */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(value);
}
