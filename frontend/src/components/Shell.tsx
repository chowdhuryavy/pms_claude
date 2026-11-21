import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { callApi, ApiError } from '../lib/api';
import { clearToken, getToken } from '../lib/session';
import { hasGrant, type Me } from '../lib/hooks';
import { Icon, type IconName } from './Icon';
import { formatDate } from '../lib/format';
import { APP_NAME, HOTEL_NAME } from '../lib/brand';

interface PropertyCtx {
  me: Me;
  propertyId: string | null;
  setPropertyId: (id: string) => void;
}

const Ctx = createContext<PropertyCtx | null>(null);

export function usePortal(): PropertyCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePortal must be used inside Shell');
  return v;
}

const anyGrant = (prefixes: string[]) => (m: Me) =>
  Object.keys(m.grants).some((f) => prefixes.some((p) => f.startsWith(p)));

const NAV: Array<{ href: string; label: string; icon: IconName; visible: (me: Me) => boolean }> = [
  { href: 'admin.html', label: 'Administration', icon: 'building', visible: anyGrant(['ADMIN.']) },
  { href: 'property.html', label: 'Property setup', icon: 'sliders', visible: anyGrant(['CFG.']) },
  { href: 'frontdesk.html', label: 'Front desk', icon: 'users', visible: anyGrant(['RES.', 'FO.']) },
  { href: 'cashier.html', label: 'Cashier', icon: 'wallet', visible: anyGrant(['CASH.']) },
  { href: 'audit.html', label: 'Night audit and reports', icon: 'chart', visible: anyGrant(['AUDIT.', 'RPT.']) }
];

/**
 * Page frame. Loads the signed-in user, redirects to sign-in when the session is
 * missing or expired, and sends users with a temporary password to the change page.
 * The server enforces the same rule; this redirect is only for convenience.
 */
export function Shell({ title, children, allowWhenMustChange = false }: {
  title: string; children: (ctx: PropertyCtx) => ReactNode; allowWhenMustChange?: boolean;
}) {
  const [propertyId, setPropertyIdState] = useState<string | null>(sessionStorage.getItem('pms.property'));
  const [navOpen, setNavOpen] = useState(false);
  const here = window.location.pathname.split('/').pop() ?? '';

  const me = useQuery<Me, ApiError>({
    queryKey: ['auth.me'],
    queryFn: () => callApi<Me>('auth.me'),
    retry: false,
    enabled: !!getToken()
  });

  useEffect(() => {
    if (!getToken() || (me.error && me.error.code === 'UNAUTHENTICATED')) {
      clearToken();
      window.location.replace('index.html');
    }
  }, [me.error]);

  useEffect(() => {
    if (me.data?.user.must_change_password && !allowWhenMustChange) {
      window.location.replace('password.html');
    }
  }, [me.data, allowWhenMustChange]);

  if (me.error && me.error.code !== 'UNAUTHENTICATED') {
    return <div className="p-8 text-red-700">Could not load your account: {me.error.message}</div>;
  }
  if (me.isLoading || !me.data) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-500">
        <span className="spin mr-3 inline-block h-5 w-5 rounded-full border-2 border-slate-400 border-t-transparent" />
        Loading…
      </div>
    );
  }
  if (me.data.user.must_change_password && !allowWhenMustChange) return null;

  const data = me.data;
  const properties = data.properties;
  const selected = properties.find((p) => p.property_id === propertyId) ?? properties[0] ?? null;

  const setPropertyId = (id: string) => {
    sessionStorage.setItem('pms.property', id);
    setPropertyIdState(id);
  };

  const signOut = async () => {
    try { await callApi('auth.logout'); } catch { /* token may already be gone */ }
    clearToken();
    window.location.replace('index.html');
  };

  const linkClass = (active: boolean) =>
    `group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
      active ? 'bg-white/10 text-white shadow-inner ring-1 ring-white/10' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`;
  const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || 'U';

  return (
    <Ctx.Provider value={{ me: data, propertyId: selected?.property_id ?? null, setPropertyId }}>
      <div className="min-h-screen bg-slate-100 text-slate-900">
        {navOpen && (
          <button aria-label="Close menu" onClick={() => setNavOpen(false)}
            className="anim-fade-up fixed inset-0 z-30 bg-slate-950/50 backdrop-blur-sm md:hidden" />
        )}

        <aside className={`fixed inset-y-0 left-0 z-40 flex w-72 max-w-[85vw] flex-col bg-slate-950 p-5 text-slate-200 shadow-2xl transition-transform duration-300 md:translate-x-0 ${navOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="mb-8 flex items-center gap-3 px-1">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-sky-400 to-indigo-600 text-white shadow-lg shadow-sky-500/20">
              <Icon name="building" size={20} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-white">{HOTEL_NAME}</span>
              <span className="block truncate text-xs text-slate-400">{APP_NAME}</span>
            </span>
            <button aria-label="Close menu" onClick={() => setNavOpen(false)}
              className="grid h-8 w-8 place-items-center rounded-md text-slate-400 transition hover:bg-white/10 hover:text-white md:hidden">
              <Icon name="x" size={18} />
            </button>
          </div>

          <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Menu</p>
          <nav className="space-y-1">
            {NAV.filter((n) => n.visible(data)).map((n) => {
              const active = here === n.href;
              return (
                <a key={n.href} href={n.href} onClick={() => setNavOpen(false)} className={linkClass(active)}>
                  <Icon name={n.icon} size={18} className={active ? 'text-sky-300' : 'text-slate-500 transition-colors group-hover:text-sky-300'} />
                  {n.label}
                </a>
              );
            })}
          </nav>

          <div className="mt-auto space-y-1 border-t border-white/10 pt-4">
            <div className="mb-3 flex items-center gap-3 px-2">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-sky-500/20 text-sm font-semibold text-sky-200 ring-1 ring-sky-400/30">
                {initials(data.user.display_name)}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-white">{data.user.display_name}</span>
                <span className="block truncate text-xs text-slate-400">{data.user.username}</span>
              </span>
            </div>
            <a href="password.html" className={linkClass(here === 'password.html')}>
              <Icon name="key" size={18} className="text-slate-500 group-hover:text-sky-300" />
              Change password
            </a>
            <button onClick={signOut} className={`${linkClass(false)} w-full text-left`}>
              <Icon name="logout" size={18} className="text-slate-500 group-hover:text-rose-300" />
              Sign out
            </button>
          </div>
        </aside>

        <div className="md:pl-72">
          <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur md:px-8">
            <button aria-label="Open menu" onClick={() => setNavOpen(true)}
              className="grid h-9 w-9 place-items-center rounded-lg border border-slate-300 text-slate-700 transition hover:bg-slate-100 md:hidden">
              <Icon name="menu" size={18} />
            </button>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg font-semibold tracking-tight md:text-xl">{title}</h1>
              {selected && (
                <p className="truncate text-xs text-slate-500">Business date {formatDate(selected.business_date)}</p>
              )}
            </div>
            {properties.length > 0 && (
              <select aria-label="Property"
                className="max-w-[12rem] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition hover:border-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                value={selected?.property_id ?? ''} onChange={(e) => setPropertyId(e.target.value)}>
                {properties.map((p) => (
                  <option key={p.property_id} value={p.property_id}>{p.code} · {p.name}</option>
                ))}
              </select>
            )}
            <span className="hidden h-9 w-9 place-items-center rounded-full bg-slate-900 text-xs font-semibold text-white sm:grid">
              {initials(data.user.display_name)}
            </span>
          </header>

          <main className="anim-fade-up mx-auto max-w-7xl p-4 md:p-8">
            {children({ me: data, propertyId: selected?.property_id ?? null, setPropertyId })}
          </main>
        </div>
      </div>
    </Ctx.Provider>
  );
}

/** Shows children only when the server granted the function. The API still enforces it. */
export function Can({ fn, level, children, fallback = null }: {
  fn: string; level: string; children: ReactNode; fallback?: ReactNode;
}) {
  const { me } = usePortal();
  return <>{hasGrant(me, fn, level) ? children : fallback}</>;
}
