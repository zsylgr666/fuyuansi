  function receiptRows(v) {
    if (Array.isArray(v)) return v.filter(function (x) { return x && typeof x === 'object' && typeof x.req === 'string'; });
    if (v && typeof v === 'object') return Object.keys(v).map(function (k) { var x = v[k]; return x && typeof x === 'object' ? x : null; }).filter(function (x) { return x && typeof x.req === 'string'; });
    return [];
  }
  function appliedSet(v) {
    var o = {};
    if (Array.isArray(v)) v.forEach(function (x) { if (typeof x === 'string' && x) o[x] = 1; });
    else if (v && typeof v === 'object') Object.keys(v).forEach(function (k) { if (k && v[k]) o[k] = 1; });
    return o;
  }
  function unionApplied(b, l, s) {
    var o = {};
    [b, l, s].forEach(function (v) { var a = appliedSet(v); Object.keys(a).forEach(function (k) { o[k] = 1; }); });
    return o;
  }
  function unionPending(l, s, applied) {
    var o = {};
    receiptRows(l).concat(receiptRows(s)).forEach(function (rec) { if (rec.req && !applied[rec.req]) o[rec.req] = rec; });
    return o;
  }
  function floorReserved(out, base, local, server, pending) {
    var ids = {};
    Object.keys(pending).forEach(function (req) { if (pending[req] && pending[req].id) ids[pending[req].id] = 1; });
    if (!Object.keys(ids).length) return;
    if (!out.inventory || typeof out.inventory !== 'object' || Array.isArray(out.inventory)) out.inventory = {};
    Object.keys(ids).forEach(function (id) {
      var nums = [];
      [base, local, server].forEach(function (st) {
        var inv = st && st.inventory;
        if (inv && typeof inv[id] === 'number' && Number.isSafeInteger(inv[id]) && inv[id] >= 0) nums.push(inv[id]);
      });
      if (nums.length) out.inventory[id] = Math.min.apply(null, nums);
    });
  }
  function merge3(base, local, server, depth) {
    depth = depth || 0;
    if (server == null) return clone(local);
    if (base == null || local == null) {
      if (depth === 0 && base == null && local && server) {
        var seeded = clone(server);
        var applied0 = unionApplied(null, local.cropApplied, server.cropApplied);
        var pending0 = unionPending(local.cropPending, server.cropPending, applied0);
        if (Object.keys(applied0).length) seeded.cropApplied = applied0; else delete seeded.cropApplied;
        if (Object.keys(pending0).length) seeded.cropPending = pending0; else delete seeded.cropPending;
        floorReserved(seeded, {}, local, server, pending0);
        return seeded;
      }
      return clone(server);
    }
    if (same(local, base)) return clone(server);
    if (same(server, base)) return clone(local);
    if (Array.isArray(server) && Array.isArray(local) && Array.isArray(base) && depth === 1 && server.length === local.length && local.length === base.length) {
      return server.map(function (sv, i) { return same(local[i], base[i]) ? clone(sv) : same(sv, base[i]) ? clone(local[i]) : clone(sv); });
    }
    if (!isObj(server) || !isObj(local) || !isObj(base) || depth > 3) return clone(server);
    var out = {}, keys = {};
    [base, local, server].forEach(function (o) { Object.keys(o).forEach(function (k) { keys[k] = 1; }); });
    Object.keys(keys).forEach(function (k) {
      if (k === '_savedAt' || k === '_wid') return;
      var b = base[k], l = local[k], s = server[k];
      if (depth === 0 && k === 'cropApplied') { out[k] = unionApplied(b, l, s); return; }
      if (depth === 0 && k === 'cropPending') return;
      var v = (k === 'plots' && depth === 0) ? merge3(b, l, s, 1) : (same(l, b) ? s : same(s, b) ? l : merge3(b, l, s, depth + 1));
      if (v !== undefined) out[k] = clone(v);
    });
    if (depth === 0) {
      var applied = out.cropApplied || unionApplied(base.cropApplied, local.cropApplied, server.cropApplied);
      if (applied && Object.keys(applied).length) out.cropApplied = applied; else delete out.cropApplied;
      var pending = unionPending(local.cropPending, server.cropPending, applied || {});
      if (Object.keys(pending).length) out.cropPending = pending; else delete out.cropPending;
      floorReserved(out, base, local, server, pending);
    }
    out._savedAt = Date.now();
    return out;
  }

