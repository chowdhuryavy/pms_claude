import { DashboardCards } from '../components/Dashboard';
import { useState, type FormEvent } from 'react';
import { Shell, Can, usePortal } from '../components/Shell';
import { Button, Field, Notice, Panel, Table, inputClass, errorText } from '../components/ui';
import { useApiAction, useApiQuery, type Page } from '../lib/hooks';
import { addDaysIso, todayIso } from '../lib/format';

interface AvailRow { room_type_id: string; code: string; description: string; base_rate_minor: number; min_available: number }
interface Res {
  res_id: string; confirmation_no: string; status: string; arrival: string; departure: string;
  room_type_id: string; room_id: string; version: number; rate_minor: number;
  guest?: { first_name: string; last_name: string; email: string } | null;
}
interface Rack {
  summary: { business_date: string; rooms: number; in_house: number; vacant_clean: number; vacant_dirty: number; out_of_order: number; arrivals: number; departures: number };
  rooms: Array<{ room_id: string; room_number: string; room_type: string; status: string; housekeeping_status: string; occupied: boolean; departure: string | null; version: number }>;
}
interface ArrDep extends Res { guest_name: string }
interface ConfigRow { code: string; description: string }

function Availability() {
  const { propertyId, me } = usePortal();
  const pid = propertyId ?? '';
  const [arrival, setArrival] = useState(todayIso());
  const [departure, setDeparture] = useState(addDaysIso(todayIso(), 1));
  const [searched, setSearched] = useState<{ arrival: string; departure: string } | null>(null);
  const avail = useApiQuery<AvailRow[]>('res.availability', { property_id: pid, ...(searched ?? { arrival, departure }) }, !!pid && !!searched);
  const markets = useApiQuery<Page<ConfigRow>>('config.items.list', { property_id: pid, config_type: 'MARKET_CODE' }, !!pid);
  const sources = useApiQuery<Page<ConfigRow>>('config.items.list', { property_id: pid, config_type: 'SOURCE_CODE' }, !!pid);
  const book = useApiAction('res.create');
  const [booking, setBooking] = useState<{ room_type_id: string; code: string } | null>(null);
  const [guest, setGuest] = useState({ first_name: '', last_name: '', email: '', phone: '' });
  const [extra, setExtra] = useState({ adults: '2', children: '0', market_code: '', source_code: '' });
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  if (!me.grants['RES.VIEW']?.length) return null;
  return (
    <Panel title="Availability and new booking">
      {message && <Notice kind={message.kind}>{message.text}</Notice>}
      <form className="mb-4 flex flex-wrap items-end gap-3" onSubmit={(e: FormEvent) => {
        e.preventDefault(); setSearched({ arrival, departure }); setBooking(null);
      }}>
        <Field label="Arrival"><input type="date" className={inputClass} value={arrival} onChange={(e) => setArrival(e.target.value)} /></Field>
        <Field label="Departure"><input type="date" className={inputClass} value={departure} onChange={(e) => setDeparture(e.target.value)} /></Field>
        <Button type="submit" loading={avail.isFetching}>Check availability</Button>
      </form>
      <Table<AvailRow> rowKey={(a) => a.room_type_id} rows={searched ? avail.data ?? [] : []} empty="Search a date range to see availability" columns={[
        { header: 'Room type', render: (a) => `${a.code} · ${a.description}` },
        { header: 'Rate', align: 'right', render: (a) => (a.base_rate_minor / 100).toFixed(2) },
        { header: 'Free every night', align: 'right', render: (a) => a.min_available },
        { header: '', render: (a) => (
          <Can fn="RES.BOOK" level="Create">
            <Button variant="secondary" disabled={a.min_available < 1} onClick={() => setBooking({ room_type_id: a.room_type_id, code: a.code })}>
              Book
            </Button>
          </Can>
        ) }
      ]} />
      {booking && (
        <form className="mt-6 grid gap-3 rounded border border-slate-200 p-4 md:grid-cols-4" onSubmit={(e) => {
          e.preventDefault(); setMessage(null);
          book.mutate({
            property_id: pid, room_type_id: booking.room_type_id, arrival: searched!.arrival, departure: searched!.departure,
            adults: Number(extra.adults), children: Number(extra.children),
            market_code: extra.market_code || undefined, source_code: extra.source_code || undefined,
            guest
          }, {
            onSuccess: (r: unknown) => {
              const res = r as Res;
              setMessage({ kind: 'ok', text: `Booked. Confirmation ${res.confirmation_no}.` });
              setBooking(null);
              setGuest({ first_name: '', last_name: '', email: '', phone: '' });
            },
            onError: (err) => setMessage({ kind: 'error', text: errorText(err) })
          });
        }}>
          <div className="md:col-span-4 text-sm font-medium">Guest for {booking.code}</div>
          <Field label="First name"><input className={inputClass} required value={guest.first_name} onChange={(e) => setGuest({ ...guest, first_name: e.target.value })} /></Field>
          <Field label="Last name"><input className={inputClass} required value={guest.last_name} onChange={(e) => setGuest({ ...guest, last_name: e.target.value })} /></Field>
          <Field label="Email"><input type="email" className={inputClass} value={guest.email} onChange={(e) => setGuest({ ...guest, email: e.target.value })} /></Field>
          <Field label="Phone"><input className={inputClass} value={guest.phone} onChange={(e) => setGuest({ ...guest, phone: e.target.value })} /></Field>
          <Field label="Adults"><input type="number" min={1} className={inputClass} value={extra.adults} onChange={(e) => setExtra({ ...extra, adults: e.target.value })} /></Field>
          <Field label="Children"><input type="number" min={0} className={inputClass} value={extra.children} onChange={(e) => setExtra({ ...extra, children: e.target.value })} /></Field>
          <Field label="Market">
            <select className={inputClass} value={extra.market_code} onChange={(e) => setExtra({ ...extra, market_code: e.target.value })}>
              <option value="">None</option>
              {(markets.data?.items ?? []).map((m) => <option key={m.code} value={m.code}>{m.code}</option>)}
            </select>
          </Field>
          <Field label="Source">
            <select className={inputClass} value={extra.source_code} onChange={(e) => setExtra({ ...extra, source_code: e.target.value })}>
              <option value="">None</option>
              {(sources.data?.items ?? []).map((s) => <option key={s.code} value={s.code}>{s.code}</option>)}
            </select>
          </Field>
          <div className="flex items-end gap-2">
            <Button type="submit" loading={book.isPending}>Confirm booking</Button>
            <Button variant="secondary" type="button" onClick={() => setBooking(null)}>Cancel</Button>
          </div>
        </form>
      )}
    </Panel>
  );
}

function Rack() {
  const { propertyId, me } = usePortal();
  const pid = propertyId ?? '';
  const rack = useApiQuery<Rack>('fo.rack', { property_id: pid }, !!pid && !!me.grants['FO.RACK']?.length);
  const setRoom = useApiAction('fo.room_status');
  const [error, setError] = useState<string | null>(null);
  if (!me.grants['FO.RACK']?.length) return null;
  const s = rack.data?.summary;
  return (
    <Panel title={`Room rack${s ? ` · ${s.business_date}` : ''}`}>
      {error && <Notice kind="error">{error}</Notice>}
      {s && (
        <div className="mb-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-4 lg:grid-cols-7">
          {[
            ['In house', s.in_house], ['Arrivals', s.arrivals], ['Departures', s.departures],
            ['Vacant clean', s.vacant_clean], ['Vacant dirty', s.vacant_dirty], ['Out of order', s.out_of_order], ['Rooms', s.rooms]
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded border border-slate-200 p-3">
              <div className="text-xs text-slate-500">{label}</div>
              <div className="text-xl font-semibold">{value}</div>
            </div>
          ))}
        </div>
      )}
      <Table<Rack['rooms'][number]> rowKey={(r) => r.room_id} rows={rack.data?.rooms ?? []} columns={[
        { header: 'Room', render: (r) => r.room_number },
        { header: 'Type', render: (r) => r.room_type },
        { header: 'Occupancy', render: (r) => (r.occupied ? `Occupied, leaves ${r.departure}` : 'Vacant') },
        { header: 'Housekeeping', render: (r) => (
          <Can fn="FO.HOUSEKEEPING" level="Edit" fallback={r.housekeeping_status}>
            <select className="rounded border border-slate-300 px-1 py-0.5 text-sm" value={r.housekeeping_status}
              onChange={(e) => setRoom.mutate({ room_id: r.room_id, housekeeping_status: e.target.value, version: r.version },
                { onError: (err) => setError(errorText(err)) })}>
              {['CLEAN', 'DIRTY', 'INSPECTED'].map((h) => <option key={h}>{h}</option>)}
            </select>
          </Can>
        ) },
        { header: 'Status', render: (r) => (r.status === 'ACTIVE' ? 'In service' : 'Out of order') }
      ]} />
    </Panel>
  );
}

function StayActions({ res, onError }: { res: Res; onError: (m: string) => void }) {
  const checkin = useApiAction('fo.checkin');
  const checkout = useApiAction('fo.checkout');
  const noShow = useApiAction('res.no_show');
  const cancel = useApiAction('res.cancel');
  const showErr = (e: unknown) => onError(errorText(e));
  return (
    <div className="flex flex-wrap gap-2">
      {res.status === 'RESERVED' && (
        <Can fn="FO.CHECKIN" level="Create">
          <Button loading={checkin.isPending} onClick={() => checkin.mutate({ res_id: res.res_id, version: res.version }, { onError: showErr })}>Check in</Button>
        </Can>
      )}
      {res.status === 'RESERVED' && (
        <Can fn="RES.CANCEL" level="Edit">
          <Button variant="secondary" loading={noShow.isPending} onClick={() => noShow.mutate({ res_id: res.res_id, version: res.version }, { onError: showErr })}>No-show</Button>
        </Can>
      )}
      {res.status === 'RESERVED' && (
        <Can fn="RES.CANCEL" level="Delete">
          <Button variant="danger" loading={cancel.isPending} onClick={() => {
            const reason = window.prompt('Reason for cancelling this booking');
            if (reason) cancel.mutate({ res_id: res.res_id, reason, version: res.version }, { onError: showErr });
          }}>Cancel</Button>
        </Can>
      )}
      {res.status === 'IN_HOUSE' && (
        <Can fn="FO.CHECKOUT" level="Create">
          <Button variant="secondary" loading={checkout.isPending} onClick={() => checkout.mutate({ res_id: res.res_id, version: res.version }, { onError: showErr })}>Check out</Button>
        </Can>
      )}
    </div>
  );
}

function Reservations() {
  const { propertyId, me } = usePortal();
  const pid = propertyId ?? '';
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const res = useApiQuery<Page<Res & { guest_name?: string }>>('res.list', { property_id: pid, q: q || undefined, status: status || undefined, limit: 50 }, !!pid && !!me.grants['RES.VIEW']?.length);
  if (!me.grants['RES.VIEW']?.length) return null;
  return (
    <Panel title="Reservations" actions={
      <div className="flex gap-2">
        <input className="rounded border border-slate-300 px-2 py-1 text-sm" placeholder="Name, email or confirmation" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="rounded border border-slate-300 px-2 py-1 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {['RESERVED', 'IN_HOUSE', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW'].map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>
    }>
      {error && <Notice kind="error">{error}</Notice>}
      <Table<Res> rowKey={(r) => r.res_id} rows={res.data?.items ?? []} columns={[
        { header: 'Confirmation', render: (r) => <code>{r.confirmation_no}</code> },
        { header: 'Guest', render: (r) => (r.guest ? `${r.guest.first_name} ${r.guest.last_name}` : '') },
        { header: 'Arrival', render: (r) => r.arrival },
        { header: 'Departure', render: (r) => r.departure },
        { header: 'Status', render: (r) => r.status },
        { header: 'Room', render: (r) => r.room_id ? 'Assigned' : '' },
        { header: '', render: (r) => <StayActions res={r} onError={setError} /> }
      ]} />
      {res.data && res.data.total > res.data.items.length && (
        <p className="mt-2 text-xs text-slate-500">Showing {res.data.items.length} of {res.data.total}. Narrow the search to see more.</p>
      )}
    </Panel>
  );
}

function MovementList({ title, action }: { title: 'arrivals' | 'departures'; action: string }) {
  const { propertyId, me } = usePortal();
  const pid = propertyId ?? '';
  const list = useApiQuery<Page<ArrDep>>(action, { property_id: pid }, !!pid && !!me.grants['FO.RACK']?.length);
  const [error, setError] = useState<string | null>(null);
  if (!me.grants['FO.RACK']?.length) return null;
  return (
    <Panel title={`${title[0].toUpperCase()}${title.slice(1)} today`}>
      {error && <Notice kind="error">{error}</Notice>}
      <Table<ArrDep> rowKey={(r) => r.res_id} rows={list.data?.items ?? []} empty={`No ${title} for today`} columns={[
        { header: 'Guest', render: (r) => r.guest_name },
        { header: 'Confirmation', render: (r) => <code>{r.confirmation_no}</code> },
        { header: 'Room', render: (r) => (r.room_id ? 'Assigned' : 'Not yet') },
        { header: '', render: (r) => <StayActions res={r} onError={setError} /> }
      ]} />
    </Panel>
  );
}

export default function FrontDeskPage() {
  return (
    <Shell title="Front desk">
      {({ propertyId }) => (propertyId ? (
        <>
          <DashboardCards />
        <Rack />
          <MovementList title="arrivals" action="fo.arrivals" />
          <MovementList title="departures" action="fo.departures" />
          <Availability />
          <Reservations />
        </>
      ) : <p className="text-sm text-slate-500">You are not assigned to a property.</p>)}
    </Shell>
  );
}
