/**
 * Engineering: maintenance requests. A request can be tied to a room or to the
 * property in general. Its status moves one way through a fixed set of steps.
 *
 *   OPEN -> IN_PROGRESS -> DONE
 *   OPEN or IN_PROGRESS -> CANCELLED
 *   DONE and CANCELLED are final.
 *
 * A request cannot be marked DONE without a resolution note.
 */

var Engineering = (function () {
  var CATEGORIES = ['ELECTRICAL', 'PLUMBING', 'HVAC', 'FURNITURE', 'APPLIANCE', 'OTHER'];
  var PRIORITIES = ['LOW', 'NORMAL', 'URGENT'];
  var STATUSES = ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'];
  var NEXT = {
    OPEN: ['IN_PROGRESS', 'CANCELLED'],
    IN_PROGRESS: ['OPEN', 'DONE', 'CANCELLED'],
    DONE: [],
    CANCELLED: []
  };

  function optionalText(value, field, max) {
    if (value === undefined || value === null) return '';
    return Validate.text(value, field, max).slice(0, max);
  }

  function list(ctx, p) {
    var pid = Validate.text(p.property_id, 'property_id', 60);
    Perm.authorize(ctx, 'ENG.REQUEST', 'View', pid);
    var status = p.status ? Validate.oneOf(String(p.status).toUpperCase(), 'status', STATUSES) : null;
    var roomId = p.room_id || null;
    var rows = Store.list('Maintenance_Requests', function (r) {
      return r.property_id === pid && (!status || r.status === status) && (!roomId || r.room_id === roomId);
    });
    var rank = { URGENT: 0, NORMAL: 1, LOW: 2 };
    rows.sort(function (a, b) {
      if (a.status !== b.status && (a.status === 'DONE' || b.status === 'DONE')) return a.status === 'DONE' ? 1 : -1;
      if (rank[a.priority] !== rank[b.priority]) return rank[a.priority] - rank[b.priority];
      return a.created_at < b.created_at ? -1 : 1;
    });
    return Paging.page(Store.publicRows(rows), p);
  }

  function create(ctx, p) {
    var pid = Validate.text(p.property_id, 'property_id', 60);
    Perm.authorize(ctx, 'ENG.REQUEST', 'Create', pid);
    var roomId = '';
    if (p.room_id) {
      var room = Store.mustGet('Rooms', p.room_id);
      if (room.property_id !== pid) throw new PmsError('VALIDATION', 'room belongs to another property');
      roomId = room.room_id;
    }
    var row = Store.insert('Maintenance_Requests', {
      property_id: pid,
      room_id: roomId,
      category: Validate.oneOf(p.category, 'category', CATEGORIES),
      priority: Validate.oneOf(p.priority || 'NORMAL', 'priority', PRIORITIES),
      description: Validate.text(p.description, 'description', 500),
      status: 'OPEN',
      assigned_to: optionalText(p.assigned_to, 'assigned_to', 120),
      resolution: '',
      completed_at: ''
    }, ctx.user.user_id);
    Audit.record(ctx, 'ENG.REQUEST', 'CREATE', 'Maintenance_Requests', row.request_id, null, row, pid);
    return Store.publicRow(row);
  }

  function update(ctx, p) {
    var req = Store.mustGet('Maintenance_Requests', p.request_id);
    Perm.authorize(ctx, 'ENG.REQUEST', 'Edit', req.property_id);
    var patch = {};
    if (p.status !== undefined) {
      var next = Validate.oneOf(String(p.status).toUpperCase(), 'status', STATUSES);
      if (next !== req.status) {
        if (NEXT[req.status].indexOf(next) === -1) {
          throw new PmsError('INVALID_STATE', 'A ' + req.status + ' request cannot move to ' + next, 409);
        }
        patch.status = next;
        patch.completed_at = (next === 'DONE' || next === 'CANCELLED') ? Dates.now() : '';
      }
    }
    if (p.assigned_to !== undefined) patch.assigned_to = optionalText(p.assigned_to, 'assigned_to', 120);
    if (p.resolution !== undefined) patch.resolution = optionalText(p.resolution, 'resolution', 500);
    var finalStatus = patch.status || req.status;
    var finalResolution = patch.resolution !== undefined ? patch.resolution : req.resolution;
    if (finalStatus === 'DONE' && !finalResolution) {
      throw new PmsError('VALIDATION', 'Add a resolution note before marking the request done');
    }
    var result = Store.update('Maintenance_Requests', req.request_id, patch, p.version, ctx.user.user_id);
    Audit.record(ctx, 'ENG.REQUEST', 'UPDATE', 'Maintenance_Requests', req.request_id, result.before, result.after, req.property_id);
    return Store.publicRow(result.after);
  }

  return { list: list, create: create, update: update, CATEGORIES: CATEGORIES, PRIORITIES: PRIORITIES, STATUSES: STATUSES };
})();
