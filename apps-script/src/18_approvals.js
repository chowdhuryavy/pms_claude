/**
 * Posting approvals. A cashier whose limit is below the amount can ask for the
 * posting to be queued instead of refused. A user with a higher limit approves
 * it, and only then is the transaction posted.
 *
 * Rules:
 * - The requester cannot approve their own request. They may withdraw it by rejecting it.
 * - The approver's approval limit must cover the amount (System Administrator is exempt).
 * - Approval posts with the txn_key APPROVAL:<id>, so the posting can happen only once.
 * - A decision is accepted only while the request is PENDING and the folio is open.
 */

var Approvals = (function () {
  var STATUSES = ['PENDING', 'APPROVED', 'REJECTED'];

  /** Creates a queued request. Called by Cashier.post when the caller asks for approval. */
  function requestPosting(ctx, folio, args) {
    var row = Store.insert('Approval_Requests', {
      property_id: folio.property_id,
      folio_id: folio.folio_id,
      res_id: folio.res_id || '',
      code: args.code,
      kind: args.kind,
      amount_minor: args.amountSigned,
      currency: folio.currency,
      business_date: args.businessDate,
      description: String(args.description || '').slice(0, 200),
      status: 'PENDING',
      requested_by: ctx.user.user_id,
      requested_at: Dates.now()
    }, ctx.user.user_id);
    Audit.record(ctx, 'APPROVAL.QUEUE', 'REQUEST', 'Approval_Requests', row.approval_id, null, row, folio.property_id);
    return row;
  }

  function list(ctx, p) {
    var pid = Validate.text(p.property_id, 'property_id', 60);
    Perm.authorize(ctx, 'APPROVAL.QUEUE', 'View', pid);
    var status = p.status ? Validate.oneOf(String(p.status).toUpperCase(), 'status', STATUSES) : null;
    var rows = Store.list('Approval_Requests', function (r) {
      return r.property_id === pid && (!status || r.status === status);
    });
    rows.sort(function (a, b) { return a.requested_at < b.requested_at ? 1 : -1; });
    return Paging.page(Store.publicRows(rows), p);
  }

  function assertPending(req) {
    if (req.status !== 'PENDING') throw new PmsError('INVALID_STATE', 'This request is already ' + req.status, 409);
  }

  function assertVersion(req, expected) {
    if (expected !== undefined && expected !== null && Number(expected) !== Number(req.version)) {
      throw new PmsError('CONFLICT', 'This request was changed by someone else. Reload and try again.', 409);
    }
  }

  function approve(ctx, p) {
    var req = Store.mustGet('Approval_Requests', p.approval_id);
    Perm.authorize(ctx, 'APPROVAL.QUEUE', 'Approve', req.property_id);
    assertPending(req);
    assertVersion(req, p.version);
    if (req.requested_by === ctx.user.user_id) {
      throw new PmsError('SELF_APPROVAL', 'You cannot approve your own request', 403);
    }
    var magnitude = Math.abs(Number(req.amount_minor));
    if (!Perm.isSystemUser(ctx.user) && magnitude > Perm.approvalLimitFor(ctx.user)) {
      throw new PmsError('APPROVAL_REQUIRED', 'Amount is above your approval limit.', 403);
    }
    var folio = Store.mustGet('Folios', req.folio_id);
    if (folio.status !== 'OPEN') throw new PmsError('INVALID_STATE', 'Folio ' + folio.folio_no + ' is closed', 409);

    // Post before the status change. The txn_key makes a retry post nothing twice.
    var posted = Cashier.postRaw({
      txnKey: 'APPROVAL:' + req.approval_id,
      propertyId: req.property_id,
      folioId: req.folio_id,
      resId: req.res_id,
      code: req.code,
      kind: req.kind,
      amountSigned: Number(req.amount_minor),
      currency: req.currency,
      businessDate: req.business_date,
      description: req.description,
      userId: ctx.user.user_id
    });
    var result = Store.update('Approval_Requests', req.approval_id, {
      status: 'APPROVED', decided_by: ctx.user.user_id, decided_at: Dates.now(), txn_id: posted.txn.txn_id
    }, p.version, ctx.user.user_id);
    Audit.record(ctx, 'APPROVAL.QUEUE', 'APPROVE', 'Approval_Requests', req.approval_id, result.before, result.after, req.property_id);
    if (posted.created) {
      Audit.record(ctx, 'APPROVAL.QUEUE', 'POST', 'Transactions', posted.txn.txn_id, null, posted.txn, req.property_id);
    }
    return {
      approval: Store.publicRow(result.after),
      txn: Store.publicRow(posted.txn),
      folio_balance: Cashier.folioBalance(req.folio_id)
    };
  }

  function reject(ctx, p) {
    var req = Store.mustGet('Approval_Requests', p.approval_id);
    Perm.authorize(ctx, 'APPROVAL.QUEUE', 'Approve', req.property_id);
    assertPending(req);
    assertVersion(req, p.version);
    var note = String(p.decision_note || '').trim().slice(0, 300);
    var result = Store.update('Approval_Requests', req.approval_id, {
      status: 'REJECTED', decided_by: ctx.user.user_id, decided_at: Dates.now(), decision_note: note
    }, p.version, ctx.user.user_id);
    Audit.record(ctx, 'APPROVAL.QUEUE', 'REJECT', 'Approval_Requests', req.approval_id, result.before, result.after, req.property_id);
    return Store.publicRow(result.after);
  }

  return { requestPosting: requestPosting, list: list, approve: approve, reject: reject, STATUSES: STATUSES };
})();
