import { useState } from 'react';
import { Shell, Can, usePortal } from '../components/Shell';
import { Button, Field, Notice, Panel, Table, inputClass, errorText } from '../components/ui';
import { useApiAction, useApiQuery, type Page } from '../lib/hooks';
import { addDaysIso, formatMoney, formatPercent, todayIso } from '../lib/format';
import { callApi } from '../lib/api';
import { useConfirm } from '../components/Dialog';

interface Check { code: string; ok: boolean; count: number; message: string }
interface AuditStatus { business_date: string; checks: Check[]; can_run: boolean; last_runs: Array<{ run_id: string; status: string; error: string; rooms_posted: number; room_minor: number; tax_minor: number }> }
interface RunResult { run: { status: string; rooms_posted: number; room_minor: number; tax_minor: number; no_shows: number }; next_business_date: string }
interface Flash {
  business_date: string; currency: string; rooms_sold: number; in_house: number; arrivals: number; departures: number;
  no_shows: number; occupancy: number; adr_minor: number; revpar_minor: number; room_revenue_minor: number;
  total_revenue_minor: number; payments_minor: number;
}
interface Daily { rows: Array<{ code: string; count: number; amount_minor: number }>; total_minor: number }
interface Ledger { folio_no: number; confirmation_no: string; guest_name: string; balance_minor: number }
interface Occupancy { totals: { available: number; sold: number; room_revenue_minor: number; occupancy: number; adr_minor: number; revpar_minor: number }; from: string; to: string }

function NightAuditPanel() {
  const { propertyId, me } = usePortal();
  const pid = propertyId ?? '';
  const status = useApiQuery<AuditStatus>('audit.status', { property_id: pid }, !!pid && !!me.grants['AUDIT.RUN']?.length);
  const run = useApiAction<RunResult>('audit.run');
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, ask] = useConfirm();
  if (!me.grants['AUDIT.RUN']?.length) return null;
  const s = status.data;
  return (
    <>{dialog}
    <Panel title={`Night audit${s ? ` · business date ${s.business_date}` : ''}`} actions={
      <Can fn="AUDIT.RUN" level="Execute">
        <Button loading={run.isPending} disabled={!s?.can_run} onClick={async () => {
          const ok = await ask({
            title: 'Run night audit?',
            message: `Run night audit for ${s?.business_date}? The business date will move to the next day after it completes.`,
            okLabel: 'Run audit'
          });
          if (!ok) return;
          setError(null);
          run.mutate({ property_id: pid }, { onSuccess: (r) => setResult(r), onError: (e) => setError(errorText(e)) });
        }}>Run audit</Button>
      </Can>
    }>
      {error && <Notice kind="error">{error}</Notice>}
      {result && (
        <Notice kind="ok">
          Audit complete. Rooms posted {result.run.rooms_posted}, room revenue {formatMoney(result.run.room_minor)}, tax {formatMoney(result.run.tax_minor)}, no-shows {result.run.no_shows}. Business date is now {result.next_business_date}.
        </Notice>
      )}
      <Table<Check> rowKey={(c) => c.code} rows={s?.checks ?? []} columns={[
        { header: 'Pre-audit check', render: (c) => c.message },
        { header: 'Result', render: (c) => (c.ok ? 'Pass' : `Attention (${c.count})`) }
      ]} />
      {s && s.last_runs.length > 0 && (
        <div className="mt-4 text-sm">
          <div className="mb-1 font-medium">Recent runs for this date</div>
          <ul className="list-disc pl-5 text-slate-600">
            {s.last_runs.map((r) => (
              <li key={r.run_id}>{r.status}{r.status === 'FAILED' ? `: ${r.error}` : ` · ${r.rooms_posted} rooms`}</li>
            ))}
          </ul>
        </div>
      )}
    </Panel></>
  );
}

function FlashPanel() {
  const { propertyId, me } = usePortal();
  const pid = propertyId ?? '';
  const [date, setDate] = useState('');
  const flash = useApiQuery<Flash>('rpt.flash', { property_id: pid, date: date || undefined }, !!pid && !!me.grants['RPT.VIEW']?.length);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const daily = useApiQuery<Daily>('rpt.daily_revenue', { property_id: pid, date: date || undefined }, !!pid && !!me.grants['RPT.VIEW']?.length);
  const f = flash.data;
  if (!me.grants['RPT.VIEW']?.length) return null;
  const tile = (label: string, value: string) => (
    <div className="rounded border border-slate-200 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
  return (
    <Panel title="Manager flash" actions={
      <input type="date" className="rounded border border-slate-300 px-2 py-1 text-sm" value={date} onChange={(e) => setDate(e.target.value)} />
    }>
      {f && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            {tile('Occupancy', formatPercent(f.occupancy))}
            {tile('ADR', formatMoney(f.adr_minor, f.currency))}
            {tile('RevPAR', formatMoney(f.revpar_minor, f.currency))}
            {tile('Room revenue', formatMoney(f.room_revenue_minor, f.currency))}
            {tile('Rooms sold', String(f.rooms_sold))}
            {tile('Arrivals', String(f.arrivals))}
            {tile('Departures', String(f.departures))}
            {tile('Total revenue', formatMoney(f.total_revenue_minor, f.currency))}
          </div>
        </>
      )}
      <Table<Daily['rows'][number]> rowKey={(r) => r.code} rows={daily.data?.rows ?? []} empty="No revenue postings for this date" columns={[
        { header: 'Code', render: (r) => r.code },
        { header: 'Postings', align: 'right', render: (r) => r.count },
        { header: 'Amount', align: 'right', render: (r) => formatMoney(r.amount_minor) }
      ]} />
      {daily.data && <p className="mt-2 text-sm font-medium">Total {formatMoney(daily.data.total_minor)}</p>}
      <Can fn="RPT.VIEW" level="Export">
        {exportError && <Notice kind="error">{exportError}</Notice>}
        <Button variant="secondary" className="mt-3" loading={exporting} onClick={async () => {
          setExporting(true);
          setExportError(null);
          try {
            const out = await callApi<{ filename: string; csv: string }>('rpt.daily_revenue_csv', { property_id: pid, date: date || undefined });
            const url = URL.createObjectURL(new Blob([out.csv], { type: 'text/csv' }));
            const a = document.createElement('a');
            a.href = url; a.download = out.filename; a.click();
            URL.revokeObjectURL(url);
          } catch (err) {
            setExportError(errorText(err));
          } finally {
            setExporting(false);
          }
        }}>Export CSV</Button>
      </Can>
    </Panel>
  );
}

function OccupancyPanel() {
  const { propertyId, me } = usePortal();
  const pid = propertyId ?? '';
  const [from, setFrom] = useState(addDaysIso(todayIso(), -6));
  const [to, setTo] = useState(todayIso());
  const [searched, setSearched] = useState<{ from: string; to: string } | null>(null);
  const occ = useApiQuery<Occupancy>('rpt.occupancy', { property_id: pid, ...(searched ?? { from, to }) }, !!pid && !!searched && !!me.grants['RPT.VIEW']?.length);
  if (!me.grants['RPT.VIEW']?.length) return null;
  return (
    <Panel title="Occupancy, ADR and RevPAR">
      <form className="mb-4 flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); setSearched({ from, to }); }}>
        <Field label="From"><input type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Button type="submit" loading={occ.isFetching}>Run</Button>
      </form>
      {occ.data && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {[
            ['Occupancy', formatPercent(occ.data.totals.occupancy)],
            ['ADR', formatMoney(occ.data.totals.adr_minor)],
            ['RevPAR', formatMoney(occ.data.totals.revpar_minor)],
            ['Room nights sold', String(occ.data.totals.sold)],
            ['Room revenue', formatMoney(occ.data.totals.room_revenue_minor)]
          ].map(([l, v]) => (
            <div key={l} className="rounded border border-slate-200 p-3">
              <div className="text-xs text-slate-500">{l}</div>
              <div className="text-lg font-semibold tabular-nums">{v}</div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function LedgerPanel() {
  const { propertyId, me } = usePortal();
  const pid = propertyId ?? '';
  const ledger = useApiQuery<Page<Ledger>>('rpt.guest_ledger', { property_id: pid, limit: 200 }, !!pid && !!me.grants['RPT.VIEW']?.length);
  if (!me.grants['RPT.VIEW']?.length) return null;
  return (
    <Panel title="Guest ledger (open folios with a balance)">
      <Table<Ledger> rowKey={(l) => String(l.folio_no)} rows={ledger.data?.items ?? []} empty="No open balances" columns={[
        { header: 'Folio', render: (l) => l.folio_no },
        { header: 'Guest', render: (l) => l.guest_name },
        { header: 'Confirmation', render: (l) => <code>{l.confirmation_no}</code> },
        { header: 'Balance', align: 'right', render: (l) => formatMoney(l.balance_minor) }
      ]} />
    </Panel>
  );
}

export default function AuditPage() {
  return (
    <Shell title="Night audit and reports">
      {() => (
        <>
          <NightAuditPanel />
          <FlashPanel />
          <OccupancyPanel />
          <LedgerPanel />
        </>
      )}
    </Shell>
  );
}
