/* plan: the loaded plan. Planner text (data/trip.json, verbatim) + dated overrides + places, indexed by day.
   Interface: Plan.set(trip, overrides, places) · Plan.day(n) · Plan.panel(id) · Plan.dayLabel(d)
   and the read-only fields trip, days, stops, flat, places, cities, confs. No DOM. */
(function (T) {
  'use strict';
  var P = T.plan = {
    trip: null, days: [], stops: {}, flat: {}, // stops[day] = [{uid, stop, party, ob, day, t(ms|null)}]; flat[day] = stops + routes in planner order
    places: {}, cities: {}, overrides: [], confs: null
  };

  /* Accepts the whole overrides.json / places.json objects (static files or backend.loadTrip()), {} or a legacy
     overrides array. A places payload without .places keeps the previous cities. */
  P.set = function (trip, overrides, places) {
    P.trip = T.clone(trip);
    P.overrides = Array.isArray(overrides) ? overrides : ((overrides && overrides.overrides) || []);
    P.confs = (overrides && !Array.isArray(overrides) && overrides.confirmations) || null;
    if (places && places.places) { P.places = places.places; P.cities = places.cities || P.cities || {}; }
    else { P.places = places || P.places || {}; }
    applyOverrides(); index();
  };
  P.day = function (n) { return P.trip.days.filter(function (d) { return d.day === n; })[0]; };
  P.panel = function (id) { return P.trip.panels.filter(function (p) { return p.id === id; })[0]; };
  /* "Thu 14 Jan" — the first part of the planner's day eyebrow */
  P.dayLabel = function (d) { return d.eyebrow.split(' · ')[0]; };

  /* ---------------- overrides (verbatim find → replace, applied at load) ---------------- */
  var HTML_KEYS = { html: 1, more: 1, paras: 1, items: 1, notes: 1, start2: 1, title: 1, spec: 1, meta: 1, glance: 1, note: 1 };
  var OWNER_KINDS = { stop: 1, notice: 1, route: 1, nearby: 1, booking: 1, group: 1, confirmed: 1 };
  /* Wrap the changed words of a replacement in <mark class="upd-t"> (whole words; never across a tag). */
  function markDiff(find, rep) {
    var i = 0; while (i < find.length && i < rep.length && find[i] === rep[i]) i++;
    while (i > 0 && !/[\s(]/.test(rep[i - 1])) i--;
    var j = 0; while (j < find.length - i && j < rep.length - i && find[find.length - 1 - j] === rep[rep.length - 1 - j]) j++;
    while (j > 0 && !/\s/.test(rep[rep.length - j - 1])) j--;
    while (j < rep.length - i && /\s/.test(rep[rep.length - j - 1])) j++;
    var mid = rep.slice(i, rep.length - j);
    if (!mid || /[<>]/.test(mid)) return rep;
    return rep.slice(0, i) + '<mark class="upd-t">' + mid + '</mark>' + rep.slice(rep.length - j);
  }
  function applyOverrides() {
    var TRIP = P.trip, applied = [];
    P.overrides.forEach(function (ov) {
      var roots = typeof ov.day === 'number' ? TRIP.days.filter(function (d) { return d.day === ov.day; })
        : TRIP.panels.filter(function (p) { return p.id === ov.day; });
      if (ov.stop) {
        var found = [];
        (function rec(o) {
          if (Array.isArray(o)) o.forEach(rec);
          else if (o && typeof o === 'object') { if (o.kind === 'stop' && o.name === ov.stop) found.push(o); for (var k in o) if (k[0] !== '_') rec(o[k]); }
        })(roots);
        roots = found;
      }
      var hits = 0, info = { id: ov.id, date: ov.date, reason: ov.reason };
      var repHtml = markDiff(ov.find, String(ov.replace).replace(/&(?![a-z#0-9]+;)/gi, '&amp;'));
      function tag(o) {
        if (!o._upd) Object.defineProperty(o, '_upd', { value: [], enumerable: false, writable: true });
        if (o._upd.indexOf(info) < 0) o._upd.push(info);
      }
      // owner = nearest object with a `kind` (stop, notice, booking, group…) or the day/panel root;
      // row = nearest detail row ({key, html}) — both get the "updated" tag.
      function walk(o, owner, row, isHtml) {
        var keys = Array.isArray(o) ? o.map(function (_, i) { return i; }) : Object.keys(o);
        keys.forEach(function (k) {
          if (typeof k === 'string' && k[0] === '_') return;
          var v = o[k], h = Array.isArray(o) ? isHtml : !!HTML_KEYS[k];
          if (typeof v === 'string') {
            if (v.indexOf(ov.find) >= 0) {
              o[k] = v.split(ov.find).join(h ? repHtml : ov.replace);
              hits++; tag(owner); if (row) tag(row);
            }
          } else if (v && typeof v === 'object') {
            var isObj = !Array.isArray(v);
            walk(v, isObj && OWNER_KINDS[v.kind] ? v : owner, isObj && v.key !== undefined && v.html !== undefined ? v : row, h);
          }
        });
      }
      roots.forEach(function (r) { walk(r, r, null, false); });
      applied.push({ id: ov.id, hits: hits });
    });
    TRIP._overrideReport = applied;
    if (applied.some(function (a) { return !a.hits; })) console.warn('Overrides not applied:', applied.filter(function (a) { return !a.hits; }));
  }

  /* ---------------- index stops & times ---------------- */
  function index() {
    var TRIP = P.trip;
    P.days = TRIP.days.map(function (d) { return d.day; });
    TRIP.days.forEach(function (d) {
      var list = [], n = 0, flat = [];
      function rec(items, party, ob) {
        items.forEach(function (it) {
          if (it.kind === 'party') return rec(it.items, it.party, ob);
          if (it.kind !== 'stop' && it.kind !== 'route') return;
          it._uid = 's' + d.day + '-' + (n++); flat.push(it);
          if (!it._day) Object.defineProperty(it, '_day', { value: d.day, enumerable: false, writable: true });
          if (it.kind !== 'stop') return;
          var mins = T.parseClock(it.time);
          list.push({ uid: it._uid, stop: it, party: party || '', ob: !!ob, day: d.day, t: (mins == null || it.optional || it.moved || ob) ? null : T.jstAt(d.day, mins) });
        });
      }
      d.blocks.forEach(function (b) { rec(b.items, '', b.optional); });
      P.stops[d.day] = list; P.flat[d.day] = flat;
    });
  }
})(window.TripApp);
