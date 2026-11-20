/**
 * Reports, computed from the ledger. Read-only.
 *
 * Definitions used everywhere:
 * - Rooms available: ACTIVE rooms. Out-of-order rooms are excluded.
 *   This uses today's room count for every historical day (approximation,
 *   documented in docs/REPORTS.md).
 * - Rooms sold on a night: IN_HOUSE or CHECKED_OUT stays that covered the night.
 * - Room revenue: net ROOM code postings (charges and reversals) dated to the day.
 * - Occupancy = sold / available. ADR = room revenue / sold. RevPAR = room revenue / available.
 */

var Reports = (function () {
  var ROOM_CODE = 'ROOM';
  var REVENUE_KINDS = ['CHARGE', 'ADJUSTMENT', 'REBATE', 'REVERSAL'];

  function dayList(from, to) {
    var out = [];
    var n = Dates.nights(from, to) + 1;
    for (var i = 0; i < n; i++) out.push(Dates.addDays(from, i));
    return out;
  }

  function assertRange(from, to) {
    Dates.assertIsoDate(from, 'from');
    Dates.assertIsoDate(to, 'to');
    if (to < from) throw new PmsError('VALIDATION', 'to must be on or after from');
    if (Dates.nights(from, to) > 366) throw new PmsError('VALIDATION', 'range cannot exceed 367 days');
  }

  /** Core statistics for a date range, using preloaded data for speed. */
  function statsFor(pid, from, to) {
    var days = dayList(from, to);
    var available = Store.list('Rooms', function (r) { return r.property_id === pid && r.status === 'ACTIVE'; }).length;
    var stays = Store.list('Reservations', function (r) {
      return r.property_id === pid && (r.status === 'IN_HOUSE' || r.status === 'CHECKED_OUT') &&
        r.arrival <= to && r.departure > from;
    });
    var roomTxns = Store.list('Transactions', function (t) {
      return t.property_id === pid && t.code === ROOM_CODE && t.business_date >= from && t.business_date <= to &&
        (t.kind === 'CHARGE' || t.kind === 'REVERSAL');
    });

    var daily = days.map(function (d) {
      var sold = stays.filter(function (s) { return s.arrival <= d && d < s.departure; }).length;
      var revenue = roomTxns.filter(function (t) { return t.business_date === d; })
        .reduce(function (s, t) { return s + Number(t.amount_minor); }, 0);
      return {
        date: d,
        available: available,
        sold: sold,
        room_revenue_minor: revenue,
        occupancy: available ? round4(sold / available) : 0,
        adr_minor: sold ? Math.round(revenue / sold) : 0,
        revpar_minor: available ? Math.round(revenue / available) : 0
      };
    });

    var totals = daily.reduce(function (t, d) {
      t.available += d.available;
      t.sold += d.sold;
      t.room_revenue_minor += d.room_revenue_minor;
      return t;
    }, { available: 0, sold: 0, room_revenue_minor: 0 });

    return {
      from: from,
      to: to,
      days: days.length,
      totals: {
        available: totals.available,
        sold: totals.sold,
        room_revenue_minor: totals.room_revenue_minor,
        occupancy: totals.available ? round4(totals.sold / totals.available) : 0,
        adr_minor: totals.sold ? Math.round(totals.room_revenue_minor / totals.sold) : 0,
        revpar_minor: totals.available ? Math.round(totals.room_revenue_minor / totals.available) : 0
      },
      daily: daily
    };
  }

  function round4(x) {
    return Math.round(x * 10000) / 10000;
  }

  function occupancyRange(ctx, p) {
    var pid = Validate.text(p.property_id, 'property_id', 60);
    Perm.authorize(ctx, 'RPT.VIEW', 'View', pid);
    var from = Dates.assertIsoDate(p.from, 'from');
    var to = Dates.assertIsoDate(p.to, 'to');
    assertRange(from, to);
    return statsFor(pid, from, to);
  }

  /** Manager flash for one business date. */
  function flash(ctx, p) {
    var pid = Validate.text(p.property_id, 'property_id', 60);
    Perm.authorize(ctx, 'RPT.VIEW', 'View', pid);
    var property = Store.mustGet('Properties', pid);
    var date = p.date ? Dates.assertIsoDate(p.date, 'date') : property.business_date;
    var stats = statsFor(pid, date, date);
    var txns = Store.list('Transactions', function (t) { return t.property_id === pid && t.business_date === date; });
    var totalRevenue = txns.filter(function (t) { return REVENUE_KINDS.indexOf(t.kind) !== -1; })
      .reduce(function (s, t) { return s + Number(t.amount_minor); }, 0);
    var payments = txns.filter(function (t) { return t.kind === 'PAYMENT'; })
      .reduce(function (s, t) { return s + -Number(t.amount_minor); }, 0);
    var reservations = Store.list('Reservations', function (r) { return r.property_id === pid; });
    return {
      business_date: date,
      currency: property.currency,
      rooms_available: stats.totals.available / (stats.days || 1),
      rooms_sold: stats.totals.sold,
      in_house: reservations.filter(function (r) { return r.status === 'IN_HOUSE'; }).length,
      arrivals: reservations.filter(function (r) { return r.status === 'RESERVED' && r.arrival === date; }).length,
      departures: reservations.filter(function (r) { return r.status === 'IN_HOUSE' && r.departure === date; }).length,
      no_shows: reservations.filter(function (r) { return r.status === 'NO_SHOW' && r.arrival === date; }).length,
      occupancy: stats.totals.occupancy,
      adr_minor: stats.totals.adr_minor,
      revpar_minor: stats.totals.revpar_minor,
      room_revenue_minor: stats.totals.room_revenue_minor,
      total_revenue_minor: totalRevenue,
      payments_minor: payments
    };
  }

  /** Revenue grouped by transaction code for one business date. */
  function dailyRevenue(ctx, p) {
    var pid = Validate.text(p.property_id, 'property_id', 60);
    Perm.authorize(ctx, 'RPT.VIEW', 'View', pid);
    var property = Store.mustGet('Properties', pid);
    var date = p.date ? Dates.assertIsoDate(p.date, 'date') : property.business_date;
    var groups = {};
    Store.list('Transactions', function (t) {
      return t.property_id === pid && t.business_date === date && REVENUE_KINDS.indexOf(t.kind) !== -1;
    }).forEach(function (t) {
      if (!groups[t.code]) groups[t.code] = { code: t.code, count: 0, amount_minor: 0 };
      groups[t.code].count++;
      groups[t.code].amount_minor += Number(t.amount_minor);
    });
    var rows = Object.keys(groups).sort().map(function (k) { return groups[k]; });
    return {
      business_date: date,
      rows: rows,
      total_minor: rows.reduce(function (s, r) { return s + r.amount_minor; }, 0)
    };
  }

  /** Guest ledger: open folios with a balance, with guest and room. */
  function guestLedger(ctx, p) {
    var pid = Validate.text(p.property_id, 'property_id', 60);
    Perm.authorize(ctx, 'RPT.VIEW', 'View', pid);
    var rows = Store.list('Folios', function (f) { return f.property_id === pid && f.status === 'OPEN'; })
      .map(function (f) {
        var res = Store.get('Reservations', f.res_id) || {};
        var guest = Store.get('Guest_Profiles', res.guest_id) || {};
        return {
          folio_id: f.folio_id,
          folio_no: f.folio_no,
          confirmation_no: res.confirmation_no || '',
          guest_name: [guest.first_name, guest.last_name].join(' ').trim(),
          balance_minor: Cashier.folioBalance(f.folio_id)
        };
      })
      .filter(function (r) { return r.balance_minor !== 0; });
    return Paging.page(rows, p);
  }

  /** CSV export of the daily revenue report. Requires the Export level. */
  function dailyRevenueCsv(ctx, p) {
    var pid = Validate.text(p.property_id, 'property_id', 60);
    Perm.authorize(ctx, 'RPT.VIEW', 'Export', pid);
    var report = dailyRevenue(ctx, p);
    var lines = ['code,count,amount'];
    report.rows.forEach(function (r) {
      lines.push([r.code, r.count, Money.format(r.amount_minor)].join(','));
    });
    lines.push(['TOTAL', '', Money.format(report.total_minor)].join(','));
    return { filename: 'daily-revenue-' + report.business_date + '.csv', csv: lines.join('\n') };
  }

  return {
    occupancyRange: occupancyRange, flash: flash, dailyRevenue: dailyRevenue,
    guestLedger: guestLedger, dailyRevenueCsv: dailyRevenueCsv, statsFor: statsFor, dayList: dayList
  };
})();
