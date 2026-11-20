/**
 * Audit trail and paging helpers.
 */

var Audit = (function () {
  function record(ctx, fnId, action, entity, entityId, before, after, propertyId) {
    Store.insert('Audit_Log', {
      at: Dates.now(),
      user_id: ctx && ctx.user ? ctx.user.user_id : 'SYSTEM',
      property_id: propertyId || '',
      function_id: fnId || '',
      action: action,
      entity: entity,
      entity_id: entityId || '',
      before_json: before === undefined || before === null ? '' : JSON.stringify(before),
      after_json: after === undefined || after === null ? '' : JSON.stringify(after)
    }, ctx && ctx.user ? ctx.user.user_id : 'SYSTEM');
  }

  return { record: record };
})();

var Paging = (function () {
  /** Offset cursor paging. Server caps page size. */
  function window(params) {
    var size = Number(params && params.limit) || CFG.PAGE_SIZE_DEFAULT;
    size = Math.min(Math.max(1, size), CFG.PAGE_SIZE_MAX);
    var offset = Math.max(0, Number(params && params.offset) || 0);
    return { size: size, offset: offset };
  }

  function page(items, params) {
    var w = window(params);
    var slice = items.slice(w.offset, w.offset + w.size);
    return {
      items: slice,
      total: items.length,
      offset: w.offset,
      limit: w.size,
      next_offset: w.offset + w.size < items.length ? w.offset + w.size : null
    };
  }

  return { page: page, window: window };
})();
