import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { callApi, ApiError } from '../lib/api';
import { clearToken, getToken } from '../lib/session';
import { hasGrant, type Me } from '../lib/hooks';

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

const NAV: Array<{ href: string; label: string; visible: (me: Me) => boolean }> = [
  { href: 'admin.html', label: 'Administration', visible: (m) => Object.keys(m.grants).some((f) => f.startsWith('ADMIN.')) },
  { href: 'property.html', label: 'Property setup', visible: (m) => Object.keys(m.grants).some((f) => f.startsWith('CFG.')) },
  { href: 'frontdesk.html', label: 'Front desk', visible: (m) => Object.keys(m.grants).some((f) => f.startsWith('RES.') || f.startsWith('FO.')) },
  { href: 'cashier.html', label: 'Cashier', visible: (m) => Object.keys(m.grants).some((f) => f.startsWith('CASH.')) },
  { href: 'audit.html', label: 'Night audit and reports', visible: (m) => Object.keys(m.grants).some((f) => f.startsWith('AUDIT.') || f.startsWith('RPT.')) }
];

/**
 * Page frame. Loads the signed-in user, redirects to sign-in when the session is
 * missing or expired, and gives children the selected property.
 */
export function Shell({ title, children }: { title: string; children: (ctx: PropertyCtx) => ReactNode }) {
  const [propertyId, setPropertyIdState] = useState<string | null>(sessionStorage.getItem('pms.property'));

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

  if (me.error && me.error.code !== 'UNAUTHENTICATED') {
    return <div className="p-8 text-red-700">Could not load your account: {me.error.message}</div>;
  }
  if (me.isLoading || !me.data) {
    return <div className="p-8 text-slate-500">Loading…</div>;
  }
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

  return (
    <Ctx.Provider value={{ me: data, propertyId: selected?.property_id ?? null, setPropertyId }}>
      <div className="flex min-h-screen bg-slate-50 text-slate-900">
        <aside className="w-56 shrink-0 border-r border-slate-200 bg-white p-4">
          <div className="mb-6 text-lg font-semibold">Hotel PMS</div>
          <nav className="space-y-1">
            {NAV.filter((n) => n.visible(data)).map((n) => (
              <a key={n.href} href={n.href}
                className={`block rounded px-3 py-2 text-sm hover:bg-slate-100 ${window.location.pathname.endsWith(n.href) ? 'bg-slate-100 font-medium' : ''}`}>
                {n.label}
              </a>
            ))}
          </nav>
          <div className="mt-8 text-xs text-slate-500">
            Signed in as {data.user.display_name}
            <button onClick={signOut} className="mt-2 block text-slate-700 underline">Sign out</button>
          </div>
        </aside>
        <main className="flex-1 p-6">
          <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <h1 className="text-2xl font-semibold">{title}</h1>
            {properties.length > 0 && (
              <label className="text-sm">
                Property{' '}
                <select className="ml-2 rounded border border-slate-300 bg-white px-2 py-1"
                  value={selected?.property_id ?? ''} onChange={(e) => setPropertyId(e.target.value)}>
                  {properties.map((p) => (
                    <option key={p.property_id} value={p.property_id}>{p.code} · {p.name}</option>
                  ))}
                </select>
                {selected && (
                  <span className="ml-3 text-slate-500">Business date {selected.business_date}</span>
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
