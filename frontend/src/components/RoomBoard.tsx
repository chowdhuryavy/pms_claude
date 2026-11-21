import { usePortal } from './Shell';
import { useApiQuery } from '../lib/hooks';
import { formatDate } from '../lib/format';

interface BoardRoom {
  room_id: string; room_number: string; room_type: string; status: string;
  housekeeping_status: string; occupied: boolean; departure: string | null;
}
interface RackResponse { summary: { business_date: string }; rooms: BoardRoom[] }

type Tone = 'occupied' | 'dirty' | 'clean' | 'ooo';

function toneOf(r: BoardRoom): Tone {
  if (r.status === 'OUT_OF_ORDER') return 'ooo';
  if (r.occupied) return 'occupied';
  return r.housekeeping_status === 'DIRTY' ? 'dirty' : 'clean';
}

const TONES: Record<Tone, { label: string; tile: string; dot: string }> = {
  occupied: { label: 'Occupied', tile: 'bg-sky-500 text-white', dot: 'bg-sky-500' },
  dirty: { label: 'Vacant, dirty', tile: 'bg-amber-300 text-slate-900', dot: 'bg-amber-300' },
  clean: { label: 'Vacant, clean', tile: 'bg-emerald-500 text-white', dot: 'bg-emerald-500' },
  ooo: { label: 'Out of order', tile: 'bg-rose-500 text-white', dot: 'bg-rose-500' }
};

/** Every room as a tile, coloured by its state, grouped by room type. Read-only. */
export function RoomBoard() {
  const { propertyId, me } = usePortal();
  const pid = propertyId ?? '';
  const allowed = !!me.grants['FO.RACK']?.length;
  const rack = useApiQuery<RackResponse>('fo.rack', { property_id: pid }, !!pid && allowed);
  if (!allowed || !pid) return null;

  const rooms = rack.data?.rooms ?? [];
  const types = Array.from(new Set(rooms.map((r) => r.room_type)));

  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-900">Room board</h2>
        <div className="flex flex-wrap gap-3 text-xs text-slate-600">
          {(Object.keys(TONES) as Tone[]).map((t) => (
            <span key={t} className="flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-full ${TONES[t].dot}`} />
              {TONES[t].label}
            </span>
          ))}
        </div>
      </div>

      {rack.isLoading && <p className="text-sm text-slate-500">Loading rooms…</p>}
      {!rack.isLoading && rooms.length === 0 && (
        <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
          No rooms yet. Add room types and rooms in Property setup.
        </p>
      )}

      {types.map((type) => (
        <div key={type} className="mb-5 last:mb-0">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{type}</h3>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-8 xl:grid-cols-10">
            {rooms.filter((r) => r.room_type === type).map((r) => {
              const t = toneOf(r);
              return (
                <div key={r.room_id} title={`${r.room_number} · ${TONES[t].label}${r.departure ? ` · leaves ${formatDate(r.departure)}` : ''}`}
                  className={`group rounded-xl p-2.5 text-center shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md ${TONES[t].tile}`}>
                  <div className="text-base font-bold leading-none">{r.room_number}</div>
                  <div className="mt-1 truncate text-[11px] opacity-90">{TONES[t].label}</div>
                  {r.occupied && r.departure && (
                    <div className="mt-0.5 text-[10px] opacity-80">out {formatDate(r.departure)}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}
