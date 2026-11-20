/**
 * Housekeeping tasks and lost and found.
 *
 * A housekeeping task is assigned work on one room for one business date.
 * Completing a CLEAN or INSPECT task also sets the room's housekeeping status,
 * so the front desk sees the room as ready. TURNDOWN tasks do not change the room.
 * Completing a task needs the task grant and the front-office housekeeping grant.
 *
 * Lost and found items move HELD -> CLAIMED (needs a claimant) or HELD -> DISPOSED.
 */

var Housekeeping = (function () {
  var TASK_TYPES = ['CLEAN', 'INSPECT', 'TURNDOWN'];
  var TASK_STATUS = ['OPEN', 'DONE'];
  var ROOM_STATUS_AFTER = { CLEAN: 'CLEAN', INSPECT: 'INSPECTED' };
  var ITEM_STATUS = ['HELD', 'CLAIMED', 'DISPOSED'];

  function optionalText(value, field, max) {
    if (value === undefined || value === null) return '';
    return Validate.text(value, field, max).slice(0, max);
  }

  // ---- Tasks ---------------------------------------------------------------

  function tasksList(ctx, p) {
    var pid = Validate.text(p.property_id, 'property_id', 60);
    Perm.authorize(ctx, 'HK.TASKS', 'View', pid);
    var date = p.date ? Dates.assertIsoDate(p.date, 'date') : Reservations.propertyBusinessDate(pid);
    var status = p.status ? Validate.oneOf(String(p.status).toUpperCase(), 'status', TASK_STATUS) : null;
    var rows = Store.list('Housekeeping_Tasks', function (t) {
      return t.property_id === pid && t.business_date === date && (!status || t.status === status);
    });
    var rooms = {};
    Store.list('Rooms', function (r) { return r.property_id === pid; }).forEach(function (r) { rooms[r.room_id] = r; });
    rows.sort(function (a, b) {
      var ra = rooms[a.room_id] ? rooms[a.room_id].room_number : '';
      var rb = rooms[b.room_id] ? rooms[b.room_id].room_number : '';
      return ra < rb ? -1 : ra > rb ? 1 : 0;
    });
    return Paging.page(rows.map(function (t) {
      return Object.assign(Store.publicRow(t), {
        room_number: rooms[t.room_id] ? rooms[t.room_id].room_number : ''
      });
    }), p);
  }

  function tasksCreate(ctx, p) {
    var pid = Validate.text(p.property_id, 'property_id', 60);
    Perm.authorize(ctx, 'HK.TASKS', 'Create', pid);
    var room = Store.mustGet('Rooms', p.room_id);
    if (room.property_id !== pid) throw new PmsError('VALIDATION', 'room belongs to another property');
    var date = p.business_date ? Dates.assertIsoDate(p.business_date, 'business_date') : Reservations.propertyBusinessDate(pid);
    var row = Store.insert('Housekeeping_Tasks', {
      property_id: pid,
      room_id: room.room_id,
      business_date: date,
      task_type: Validate.oneOf(p.task_type, 'task_type', TASK_TYPES),
      assigned_to: optionalText(p.assigned_to, 'assigned_to', 120),
      status: 'OPEN',
      completed_at: ''
    }, ctx.user.user_id);
    Audit.record(ctx, 'HK.TASKS', 'CREATE', 'Housekeeping_Tasks', row.task_id, null, row, pid);
    return Store.publicRow(row);
  }

  function tasksComplete(ctx, p) {
    var task = Store.mustGet('Housekeeping_Tasks', p.task_id);
    Perm.authorize(ctx, 'HK.TASKS', 'Edit', task.property_id);
    Perm.authorize(ctx, 'FO.HOUSEKEEPING', 'Edit', task.property_id);
    if (task.status !== 'OPEN') throw new PmsError('INVALID_STATE', 'This task is already done', 409);
    var done = Store.update('Housekeeping_Tasks', task.task_id,
      { status: 'DONE', completed_at: Dates.now() }, p.version, ctx.user.user_id);
    Audit.record(ctx, 'HK.TASKS', 'COMPLETE', 'Housekeeping_Tasks', task.task_id, done.before, done.after, task.property_id);

    var roomStatus = ROOM_STATUS_AFTER[task.task_type];
    if (roomStatus) {
      var room = Store.mustGet('Rooms', task.room_id);
      var roomResult = Store.update('Rooms', room.room_id, { housekeeping_status: roomStatus }, null, ctx.user.user_id);
      Audit.record(ctx, 'FO.HOUSEKEEPING', 'UPDATE', 'Rooms', room.room_id, roomResult.before, roomResult.after, task.property_id);
    }
    return Store.publicRow(done.after);
  }

  // ---- Lost and found ------------------------------------------------------

  function lostList(ctx, p) {
    var pid = Validate.text(p.property_id, 'property_id', 60);
    Perm.authorize(ctx, 'HK.LOST', 'View', pid);
    var status = p.status ? Validate.oneOf(String(p.status).toUpperCase(), 'status', ITEM_STATUS) : null;
    var rows = Store.list('Lost_Found', function (i) {
      return i.property_id === pid && (!status || i.status === status);
    });
    rows.sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; });
    return Paging.page(Store.publicRows(rows), p);
  }

  function lostCreate(ctx, p) {
    var pid = Validate.text(p.property_id, 'property_id', 60);
    Perm.authorize(ctx, 'HK.LOST', 'Create', pid);
    var row = Store.insert('Lost_Found', {
      property_id: pid,
      description: Validate.text(p.description, 'description', 200),
      location: optionalText(p.location, 'location', 120),
      found_on: p.found_on ? Dates.assertIsoDate(p.found_on, 'found_on') : Reservations.propertyBusinessDate(pid),
      status: 'HELD',
      claimed_by: '',
      claimed_at: '',
      notes: optionalText(p.notes, 'notes', 300)
    }, ctx.user.user_id);
    Audit.record(ctx, 'HK.LOST', 'CREATE', 'Lost_Found', row.item_id, null, row, pid);
    return Store.publicRow(row);
  }

  function lostUpdate(ctx, p) {
    var item = Store.mustGet('Lost_Found', p.item_id);
    Perm.authorize(ctx, 'HK.LOST', 'Edit', item.property_id);
    if (item.status !== 'HELD') throw new PmsError('INVALID_STATE', 'This item is already ' + item.status, 409);
    var next = Validate.oneOf(String(p.status || '').toUpperCase(), 'status', ['CLAIMED', 'DISPOSED']);
    var patch = { status: next, notes: optionalText(p.notes, 'notes', 300) || item.notes };
    if (next === 'CLAIMED') {
      patch.claimed_by = Validate.text(p.claimed_by, 'claimed_by', 120);
      patch.claimed_at = Dates.now();
    }
    var result = Store.update('Lost_Found', item.item_id, patch, p.version, ctx.user.user_id);
    Audit.record(ctx, 'HK.LOST', 'UPDATE', 'Lost_Found', item.item_id, result.before, result.after, item.property_id);
    return Store.publicRow(result.after);
  }

  return {
    tasksList: tasksList, tasksCreate: tasksCreate, tasksComplete: tasksComplete,
    lostList: lostList, lostCreate: lostCreate, lostUpdate: lostUpdate,
    TASK_TYPES: TASK_TYPES
  };
})();
