import { useState } from 'react';
import { Shell, Can, usePortal } from '../components/Shell';
import { Button, Field, Notice, Panel, Table, inputClass, errorText } from '../components/ui';
import { useApiAction, useApiQuery, type Page } from '../lib/hooks';
import { formatMoney, normalizeMoneyInput } from '../lib/format';

interface StayRow { res_id: string; confirmation_no: string; folio_id: string; room_id: string; guest?: { first_name: string; last_name: string } | null }
interface TxnRow { txn_id: string; code: string; kind: string; amount_minor: number; business_date: string; description: string; reverses_txn_id: string; created_at: string }
interface FolioView { folio: { folio_id: string; folio_no: number; status: string }; balance_minor: number; transactions: TxnRow[]; transaction_count: number }
interface ConfigRow { code: string; data_json: string }

export function CashierWorkspace() {
  const { propertyId } = usePortal();
  const pid = propertyId ?? '';
  const stays = useApiQuery<Page<StayRow>>('res.list', { property_id: pid, status: 'IN_HOUSE', limit: 200 }, !!pid);
  const codes = useApiQuery<Page<ConfigRow>>('config.items.list', { property_id: pid, config_type: 'TRANSACTION_CODE', limit: 200 }, !!pid);
  const [selected, setSelected] = useState<string>('');
  const [target, setTarget] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [postForm, setPostForm] = useState({ code: '', amount: '', description: '' });
  const [xferAmount, setXferAmount] = useState('');

  const selectedStay = (stays.data?.items ?? []).find((s) => s.res_id === selected);
  const folioId = selectedStay?.folio_id ?? '';
  const folio = useApiQuery<FolioView>('cash.folio', { folio_id: folioId }, !!folioId);
  const post = useApiAction('cash.post');
  const transfer = useApiAction('cash.transfer');
  const reverse = useApiAction('cash.reverse');

  const flash = (text: string) => { setOk(text); setError(null); };
  const fail = (e: unknown) => { setError(errorText(e)); setOk(null); };
  const stayLabel = (s: StayRow) => `${s.guest ? `${s.guest.first_name} ${s.guest.last_name}` : 'Guest'} · ${s.confirmation_no}`;

  if (!pid) return <p className="text-sm text-slate-500">You are not assigned to a property.</p>;

  return (
    <>
      <Panel title="Folio">
        <Field label="In-house guest">
          <select className={inputClass} value={selected} onChange={(e) => { setSelected(e.target.value); setTarget(''); setError(null); setOk(null); }}>
            <option value="">Select a stay</option>
            {(stays.data?.items ?? []).map((s) => <option key={s.res_id} value={s.res_id}>{stayLabel(s)}</option>)}
          </select>
        </Field>
        {error && <div className="mt-4"><Notice kind="error">{error}</Notice></div>}
        {ok && <div className="mt-4"><Notice kind="ok">{ok}</Notice></div>}
        {folio.data && (
          <div className="mt-4">
            <div className="mb-4 flex items-baseline gap-6">
              <div className="text-sm text-slate-500">Folio {folio.data.folio.folio_no}</div>
              <div className="text-2xl font-semibold tabular-nums">{formatMoney(folio.data.balance_minor)}</div>
              <div className="text-sm text-slate-500">{folio.data.folio.status}</div>
            </div>
            <Table<TxnRow> rowKey={(t) => t.txn_id} rows={folio.data.transactions} empty="No postings yet" columns={[
              { header: 'Date', render: (t) => t.business_date },
              { header: 'Code', render: (t) => t.code },
              { header: 'Kind', render: (t) => t.kind },
              { header: 'Description', render: (t) => t.description },
              { header: 'Amount', align: 'right', render: (t) => formatMoney(t.amount_minor) },
              { header: '', render: (t) => (
                t.kind === 'REVERSAL' || t.reverses_txn_id ? null : (
                  <Can fn="CASH.REVERSE" level="Create">
                    <Button variant="secondary" loading={reverse.isPending} onClick={() => {
                      const reason = window.prompt('Reason for reversing this posting');
                      if (reason) reverse.mutate({ txn_id: t.txn_id, reason },
                        { onSuccess: () => flash('Posting reversed.'), onError: fail });
                    }}>Reverse</Button>
                  </Can>
                )
              ) }
            ]} />
          </div>
        )}
      </Panel>

      {folio.data && folio.data.folio.status === 'OPEN' && (
        <>
          <Can fn="CASH.POST" level="Create">
            <Panel title="Post a charge or payment">
              <form className="grid gap-3 md:grid-cols-4" onSubmit={(e) => {
                e.preventDefault(); setError(null);
                const amount = normalizeMoneyInput(postForm.amount);
                if (amount === null) { setError('Amount must be a decimal such as 25.00'); return; }
                post.mutate({ folio_id: folioId, code: postForm.code, amount, description: postForm.description },
                  { onSuccess: () => { setPostForm({ ...postForm, amount: '', description: '' }); flash('Posted.'); }, onError: fail });
              }}>
                <Field label="Code">
                  <select className={inputClass} required value={postForm.code} onChange={(e) => setPostForm({ ...postForm, code: e.target.value })}>
                    <option value="">Select</option>
                    {(codes.data?.items ?? []).map((c) => <option key={c.code} value={c.code}>{c.code} · {JSON.parse(c.data_json || '{}').kind}</option>)}
                  </select>
                </Field>
                <Field label="Amount"><input className={inputClass} required placeholder="0.00" value={postForm.amount} onChange={(e) => setPostForm({ ...postForm, amount: e.target.value })} /></Field>
                <Field label="Description"><input className={inputClass} value={postForm.description} onChange={(e) => setPostForm({ ...postForm, description: e.target.value })} /></Field>
                <div className="flex items-end"><Button type="submit" loading={post.isPending}>Post</Button></div>
              </form>
              <p className="mt-2 text-xs text-slate-500">Adjustment and rebate codes need approval-limit authority. Above your limit, the server refuses the posting.</p>
            </Panel>
          </Can>

          <Can fn="CASH.TRANSFER" level="Create">
            <Panel title="Transfer to another folio">
              <form className="grid gap-3 md:grid-cols-4" onSubmit={(e) => {
                e.preventDefault(); setError(null);
                const amount = normalizeMoneyInput(xferAmount);
                if (amount === null) { setError('Amount must be a decimal such as 25.00'); return; }
                transfer.mutate({ from_folio_id: folioId, to_folio_id: target, amount },
                  { onSuccess: () => { setXferAmount(''); flash('Transferred.'); }, onError: fail });
              }}>
                <Field label="Target stay">
                  <select className={inputClass} required value={target} onChange={(e) => setTarget(e.target.value)}>
                    <option value="">Select</option>
                    {(stays.data?.items ?? []).filter((s) => s.res_id !== selected && s.folio_id).map((s) => (
                      <option key={s.res_id} value={s.folio_id}>{stayLabel(s)}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Amount"><input className={inputClass} required value={xferAmount} onChange={(e) => setXferAmount(e.target.value)} /></Field>
                <div className="flex items-end"><Button type="submit" loading={transfer.isPending} disabled={!target}>Transfer</Button></div>
              </form>
            </Panel>
          </Can>
        </>
      )}
    </>
  );
}

export default function CashierPage() {
  return (
    <Shell title="Cashier">
      {() => <CashierWorkspace />}
    </Shell>
  );
}
