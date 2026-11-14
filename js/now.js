/* now: where are we in the trip. All maths in Japan time (fixed +09:00), never the device zone.
   Interface: Now.state() · Now.nextToday(st) · Now.timed(day) · Now.mine(day) · Now.curNext(list, t) · Now.over(s, t)
   · Now.partyPick() / partyMe() · Now.bagInfo(day) · Now.leaveBy(st) · Now.navPick(st) · Now.navTarget(stop)
   · Now.placeOf(stop) · Now.dirURL(p) · Now.deadlines(n) · Now.geo (last location fix) · Now.geoDenied(). */
(function (T) {
  'use strict';
  var P = T.plan, R = T.reading, LS = T.LS, CFG = T.CFG, now = T.now, jst = T.jst, jstAt = T.jstAt;
  var N = T.nowModel = {};
  /* The planner has no end times: a stop is "current" until 3 h after it starts. */
  var CUR_MAX_MS = 3 * 3600e3;
  N.over = function (s, t) { return t - s.t > CUR_MAX_MS; };
  /* list = timed stops sorted by time → last = latest started, cur = last unless over, next = first not started */
  N.curNext = function (list, t) {
    var last = null, next = null;
    for (var i = 0; i < list.length; i++) { if (list[i].t <= t) last = list[i]; else { next = list[i]; break; } }
    return { last: last, cur: last && !N.over(last, t) ? last : null, next: next };
  };

  /* ---------------- party (split days, e.g. Jan 12) ----------------
     Whose phone is this? Set by js/live.js after "Link this phone" (cached, so it works offline).
     On split days Now/Next only shows this person's stops plus shared ones; an unlinked
     device follows the Nic / Elly filter on that day instead. */
  function whoAmI() { var w = null; try { w = (localStorage.getItem('jp27.who') || '').replace(/"/g, ''); } catch (e) {} return w === 'nic' || w === 'elly' ? w : null; } // raw string, written by backend.js
  N.partyPick = function () { return LS.get('party', null) || whoAmI() || 'all'; }; // a phone linked as Elly opens in her lane
  N.partyMe = function () { var p = N.partyPick(); return p === 'nic' || p === 'elly' ? p : null; };
  var mine = N.mine = function (day) { var w = N.partyMe(); return (P.stops[day] || []).filter(function (s) { return !w || !s.party || s.party === w; }); };
  var timed = N.timed = function (day) { return mine(day).filter(function (s) { return s.t != null; }).sort(function (a, b) { return a.t - b.t; }); };

  N.tripDayAt = function (ms) { var j = jst(ms); return (j.y === 2027 && j.m === 1 && P.days.indexOf(j.d) >= 0) ? j.d : null; };
  N.cityOf = function (d) { return (d && d.city || 'Tokyo').split(' · ')[0]; };

  /* Planner soft times ("Morning", "Afternoon"…) — drop them from "Later today" once that part of the day is over. */
  var SOFT_END = [[/^morning$/i, 12], [/^late morning$/i, 13], [/^(midday|lunch)$/i, 15], [/^afternoon$/i, 18], [/^(late afternoon|dusk)$/i, 19]];
  function softOver(label, hr) { for (var i = 0; i < SOFT_END.length; i++) if (SOFT_END[i][0].test((label || '').trim())) return hr >= SOFT_END[i][1]; return false; }

  /* phase: pre (before the flight) · trip (flight out → flight home) · post.
     During the trip: cur = timed stop that started ≤ 3 h ago, next = next timed stop (may be tomorrow),
     later = untimed stops (planner order) between here and the next timed one, flying / home = in the air / flight home next. */
  N.state = function () {
    var DAYS = P.days, t = now(), dep = Date.parse(CFG.departure.iso), end = Date.parse(CFG.tripEnd);
    if (t < dep) return { phase: 'pre', t: t, dep: dep };
    if (t >= end) return { phase: 'post', t: t };
    var td = N.tripDayAt(t) || (t < jstAt(DAYS[0], 0) ? DAYS[0] : DAYS[DAYS.length - 1]);
    var cn = N.curNext(timed(td), t), last = cn.last, next = cn.next, nextDay = td;
    if (!next) { var k = DAYS.indexOf(td) + 1; if (k < DAYS.length) { nextDay = DAYS[k]; next = timed(nextDay)[0] || null; } }
    var ord = mine(td), from = last ? ord.indexOf(last) + 1 : 0, to = next && nextDay === td ? ord.indexOf(next) : ord.length;
    var hr = jst(t).h + jst(t).mi / 60;
    var later = hr >= 22 ? [] : ord.slice(from, to < 0 ? ord.length : to).filter(function (s) { return s.t == null && !s.stop.optional && !s.stop.moved && !s.ob && !softOver(s.stop.time, hr) && !R.isBag(s.stop); }).slice(0, 8);
    return { phase: 'trip', t: t, day: td, cur: cn.cur, next: next, nextDay: nextDay, later: later,
      flying: td === DAYS[0] && !last, home: !next && td === DAYS[DAYS.length - 1] ? end : null };
  };
  /* the next timed stop is later today (not tomorrow's first stop) */
  N.nextToday = function (st) { return !!(st.next && st.nextDay === st.day); };

  /* The day's bag move: its action + the one clause with the hand-over / collect timing. */
  N.bagInfo = function (day) {
    var b = mine(day).filter(function (s) { return R.isBag(s.stop); })[0];
    if (!b) return null;
    var act = b.stop.action || '', key = R.clauses(R.detailText(b.stop, /about|notes/i)).filter(function (c) { return R.BAG_RX.test(c) && !R.overlaps(c, act); })[0] || '';
    return { s: b, action: act, key: key };
  };

  /* ---------------- places, Navigate, leave-by ---------------- */
  N.geo = LS.get('geo', null); // {lat, lng, at} — last "My location" fix
  N.geoDenied = function () { return !!LS.get('geoDenied', false); };
  N.geoFresh = function () { return N.geo && now() - N.geo.at < 15 * 60e3; };
  var placeOf = N.placeOf = function (stop) {
    var p = P.places[stop.name]; if (!p) return null;
    var lat = +p[0], lng = +p[1], ok = isFinite(lat) && isFinite(lng) && lat > 20 && lat < 46 && lng > 122 && lng < 154;
    return ok ? { lat: lat, lng: lng, label: p[2], q: p[3] || p[2] || stop.name } : null;
  };
  /* Planner's own "Map" link (Apple Maps, address query) — the fallback destination when a stop has no verified coordinates. */
  function plannerMapQuery(stop) {
    var l = (stop.links || []).filter(function (x) { return /^https:\/\/maps\.apple\.com\//.test(x.href || ''); })[0];
    if (!l) return null;
    var m = /[?&]daddr=([^&]+)/.exec(l.href); if (!m) return null;
    try { return decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch (e) { return null; }
  }
  /* Navigate target for a stop: verified coordinates first, else name + address query, else nothing. */
  var navTarget = N.navTarget = function (stop) {
    var p = placeOf(stop); if (p) return p;
    var raw = P.places[stop.name]; if (raw && raw[3]) return { q: String(raw[3]) };
    var q = plannerMapQuery(stop); if (!q) return null;
    var nm = String(stop.name || '').split(' · ')[0].trim();
    return { q: nm && q.toLowerCase().indexOf(nm.toLowerCase()) < 0 ? nm + ', ' + q : q };
  };
  /* p = {lat,lng} (verified coordinates) or {q} (name + address). Apple Maps (opens the Maps app from Safari and the
     home-screen app) on Apple devices, Google Maps elsewhere; transit directions from wherever you are. */
  N.dirURL = function (p) {
    var dest = p.lat != null ? p.lat.toFixed(6) + ',' + p.lng.toFixed(6) : encodeURIComponent(p.q);
    return T.IS_APPLE ? 'https://maps.apple.com/?daddr=' + dest + '&dirflg=r'
      : 'https://www.google.com/maps/dir/?api=1&destination=' + dest + '&travelmode=transit';
  };
  function km(a, b) {
    var R_ = 6371, r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lng - a.lng) * r;
    var x = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
    return 2 * R_ * Math.asin(Math.sqrt(x));
  }
  /* Leave-by for the next stop: only later today and within 4 h — never for tomorrow's first stop.
     Origin = a fresh location fix, else the current stop (not a train). Shown from 60 min before leave-by. */
  N.leaveBy = function (st) {
    if (!N.nextToday(st) || st.next.t - now() > 4 * 3600e3) return null;
    var dest = placeOf(st.next.stop); if (!dest) return null;
    var origin = null, from = '', GEO = N.geo;
    if (N.geoFresh() && km(GEO, dest) < 150) { origin = GEO; from = 'your location'; }
    else if (st.cur && placeOf(st.cur.stop) && !R.isTrain(st.cur.stop)) { origin = placeOf(st.cur.stop); from = st.cur.stop.name; }
    if (!origin) return null;
    var L = CFG.leaveBy, d = km(origin, dest);
    if (d < 0.05) return null; // same place (e.g. head spa at the same salon) — nothing to leave for
    var walk = d < L.walkMaxKm, est = Math.ceil(walk ? d / L.walkKmh * 60 : d / L.transitKmh * 60 + L.transitBufferMin);
    var left = (st.next.t - now()) / 60000;
    if (est > 120) return null;
    var leaveAt = st.next.t - (est + L.extraBufferMin) * 60000;
    if (now() < leaveAt - 60 * 60000) return null;
    return { km: d, est: est, walk: walk, from: from, go: left < est + L.extraBufferMin && left > -5, soon: leaveAt - now() < 30 * 60000, leaveAt: leaveAt };
  };
  /* Which stop Navigate points at: next (today), else the next one with a destination, else now, else later today. */
  N.navPick = function (st) {
    if (st.phase !== 'trip' || st.flying) return null;
    var today = N.nextToday(st);
    if (today && navTarget(st.next.stop)) return { s: st.next, k: 'Next · ' + T.until(st.next.t) };
    var up = today ? timed(st.day).filter(function (x) { return x.t > st.next.t && navTarget(x.stop); })[0] : null;
    if (up) return { s: up, k: 'Then · ' + T.until(up.t) };
    if (st.cur && navTarget(st.cur.stop)) return { s: st.cur, k: 'Now' };
    var l = (st.later || []).filter(function (x) { return navTarget(x.stop); })[0];
    return l ? { s: l, k: 'Later today' } : null;
  };

  /* ---------------- booking windows from the planner (verbatim) ---------------- */
  N.deadlines = function (n) {
    var bk = (P.panel('bookings') || { parts: [] }).parts.filter(function (p) { return p.kind === 'booking' && p.sortDate; });
    var t = now(), done = LS.get('bk', {});
    // Keep a window on screen for 24 h after it opens (that's exactly when it matters), marked "Open now".
    // Date-only entries start at local midnight of that date (JST if the planner says JST, else Pacific).
    return bk.map(function (b) {
      var sd = b.sortDate, ms = Date.parse(sd.length === 10 ? sd + (/JST/.test(b.when || '') ? 'T00:00:00+09:00' : 'T00:00:00-08:00') : sd);
      return { b: b, ms: ms, open: ms <= t };
    }).filter(function (x) { return x.ms + 864e5 > t && !done[x.b.key]; }).sort(function (a, b) { return a.ms - b.ms; }).slice(0, n);
  };
})(window.TripApp);
