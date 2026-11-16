/*!
 * 福缘里 tg-r6.js — round 6 backend client. Needs backend/r6.sql. Load AFTER the game script + tg-backend.js.
 * API only (the game draws the UI) plus a small fallback panel for the 茶馆 wall: TG_TEAHOUSE.open().
 *
 * window.TG_AVATAR_NET   捏人 / 饰品 / 头衔 persistence + purchases (codex2's avatar.js owns window.TG_AVATAR = the 3D model) (server-persisted; others see it via presence + server copy)
 *   load() -> Promise<{avatar, title, title_name, owned[], catalog[], mounts, merit_spent}>   (also runs after login)
 *   mine() / owned() / catalog()           cached values (catalog: [{id, kind:'accessory'|'title', name, emoji, price}])
 *   save(config | TG_AVATAR.serialize() wire, titleId|null) -> Promise<{ok, reason?}>   normalized with TG_AVATAR before sending;
 *        equipped accessories = config.acc, equipped title = avatars.title, owned list = server avatar_owned (all separate from appearance)
 *        paid parts (acc.neck='beads', acc.head='hairpin', acc.waist='jade', acc.back='cape') need ownership;
 *        config.title must be '' or the name of an owned title (or pass titleId); config.name is text-filtered (<=12)
 *        reasons: not_owned | title_not_owned | bad_name | bad_title | bad_acc | bad_value | bad_key | too_big
 *   locked(slot, part) -> null | {id, price, name}   paid part not owned yet (for the 捏脸 panel)
 *   titles() -> [{id, name, emoji, price, owned}]
 *   buy(itemId) -> Promise<{ok, item, kind, price, replay?} | {ok:false, reason}>   accessories/titles ('jade' = 'jade_pendant');
 *        same purchase path as TG_MERIT.spend (see there)
 *   of(userId) -> {avatar, title, title_name, title_emoji, mounts} | null   (server-validated; fetched lazily)
 *   TG_NET.players()[i] gains: avatar (trusted config), avatarWire (TG_AVATAR.serialize of it -> deserialize+build/update),
 *        title (display name), titleId, titleEmoji, nameWithTitle, mount (TG_MOUNTS.fromJSON-able {kind,deco,id,passenger}; non-null only while riding)
 *   window event 'tg-avatar' {detail:{type:'loaded'|'saved'|'bought'|'others', ...}}
 * window.TG_MERIT    every 功德 purchase (r6.1): decor, white_horse/white_deer/green_ox, saddle_bell, accessories, titles
 *   spend(itemId) -> Promise<{ok:true, item(canonical id), kind, price, replay?} | {ok:false, reason, price?}>
 *        deducts TG_MERIT_ADD(-serverPrice) first, refunds if refused; grant the item ONLY when ok===true.
 *        reasons: poor | owned | unknown | rate | offline | busy (same item already pending: do NOT grant) | error | bad_req
 *   reasonText(r) -> Chinese toast text   price(id) / id(alias) / busy(id) / bought(id) / load() / catalog()
 * window.TG_MOUNT_NET
 *   buy(kindOrId) -> same as TG_MERIT.spend (whitehorse/white_horse, whitedeer, greenox, saddle_bell)
 *   setRiding(payload|null)   payload = TG_MOUNTS.toJSON(m) + {id, passenger?}; presence 'mount' = {id, kind, deco, decor(=deco), passenger?} ONLY while riding (cleared automatically in hall/zen/study)
 *   save(S.mounts)            persist {owned:[{id,kind,deco (TG_MOUNTS.toJSON().deco; 'decor' accepted),location:'yard-post'|'following'|{scene,x,z}}], riding} (debounced)
 *   requestRide(ownerId) -> Promise<bool>   family-only 黄牛车 passenger request (server checks family); owner gets onRideRequest
 *   onRideRequest(cb(fromId, name)) / leaveRide()
 * window.TG_TEAHOUSE (scene 'teahouse' is always one shared public room)
 *   post(text) -> {ok, id | reason: empty|too_long|link|number|blocked|slow(wait_s)|daily}   wall(limit?, beforeId?) -> [posts]
 *   del(id) / report(id)    (3 reports hide a post)
 *   release(text, color?) -> {ok, left | reason: daily|...}   lanterns() -> 24 h of 河灯
 *   sit(seatId) -> bool (false if taken)   stand()   seats() -> {seatId: {id, name}}   onSeats(cb)   open()  (fallback panel)
 * window.TG_LOTUS    koi() -> SYNC {ok, left, server:Promise | ok:false, reason:'daily'} (3/day; local mirror of the server count; koiAsync() waits)   wish(text) (3/day)   status()
 * window.TG_ECON     earn(coins, source 'sell'|'task'|'merit'|'steal', exact?) -> SYNC granted coins (local mirror of today's server caps,
 *        reported to econ_earn in the background)   earnAsync(...) -> Promise<server-granted coins>   status()
 *   Server caps (r9f): crops/produce have NO daily coin ceiling when econ_status.sell_uncapped is true
 *   (not a larger number). A status may also carry sell_cap/sell_left 100 for already-open r9 pages;
 *   those pages have no unlimited signal, and null sell_left makes them share the 40. This client
 *   ignores the numbers while sell_uncapped is true. sell_uncapped false with a newer sell_epoch revokes
 *   unlimited. A reply with an older sell_epoch, or with no sell_epoch after one was applied, does not move the mode.
 *   task+merit 40 (merit <= 8), stolen 15, furniture sell-back 400 stay.
 *   exact=true: all-or-nothing. Pre-r9 server: 'sell' still shares the 40 (no sell_left and no sell_uncapped).
 *   Legacy r9: numeric sell_left is that day's remaining crop coins (usually a 100 cap). Once this page has
 *   seen sell_uncapped, a later status that merely repeats sell_left does not put 100 back; TG_R9.sell.noteSellStatus
 *   owns that decision. left('sell') is null when uncapped (null here means "no ceiling", and the game checks
 *   policy().uncapped rather than treating null as the old 100).
 *       shopBuy(item, qty) -> Promise   log a coin purchase from the shop (fire-and-forget; same req on retry)
 *       sellback(item, qty, unit, req?) -> Promise<{ok, granted, unit, credit_left, left} | {ok:false, reason, req}>
 *         reason: no_credit | daily_cap | price_changed | not_sellable | bad_qty | offline | old_schema (r9 not installed:
 *         offline rules apply) | error (network: result unknown — do NOT apply locally; retry later with the same req)
 *       sellbackSeed(items) -> Promise (one-time credit for pre-r9 saves; no_save / stale_save = flush the save, retry later)   sellbackCredit() -> Promise<{credit, prices, seeded, left}>
 *   Offline / backend down: returns the full amount (the game's own S.daily caps still apply).
 * Hooks the GAME provides: TG_MERIT_GET() -> number, TG_MERIT_ADD(n) -> bool (n<0 spends; false = no change).
 *   Fallback when missing: S.merit + save().
 */
(function () {
  'use strict';
  if (window.__TG_R6_NET) return; window.__TG_R6_NET = true;   // v4's r6-net.js installs an offline TG_AVATAR_NET stub ({__offline:true}) first; replace it
  var AUTH = window.TG_AUTH, NET = window.TG_NET || {};
  function me() { return AUTH && AUTH.user && AUTH.user.id; }
  // r6.sql not applied yet (PostgREST PGRST202 = function not in schema) -> behave as offline instead of 404-ing on every call;
  // probe again every 10 min so applying r6.sql takes effect without a reload.
  var NO_R6 = 0;
  function online() { return !!(AUTH && AUTH.online && AUTH.user) && !(NO_R6 && Date.now() - NO_R6 < 600000); }
  function rpc(fn, args) {
    var hook = window.TG_R6_RPC || window.TG_GARDEN_RPC;
    if (hook) return Promise.resolve(hook(fn, args || {}));
    return AUTH.client.rpc(fn, args || {}).then(function (r) {
      if (r.error) { if (r.error.code === 'PGRST202' && !NO_R6) { NO_R6 = Date.now(); console.info('[tg-r6] r6 server functions not installed yet; running offline'); } throw r.error; }
      NO_R6 = 0; return r.data;
    });
  }
  function safe(fn) { try { return fn(); } catch (e) {} }
  function fire(type, detail) { safe(function () { window.dispatchEvent(new CustomEvent('tg-avatar', { detail: Object.assign({ type: type }, detail || {}) })); }); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function say(t) { try { toast(t); } catch (e) { console.log('[toast]', t); } }
  function meritGet() {
    if (typeof window.TG_MERIT_GET === 'function') return Number(safe(window.TG_MERIT_GET)) || 0;
    return Number(safe(function () { return S.merit; })) || 0;
  }
  function meritAdd(n) {
    if (typeof window.TG_MERIT_ADD === 'function') return !!safe(function () { return window.TG_MERIT_ADD(n); });
    return !!safe(function () { if (!(S.merit + n >= 0)) return false; S.merit += n; save(); safe(renderTop); return true; });
  }
  // ---- 功德 purchases (r6.1) ----
  // One path for every merit sink (TG_MERIT.spend, TG_AVATAR_NET.buy, TG_MOUNT_NET.buy):
  //  * price from the server list (merit_catalog), aliases jade -> jade_pendant, whitehorse -> white_horse …
  //  * one purchase per item at a time: a second call while the first is pending gets {ok:false, reason:'busy'} (no grant!)
  //  * pay first: TG_MERIT_ADD(-price) must succeed, else 'poor'; refunded if the server refuses
  //  * idempotency key p_req: a network retry can't charge twice (the server replays the first result)
  var PRICES = null, INFLIGHT = {};
  var ALIAS = { jade: 'jade_pendant', whitehorse: 'white_horse', whitedeer: 'white_deer', greenox: 'green_ox', bells: 'saddle_bell' };
  var MERIT_REASON = { poor: '善缘不足', offline: '需联网才能兑换', unknown: '暂未开放', rate: '今日次数已用完', error: '网络异常，请重试',
    owned: '已经拥有了', busy: '正在处理，请稍候', free: '免费，无需购买', bad_req: '请求无效，请重试' };
  function canon(id) { id = String(id || ''); return (PRICES && PRICES.aliases && PRICES.aliases[id]) || ALIAS[id] || id; }
  async function loadPrices() { if (!online()) return PRICES; try { PRICES = await rpc('merit_catalog', {}); } catch (e) {} return PRICES; }
  function priceItem(id) { return PRICES && (PRICES.items || []).find(function (x) { return x.id === id; }) || null; }
  function newReq() { return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  function payMerit(fn, item) {
    var id = canon(item);
    if (INFLIGHT[id]) return Promise.resolve({ ok: false, reason: 'busy', item: id });
    var p = (async function () {
      if (!online()) return { ok: false, reason: 'offline', item: id };
      if (!PRICES) await loadPrices();
      var it = priceItem(id);
      if (!it) return { ok: false, reason: 'unknown', item: id };
      if ((it.kind === 'accessory' || it.kind === 'title') && PRICES.owned && PRICES.owned.indexOf(id) >= 0) return { ok: false, reason: 'owned', item: id };
      var price = it.price, bal = meritGet();
      if (bal < price || !meritAdd(-price)) return { ok: false, reason: 'poor', price: price, item: id };
      var req = newReq(), r = null;
      for (var t = 0; t < 2; t++) {   // one retry with the same key on a network error
        try { r = await rpc(fn, { p_item: id, p_balance: bal, p_req: req }); break; } catch (e) { r = { ok: false, reason: 'error', message: e && e.message }; }
      }
      if (!r || !r.ok) { meritAdd(price); if (r && r.reason === 'unknown') loadPrices(); return r || { ok: false, reason: 'error', item: id }; }
      if (r.price !== price) { meritAdd(price - r.price); loadPrices(); }   // server price wins
      if (r.kind === 'accessory' || r.kind === 'title') {
        if (PRICES.owned && PRICES.owned.indexOf(r.item) < 0) PRICES.owned.push(r.item);
        if (MINE && MINE.owned && MINE.owned.indexOf(r.item) < 0) MINE.owned.push(r.item);
        fire('bought', { item: r.item, price: r.price });
      }
      if (PRICES.bought) PRICES.bought[r.item] = (PRICES.bought[r.item] || 0) + (r.replay ? 0 : 1);
      return r;
    })();
    INFLIGHT[id] = p;
    p.then(function () { delete INFLIGHT[id]; }, function () { delete INFLIGHT[id]; });
    return p;
  }

  /* ---------------- avatars ---------------- */
  var A = window.TG_AVATAR_NET = {};
  var MINE = null, CACHE = {}, WANT = {}, fetchTimer = null;
  A.load = async function () {
    if (!online()) return null;
    try { MINE = await rpc('avatar_me', {}); } catch (e) { console.warn('[TG_AVATAR_NET] load', e && e.message); return null; }
    CACHE[me()] = MINE; publish(); fire('loaded', { me: MINE }); return MINE;
  };
  A.mine = function () { return MINE; };
  A.owned = function () { return MINE ? MINE.owned.slice() : []; };
  A.catalog = function () { return MINE ? MINE.catalog.slice() : []; };
  A.save = async function (avatar, title) {
    if (!online()) return { ok: false, reason: 'offline' };
    // accepts a TG_AVATAR config object or its serialize() wire string; normalized by avatar.js when present
    var AV = window.TG_AVATAR;
    if (typeof avatar === 'string') { try { avatar = AV && AV.deserialize ? AV.deserialize(avatar) : JSON.parse(avatar); } catch (e) { return { ok: false, reason: 'bad_avatar' }; } }
    else if (avatar && AV && AV.normalize) { try { avatar = AV.normalize(avatar); } catch (e) {} }
    var r; try { r = await rpc('avatar_save', { p_avatar: avatar || {}, p_title: title || null }); } catch (e) { r = { ok: false, reason: 'error', message: e && e.message }; }
    if (r && r.ok) { MINE = Object.assign(MINE || {}, r); CACHE[me()] = MINE; publish(); fire('saved', { me: MINE }); syncNick(r, avatar); }
    return r;
  };
  // r8-nick: the 捏人 name (avatar.name) becomes the account nickname while that is still the random default (访客/香客 + digits),
  // so other players see it in presence / 邻居 / 私信 / 家庭. A name chosen via 改名/注册 is never overwritten.
  // Only after a successful avatar_save: the server already ran the text filter on the name (bad_name otherwise).
  var DEFAULT_NICK = /^(访客|香客)\d+$/;
  function syncNick(r, sent) {
    try {
      var AU = window.TG_AUTH; if (!AU || typeof AU.setNickname !== 'function' || !AU.user) return;
      if (!DEFAULT_NICK.test(String(AU.nickname || '').trim())) return;
      var nm = String((r.avatar && typeof r.avatar.name === 'string') ? r.avatar.name : (sent && sent.name) || '').trim();
      if (!nm || DEFAULT_NICK.test(nm) || /^__test/.test(nm)) return;
      Promise.resolve(AU.setNickname(nm)).catch(function (e) { console.warn('[TG_AVATAR_NET] nickname sync', e && e.message); });
    } catch (e) {}
  }
  A._syncNick = syncNick;
  A.buy = async function (id) {   // accessories / titles only (server avatar_buy); same lock / pay-first / idempotency as TG_MERIT.spend
    if (!MINE) await A.load();
    var r = await payMerit('avatar_buy', id);
    if (r.ok && MINE && MINE.owned.indexOf(r.item) < 0) MINE.owned.push(r.item);
    return r;
  };
  A.locked = function (slot, part) {
    var c = (MINE && MINE.catalog || []).find(function (x) { return x.slot === slot && x.part === part && x.price > 0; });
    return c && A.owned().indexOf(c.id) < 0 ? { id: c.id, price: c.price, name: c.name } : null;
  };
  A.titles = function () { return (MINE && MINE.catalog || []).filter(function (c) { return c.kind === 'title'; }).map(function (c) { return { id: c.id, name: c.name, emoji: c.emoji, price: c.price, owned: c.price === 0 || A.owned().indexOf(c.id) >= 0 }; }); };
  A.of = function (id) { if (!id) return null; if (!CACHE[id]) want(id); return CACHE[id] || null; };
  function want(id, rev) { if (!id || (CACHE[id] && (rev == null || CACHE[id].rev >= rev))) return; WANT[id] = 1; clearTimeout(fetchTimer); fetchTimer = setTimeout(fetchWanted, 250); }
  async function fetchWanted() {
    var ids = Object.keys(WANT).slice(0, 100); WANT = {};
    if (!ids.length || !online()) return;
    var r; try { r = await rpc('avatar_get', { p_ids: ids }); } catch (e) { return; }
    ids.forEach(function (id) { CACHE[id] = (r && r[id]) || { avatar: {}, title: null, rev: 0, none: true }; });
    safe(function () { NET._emit && NET._emit(); }); fire('others', { ids: ids });
  }
  // r8remote: appearance keys that make a look "real" (an empty / text-only avatar must not render as everyone's default look)
  var LOOK_KEYS = ['height', 'build', 'skin', 'face', 'hair', 'hairColor', 'outfit', 'color1', 'color2', 'trim', 'capeColor'];
  function hasLook(a) { return !!a && typeof a === 'object' && LOOK_KEYS.some(function (k) { var v = a[k]; return v != null && v !== ''; }); }
  A._hasLook = hasLook;
  function publish() {   // presence: rev + appearance (accessories/title are always taken from the server copy)
    if (!MINE || !NET.setPresence) return;
    var av = Object.assign({}, MINE.avatar || {}); delete av.accessories; delete av.acc; delete av.title; delete av.name;
    if (!hasLook(av)) { NET.setPresence('av', MINE.rev ? { rev: MINE.rev } : null); return; }   // r8remote: no empty look on the wire
    NET.setPresence('av', { rev: MINE.rev || 0, a: av });
  }
  NET.decorate = function (o) {
    var x = o.x || {}, pv = x.av || {}, c = CACHE[o.id];
    if (pv.rev && (!c || (c.rev || 0) < pv.rev)) want(o.id, pv.rev);
    var a = c && !c.none ? c.avatar : null;
    if (pv.a && typeof pv.a === 'object' && (!a || (pv.rev || 0) > (c.rev || 0))) {   // newer look from presence: free appearance keys only
      var f = {}; Object.keys(pv.a).slice(0, 24).forEach(function (k) { var v = pv.a[k]; if (!/^[a-z][a-zA-Z0-9_]{0,23}$/.test(k) || k === 'acc' || k === 'accessories' || k === 'title' || k === 'name') return;
        if ((typeof v === 'string' && /^[A-Za-z0-9#_.-]{0,32}$/.test(v)) || typeof v === 'boolean' || (typeof v === 'number' && isFinite(v))) f[k] = v; });
      var sv = (c && c.avatar) || {};   // paid / text parts always from the server copy
      a = Object.assign(f, { acc: sv.acc || {}, accessories: sv.accessories || [], title: sv.title || '', name: sv.name || '' });
      if (!hasLook(f) && !(c && !c.none)) a = null;   // r8remote: no server save + empty presence look → null (game picks a stable random look)
    }
    o.avatar = a || null;
    o.avatarWire = null;   // TG_AVATAR.serialize() of the trusted merge, ready for deserialize()+build()/update()
    if (a && window.TG_AVATAR && TG_AVATAR.serialize) { try { o.avatarWire = TG_AVATAR.serialize(a); } catch (e) {} }
    o.titleId = c && c.title || null; o.title = c && c.title_name || null; o.titleEmoji = c && c.title_emoji || null;
    if (o.title) o.nameWithTitle = '【' + o.title + '】' + o.name;
  };

  /* ---------------- other merit sinks ---------------- */
  window.TG_MERIT = {
    spend: function (id) { return payMerit('merit_spend', id); },   // any merit item (decor, mount, saddle_bell, accessory, title)
    load: loadPrices,                                                // -> {items:[{id,kind,price,name,emoji,slot,part}], aliases, bought:{id:n}, owned:[]}
    catalog: function () { return PRICES; },
    price: function (id) { var it = priceItem(canon(id)); return it ? it.price : null; },
    id: canon,
    busy: function (id) { return !!INFLIGHT[canon(id)]; },
    bought: function (id) { return (PRICES && PRICES.bought && PRICES.bought[canon(id)]) || 0; },
    reasonText: function (r) { return MERIT_REASON[r && r.reason] || '暂时无法购买'; }
  };

  /* ---------------- mounts ---------------- */
  var INDOOR = { hall: 1, zen: 1, study: 1 };
  var MN = window.TG_MOUNT_NET = {}, riding = null, lastRide = null, mSaveTimer = null, rideCbs = [];
  function cleanDeco(d) { var o = {}; if (!d || typeof d !== 'object') return o; Object.keys(d).slice(0, 8).forEach(function (k) { var v = d[k]; if (/^[a-z][A-Za-z0-9_]{0,23}$/.test(k) && (typeof v === 'boolean' || v === null || (typeof v === 'string' && /^[A-Za-z0-9#_.-]{0,32}$/.test(v)))) o[k] = v; }); return o; }
  MN.setRiding = function (payload) {
    if (payload && riding && JSON.stringify(payload) === lastRide && !INDOOR[NET.scene]) return true;   // per-move tick: unchanged
    lastRide = payload ? JSON.stringify(payload) : null;
    // accepts TG_MOUNTS.toJSON() {kind, deco} plus id/passenger; legacy 'decor' too. Presence carries both deco and decor (same object).
    if (payload && typeof payload === 'object') { var dc = cleanDeco(payload.deco || payload.decor); riding = { id: String(payload.id || payload.kind || '').slice(0, 32), kind: String(payload.kind || '').slice(0, 24), deco: dc, decor: dc, passenger: payload.passenger && typeof payload.passenger === 'object' ? { userId: String(payload.passenger.userId || payload.passenger.id || '').slice(0, 40) } : (typeof payload.passenger === 'string' ? { userId: payload.passenger.slice(0, 40) } : null) }; }
    else riding = null;
    if (riding && INDOOR[NET.scene]) riding = null;
    NET.setPresence && NET.setPresence('mount', riding);
    return !!riding || payload == null;
  };
  MN.riding = function () { return riding; };
  MN.buy = function (kindOrId) { return payMerit('merit_spend', kindOrId); };   // merit mounts / saddle_bell; server records ownership (mounts_save drops unbought ones)
  MN.save = function (mounts) {
    clearTimeout(mSaveTimer);
    return new Promise(function (res) {
      mSaveTimer = setTimeout(async function () {
        if (!online() || !mounts) return res(null);
        var m = { owned: (mounts.owned || []).map(function (o) { return { id: o.id, kind: o.kind, deco: cleanDeco(o.deco || o.decor), location: o.location || 'yard-post' }; }), riding: mounts.riding || null };
        try { res(await rpc('mounts_save', { p_mounts: m })); } catch (e) { res({ ok: false, reason: 'error', message: e && e.message }); }
      }, 400);
    });
  };
  MN.requestRide = async function (ownerId) {
    if (!online() || !ownerId) return false;
    var ok = false; try { ok = await rpc('family_same', { p_other: ownerId }); } catch (e) {}
    if (ok && NET.sendEvent) { NET.sendEvent('ride_req', { owner: ownerId }); NET.setPresence('rideWith', ownerId); }
    return !!ok;
  };
  MN.leaveRide = function () { NET.setPresence && NET.setPresence('rideWith', null); NET.sendEvent && NET.sendEvent('ride_leave', {}); };
  MN.onRideRequest = function (cb) { rideCbs.push(cb); };
  if (NET.onEvent) NET.onEvent(function (ev) {
    if (!ev || ev.type !== 'ride_req' || !ev.data || ev.data.owner !== me()) return;
    rpc('family_same', { p_other: ev.from }).then(function (ok) { if (ok) rideCbs.forEach(function (cb) { safe(function () { cb(ev.from, ev.name); }); }); }, function () {});
  });
  setInterval(function () { if (riding && INDOOR[NET.scene]) MN.setRiding(null); }, 500);   // indoor = dismounted (rule 3)

  /* ---------------- 茶馆 ---------------- */
  var T = window.TG_TEAHOUSE = {}, seatCbs = [], mySeat = null;
  async function call(fn, args) { if (!online()) return { ok: false, reason: 'offline' }; try { return await rpc(fn, args); } catch (e) { return { ok: false, reason: 'error', message: e && e.message }; } }
  T.post = function (text) { return call('tea_post', { p_body: String(text || '') }); };
  T.wall = async function (limit, before) { var r = await call('tea_wall', { p_limit: limit || 50, p_before: before || null }); return Array.isArray(r) ? r : []; };
  T.del = function (id) { return call('tea_delete', { p_id: id }); };
  T.report = function (id) { return call('tea_report', { p_id: id }); };
  T.release = function (text, color) { return call('lantern_release', { p_body: String(text || ''), p_color: color || 'red' }); };
  T.lanterns = async function (limit) { var r = await call('lantern_list', { p_limit: limit || 60 }); return Array.isArray(r) ? r : []; };
  T.seats = function () {
    var out = {}, list = safe(function () { return NET.players(); }) || [];
    list.forEach(function (p) { var s = p.x && p.x.seat; if (!s || !s.id) return; var cur = out[s.id]; if (!cur || (s.at || 0) < cur.at) out[s.id] = { id: p.id, name: p.name, at: s.at || 0 }; });
    if (mySeat && (!out[mySeat.id] || mySeat.at < out[mySeat.id].at)) out[mySeat.id] = { id: me(), name: AUTH.nickname, at: mySeat.at, me: true };
    return out;
  };
  T.sit = function (seatId) {
    seatId = String(seatId || ''); if (!/^[A-Za-z0-9_-]{1,24}$/.test(seatId)) return false;
    var s = T.seats()[seatId]; if (s && !s.me) return false;
    mySeat = { id: seatId, at: Date.now(), scene: NET.scene }; NET.setPresence && NET.setPresence('seat', { id: mySeat.id, at: mySeat.at }); emitSeats(); return true;
  };
  T.stand = function () { mySeat = null; NET.setPresence && NET.setPresence('seat', null); emitSeats(); };
  T.mySeat = function () { return mySeat && mySeat.id; };
  T.onSeats = function (cb) { seatCbs.push(cb); };
  function emitSeats() { var s = T.seats(); seatCbs.forEach(function (cb) { safe(function () { cb(s); }); }); }
  if (NET.onRemotePlayers) NET.onRemotePlayers(function () {
    if (mySeat) { var s = T.seats()[mySeat.id]; if (s && !s.me) { mySeat = null; NET.setPresence('seat', null); say('这个座位刚被人坐了'); } }   // earlier claim wins
    if (mySeat && NET.scene !== mySeat.scene) T.stand();   // left the room
    emitSeats();
  });

  /* ---------------- 荷花池 / 经济 ---------------- */
  // The game calls TG_LOTUS.koi() and TG_ECON.earn() synchronously (r6-net.js), so both answer at once from a local mirror of the
  // server's daily counters (econ_status / lotus_status, refreshed on login, every 5 min and after each call) and report to the
  // server in the background. The server stays authoritative for its own counters; the *Async variants wait for its answer.
  var MIR = { day: null, earn: null, merit: null, steal: null, koi: null, sell: null, sellback: null, r9: false, sellUncapped: false };
  function sday() { return new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10); }
  function mirFresh() { if (MIR.day && MIR.day !== sday()) { MIR = { day: sday(), earn: null, merit: null, steal: null, koi: null, sell: null, sellback: null, r9: MIR.r9, sellUncapped: MIR.sellUncapped }; refreshMir(); } }
  function adoptSell(p) {
    if (!p) return p;
    if (p.uncapped) { MIR.r9 = true; MIR.sellUncapped = true; MIR.sell = null; }
    else if (p.mode === 'r9') { MIR.r9 = true; MIR.sellUncapped = false; if (typeof p.serverLeft === 'number') MIR.sell = p.serverLeft; }
    else { MIR.r9 = false; MIR.sellUncapped = false; MIR.sell = null; }
    return p;
  }
  function boundAcct() { try { var A = window.TG_AUTH; if (!A) return 'default'; var u = A.userId; return u ? String(u) : null; } catch (e) { return null; } }
  async function refreshMir() {
    if (!online()) return;
    var sell = window.TG_R9 && TG_R9.sell;
    if (sell && typeof sell.probe === 'function') { try { await sell.probe(); } catch (x) {} }
    else {
      var who = boundAcct();
      try { var e = await rpc('econ_status', {}); if (boundAcct() !== who) return; if (e && e.day) { MIR.day = e.day; MIR.earn = e.earn_left; MIR.merit = e.merit_coins_left; MIR.steal = e.steal_left;
        MIR.sellback = typeof e.sellback_left === 'number' ? e.sellback_left : null;
        var note = window.TG_R9 && TG_R9.sell && TG_R9.sell.noteSellStatus;
        if (note) adoptSell(note(e, true));
        else { MIR.sellUncapped = e.sell_uncapped === true; MIR.r9 = MIR.sellUncapped || typeof e.sell_left === 'number'; MIR.sell = MIR.sellUncapped ? null : (MIR.r9 ? e.sell_left : null); }
      } } catch (x) {}
    }
    try { var l = await rpc('lotus_status', {}); if (l && l.day) MIR.koi = l.koi_left; } catch (x) {}
  }
  setInterval(refreshMir, 300000);
  function econAsync(coins, source, exact) {
    coins = Math.floor(Number(coins) || 0); if (coins <= 0) return Promise.resolve(0);
    if (!online()) return Promise.resolve(coins);
    var who = boundAcct();
    return call('econ_earn', { p_coins: coins, p_source: source || 'sell', p_exact: !!exact }).then(function (r) {
      // Never invent sell_uncapped:true. A reply applies its own epoch, and an older epoch cannot move the mode.
      // A reply that belongs to the account that was signed in when the call started cannot be applied after a switch.
      if (boundAcct() === who && r && (r.sell_uncapped === true || r.sell_uncapped === false || typeof r.sell_epoch === 'number') && window.TG_R9 && TG_R9.sell && TG_R9.sell.noteSellStatus) TG_R9.sell.noteSellStatus(r);
      if (r && r.reason === 'error') return coins;   // backend down / old schema: client caps only
      // A numeric left must not reintroduce a crop ceiling after sell_uncapped. Task/merit/steal still mirror their own pools.
      if (r && typeof r.left === 'number' && !((source || 'sell') === 'sell' && sellUncapped())) MIR[mirKey(source || 'sell')] = r.left;
      var granted = r && r.granted, gn = typeof granted === 'number' ? granted : Number(granted);
      return Number.isSafeInteger(gn) && gn > 0 ? gn : 0;
    });
  }
  function sellUncapped() { return !!(MIR.sellUncapped || (window.TG_R9 && TG_R9.sell && TG_R9.sell.policy && TG_R9.sell.policy().uncapped)); }
  function mirKey(source) { return source === 'steal' ? 'steal' : (source === 'sell' && (MIR.r9 || sellUncapped())) ? 'sell' : 'earn'; }   // uncapped sell is not the 40 earn pool
  // r9 RPCs: a missing function (r9.sql not applied) must NOT flip NO_R6 (that would park every r6 feature for 10 min)
  var NO_R9 = 0;
  async function call9(fn, args) {
    if (!online()) return { ok: false, reason: 'offline' };
    if (NO_R9 && Date.now() - NO_R9 < 600000) return { ok: false, reason: 'old_schema' };
    try {
      var hook = window.TG_R6_RPC || window.TG_GARDEN_RPC;
      if (hook) return await Promise.resolve(hook(fn, args || {}));
      var r = await AUTH.client.rpc(fn, args || {});
      if (r.error) { if (r.error.code === 'PGRST202') { NO_R9 = Date.now(); return { ok: false, reason: 'old_schema' }; } throw r.error; }
      return r.data;
    } catch (e) { if (e && e.code === 'PGRST202') { NO_R9 = Date.now(); return { ok: false, reason: 'old_schema' }; } return { ok: false, reason: 'error', message: e && e.message }; }
  }
  function newReq(p) { return p + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10); }
  async function call9Retry(fn, args, tries) {   // same p_req on every try: the server replays a committed call instead of doing it twice
    var r;
    for (var i = 0; i < (tries || 3); i++) { r = await call9(fn, args); if (!r || r.reason !== 'error') return r; await new Promise(function (ok) { setTimeout(ok, 600 * (i + 1)); }); }
    return r;
  }
  function koiAsync() { return call('lotus_koi', {}).then(function (r) { if (r && typeof r.left === 'number') MIR.koi = r.left; if (r && r.reason === 'daily') MIR.koi = 0; return r; }); }
  window.TG_LOTUS = {
    koi: function () {   // sync: {ok:false, reason:'daily'} | {ok:true, left, server:Promise}
      mirFresh();
      if (MIR.koi != null && MIR.koi <= 0) return { ok: false, reason: 'daily', left: 0 };
      if (MIR.koi != null) MIR.koi--;
      return { ok: true, left: MIR.koi, server: online() ? koiAsync() : null };
    },
    koiAsync: koiAsync,
    wish: function (t) { return call('lotus_wish', { p_body: String(t || '') }); }, status: function () { return call('lotus_status', {}); } };
  window.TG_ECON = {
    earn: function (coins, source, exact) {   // sync: number of coins granted now (0 = over today's cap). Uncapped crop sales are not clamped.
      coins = Math.floor(Number(coins) || 0); if (coins <= 0) return 0;
      if (!Number.isSafeInteger(coins)) return 0;
      mirFresh(); source = source || 'sell';
      var uncapped = source === 'sell' && sellUncapped();
      var key = mirKey(source), left = uncapped ? null : MIR[key], g = coins;
      if (!uncapped && left != null) g = Math.min(g, Math.max(0, left));
      if (source === 'merit' && MIR.merit != null) g = Math.min(g, Math.max(0, MIR.merit));
      if (g <= 0 || (exact && g < coins)) return 0;
      if (!Number.isSafeInteger(g)) return 0;
      if (!uncapped && left != null) MIR[key] = left - g;
      if (source === 'merit' && MIR.merit != null) MIR.merit -= g;
      if (online()) econAsync(g, source, true).then(function (sv) { if (sv < g) console.warn('[TG_ECON] server granted', sv, 'of', g); });
      return g;
    },
    adoptSell: adoptSell,
    earnAsync: econAsync,
    refreshStatus: refreshMir,
    // Server-mode crop sale. Inventory is already reserved by the game. Coins are added only after this resolves.
    confirmSell: function (rec) {
      var req = rec && rec.req;
      var who = boundAcct();
      return call9Retry('econ_earn', { p_coins: rec && rec.gain, p_source: 'sell', p_exact: true, p_req: req }, 3).then(function (r) {
        // The game applies coins and the epoch only if the same account is still signed in.
        if (boundAcct() !== who) return r || { ok: false, reason: 'error', req: req };
        if (r && (r.sell_uncapped === true || r.sell_uncapped === false || typeof r.sell_epoch === 'number') && window.TG_R9 && TG_R9.sell && TG_R9.sell.noteSellStatus) TG_R9.sell.noteSellStatus(r);
        return r || { ok: false, reason: 'error', req: req };
      });
    },
    status: function () { return call('econ_status', {}); },
    // ---- r9 ----
    left: function (source) {   // today's mirrored allowance. sell returns null when uncapped (no ceiling) and when unknown.
      mirFresh(); source = source || 'sell';
      if (source === 'sell' && sellUncapped()) return null;
      if (source === 'sellback') return MIR.sellback;
      if (source === 'merit') return MIR.merit == null ? null : (MIR.earn == null ? MIR.merit : Math.min(MIR.merit, MIR.earn));
      return MIR[mirKey(source)];
    },
    shopBuy: function (item, qty) {
      qty = Math.floor(Number(qty) || 1);
      return call9Retry('econ_shop_buy', { p_item: String(item || ''), p_qty: qty, p_req: newReq('buy') }, 3);
    },
    sellback: async function (item, qty, unit, req) {
      qty = Math.floor(Number(qty) || 1); req = req || newReq('sell');
      var r = await call9Retry('econ_sellback', { p_item: String(item || ''), p_qty: qty, p_unit: unit == null ? null : Math.floor(Number(unit)), p_req: req }, 3);
      if (r && typeof r.left === 'number') MIR.sellback = r.left;
      if (r && !r.ok) r.req = req;   // reason 'error': unknown outcome; pass this req back to retry later
      return r || { ok: false, reason: 'error', req: req };
    },
    sellbackSeed: function (items) { return call9Retry('econ_sellback_seed', { p_items: items || {} }, 2); },
    sellbackCredit: function () { return call9('econ_sellback_credit', {}); }
  };

  /* ---------------- fallback 茶馆 wall panel ---------------- */
  var REASON = { empty: '写点什么吧', too_long: '太长了', link: '不能发链接', number: '不能留联系方式', blocked: '换个说法吧', slow: '慢一点，稍后再发', daily: '今天发得够多了', offline: '离线中', error: '出错了' };
  T.reasonText = function (r) { return REASON[r && r.reason] || ((r && r.reason) || ''); };
  T.open = async function () {
    var host = document.getElementById('app') || document.body, old = document.querySelector('.tgt-modal'); if (old) old.remove();
    var m = document.createElement('div'); m.className = 'tgg-mask tgt-modal' + (host.id === 'app' ? ' r41-contained' : '');
    m.style.cssText = 'position:absolute;inset:0;z-index:99998;background:rgba(30,16,8,.55);display:flex;align-items:center;justify-content:center;padding:14px;font-family:"PingFang SC","Noto Sans SC",sans-serif';
    m.innerHTML = '<div style="background:#fbf1dc;border:3px solid #5b3820;border-radius:14px;width:100%;max-width:420px;max-height:86%;display:flex;flex-direction:column;overflow:hidden;color:#3a2615">' +
      '<div style="background:linear-gradient(#c8423a,#8f231c);color:#ffe39a;padding:10px 14px;font-weight:800;display:flex;justify-content:space-between">🍵 茶馆留言墙<button data-x style="background:none;border:0;color:#ffe39a;font-size:20px">×</button></div>' +
      '<div data-list style="flex:1;overflow:auto;padding:8px 12px;font-size:14px"></div>' +
      '<div style="display:flex;gap:6px;padding:8px;border-top:2px solid #e3cfa4"><input data-in maxlength="120" placeholder="说点什么（120 字内）" style="flex:1;padding:8px;border:2px solid #c9a46a;border-radius:8px"><button data-send style="background:#8f231c;color:#ffe39a;border:0;border-radius:8px;padding:0 14px;font-weight:700">发布</button></div></div>';
    host.appendChild(m);
    m.querySelector('[data-x]').onclick = function () { m.remove(); };
    async function render() {
      var l = await T.wall(50);
      m.querySelector('[data-list]').innerHTML = l.length ? l.map(function (p) {
        return '<div style="padding:6px 0;border-bottom:1px dashed #e3cfa4"><b>' + (p.title_name ? '【' + esc(p.title_name) + '】' : '') + esc(p.name) + '</b>：' + esc(p.body) +
          (p.mine ? ' <button data-del="' + p.id + '" style="border:0;background:none;color:#8f231c">删除</button>' : ' <button data-rep="' + p.id + '" style="border:0;background:none;color:#9a8466;font-size:12px">举报</button>') + '</div>';
      }).join('') : '<div style="color:#9a8466;padding:20px;text-align:center">还没有人留言，来说第一句吧</div>';
      m.querySelectorAll('[data-del]').forEach(function (b) { b.onclick = async function () { await T.del(+b.dataset.del); render(); }; });
      m.querySelectorAll('[data-rep]').forEach(function (b) { b.onclick = async function () { await T.report(+b.dataset.rep); say('已举报，谢谢'); b.remove(); }; });
    }
    m.querySelector('[data-send]').onclick = async function () {
      var inp = m.querySelector('[data-in]'), r = await T.post(inp.value);
      if (r && r.ok) { inp.value = ''; render(); } else say(T.reasonText(r));
    };
    await render();
    return m;
  };

  /* ---------------- start ---------------- */
  var started = null;
  function start() {   // once per signed-in user (auth fires several change events); sequential: one probe call if r6.sql is missing
    if (started === me()) return; started = me();
    PRICES = null; A.load().then(function () { refreshMir(); loadPrices(); });
  }
  (function waitAuth(n) { if (online()) return start(); if (n > 240) return; setTimeout(function () { waitAuth(n + 1); }, 500); })(0);
  if (AUTH && AUTH.onChange) safe(function () { AUTH.onChange(function () { if (online()) start(); }); });
})();
