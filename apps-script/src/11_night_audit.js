/**
 * Night audit: pre-audit checks, no-show processing, room and tax posting,
 * revenue and ledger validation, and business-date rollover.
 *
 * Recovery design (Sheets has no transactions):
 * 1. A Night_Audit_Runs row is written as RUNNING before any posting.
 * 2. Every posting uses a deterministic txn_key (NA|ROOM|<res>|<date>), so a
 *    rerun after a crash posts nothing twice.
 * 3. The business date changes only after every check passes. A FAILED run leaves
 *    the date where it was, so the same audit can be run again safely.
 * 4. A COMPLETE run for a business date blocks a second audit of that date.
 */

var NightAudit = (function () {

  function runsFor(propertyId, date) {
    return Store.list('Night_Audit_Runs', function (r) {
      return r.property_id === propertyId && r.business_date === date;
    });
  }

  function status(ctx, p) {
    var pid = Validate.text(p.property_id, 'property_id', 60);
    Perm.authorize(ctx, 'AUDIT.RUN', 'View', pid);
    var property = Store.mustGet('Properties', pid);
    var date = property.business_date;
    var reservations = Store.list('Reservations', function (r) { return r.property_id === pid; });
    var overdueArrivals = reservations.filter(function (r) { return r.status === 'RESERVED' && r.arrival <= date; });
    var overdueDepartures = reservations.filter(function (r) { return r.status === 'IN_HOUSE' && r.departure <= date; });
    var done = runsFor(pid, date).filter(function (r) { return r.status === 'COMPLETE'; }).length > 0;
    var running = runsFor(pid, date).filter(function (r) { return r.status === 'RUNNING'; }).length > 0;
    var checks = [
      {
        code: 'ARRIVALS_RESOLVED', ok: overdueArrivals.length === 0, count: overdueArrivals.length,
        message: overdueArrivals.length ? 'Unarrived bookings will be marked no-show' : 'All arrivals resolved'
      },
      {
        code: 'DEPARTURES_RESOLVED', ok: overdueDepartures.length === 0, count: overdueDepartures.length,
        message: overdueDepartures.length ? 'Guests past departure date are still in house' : 'No overdue departures'
      },
      { code: 'NOT_ALREADY_RUN', ok: !done, count: done ? 1 : 0, message: done ? 'Audit already completed for ' + date : 'Audit not yet run for ' + date },
      { code: 'NOT_RUNNING', ok: !running, count: running ? 1 : 0, message: running ? 'An audit is in progress' : 'No audit in progress' }
    ];
    return {
      business_date: date,
      checks: checks,
      can_run: !done && !running,
      last_runs: Store.publicRows(runsFor(pid, date).slice(-3))
    };
  }

  function activeTaxRules(pid) {
    return Store.list('Config_Items', function (c) {
      return c.property_id === pid && c.config_type === 'TAX_RULE' && String(c.active) === 'true';
    }).map(function (c) {
      return { code: c.code, rate_bps: Number(JSON.parse(c.data_json || '{}').rate_bps || 0) };
    });
  }

  function processNoShows(ctx, pid, date) {
    var count = 0;
    Store.list('Reservations', function (r) {
      return r.property_id === pid && r.status === 'RESERVED' && r.arrival <= date;
    }).forEach(function (r) {
      Store.update('Reservations', r.res_id, { status: 'NO_SHOW' }, null, ctx.user.user_id);
      Audit.record(ctx, 'AUDIT.RUN', 'NO_SHOW', 'Reservations', r.res_id, null, { status: 'NO_SHOW' }, pid);
      count++;
    });
    return count;
  }

  function postNightCharges(ctx, pid, date) {
    var roomCode = ConfigSvc.findActiveItem(pid, 'TRANSACTION_CODE', 'ROOM');
    var taxRules = activeTaxRules(pid);
    var property = Store.mustGet('Properties', pid);
    var stays = Store.list('Reservations', function (r) {
      return r.property_id === pid && r.status === 'IN_HOUSE' && r.arrival <= date && date < r.departure;
    });
    var summary = { rooms_posted: 0, room_minor: 0, tax_minor: 0, expected_room_minor: 0, res_ids: [] };

    stays.forEach(function (res) {
      if (!res.folio_id) throw new PmsError('INVALID_STATE', 'In-house reservation ' + res.res_id + ' has no folio', 500);
      var rate = Number(res.rate_minor);
      summary.expected_room_minor += rate;
      summary.res_ids.push(res.res_id);

      var room = Cashier.postRaw({
        txnKey: 'NA|ROOM|' + res.res_id + '|' + date,
        propertyId: pid, folioId: res.folio_id, resId: res.res_id,
        code: roomCode.code, kind: 'CHARGE', amountSigned: rate,
        currency: property.currency, businessDate: date, description: 'Room charge ' + date,
        userId: ctx.user.user_id
      });
      if (room.created) {
        summary.rooms_posted++;
        summary.room_minor += rate;
      }

      taxRules.forEach(function (rule) {
        var taxAmount = Money.roundDiv(rate * rule.rate_bps, 10000);
        if (taxAmount === 0) return;
        var taxCode = ConfigSvc.findActiveItem(pid, 'TRANSACTION_CODE', rule.code);
        var tax = Cashier.postRaw({
          txnKey: 'NA|' + rule.code + '|' + res.res_id + '|' + date,
          propertyId: pid, folioId: res.folio_id, resId: res.res_id,
          code: taxCode.code, kind: 'CHARGE', amountSigned: taxAmount,
          currency: property.currency, businessDate: date, description: 'Tax ' + rule.code + ' on room ' + date,
          userId: ctx.user.user_id
        });
        if (tax.created) summary.tax_minor += taxAmount;
      });
    });
    return summary;
  }

  /** Every posted room charge for the date must equal the rate on its reservation. */
  function validateRevenue(pid, date, summary) {
    var posted = Store.list('Transactions', function (t) {
      return t.property_id === pid && t.business_date === date && t.code === 'ROOM' &&
        t.kind === 'CHARGE' && summary.res_ids.indexOf(t.res_id) !== -1;
    });
    var actual = posted.reduce(function (s, t) { return s + Number(t.amount_minor); }, 0);
    if (actual !== summary.expected_room_minor) {
      throw new PmsError('REVENUE_MISMATCH', 'Posted room revenue ' + Money.format(actual) +
        ' does not match expected ' + Money.format(summary.expected_room_minor), 500);
    }
  }

  /** Transfers come in pairs that net to zero. Any imbalance stops the audit. */
  function validateLedger(pid) {
    var net = Store.list('Transactions', function (t) {
      return t.property_id === pid && t.kind === 'TRANSFER';
    }).reduce(function (s, t) { return s + Number(t.amount_minor); }, 0);
    if (net !== 0) {
      throw new PmsError('LEDGER_UNBALANCED', 'Transfer entries do not net to zero (' + Money.format(net) + ')', 500);
    }
  }

  function run(ctx, p) {
    var pid = Validate.text(p.property_id, 'property_id', 60);
    Perm.authorize(ctx, 'AUDIT.RUN', 'Execute', pid);
    var property = Store.mustGet('Properties', pid);
    var date = property.business_date;

    var existing = runsFor(pid, date);
    if (existing.some(function (r) { return r.status === 'COMPLETE'; })) {
      throw new PmsError('DUPLICATE_AUDIT', 'Night audit already completed for ' + date, 409);
    }
    if (existing.some(function (r) { return r.status === 'RUNNING'; })) {
      throw new PmsError('AUDIT_IN_PROGRESS', 'An audit for ' + date + ' is still marked running. Check the run log first.', 409);
    }

    var runRow = Store.insert('Night_Audit_Runs', {
      property_id: pid, business_date: date, status: 'RUNNING',
      started_at: Dates.now(), completed_at: '', rooms_posted: 0, room_minor: 0,
      tax_minor: 0, no_shows: 0, error: '', created_by: ctx.user.user_id
    }, ctx.user.user_id);

    try {
      var noShows = processNoShows(ctx, pid, date);
      var summary = postNightCharges(ctx, pid, date);
      validateRevenue(pid, date, summary);
      validateLedger(pid);

      Store.update('Properties', pid, { business_date: Dates.addDays(date, 1) }, null, ctx.user.user_id);
      var completed = Store.update('Night_Audit_Runs', runRow.run_id, {
        status: 'COMPLETE', completed_at: Dates.now(), rooms_posted: summary.rooms_posted,
        room_minor: summary.room_minor, tax_minor: summary.tax_minor, no_shows: noShows
      }, null, ctx.user.user_id);
      Audit.record(ctx, 'AUDIT.RUN', 'COMPLETE', 'Night_Audit_Runs', runRow.run_id, null, completed.after, pid);
      return {
        run: Store.publicRow(completed.after),
        next_business_date: Dates.addDays(date, 1)
      };
    } catch (err) {
      // Leave the business date unchanged. Postings made so far are safe to repeat.
      Store.update('Night_Audit_Runs', runRow.run_id, {
        status: 'FAILED', completed_at: Dates.now(), error: String(err && err.message || err).slice(0, 300)
      }, null, ctx.user.user_id);
      throw err;
    }
  }

  return { status: status, run: run, processNoShows: processNoShows, postNightCharges: postNightCharges };
})();
