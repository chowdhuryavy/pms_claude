/**
 * Reservations: availability, bookings, guest profiles, modification,
 * cancellation and no-show.
 *
 * Availability is checked night by night. A stay is possible only if every
 * night has at least one room of the requested type left.
 */

var Reservations = (function () {
  var OPEN_STATUSES = ['RESERVED', 'IN_HOUSE'];

  function propertyBusinessDate(propertyId) {
    return Store.mustGet('Properties', propertyId).business_date;
  }

  /** Nights in [arrival, departure) that the stay needs. */
  function nightList(arrival, departure) {
    var out = [];
    var n = Dates.nights(arrival, departure);
    for (var i = 0; i < n; i++) out.push(Dates.addDays(arrival, i));
    return out;
  }

  /**
   * Returns { nights: [{date, capacity, sold, available}], minAvailable }
   * for one room type. excludeResId lets a modification ignore its own booking.
   */
  function availabilityForType(propertyId, roomTypeId, arrival, departure, excludeResId) {
    var capacity = Store.list('Rooms', function (r) {
      return r.property_id === propertyId && r.room_type_id === roomTypeId && r.status === 'ACTIVE';
    }).length;
    var bookings = Store.list('Reservations', function (r) {
      return r.property_id === propertyId && r.room_type_id === roomTypeId &&
        OPEN_STATUSES.indexOf(r.status) !== -1 && r.res_id !== excludeResId;
    });
    var nights = nightList(arrival, departure).map(function (date) {
      var sold = bookings.filter(function (b) { return b.arrival <= date && date < b.departure; }).length;
      return { date: date, capacity: capacity, sold: sold, available: capacity - sold };
    });
    var min = nights.reduce(function (m, n) { return Math.min(m, n.available); }, Infinity);
    return { nights: nights, minAvailable: nights.length ? min : 0 };
  }

  function assertStayDates(arrival, departure) {
    Dates.assertIsoDate(arrival, 'arrival');
    Dates.assertIsoDate(departure, 'departure');
    var n = Dates.nights(arrival, departure);
    if (n < 1) throw new PmsError('VALIDATION', 'departure must be after arrival');
    if (n > 365) throw new PmsError('VALIDATION', 'stay cannot exceed 365 nights');
    return n;
  }

  function availability(ctx, p) {
    Perm.authorize(ctx, 'RES.VIEW', 'View', p.property_id);
    assertStayDates(p.arrival, p.departure);
    var types = Store.list('Room_Types', function (t) {
      return t.property_id === p.property_id && String(t.active) === 'true' &&
        (!p.room_type_id || t.room_type_id === p.room_type_id);
    });
    return types.map(function (t) {
      var a = availabilityForType(p.property_id, t.room_type_id, p.arrival, p.departure, null);
      return {
        room_type_id: t.room_type_id,
        code: t.code,
        description: t.description,
        base_rate_minor: Number(t.base_rate_minor),
        min_available: a.minAvailable,
        nights: a.nights
      };
    });
  }

  /** Finds a guest by email within the organization, or creates one. */
  function findOrCreateGuest(ctx, orgId, g) {
    var first = Validate.text(g.first_name, 'guest.first_name', 60);
    var last = Validate.text(g.last_name, 'guest.last_name', 60);
    var email = Validate.email(g.email);
    if (email) {
      var existing = Store.list('Guest_Profiles', function (x) {
        return x.org_id === orgId && String(x.email).toLowerCase() === email.toLowerCase();
      })[0];
      if (existing) return existing;
    }
    return Store.insert('Guest_Profiles', {
      org_id: orgId,
      first_name: first,
      last_name: last,
      email: email,
      phone: String(g.phone || '').slice(0, 30),
      nationality: String(g.nationality || '').slice(0, 3).toUpperCase()
    }, ctx.user.user_id);
  }

  function create(ctx, p) {
    var pid = Validate.text(p.property_id, 'property_id', 60);
    Perm.authorize(ctx, 'RES.BOOK', 'Create', pid);
    var property = Store.mustGet('Properties', pid);
    assertStayDates(p.arrival, p.departure);
    if (p.arrival < property.business_date) {
      throw new PmsError('VALIDATION', 'arrival cannot be before the business date ' + property.business_date);
    }
    var type = Store.mustGet('Room_Types', p.room_type_id);
    if (type.property_id !== pid || String(type.active) !== 'true') {
      throw new PmsError('VALIDATION', 'room type is not available for this property');
    }
    var adults = Validate.integer(p.adults === undefined ? 1 : p.adults, 'adults', 1, 20);
    var children = Validate.integer(p.children === undefined ? 0 : p.children, 'children', 0, 20);
    if (adults + children > Number(type.max_occupancy)) {
      throw new PmsError('VALIDATION', 'occupancy exceeds the room type limit');
    }

    var market = p.market_code ? ConfigSvc.findActiveItem(pid, 'MARKET_CODE', String(p.market_code).toUpperCase()).code : '';
    var source = p.source_code ? ConfigSvc.findActiveItem(pid, 'SOURCE_CODE', String(p.source_code).toUpperCase()).code : '';
    var rateCode = p.rate_code ? ConfigSvc.findActiveItem(pid, 'RATE_CODE', String(p.rate_code).toUpperCase()) : null;

    var availability = availabilityForType(pid, type.room_type_id, p.arrival, p.departure, null);
    if (availability.minAvailable < 1) {
      throw new PmsError('NO_AVAILABILITY', 'No ' + type.code + ' rooms available for every night of this stay', 409);
    }

    var rate;
    if (p.rate !== undefined && p.rate !== null && p.rate !== '') {
      rate = Money.parse(p.rate, 'rate');
    } else if (rateCode && rateCode.data.amount !== undefined) {
      rate = Money.parse(String(rateCode.data.amount), 'rate');
    } else {
      rate = Number(type.base_rate_minor);
    }
    if (rate < 0) throw new PmsError('VALIDATION', 'rate cannot be negative');

    var guest = findOrCreateGuest(ctx, property.org_id, p.guest || {});
    var row = Store.insert('Reservations', {
      property_id: pid,
      confirmation_no: Ids.confirmationNo(),
      guest_id: guest.guest_id,
      room_type_id: type.room_type_id,
      room_id: '',
      arrival: p.arrival,
      departure: p.departure,
      status: 'RESERVED',
      rate_code: rateCode ? rateCode.code : '',
      rate_minor: rate,
      currency: property.currency,
      market_code: market,
      source_code: source,
      adults: adults,
      children: children,
      folio_id: '',
      cancel_reason: ''
    }, ctx.user.user_id);
    Audit.record(ctx, 'RES.BOOK', 'CREATE', 'Reservations', row.res_id, null, row, pid);
    return view(row);
  }

  function view(row) {
    var out = Store.publicRow(row);
    var guest = Store.get('Guest_Profiles', row.guest_id);
    out.guest = guest ? Store.publicRow(guest) : null;
    return out;
  }

  function get(ctx, p) {
    var row = Store.mustGet('Reservations', p.res_id);
    Perm.authorize(ctx, 'RES.VIEW', 'View', row.property_id);
    return view(row);
  }

  function list(ctx, p) {
    var pid = Validate.text(p.property_id, 'property_id', 60);
    Perm.authorize(ctx, 'RES.VIEW', 'View', pid);
    var q = String(p.q || '').trim().toLowerCase();
    var rows = Store.list('Reservations', function (r) {
      if (r.property_id !== pid) return false;
      if (p.status && r.status !== p.status) return false;
      if (p.arrival_from && r.arrival < p.arrival_from) return false;
      if (p.arrival_to && r.arrival > p.arrival_to) return false;
      if (q) {
        var guest = Store.get('Guest_Profiles', r.guest_id) || {};
        var hay = [r.confirmation_no, guest.first_name, guest.last_name, guest.email].join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    rows.sort(function (a, b) { return a.arrival < b.arrival ? -1 : a.arrival > b.arrival ? 1 : 0; });
    return Paging.page(rows.map(view), p);
  }

  function modify(ctx, p) {
    var row = Store.mustGet('Reservations', p.res_id);
    Perm.authorize(ctx, 'RES.MODIFY', 'Edit', row.property_id);
    if (row.status !== 'RESERVED') {
      throw new PmsError('INVALID_STATE', 'Only reservations not yet checked in can be modified', 409);
    }
    var arrival = p.arrival || row.arrival;
    var departure = p.departure || row.departure;
    assertStayDates(arrival, departure);
    var typeId = p.room_type_id || row.room_type_id;
    var type = Store.mustGet('Room_Types', typeId);
    if (type.property_id !== row.property_id) throw new PmsError('VALIDATION', 'room type belongs to another property');
    var a = availabilityForType(row.property_id, typeId, arrival, departure, row.res_id);
    if (a.minAvailable < 1) {
      throw new PmsError('NO_AVAILABILITY', 'No ' + type.code + ' rooms available for the new dates', 409);
    }
    var patch = { arrival: arrival, departure: departure, room_type_id: typeId };
    if (p.rate !== undefined) patch.rate_minor = Money.parse(p.rate, 'rate');
    var result = Store.update('Reservations', row.res_id, patch, p.version, ctx.user.user_id);
    Audit.record(ctx, 'RES.MODIFY', 'UPDATE', 'Reservations', row.res_id, result.before, result.after, row.property_id);
    return view(result.after);
  }

  function cancel(ctx, p) {
    var row = Store.mustGet('Reservations', p.res_id);
    Perm.authorize(ctx, 'RES.CANCEL', 'Delete', row.property_id);
    if (row.status !== 'RESERVED') {
      throw new PmsError('INVALID_STATE', 'Only reservations not yet checked in can be cancelled', 409);
    }
    // A folio exists only after check-in, so a reserved booking never has a balance to settle.
    var reason = Validate.text(p.reason, 'reason', 200);
    var result = Store.update('Reservations', row.res_id,
      { status: 'CANCELLED', cancel_reason: reason }, p.version, ctx.user.user_id);
    Audit.record(ctx, 'RES.CANCEL', 'CANCEL', 'Reservations', row.res_id, result.before, result.after, row.property_id);
    return view(result.after);
  }

  function noShow(ctx, p) {
    var row = Store.mustGet('Reservations', p.res_id);
    Perm.authorize(ctx, 'RES.CANCEL', 'Edit', row.property_id);
    if (row.status !== 'RESERVED') throw new PmsError('INVALID_STATE', 'Only reserved bookings can be no-shows', 409);
    if (row.arrival > propertyBusinessDate(row.property_id)) {
      throw new PmsError('INVALID_STATE', 'A booking can be a no-show only on or after its arrival date', 409);
    }
    var result = Store.update('Reservations', row.res_id, { status: 'NO_SHOW' }, p.version, ctx.user.user_id);
    Audit.record(ctx, 'RES.CANCEL', 'NO_SHOW', 'Reservations', row.res_id, result.before, result.after, row.property_id);
    return view(result.after);
  }

  function guestsSearch(ctx, p) {
    Perm.authorize(ctx, 'RES.VIEW', 'View');
    var q = String(p.q || '').trim().toLowerCase();
    if (q.length < 2) throw new PmsError('VALIDATION', 'search needs at least 2 characters');
    var orgId = Perm.isSystemUser(ctx.user) ? (p.org_id || '') : ctx.user.org_id;
    var rows = Store.list('Guest_Profiles', function (g) {
      if (orgId && g.org_id !== orgId) return false;
      return [g.first_name, g.last_name, g.email].join(' ').toLowerCase().indexOf(q) !== -1;
    });
    return Paging.page(Store.publicRows(rows), p);
  }

  return {
    availability: availability, availabilityForType: availabilityForType, nightList: nightList,
    create: create, get: get, list: list, modify: modify, cancel: cancel, noShow: noShow,
    guestsSearch: guestsSearch, assertStayDates: assertStayDates, propertyBusinessDate: propertyBusinessDate
  };
})();
