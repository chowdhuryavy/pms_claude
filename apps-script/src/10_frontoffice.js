/**
 * Front Office: room rack, arrivals and departures, check-in, check-out,
 * and room status for housekeeping and out-of-order control.
 */

var FrontOffice = (function () {
  var HK_STATUSES = ['CLEAN', 'DIRTY', 'INSPECTED'];

  /** A room is taken if an in-house guest is still in it on the business date. */
  function roomOccupiedOn(roomId, arrival, departure, excludeResId) {
    return Store.list('Reservations', function (r) {
      return r.room_id === roomId && r.res_id !== excludeResId &&
        (r.status === 'IN_HOUSE' || r.status === 'RESERVED') &&
        Dates.overlaps(arrival, departure, r.arrival, r.departure);
    }).length > 0;
  }

  function assertRoomFree(room, res) {
    if (room.status !== 'ACTIVE') throw new PmsError('ROOM_UNAVAILABLE', 'Room ' + room.room_number + ' is out of order', 409);
    if (room.room_type_id !== res.room_type_id) {
      throw new PmsError('ROOM_TYPE_MISMATCH', 'Room ' + room.room_number + ' is not of the booked room type', 409);
    }
    if (roomOccupiedOn(room.room_id, res.arrival, res.departure, res.res_id)) {
      throw new PmsError('ROOM_UNAVAILABLE', 'Room ' + room.room_number + ' is already assigned for these dates', 409);
    }
  }

  function autoAssignRoom(res) {
    var rooms = Store.list('Rooms', function (r) {
      return r.property_id === res.property_id && r.room_type_id === res.room_type_id;
    }).sort(function (a, b) { return a.room_number < b.room_number ? -1 : 1; });
    for (var i = 0; i < rooms.length; i++) {
      var r = rooms[i];
      if (r.status !== 'ACTIVE' || HK_STATUSES.indexOf(r.housekeeping_status) === -1) continue;
      if (r.housekeeping_status === 'DIRTY') continue;
      if (!roomOccupiedOn(r.room_id, res.arrival, res.departure, res.res_id)) return r;
    }
    throw new PmsError('NO_ROOM', 'No clean, free room of this type is available', 409);
  }

  function checkIn(ctx, p) {
    var res = Store.mustGet('Reservations', p.res_id);
    Perm.authorize(ctx, 'FO.CHECKIN', 'Create', res.property_id);
    if (res.status !== 'RESERVED') throw new PmsError('INVALID_STATE', 'Reservation is ' + res.status, 409);
    var bizDate = Reservations.propertyBusinessDate(res.property_id);
    if (res.arrival > bizDate) throw new PmsError('INVALID_STATE', 'Arrival is ' + res.arrival + '. Check-in opens on that date.', 409);
    if (res.departure <= bizDate) throw new PmsError('INVALID_STATE', 'Departure date has passed', 409);

    var room;
    if (p.room_id) {
      room = Store.mustGet('Rooms', p.room_id);
      if (room.property_id !== res.property_id) throw new PmsError('VALIDATION', 'room belongs to another property');
      assertRoomFree(room, res);
    } else {
      room = autoAssignRoom(res);
    }
    if (room.housekeeping_status === 'DIRTY') {
      throw new PmsError('HK_NOT_READY', 'Room ' + room.room_number + ' is dirty. Clean it before check-in.', 409);
    }

    var before = Store.publicRow(res);
    var updated = Store.update('Reservations', res.res_id,
      { status: 'IN_HOUSE', room_id: room.room_id }, p.version, ctx.user.user_id);
    var folio = Cashier.openFolio(ctx, updated.after);
    Audit.record(ctx, 'FO.CHECKIN', 'CHECK_IN', 'Reservations', res.res_id, before,
      { room_id: room.room_id, folio_id: folio.folio_id }, res.property_id);
    return { res_id: res.res_id, room_number: room.room_number, folio_id: folio.folio_id, folio_no: folio.folio_no };
  }

  function checkOut(ctx, p) {
    var res = Store.mustGet('Reservations', p.res_id);
    Perm.authorize(ctx, 'FO.CHECKOUT', 'Create', res.property_id);
    if (res.status !== 'IN_HOUSE') throw new PmsError('INVALID_STATE', 'Reservation is ' + res.status, 409);
    var balance = res.folio_id ? Cashier.folioBalance(res.folio_id) : 0;
    if (balance !== 0) {
      throw new PmsError('BALANCE_DUE', 'Balance due ' + Money.format(balance) + '. Settle the folio before check-out.', 409);
    }
    // Early departure shortens the stay to today. Nights already audited stay charged.
    // Night audit only charges nights before the departure date, so no unaudited night is lost.
    var bizDate = Reservations.propertyBusinessDate(res.property_id);
    var patch = { status: 'CHECKED_OUT' };
    if (res.departure > bizDate) patch.departure = bizDate;
    var updated = Store.update('Reservations', res.res_id, patch, p.version, ctx.user.user_id);
    if (res.folio_id) {
      Store.update('Folios', res.folio_id, { status: 'CLOSED' }, null, ctx.user.user_id);
    }
    if (res.room_id) {
      Store.update('Rooms', res.room_id, { housekeeping_status: 'DIRTY' }, null, ctx.user.user_id);
    }
    Audit.record(ctx, 'FO.CHECKOUT', 'CHECK_OUT', 'Reservations', res.res_id, res, updated.after, res.property_id);
    return { res_id: res.res_id, status: 'CHECKED_OUT' };
  }

  function setRoomStatus(ctx, p) {
    var room = Store.mustGet('Rooms', p.room_id);
    Perm.authorize(ctx, 'FO.HOUSEKEEPING', 'Edit', room.property_id);
    var patch = {};
    if (p.housekeeping_status !== undefined) {
      patch.housekeeping_status = Validate.oneOf(p.housekeeping_status, 'housekeeping_status', HK_STATUSES);
    }
    if (p.status !== undefined) {
      patch.status = Validate.oneOf(p.status, 'status', ['ACTIVE', 'OUT_OF_ORDER']);
      if (patch.status === 'OUT_OF_ORDER') {
        var occupied = Store.list('Reservations', function (r) {
          return r.room_id === room.room_id && r.status === 'IN_HOUSE';
        }).length > 0;
        if (occupied) {
          throw new PmsError('ROOM_OCCUPIED', 'Room is occupied. Move the guest before marking it out of order.', 409);
        }
      }
    }
    var result = Store.update('Rooms', room.room_id, patch, p.version, ctx.user.user_id);
    Audit.record(ctx, 'FO.HOUSEKEEPING', 'UPDATE', 'Rooms', room.room_id, result.before, result.after, room.property_id);
    return Store.publicRow(result.after);
  }

  function rack(ctx, p) {
    var pid = Validate.text(p.property_id, 'property_id', 60);
    Perm.authorize(ctx, 'FO.RACK', 'View', pid);
    var bizDate = Reservations.propertyBusinessDate(pid);
    var types = {};
    Store.list('Room_Types', function (t) { return t.property_id === pid; }).forEach(function (t) { types[t.room_type_id] = t; });
    var inHouse = Store.list('Reservations', function (r) { return r.property_id === pid && r.status === 'IN_HOUSE'; });
    var rooms = Store.list('Rooms', function (r) { return r.property_id === pid; });
    rooms.sort(function (a, b) { return a.room_number < b.room_number ? -1 : 1; });
    var rows = rooms.map(function (room) {
      var occupant = inHouse.filter(function (r) { return r.room_id === room.room_id; })[0] || null;
      return {
        room_id: room.room_id,
        room_number: room.room_number,
        floor: room.floor,
        room_type: types[room.room_type_id] ? types[room.room_type_id].code : '',
        status: room.status,
        housekeeping_status: room.housekeeping_status,
        occupied: !!occupant,
        res_id: occupant ? occupant.res_id : null,
        departure: occupant ? occupant.departure : null
      };
    });
    var summary = {
      business_date: bizDate,
      rooms: rows.length,
      in_house: inHouse.length,
      vacant_clean: rows.filter(function (r) { return !r.occupied && r.status === 'ACTIVE' && r.housekeeping_status !== 'DIRTY'; }).length,
      vacant_dirty: rows.filter(function (r) { return !r.occupied && r.status === 'ACTIVE' && r.housekeeping_status === 'DIRTY'; }).length,
      out_of_order: rows.filter(function (r) { return r.status !== 'ACTIVE'; }).length,
      arrivals: Store.list('Reservations', function (r) { return r.property_id === pid && r.status === 'RESERVED' && r.arrival === bizDate; }).length,
      departures: inHouse.filter(function (r) { return r.departure === bizDate; }).length
    };
    return { summary: summary, rooms: rows };
  }

  function arrivalsOrDepartures(ctx, p, mode) {
    var pid = Validate.text(p.property_id, 'property_id', 60);
    Perm.authorize(ctx, 'FO.RACK', 'View', pid);
    var date = p.date ? Dates.assertIsoDate(p.date, 'date') : Reservations.propertyBusinessDate(pid);
    var rows = Store.list('Reservations', function (r) {
      if (r.property_id !== pid) return false;
      if (mode === 'arrivals') return r.status === 'RESERVED' && r.arrival === date;
      return r.status === 'IN_HOUSE' && r.departure === date;
    });
    return Paging.page(rows.map(function (r) {
      var g = Store.get('Guest_Profiles', r.guest_id) || {};
      return Object.assign(Store.publicRow(r), {
        guest_name: [g.first_name, g.last_name].join(' ').trim()
      });
    }), p);
  }

  function arrivals(ctx, p) { return arrivalsOrDepartures(ctx, p, 'arrivals'); }
  function departures(ctx, p) { return arrivalsOrDepartures(ctx, p, 'departures'); }

  return {
    checkIn: checkIn, checkOut: checkOut, setRoomStatus: setRoomStatus, rack: rack,
    arrivals: arrivals, departures: departures, roomOccupiedOn: roomOccupiedOn, HK_STATUSES: HK_STATUSES
  };
})();
