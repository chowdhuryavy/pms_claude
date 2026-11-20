import { useState } from 'react';
import { Shell, Can, usePortal } from '../components/Shell';
import { Button, Field, Notice, Panel, Table, inputClass, errorText } from '../components/ui';
import { useApiAction, useApiQuery, type Page } from '../lib/hooks';
import { formatMoney, normalizeMoneyInput } from '../lib/format';

const CONFIG_TYPES = ['RATE_CODE', 'TRANSACTION_CODE', 'MARKET_CODE', 'SOURCE_CODE', 'PACKAGE_CODE', 'PAYMENT_METHOD', 'TAX_RULE'];

interface RoomType { room_type_id: string; code: string; description: string; max_occupancy: number; base_rate_minor: number; active: string; version: number }
interface Room { room_id: string; room_number: string; room_type_id: string; floor: string; status: string; housekeeping_status: string; version: number }
interface ConfigItem { config_id: string; config_type: string; code: string; description: string; data_json: string; active: string }

function RoomTypes() {
  const { propertyId, me } = usePortal();
  const pid = propertyId ?? '';
  const types = useApiQuery<Page<RoomType>>('config.room_types.list', { property_id: pid }, !!pid);
  const create = useApiAction('config.room_types.create');
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ code: '', description: '', max_occupancy: '2', base_rate: '' });
  const can = me.grants['CFG.ROOMTYPE']?.length ? true : false;
  return (
    <Panel title="Room types">
      {error && <Notice kind="error">{error}</Notice>}
      <Can fn="CFG.ROOMTYPE" level="Create">
        <form className="mb-4 grid gap-3 md:grid-cols-5" onSubmit={(e) => {
          e.preventDefault(); setError(null);
          const rate = normalizeMoneyInput(form.base_rate);
          if (rate === null) { setError('Base rate must be a decimal such as 120.00'); return; }
          create.mutate({ property_id: pid, code: form.code, description: form.description,
            max_occupancy: Number(form.max_occupancy), base_rate: rate },
            { onSuccess: () => setForm({ code: '', description: '', max_occupancy: '2', base_rate: '' }),
              onError: (err) => setError(errorText(err)) });
        }}>
          <Field label="Code"><input className={inputClass} required maxLength={12} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field>
          <Field label="Description"><input className={inputClass} required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <Field label="Max occupancy"><input type="number" min={1} max={20} className={inputClass} value={form.max_occupancy} onChange={(e) => setForm({ ...form, max_occupancy: e.target.value })} /></Field>
          <Field label="Base rate"><input className={inputClass} required value={form.base_rate} onChange={(e) => setForm({ ...form, base_rate: e.target.value })} /></Field>
          <div className="flex items-end"><Button type="submit" disabled={create.isPending}>Add room type</Button></div>
        </form>
      </Can>
      <Table<RoomType> rowKey={(t) => t.room_type_id} rows={types.data?.items ?? []} empty={can ? 'No room types yet' : 'You cannot view room types'} columns={[
        { header: 'Code', render: (t) => t.code },
        { header: 'Description', render: (t) => t.description },
        { header: 'Max occupancy', align: 'right', render: (t) => t.max_occupancy },
        { header: 'Base rate', align: 'right', render: (t) => formatMoney(t.base_rate_minor) },
        { header: 'Active', render: (t) => (t.active === 'true' ? 'Yes' : 'No') }
      ]} />
    </Panel>
  );
}

function Rooms() {
  const { propertyId } = usePortal();
  const pid = propertyId ?? '';
  const rooms = useApiQuery<Page<Room>>('config.rooms.list', { property_id: pid, limit: 200 }, !!pid);
  const types = useApiQuery<Page<RoomType>>('config.room_types.list', { property_id: pid }, !!pid);
  const create = useApiAction('config.rooms.create');
  const update = useApiAction('config.rooms.update');
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ room_number: '', room_type_id: '', floor: '1' });
  const typeName = (id: string) => (types.data?.items ?? []).find((t) => t.room_type_id === id)?.code ?? '';
  return (
    <Panel title="Rooms">
      {error && <Notice kind="error">{error}</Notice>}
      <Can fn="CFG.ROOM" level="Create">
        <form className="mb-4 grid gap-3 md:grid-cols-4" onSubmit={(e) => {
          e.preventDefault(); setError(null);
          create.mutate({ property_id: pid, ...form }, { onSuccess: () => setForm({ ...form, room_number: '' }),
            onError: (err) => setError(errorText(err)) });
        }}>
          <Field label="Room number"><input className={inputClass} required value={form.room_number} onChange={(e) => setForm({ ...form, room_number: e.target.value })} /></Field>
          <Field label="Type">
            <select className={inputClass} required value={form.room_type_id} onChange={(e) => setForm({ ...form, room_type_id: e.target.value })}>
              <option value="">Select</option>
              {(types.data?.items ?? []).map((t) => <option key={t.room_type_id} value={t.room_type_id}>{t.code}</option>)}
            </select>
          </Field>
          <Field label="Floor"><input className={inputClass} value={form.floor} onChange={(e) => setForm({ ...form, floor: e.target.value })} /></Field>
          <div className="flex items-end"><Button type="submit" disabled={create.isPending}>Add room</Button></div>
        </form>
      </Can>
      <Table<Room> rowKey={(r) => r.room_id} rows={rooms.data?.items ?? []} columns={[
        { header: 'Room', render: (r) => r.room_number },
        { header: 'Type', render: (r) => typeName(r.room_type_id) },
        { header: 'Floor', render: (r) => r.floor },
        { header: 'Status', render: (r) => r.status },
        { header: 'Housekeeping', render: (r) => r.housekeeping_status },
        { header: '', render: (r) => (
          <Can fn="CFG.ROOM" level="Edit">
            <Button variant="secondary" onClick={() => update.mutate({
              room_id: r.room_id, version: r.version, status: r.status === 'ACTIVE' ? 'OUT_OF_ORDER' : 'ACTIVE'
            }, { onError: (err) => setError(errorText(err)) })}>
              {r.status === 'ACTIVE' ? 'Mark out of order' : 'Return to service'}
            </Button>
          </Can>
        ) }
      ]} />
    </Panel>
  );
}

function ConfigCodes() {
  const { propertyId } = usePortal();
  const pid = propertyId ?? '';
  const [type, setType] = useState('TRANSACTION_CODE');
  const items = useApiQuery<Page<ConfigItem>>('config.items.list', { property_id: pid, config_type: type, limit: 200 }, !!pid);
  const create = useApiAction('config.items.create');
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ code: '', description: '', kind: 'CHARGE', rate_bps: '1000' });
  return (
    <Panel title="Codes and tax rules" actions={
      <select className="rounded border border-slate-300 px-2 py-1 text-sm" value={type} onChange={(e) => setType(e.target.value)}>
        {CONFIG_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
    }>
      {error && <Notice kind="error">{error}</Notice>}
      <Can fn="CFG.CODE" level="Create">
        <form className="mb-4 grid gap-3 md:grid-cols-5" onSubmit={(e) => {
          e.preventDefault(); setError(null);
          const data: Record<string, unknown> = {};
          if (type === 'TRANSACTION_CODE') data.kind = form.kind;
          if (type === 'TAX_RULE') data.rate_bps = Number(form.rate_bps);
          create.mutate({ property_id: pid, config_type: type, code: form.code, description: form.description, data },
            { onSuccess: () => setForm({ ...form, code: '', description: '' }), onError: (err) => setError(errorText(err)) });
        }}>
          <Field label="Code" hint="A-Z, 0-9, underscore"><input className={inputClass} required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} /></Field>
          <Field label="Description"><input className={inputClass} required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          {type === 'TRANSACTION_CODE' && (
            <Field label="Kind">
              <select className={inputClass} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                {['CHARGE', 'PAYMENT', 'ADJUSTMENT', 'REBATE'].map((k) => <option key={k}>{k}</option>)}
              </select>
            </Field>
          )}
          {type === 'TAX_RULE' && (
            <Field label="Rate (basis points)" hint="1000 = 10%"><input type="number" min={0} max={10000} className={inputClass} value={form.rate_bps} onChange={(e) => setForm({ ...form, rate_bps: e.target.value })} /></Field>
          )}
          <div className="flex items-end"><Button type="submit" disabled={create.isPending}>Add</Button></div>
        </form>
      </Can>
      <Table<ConfigItem> rowKey={(c) => c.config_id} rows={items.data?.items ?? []} empty="Nothing configured for this type" columns={[
        { header: 'Code', render: (c) => c.code },
        { header: 'Description', render: (c) => c.description },
        { header: 'Details', render: (c) => <code className="text-xs">{c.data_json}</code> },
        { header: 'Active', render: (c) => (c.active === 'true' ? 'Yes' : 'No') }
      ]} />
    </Panel>
  );
}

export default function PropertyPage() {
  return (
    <Shell title="Property setup">
      {({ propertyId }) => (propertyId ? (
        <>
          <RoomTypes />
          <Rooms />
          <ConfigCodes />
        </>
      ) : <p className="text-sm text-slate-500">You are not assigned to a property.</p>)}
    </Shell>
  );
}
