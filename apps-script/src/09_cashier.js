/**
 * Cashiering: folios, postings, payments, transfers, reversals and rebates.
 *
 * Ledger rules:
 * - Transactions are append-only. A correction is a reversing entry, never an edit.
 * - A folio balance is the sum of its transactions (positive = guest owes).
 * - Every posting carries a unique txn_key. Repeating a key returns the
 *   existing row instead of posting again. This is the duplicate-posting guard
 *   used by night audit and retried requests.
 * - Adjustments and rebates above the caller's approval limit are refused with
 *   APPROVAL_REQUIRED. No approval queue exists yet; a higher-limit user must post it.
 */

var Cashier = (function () {

  function transactionsOf(folioId) {
    return Store.list('Transactions', function (t) { return t.folio_id === folioId; });
  }

  function folioBalance(folioId) {
    return transactionsOf(folioId).reduce(function (sum, t) { return sum + Number(t.amount_minor); }, 0);
  }

  function findByTxnKey(key) {
    return Store.list('Transactions', function (t) { return t.txn_key === key; })[0] || null;
  }

  function assertOpenFolio(folio) {
    if (folio.status !== 'OPEN') throw new PmsError('INVALID_STATE', 'Folio ' + folio.folio_no + ' is closed', 409);
  }

  function nextFolioNo(propertyId) {
    var count = Store.list('Folios', function (f) { return f.property_id === propertyId; }).length;
    return 1000 + count + 1;
  }

  /** Opens a folio for a reservation. Called at check-in. */
  function openFolio(ctx, reservation) {
    var folio = Store.insert('Folios', {
      property_id: reservation.property_id,
      res_id: reservation.res_id,
      folio_no: nextFolioNo(reservation.property_id),
      status: 'OPEN',
      currency: reservation.currency
    }, ctx.user.user_id);
    Store.update('Reservations', reservation.res_id, { folio_id: folio.folio_id }, null, ctx.user.user_id);
    return folio;
  }

  function assertApprovalLimit(ctx, amountMinor) {
    if (Perm.isSystemUser(ctx.user)) return;
    var limit = Perm.approvalLimitFor(ctx.user);
    if (Math.abs(amountMinor) > limit) {
      throw new PmsError('APPROVAL_REQUIRED', 'Amount is above your approval limit. A user with a higher limit must post it.', 403);
    }
  }

  /**
   * Low-level append used by all posting paths. Returns { txn, created }.
   * amountSigned already carries the sign for the folio balance.
   */
  function postRaw(params) {
    var existing = findByTxnKey(params.txnKey);
    if (existing) return { txn: existing, created: false };
    var txn = Store.insert('Transactions', {
      txn_key: params.txnKey,
      property_id: params.propertyId,
      folio_id: params.folioId,
      res_id: params.resId || '',
      code: params.code,
      kind: params.kind,
      amount_minor: params.amountSigned,
      currency: params.currency,
      business_date: params.businessDate,
      reverses_txn_id: params.reversesTxnId || '',
      description: String(params.description || '').slice(0, 200),
      created_at: Dates.now(),
      created_by: params.userId || 'SYSTEM'
    }, params.userId || 'SYSTEM');
    return { txn: txn, created: true };
  }

  function requireFolio(folioId) {
    return Store.mustGet('Folios', folioId);
  }

  /** Posts a charge, payment, adjustment or rebate to one folio. */
  function post(ctx, p) {
    var folio = requireFolio(p.folio_id);
    var pid = folio.property_id;
    var code = String(p.code || '').toUpperCase();
    var item = ConfigSvc.findActiveItem(pid, 'TRANSACTION_CODE', code);
    var kind = item.data.kind;
    var fn = (kind === 'ADJUSTMENT' || kind === 'REBATE') ? 'CASH.ADJUST' : 'CASH.POST';
    Perm.authorize(ctx, fn, 'Create', pid);
    assertOpenFolio(folio);

    var magnitude = Math.abs(Money.parse(p.amount, 'amount'));
    if (magnitude === 0) throw new PmsError('VALIDATION', 'amount must not be zero');
    var signed = magnitude * TXN_KINDS[kind].sign;
    if (fn === 'CASH.ADJUST' && p.request_approval === true && !Perm.isSystemUser(ctx.user) &&
        magnitude > Perm.approvalLimitFor(ctx.user)) {
      // Over the caller's limit: queue it for a user with a higher limit instead of refusing.
      var queued = Approvals.requestPosting(ctx, folio, {
        code: code, kind: kind, amountSigned: signed,
        businessDate: Store.mustGet('Properties', pid).business_date, description: p.description
      });
      return { status: 'PENDING_APPROVAL', approval_id: queued.approval_id,
        folio_balance: folioBalance(folio.folio_id), created: false };
    }
    if (fn === 'CASH.ADJUST') assertApprovalLimit(ctx, magnitude);

    var property = Store.mustGet('Properties', pid);
    var result = postRaw({
      txnKey: p.txn_key ? 'CLIENT:' + String(p.txn_key).slice(0, 80) : 'POST:' + Ids.newId('K'),
      propertyId: pid,
      folioId: folio.folio_id,
      resId: folio.res_id,
      code: code,
      kind: kind,
      amountSigned: signed,
      currency: folio.currency,
      businessDate: property.business_date,
      description: p.description,
      userId: ctx.user.user_id
    });
    if (result.created) {
      Audit.record(ctx, fn, 'POST', 'Transactions', result.txn.txn_id, null, result.txn, pid);
    }
    return { txn: Store.publicRow(result.txn), folio_balance: folioBalance(folio.folio_id), created: result.created };
  }

  /** Moves an amount from one folio to another as a pair of transfer entries. */
  function transfer(ctx, p) {
    var from = requireFolio(p.from_folio_id);
    var to = requireFolio(p.to_folio_id);
    if (from.folio_id === to.folio_id) throw new PmsError('VALIDATION', 'source and target folios are the same');
    if (from.property_id !== to.property_id) throw new PmsError('VALIDATION', 'folios belong to different properties');
    Perm.authorize(ctx, 'CASH.TRANSFER', 'Create', from.property_id);
    assertOpenFolio(from);
    assertOpenFolio(to);
    var magnitude = Math.abs(Money.parse(p.amount, 'amount'));
    if (magnitude === 0) throw new PmsError('VALIDATION', 'amount must not be zero');
    var property = Store.mustGet('Properties', from.property_id);
    var key = p.txn_key ? 'CLIENT:' + String(p.txn_key).slice(0, 80) : 'XFER:' + Ids.newId('K');
    var common = {
      propertyId: from.property_id, code: 'TRANSFER', kind: 'TRANSFER', currency: from.currency,
      businessDate: property.business_date, description: p.description, userId: ctx.user.user_id
    };
    var out = postRaw(Object.assign({}, common, {
      txnKey: key + ':OUT', folioId: from.folio_id, resId: from.res_id, amountSigned: -magnitude
    }));
    var inn = postRaw(Object.assign({}, common, {
      txnKey: key + ':IN', folioId: to.folio_id, resId: to.res_id, amountSigned: magnitude
    }));
    Audit.record(ctx, 'CASH.TRANSFER', 'TRANSFER', 'Folios', from.folio_id, null,
      { to_folio_id: to.folio_id, amount_minor: magnitude }, from.property_id);
    return {
      from_balance: folioBalance(from.folio_id),
      to_balance: folioBalance(to.folio_id),
      transactions: [Store.publicRow(out.txn), Store.publicRow(inn.txn)]
    };
  }

  /** Reverses one transaction with a new, opposite entry. Each transaction can be reversed once. */
  function reverse(ctx, p) {
    var original = Store.mustGet('Transactions', p.txn_id);
    var folio = requireFolio(original.folio_id);
    Perm.authorize(ctx, 'CASH.REVERSE', 'Create', folio.property_id);
    assertOpenFolio(folio);
    if (original.kind === 'REVERSAL' || original.reverses_txn_id) {
      throw new PmsError('INVALID_STATE', 'A reversal cannot itself be reversed', 409);
    }
    if (Store.list('Transactions', function (t) { return t.reverses_txn_id === original.txn_id; }).length) {
      throw new PmsError('ALREADY_REVERSED', 'This transaction was already reversed', 409);
    }
    var reason = Validate.text(p.reason, 'reason', 200);
    assertApprovalLimit(ctx, Math.abs(Number(original.amount_minor)));
    var property = Store.mustGet('Properties', folio.property_id);
    var result = postRaw({
      txnKey: 'REV:' + original.txn_id,
      propertyId: folio.property_id,
      folioId: folio.folio_id,
      resId: folio.res_id,
      code: original.code,
      kind: 'REVERSAL',
      amountSigned: -Number(original.amount_minor),
      currency: original.currency,
      businessDate: property.business_date,
      reversesTxnId: original.txn_id,
      description: 'Reversal: ' + reason,
      userId: ctx.user.user_id
    });
    Audit.record(ctx, 'CASH.REVERSE', 'REVERSE', 'Transactions', original.txn_id, null, result.txn, folio.property_id);
    return { txn: Store.publicRow(result.txn), folio_balance: folioBalance(folio.folio_id) };
  }

  function folio(ctx, p) {
    var f = requireFolio(p.folio_id);
    Perm.authorize(ctx, 'CASH.VIEW', 'View', f.property_id);
    var txns = transactionsOf(f.folio_id).sort(function (a, b) {
      return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;
    });
    return {
      folio: Store.publicRow(f),
      balance_minor: folioBalance(f.folio_id),
      transactions: Store.publicRows(txns.slice(0, 200)),
      transaction_count: txns.length
    };
  }

  return {
    openFolio: openFolio, folioBalance: folioBalance, postRaw: postRaw, findByTxnKey: findByTxnKey,
    transactionsOf: transactionsOf, post: post, transfer: transfer, reverse: reverse, folio: folio,
    assertApprovalLimit: assertApprovalLimit
  };
})();
