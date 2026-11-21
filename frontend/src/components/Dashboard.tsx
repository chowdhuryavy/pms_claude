import { usePortal } from './Shell';
import { useApiQuery } from '../lib/hooks';
import { formatDate, formatMoney, formatPercent, todayIso } from '../lib/format';
import { Icon, type IconName } from './Icon';

interface RackSummary {
  business_date: string; rooms: number; in_house: number; vacant_clean: number;
  vacant_dirty: number; out_of_order: number; arrivals: number; departures: number;
}
interface RackResponse { summary: RackSummary }
interface Occupancy {
  totals: { available: number; sold: number; room_revenue_minor: number; occupancy: number; adr_minor: number; revpar_minor: number };
}

function Kpi({ icon, label, value, hint, tone }: {
  icon: IconName; label: string; value: string | number; hint?: string; tone: 'sky' | 'emerald' | 'amber' | 'rose' | 'slate';
}) {
  const tones: Record<string, string> = {
    sky: 'bg-sky-50 text-sky-700 ring-sky-200',
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    amber: 'bg-amber-50 text-amber-700 ring-amber-200',
    rose: 'bg-rose-50 text-rose-700 ring-rose-200',
    slate: 'bg-slate-50 text-slate-700 ring-slate-200'
  };
  return (
    <div className="group rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 transition duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-500">{label}</span>
        <span className={`grid h-9 w-9 place-items-center rounded-xl ring-1 ${tones[tone]}`}>
          <Icon name={icon} size={18} />
        </span>
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

/** Headline numbers for the business date: rooms, arrivals, departures, occupancy, ADR and RevPAR. */
export function DashboardCards() {
  const { propertyId, me } = usePortal();
  const pid = propertyId ?? '';
  const canRack = !!me.grants['FO.RACK']?.length;
  const canReport = !!me.grants['RPT.VIEW']?.length;
  const rack = useApiQuery<RackResponse>('fo.rack', { property_id: pid }, !!pid && canRack);
  const s = rack.data?.summary;
  const day = s ? s.business_date.slice(0, 10) : todayIso();
  const occ = useApiQuery<Occupancy>('rpt.occupancy', { property_id: pid, from: day, to: day }, !!pid && canReport && !!s);
  if (!pid || (!canRack && !canReport)) return null;

  const t = occ.data?.totals;
  const currency = ''; // amounts are shown in the property currency by formatMoney
  return (
    <section className="mb-6">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Today</h2>
        {s && <span className="text-sm text-slate-500">Business date {formatDate(day)}</span>}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {s && <Kpi icon="users" label="In house" value={s.in_house} hint={`of ${s.rooms} rooms`} tone="sky" />}
        {s && <Kpi icon="chart" label="Arrivals" value={s.arrivals} hint="expected today" tone="emerald" />}
        {s && <Kpi icon="logIn" label="Departures" value={s.departures} hint="due out today" tone="amber" />}
        {t && <Kpi icon="chart" label="Occupancy" value={formatPercent(t.occupancy)} hint={`${t.sold} of ${t.available} rooms sold`} tone="sky" />}
        {t && <Kpi icon="wallet" label="ADR" value={formatMoney(t.adr_minor, currency)} hint="average room rate" tone="slate" />}
        {t && <Kpi icon="wallet" label="RevPAR" value={formatMoney(t.revpar_minor, currency)} hint="revenue per available room" tone="slate" />}
        {s && <Kpi icon="alert" label="Dirty rooms" value={s.vacant_dirty} hint="vacant, need cleaning" tone="rose" />}
        {s && <Kpi icon="shield" label="Out of order" value={s.out_of_order} hint="not sellable" tone="rose" />}
      </div>
    </section>
  );
}
