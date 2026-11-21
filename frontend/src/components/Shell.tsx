import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { callApi, ApiError } from '../lib/api';
import { clearToken, getToken } from '../lib/session';
import { hasGrant, type Me } from '../lib/hooks';
import { Icon, type IconName } from './Icon';
import { formatDate } from '../lib/format';

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
    `group flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-all duration-200 hover:translate-x-0.5 hover:bg-slate-100 ${active ? 'bg-slate-900 text-white hover:bg-slate-800' : 'text-slate-700'}`;

  return (
    <Ctx.Provider value={{ me: data, propertyId: selected?.property_id ?? null, setPropertyId }}>
      <div className="flex min-h-screen bg-slate-50 text-slate-900">
        {navOpen && (
          <button aria-label="Close menu" onClick={() => setNavOpen(false)}
            className="anim-fade-up fixed inset-0 z-30 bg-slate-900/40 md:hidden" />
        )}
        <aside className={`fixed inset-y-0 left-0 z-40 flex w-64 max-w-[85vw] flex-col overflow-y-auto border-r border-slate-200 bg-white p-4 shadow-xl transition-transform duration-300 md:static md:w-60 md:max-w-none md:translate-x-0 md:shadow-none ${navOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="mb-6 flex items-center justify-between gap-2 px-2">
            <span className="flex items-center gap-2 text-lg font-semibold">
              <span className="grid h-8 w-8 place-items-center rounded-md bg-slate-900 text-white"><Icon name="home" size={16} /></span>
              Hotel PMS
            </span>
            <button aria-label="Close menu" onClick={() => setNavOpen(false)}
              className="press grid h-8 w-8 place-items-center rounded-md text-slate-500 transition hover:bg-slate-100 md:hidden">
              <Icon name="x" size={18} />
            </button>
          </div>
          <nav className="space-y-1">
            {NAV.filter((n) => n.visible(data)).map((n) => {
              const active = here === n.href;
              return (
                <a key={n.href} href={n.href} onClick={() => setNavOpen(false)} className={linkClass(active)}>
                  <Icon name={n.icon} size={16} className={active ? '' : 'text-slate-400 transition-colors group-hover:text-slate-800'} />
                  {n.label}
                </a>
              );
            })}
          </nav>
          <div className="mt-auto space-y-2 border-t border-slate-100 pt-4 text-xs text-slate-500">
            <div className="px-2">Signed in as <span className="font-medium text-slate-700">{data.user.display_name}</span></div>
            <a href="password.html" className={linkClass(here === 'password.html')}>
              <Icon name="key" size={16} className="text-slate-400 group-hover:text-slate-800" />
              Change password
            </a>
            <button onClick={signOut} className={`${linkClass(false)} w-full text-left`}>
              <Icon name="logout" size={16} className="text-slate-400 group-hover:text-slate-800" />
              Sign out
            </button>
          </div>
        </aside>
        <main className="min-w-0 flex-1 p-4 md:p-6">
          <div className="sticky top-0 z-20 -mx-4 mb-4 flex items-center gap-3 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:hidden">
            <button aria-label="Open menu" onClick={() => setNavOpen(true)}
              className="press grid h-9 w-9 place-items-center rounded-md border border-slate-300 text-slate-700 transition hover:bg-slate-100">
              <Icon name="menu" size={18} />
            </button>
            <span className="truncate text-sm font-semibold">{title}</span>
          </div>
          <header className="anim-fade-up mb-6 flex flex-col gap-4 md:flex-row md:flex-wrap md:items-center md:justify-between">
            <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{title}</h1>
            {properties.length > 0 && (
              <label className="flex w-full flex-wrap items-center gap-2 text-sm md:w-auto">
                <span className="text-slate-600">Property</span>
                <select className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 outline-none transition hover:border-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-200 md:flex-none"
                  value={selected?.property_id ?? ''} onChange={(e) => setPropertyId(e.target.value)}>
                  {properties.map((p) => (
                    <option key={p.property_id} value={p.property_id}>{p.code} · {p.name}</option>
                  ))}
                </select>
                {selected && (
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
                    Business date {formatDate(selected.business_date)}
                  </span>
                )}
              </label>
            )}
          </header>
          {children({ me: data, propertyId: selected?.property_id ?? null, setPropertyId })}
        </main>
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
