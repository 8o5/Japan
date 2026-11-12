/* Japan 2027 · Nic & Elly — static trip app. No framework. All planner text comes from data/trip.json (verbatim). */
(function () {
  'use strict';
  var CFG = window.APP_CONFIG || {};
  var TRIP = null, PLACES = {}, CITIES = {}, OVERRIDES = [];
  var DAYS = [], STOPS = {}; // STOPS[day] = [{uid, stop, t(ms|null)}]
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem('jp27.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('jp27.' + k, JSON.stringify(v)); } catch (e) {} }
  };
  var reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------- time (always Asia/Tokyo; Japan has no DST → fixed +09:00) ---------------- */
  var MOCK = null;
  (function () {
    var q = new URLSearchParams(location.search).get('now');
    if (q) { var t = Date.parse(q.replace(' ', '+')); if (!isNaN(t)) MOCK = { base: t, at: Date.now() }; }
  })();
  function now() { return MOCK ? MOCK.base + (Date.now() - MOCK.at) : Date.now(); }
  var JST = 9 * 3600e3;
  function jst(ms) { var d = new Date(ms + JST); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() }; }
  function jstAt(day, mins) { return Date.UTC(2027, 0, day, 0, mins) - JST; }
  function fmtJST(ms) {
    var j = jst(ms), h = j.h % 12 || 12;
    return h + ':' + String(j.mi).padStart(2, '0') + ' ' + (j.h < 12 ? 'AM' : 'PM');
  }
  function parseClock(s) {
    if (!s || /^by\b/i.test(s)) return null;
    var m = /(\d{1,2}):(\d{2})\s*(?:[–-]\s*\d{1,2}:\d{2}\s*)?(AM|PM)/.exec(s);
    if (!m) return null;
    var h = (+m[1]) % 12 + (m[3] === 'PM' ? 12 : 0);
    return h * 60 + (+m[2]);
  }
  function until(ms) {
    var min = Math.round((ms - now()) / 60000);
    if (min <= 0) return 'now';
    if (min < 60) return 'in ' + min + ' min';
    var h = Math.floor(min / 60), mm = min % 60;
    if (h < 24) return 'in ' + h + ' h' + (mm && h < 5 ? ' ' + mm + ' min' : '');
    var d = Math.floor(h / 24), hh = h % 24;
    return 'in ' + d + (d === 1 ? ' day' : ' days') + (d < 3 && hh ? ' ' + hh + ' h' : '');
  }
  var WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDayJST(ms) { var j = jst(ms), wd = new Date(Date.UTC(j.y, j.m - 1, j.d)).getUTCDay(); return WD[wd] + ' ' + j.d + ' ' + MON[j.m - 1]; }
  /* "Today" / "Tomorrow" / "Sat 16 Jan", always by the Japan calendar */
  function dayWord(ms) {
    var a = jst(now()), b = jst(ms), da = Date.UTC(a.y, a.m - 1, a.d), db = Date.UTC(b.y, b.m - 1, b.d), n = Math.round((db - da) / 864e5);
    return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : fmtDayJST(ms);
  }

  /* ---------------- helpers ---------------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function updTag(o) {
    if (!o || !o._upd || !o._upd.length) return '';
    var u = o._upd[0], d = new Date(u.date + 'T12:00:00Z');
    var lbl = 'updated ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    return '<span class="upd" title="' + esc(o._upd.map(function (x) { return x.reason; }).join(' · ')) + '">' + esc(lbl) + '</span>';
  }

  /* ---------------- readability helpers (presentation only — never change planner words) ---------------- */
  // Split planner HTML on " · " into steps without breaking a tag pair (e.g. <b>…</b> spanning a dot).
  function splitDots(html) {
    var parts = String(html || '').split(' · '), out = [], acc = null;
    function open(s) { return (s.match(/<[a-z][^>]*>/gi) || []).filter(function (t) { return !/\/>$|^<br/i.test(t); }).length - (s.match(/<\/[a-z]+>/gi) || []).length; }
    parts.forEach(function (p) {
      acc = acc === null ? p : acc + ' · ' + p;
      if (open(acc) <= 0) { out.push(acc); acc = null; }
    });
    if (acc !== null) out.push(acc);
    return out;
  }
  function ic(e) { return '<span class="ic" aria-hidden="true">' + e + '</span>'; }
  /* tiny stroke icons (own drawings, currentColor) */
  var SVG = {
    nav: '<path d="M20.5 3.5 3.8 10.6c-.8.4-.7 1.5.1 1.7l6.6 1.2 1.2 6.6c.2.9 1.3 1 1.7.1z" fill="currentColor" stroke="none"/>',
    loc: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
    link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3.2-3.2a4.5 4.5 0 0 0-6.4-6.4l-1.3 1.3"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3.2 3.2a4.5 4.5 0 0 0 6.4 6.4l1.3-1.3"/>',
    bell: '<path d="M18 9.5a6 6 0 0 0-12 0c0 6.5-2.5 8-2.5 8h17S18 16 18 9.5"/><path d="M10.2 20.5a2 2 0 0 0 3.6 0"/>'
  };
  function svgI(k) { return '<svg class="i" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + (SVG[k] || '') + '</svg>'; }
  var FLAG_IC = { access: '🎟️', ok: '✅', diet: '⚠️', act: '📅', deadline: '⏰', time: '⏰', info: '💡', alert: '⚠️' };
  var STATUS_IC = { booked: '✅', walkin: '🚶', target: '🎯', plan: '📌', moved: '↪️' };
  var TYPE_IC = [
    [/airport|narita|arrival formalities/i, '✈️'], [/hotel|ryokan|inn\b/i, '🏨'],
    [/train|express|shinkansen|romancecar|bus\b|transit card/i, '🚆'],
    [/museum|art\b/i, '🏛️'], [/tower|observation|deck|viewpoint|valley/i, '🗼'], [/shrine|temple/i, '⛩️'],
    [/salon|spa|scalp|nail/i, '💆'], [/workshop|shoemaker|embroidery/i, '🧵'],
    [/café|cafe|coffee|bakery|tea\b|teahouse|tea shop|ice cream|soft-serve|crêpe/i, '☕'],
    [/restaurant|ramen|noodle|tsukemen|katsudon|yakitori|skewer|taco|steak|wagyu|food|market|dinner|counter|pancake|kaiseki/i, '🍣'],
    [/store|shop|boutique|mall|dealer|arcade|street|maker|capsule|goods|flagship/i, '🛍️'],
    [/evening|task|move/i, '🌙']
  ];
  function typeIcon(t) { for (var i = 0; i < TYPE_IC.length; i++) if (TYPE_IC[i][0].test(t || '')) return TYPE_IC[i][1]; return ''; }

  /* ---------------- overrides (verbatim find → replace, applied at load) ---------------- */
  var HTML_KEYS = { html: 1, more: 1, paras: 1, items: 1, notes: 1, start2: 1, title: 1, spec: 1, meta: 1, glance: 1, note: 1 };
  var OWNER_KINDS = { stop: 1, notice: 1, route: 1, nearby: 1, booking: 1, group: 1, confirmed: 1 };
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
    var applied = [];
    OVERRIDES.forEach(function (ov) {
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
  function indexTrip() {
    DAYS = TRIP.days.map(function (d) { return d.day; });
    TRIP.days.forEach(function (d) {
      var list = [], n = 0;
      function rec(items, party, ob) {
        items.forEach(function (it) {
          if (it.kind === 'party') return rec(it.items, it.party, ob);
          if (it.kind !== 'stop' && it.kind !== 'route') return;
          it._uid = 's' + d.day + '-' + (n++);
          if (it.kind !== 'stop') return;
          var mins = parseClock(it.time);
          list.push({ uid: it._uid, stop: it, party: party || '', ob: !!ob, day: d.day, t: (mins == null || it.optional || it.moved || ob) ? null : jstAt(d.day, mins) });
        });
      }
      d.blocks.forEach(function (b) { rec(b.items, '', b.optional); });
      STOPS[d.day] = list;
    });
  }
  function dayObj(n) { return TRIP.days.filter(function (d) { return d.day === n; })[0]; }
  function tripDayAt(ms) { var j = jst(ms); return (j.y === 2027 && j.m === 1 && DAYS.indexOf(j.d) >= 0) ? j.d : null; }
  function cityOf(d) { return (d && d.city || 'Tokyo').split(' · ')[0]; }

  /* Where are we in the trip? All maths in Japan time (fixed +09:00), never the device zone.
     phase: pre (before the flight) · trip (flight out → flight home) · post.
     During the trip: cur = timed stop that started ≤ 3 h ago, next = next timed stop (may be tomorrow),
     later = untimed stops (planner order) between here and the next timed one, flying / home = in the air / flight home next. */
  function state() {
    var t = now(), dep = Date.parse(CFG.departure.iso), end = Date.parse(CFG.tripEnd);
    if (t < dep) return { phase: 'pre', t: t, dep: dep };
    if (t >= end) return { phase: 'post', t: t };
    var td = tripDayAt(t) || (t < jstAt(DAYS[0], 0) ? DAYS[0] : DAYS[DAYS.length - 1]);
    var list = timed(td), cur = null, next = null;
    for (var i = 0; i < list.length; i++) { if (list[i].t <= t) cur = list[i]; else { next = list[i]; break; } }
    var nextDay = td, last = cur;
    if (!next) { var k = DAYS.indexOf(td) + 1; if (k < DAYS.length) { nextDay = DAYS[k]; next = timed(nextDay)[0] || null; } }
    // a current stop is "over" once it started more than 3 h ago (the planner has no end times)
    if (cur && t - cur.t > 3 * 3600e3) cur = null;
    var ord = mine(td), from = last ? ord.indexOf(last) + 1 : 0, to = next && nextDay === td ? ord.indexOf(next) : ord.length;
    var hr = jst(t).h + jst(t).mi / 60;
    var later = hr >= 22 ? [] : ord.slice(from, to < 0 ? ord.length : to).filter(function (s) { return s.t == null && !s.stop.optional && !s.stop.moved && !s.ob && !softOver(s.stop.time, hr); }).slice(0, 3);
    return { phase: 'trip', t: t, day: td, cur: cur, next: next, nextDay: nextDay, later: later,
      flying: td === DAYS[0] && !last, home: !next && td === DAYS[DAYS.length - 1] ? end : null };
  }
  /* Planner soft times ("Morning", "Afternoon"…) — drop them from "Later today" once that part of the day is over. */
  var SOFT_END = [[/^morning$/i, 12], [/^late morning$/i, 13], [/^(midday|lunch)$/i, 15], [/^afternoon$/i, 18], [/^(late afternoon|dusk)$/i, 19]];
  function softOver(label, hr) { for (var i = 0; i < SOFT_END.length; i++) if (SOFT_END[i][0].test((label || '').trim())) return hr >= SOFT_END[i][1]; return false; }
  /* Whose phone is this? Set by js/live.js after "Link this phone" (cached, so it works offline).
     On split days (Jan 12) Now/Next only shows this person's stops plus shared ones; an unlinked
     device follows the Nic / Elly filter on that day instead. */
  function whoAmI() { var w = null; try { w = (localStorage.getItem('jp27.who') || '').replace(/"/g, ''); } catch (e) {} return w === 'nic' || w === 'elly' ? w : null; } // raw string, written by backend.js
  function partyMe() { var w = whoAmI(); if (w) return w; var p = LS.get('party', 'all'); return p === 'nic' || p === 'elly' ? p : null; }
  function mine(day) { var w = partyMe(); return (STOPS[day] || []).filter(function (s) { return !w || !s.party || s.party === w; }); }
  function timed(day) { return mine(day).filter(function (s) { return s.t != null; }).sort(function (a, b) { return a.t - b.t; }); }

  /* ---------------- geo / leave-by ---------------- */
  var GEO = LS.get('geo', null);
  function placeOf(stop) {
    var p = PLACES[stop.name]; if (!p) return null;
    var lat = +p[0], lng = +p[1], ok = isFinite(lat) && isFinite(lng) && lat > 20 && lat < 46 && lng > 122 && lng < 154;
    return ok ? { lat: lat, lng: lng, label: p[2], q: p[3] || p[2] || stop.name } : null;
  }
  /* Planner's own "Map" link (Apple Maps, address query) — the fallback destination when a stop has no verified coordinates. */
  function plannerMapQuery(stop) {
    var l = (stop.links || []).filter(function (x) { return /^https:\/\/maps\.apple\.com\//.test(x.href || ''); })[0];
    if (!l) return null;
    var m = /[?&]daddr=([^&]+)/.exec(l.href); if (!m) return null;
    try { return decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch (e) { return null; }
  }
  /* Navigate target for a stop: verified coordinates first, else name + address query, else nothing. */
  function navTarget(stop) {
    var p = placeOf(stop); if (p) return p;
    var raw = PLACES[stop.name]; if (raw && raw[3]) return { q: String(raw[3]) };
    var q = plannerMapQuery(stop); if (!q) return null;
    var nm = String(stop.name || '').split(' · ')[0].trim();
    return { q: nm && q.toLowerCase().indexOf(nm.toLowerCase()) < 0 ? nm + ', ' + q : q };
  }
  function km(a, b) {
    var R = 6371, r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lng - a.lng) * r;
    var x = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function leaveBy(st) {
    // only for a next stop later today and within 4 h — never for tomorrow's first stop
    if (!st.next || st.nextDay !== st.day || st.next.t - now() > 4 * 3600e3) return null;
    var dest = placeOf(st.next.stop); if (!dest) return null;
    var origin = null, from = '';
    if (GEO && now() - GEO.at < 15 * 60e3 && km(GEO, dest) < 150) { origin = GEO; from = 'your location'; }
    else if (st.cur && placeOf(st.cur.stop)) { origin = placeOf(st.cur.stop); from = st.cur.stop.name; }
    if (!origin) return null;
    var L = CFG.leaveBy, d = km(origin, dest);
    var walk = d < L.walkMaxKm, est = Math.ceil(walk ? d / L.walkKmh * 60 : d / L.transitKmh * 60 + L.transitBufferMin);
    var left = (st.next.t - now()) / 60000;
    var leaveAt = st.next.t - (est + L.extraBufferMin) * 60000;
    return { km: d, est: est, walk: walk, from: from, go: left < est + L.extraBufferMin && left > -5, soon: leaveAt - now() < 30 * 60000, leaveAt: leaveAt };
  }
  function askLocation(btn) {
    var lbl = btn.querySelector('span') || btn;
    if (!navigator.geolocation) { lbl.textContent = 'Unavailable'; return; }
    lbl.textContent = 'Locating…'; btn.classList.add('busy');
    navigator.geolocation.getCurrentPosition(function (p) {
      GEO = { lat: p.coords.latitude, lng: p.coords.longitude, at: now() }; LS.set('geo', GEO); LS.set('geoDenied', false); renderLive();
    }, function (err) {
      if (err && err.code === 1) { LS.set('geoDenied', true); GEO = null; LS.set('geo', null); renderLive(); }
      else { lbl.textContent = 'Try again'; btn.classList.remove('busy'); toast('Couldn’t get your location'); }
    }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 });
  }

  /* ---------------- notifications (page-open only) ---------------- */
  var notified = LS.get('notified', {});
  function notify(key, title, body) {
    if (!LS.get('notify', false) || LS.get('pushOn', false) || !('Notification' in window) || Notification.permission !== 'granted' || notified[key]) return;
    notified[key] = 1; LS.set('notified', notified);
    var opts = { body: body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: key };
    if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.ready.then(function (r) { r.showNotification(title, opts); });
    else try { new Notification(title, opts); } catch (e) {}
  }
  function askNotify(btn) {
    if (!('Notification' in window)) { btn.textContent = 'Not supported here'; return; }
    if (LS.get('notify', false)) { LS.set('notify', false); renderLive(); return; }
    Notification.requestPermission().then(function (p) { LS.set('notify', p === 'granted'); renderLive(); });
  }

  /* ---------------- weather (Open-Meteo, no key) ---------------- */
  var WMO = { 0: ['☀️', 'Clear'], 1: ['🌤️', 'Mostly clear'], 2: ['⛅', 'Partly cloudy'], 3: ['☁️', 'Overcast'], 45: ['🌫️', 'Fog'], 48: ['🌫️', 'Fog'],
    51: ['🌦️', 'Drizzle'], 53: ['🌦️', 'Drizzle'], 55: ['🌧️', 'Drizzle'], 61: ['🌧️', 'Light rain'], 63: ['🌧️', 'Rain'], 65: ['🌧️', 'Heavy rain'],
    66: ['🌧️', 'Freezing rain'], 67: ['🌧️', 'Freezing rain'], 71: ['🌨️', 'Light snow'], 73: ['🌨️', 'Snow'], 75: ['❄️', 'Heavy snow'], 77: ['🌨️', 'Snow grains'],
    80: ['🌦️', 'Showers'], 81: ['🌧️', 'Showers'], 82: ['⛈️', 'Heavy showers'], 85: ['🌨️', 'Snow showers'], 86: ['❄️', 'Snow showers'], 95: ['⛈️', 'Thunderstorm'], 96: ['⛈️', 'Thunderstorm'], 99: ['⛈️', 'Thunderstorm'] };
  var WX = { city: null, data: null, err: null, loading: false };
  function wxWanted() {
    var t = now(), start = jstAt(DAYS[0], 0), end = Date.parse(CFG.tripEnd);
    return t >= start - (CFG.weatherAutoDaysBefore || 14) * 864e5 && t <= end;
  }
  function wxCity() {
    var st = state(), d = st.phase === 'trip' ? dayObj(st.day) : (ROUTE.view === 'day' ? dayObj(ROUTE.day) : dayObj(DAYS[0]));
    return cityOf(d);
  }
  function loadWeather(force) {
    var city = wxCity(), c = CITIES[city]; if (!c) return;
    var key = 'wx.' + city, cached = LS.get(key, null);
    if (cached && Date.now() - cached.at < 60 * 60e3 && !force) { WX = { city: city, data: cached.data }; renderWeather(); return; }
    if (!navigator.onLine) { WX = { city: city, data: cached && cached.data, err: 'Offline' + (cached ? ' — showing last forecast' : ''), stale: !!cached }; renderWeather(); return; }
    WX.loading = true; WX.city = city; renderWeather();
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + c[0] + '&longitude=' + c[1] +
      '&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FTokyo&forecast_days=7';
    fetch(url).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (j) {
      LS.set(key, { at: Date.now(), data: j }); WX = { city: city, data: j }; renderWeather();
    }).catch(function () { WX = { city: city, data: cached && cached.data, err: 'Weather unavailable right now', stale: !!cached }; renderWeather(); });
  }
  function weatherHTML(compact) {
    if (!WX.city) {
      return compact ? '' : '<section class="w" aria-label="Weather"><h2 class="w-h">Weather</h2><p class="now-sub">Forecasts load automatically from two weeks before the trip.</p><div class="w-act"><button class="btn" data-act="wx">Check ' + esc(wxCity()) + ' now</button></div><p class="fine">Open-Meteo · no tracking.</p></section>';
    }
    if (WX.loading && !WX.data) return compact ? '' : '<section class="w"><h2 class="w-h">Weather · ' + esc(WX.city) + '</h2><p class="now-sub">Loading…</p></section>';
    var d = WX.data;
    if (!d) return compact ? '' : '<section class="w"><h2 class="w-h">Weather · ' + esc(WX.city) + '</h2><p class="now-sub">' + esc(WX.err || 'No forecast yet') + '</p><div class="w-act"><button class="btn" data-act="wx">Try again</button></div></section>';
    var cur = d.current || {}, w = WMO[cur.weather_code] || ['🌡️', ''];
    if (compact) return '<button type="button" class="wx-chip" data-act="wxsheet" aria-label="Weather in ' + esc(WX.city) + ': ' + Math.round(cur.temperature_2m) + ' degrees, ' + esc(w[1]) + (WX.stale ? ', last saved forecast' : '') + '. Show forecast"><span aria-hidden="true">' + w[0] + '</span>' + Math.round(cur.temperature_2m) + '°<span class="wx-city">' + esc(WX.city) + '</span></button>';
    var days = (d.daily && d.daily.time || []).slice(0, 7).map(function (t, i) {
      var c = WMO[d.daily.weather_code[i]] || ['', ''], dt = new Date(t + 'T00:00:00Z');
      return '<div title="' + esc(c[1]) + '"><b>' + dt.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }) + ' ' + dt.getUTCDate() + '</b><span class="wd-i" aria-label="' + esc(c[1]) + '">' + c[0] + '</span>' +
        '<span class="wd-t">' + Math.round(d.daily.temperature_2m_max[i]) + '° / ' + Math.round(d.daily.temperature_2m_min[i]) + '°</span>' +
        (d.daily.precipitation_probability_max ? '<span class="wd-p">' + (d.daily.precipitation_probability_max[i] || 0) + '% ☂</span>' : '') + '</div>';
    }).join('');
    return '<section class="w" aria-label="Weather"><h2 class="w-h">Weather · ' + esc(WX.city) + '</h2><div class="wx-row"><span class="wx-ic" aria-hidden="true">' + w[0] + '</span><div><div class="wx-t">' +
      Math.round(cur.temperature_2m) + '°C</div><div class="now-sub">' + esc(w[1]) + ' now</div></div></div><div class="wx-d">' + days + '</div>' +
      '<p class="fine">' + (WX.err ? esc(WX.err) + ' · ' : '') + 'Open-Meteo · Japan time · not from the planner.</p></section>';
  }
  function renderWeather() {
    var el = $('#wx-d'); if (el) el.innerHTML = weatherHTML(false);
    $$('.wx-inline').forEach(function (e) { e.innerHTML = weatherHTML(true); });
    if (SHEET.open === 'wx') $('#me-b').innerHTML = weatherHTML(false);
  }

  /* ---------------- deadlines from the planner (verbatim) ---------------- */
  function upcomingDeadlines(n) {
    var bk = (TRIP.panels.filter(function (p) { return p.id === 'bookings'; })[0] || { parts: [] }).parts.filter(function (p) { return p.kind === 'booking' && p.sortDate; });
    var t = now(), done = LS.get('bk', {});
    // Keep a window on screen for 24 h after it opens (that's exactly when it matters), marked "Open now".
    // Date-only entries start at local midnight of that date (JST if the planner says JST, else Pacific).
    return bk.map(function (b) {
      var sd = b.sortDate, ms = Date.parse(sd.length === 10 ? sd + (/JST/.test(b.when || '') ? 'T00:00:00+09:00' : 'T00:00:00-08:00') : sd);
      return { b: b, ms: ms, open: ms <= t };
    }).filter(function (x) { return x.ms + 864e5 > t && !done[x.b.key]; }).sort(function (a, b) { return a.ms - b.ms; }).slice(0, n);
  }
  function deadlinesHTML(n, title) {
    var list = upcomingDeadlines(n);
    if (!list.length) return '';
    return '<section class="w" aria-label="Upcoming deadlines"><h2 class="w-h">' + esc(title || 'Coming up · booking windows') + '</h2><ul class="dl-list">' +
      list.map(dlItemHTML).join('') + '</ul><div class="w-act"><a class="btn" href="#bookings">All bookings</a></div><p class="fine">Times as written in the planner (Pacific unless marked JST).</p></section>';
  }

  /* ---------------- Now / Next card ---------------- */
  function dlItemHTML(x) {
    return '<li class="' + (x.b.urgent || x.open ? 'urgent' : '') + '"><span class="dl-w">' + ic('⏰') + (x.open ? '<b class="dl-open">' + (/open/i.test(x.b.when || '') ? 'Open now' : 'Due now') + '</b> · ' : '') + esc(x.b.when) + '</span><span class="dl-t">' + esc(x.b.what) + '</span></li>';
  }
  function clockHead(st, label) {
    return '<div class="nc-top"><p class="nc-clock"><span class="live" aria-hidden="true"></span>' + esc(label || fmtJST(st.t)) +
      '<span class="nc-tz">' + esc(fmtDayJST(st.t)) + ' · Japan</span></p><div class="wx-inline"></div></div>';
  }
  function partyTag(s) { return s.party && !whoAmI() && LS.get('party', 'all') === 'all' ? '<span class="who w-' + esc(s.party) + '">' + (s.party === 'nic' ? 'Nic' : 'Elly') + '</span> ' : ''; }
  function ncRow(kind, s, day, st) {
    var other = day !== st.day, when = other ? dayWord(s.t) : '';
    var badge = kind === 'Next' ? (other ? '<span class="nc-badge nc-badge-q">' + esc(when) + '</span>' : '<span class="nc-badge">' + esc(until(s.t)) + '</span>') : '';
    return '<a class="nc-row nc-' + kind.toLowerCase() + '" href="#d' + day + '" data-jump="' + s.uid + '">' +
      '<span class="nc-k">' + kind + '</span>' + badge +
      '<span class="nc-n">' + partyTag(s) + esc(s.stop.name) + '</span>' +
      '<span class="nc-m">' + esc(s.stop.time) + (s.stop.typeLabel ? ' · ' + esc(s.stop.typeLabel) : '') + '</span></a>';
  }
  function laterHTML(st) {
    if (!st.later || !st.later.length) return '';
    var head = st.next && st.nextDay === st.day ? 'Before that' : 'Later today';
    return '<div class="nc-later"><p class="nc-k">' + head + '</p><ul>' + st.later.map(function (s) {
      return '<li><a href="#d' + st.day + '" data-jump="' + s.uid + '"><span class="nc-lt">' + esc(s.stop.time) + '</span><span class="nc-ln">' + partyTag(s) + esc(s.stop.name) + '</span></a></li>'; }).join('') + '</ul></div>';
  }
  function navBtn(stop, cls) {
    var t = stop && navTarget(stop); if (!t) return '';
    return '<a class="btn ' + (cls || 'btn-p') + ' btn-nav" href="' + esc(dirURL(t)) + '" target="_blank" rel="noopener" aria-label="Navigate to ' + esc(stop.name) + '">' + svgI('nav') + 'Navigate</a>';
  }
  function nowHTML() {
    var st = state(), h = '';
    if (st.phase === 'pre') {
      var dep = Date.parse(CFG.departure.iso), d0 = dayObj(DAYS[0]);
      h += '<div class="nc-top"><p class="nc-clock"><span class="live" aria-hidden="true"></span>Countdown</p><div class="wx-inline"></div></div>' +
        '<p class="now-big">' + esc(until(dep).replace(/^in /, '')) + '</p>' +
        '<p class="now-sub">to ' + esc(CFG.departure.label) + ' · ' + esc(CFG.departure.when) + '</p>' +
        '<a class="nc-row nc-then" href="#d' + DAYS[0] + '"><span class="nc-k">Then · ' + esc(d0.eyebrow.split(' · ')[0]) + '</span><span class="nc-n">' + esc(d0.title) + '</span></a>';
      var dl = upcomingDeadlines(3);
      if (dl.length) h += '<div class="now-dl"><p class="nc-k">Next booking windows</p><ul class="dl-list">' + dl.map(dlItemHTML).join('') + '</ul></div>';
      h += liveNudge();
    } else if (st.phase === 'post') {
      h += '<div class="nc-top"><p class="nc-clock">Trip complete</p></div><p class="now-big">おかえり</p><p class="now-sub">Japan 9–21 Jan 2027 is done. Everything stays here to look back on.</p>';
    } else {
      var lb = leaveBy(st), tgt = st.next ? st.next.stop : null;
      h += clockHead(st);
      if (st.flying) h += '<div class="nc-row nc-now"><span class="nc-k">Now</span><span class="nc-n">' + ic('✈️') + 'In the air</span><span class="nc-m">' + esc(CFG.departure.label) + '</span></div>';
      if (st.cur) h += ncRow('Now', st.cur, st.day, st);
      var tomorrow = st.next && st.nextDay !== st.day;
      if (tomorrow) h += laterHTML(st);
      if (st.next) h += ncRow('Next', st.next, st.nextDay, st);
      else if (st.home) h += '<div class="nc-row nc-next"><span class="nc-k">Next</span><span class="nc-badge">' + esc(until(st.home)) + '</span><span class="nc-n">' + ic('✈️') + 'Flight home</span><span class="nc-m">' + esc(fmtJST(st.home)) + '</span></div>';
      if (st.next && st.nextDay !== st.day) {
        var nd = dayObj(st.nextDay);
        h += '<p class="nc-start"><span class="nc-k">' + esc(nd.start.label) + '</span>' + nd.start.html + '</p>';
      }
      if (!st.cur && !st.next && !st.home && !st.flying) h += '<p class="now-sub">Nothing timed left today.</p>';
      if (lb) {
        h += '<div class="leave' + (lb.go ? ' go' : lb.soon ? ' soon' : '') + '">' + (lb.go ? ic('🚶') + 'Time to head out' : ic('⏰') + 'Leave by ~' + esc(fmtJST(lb.leaveAt))) +
          '<small>~' + lb.est + ' min ' + (lb.walk ? 'walk' : 'by transit') + ' · ' + lb.km.toFixed(1) + ' km from ' + esc(lb.from) + ' · app estimate</small></div>';
        if (lb.go && st.next) notify('lb-' + st.next.uid, 'Start heading out', st.next.stop.name + ' at ' + st.next.stop.time);
      }
      if (!tomorrow) h += laterHTML(st);
      if (st.next && st.nextDay === st.day && st.next.t - now() <= LS.get('leadMin', CFG.notifyLeadMin || 30) * 60000 && st.next.t > now()) notify('nx-' + st.next.uid, 'Next: ' + st.next.stop.name, st.next.stop.time + ' · ' + until(st.next.t));
      var showGeo = lb || (st.next && st.nextDay === st.day && placeOf(st.next.stop) && st.next.t - now() < 4 * 3600e3);
      var acts = (st.flying ? '' : navBtn(tgt)) + (showGeo ? '<button class="btn btn-ic" data-act="geo" aria-label="' + (GEO_DENIED() ? 'Location is off — try again' : 'Use my location for the leave-by time') + '">' + svgI('loc') + '<span>' + (GEO_DENIED() ? 'Location off' : GEO && now() - GEO.at < 15 * 60e3 ? 'Update' : 'My location') + '</span></button>' : '');
      if (acts) h += '<div class="w-act nc-act">' + acts + '</div>';
      if (GEO_DENIED() && showGeo) h += '<p class="fine warn">Location is off, so leave-by uses the current stop. Turn on: Settings → Privacy &amp; Security → Location Services → Safari Websites → While Using.</p>';
      h += liveNudge();
    }
    return '<section class="w nowcard" aria-label="Now and next">' + h + '</section>';
  }
  function compactNowHTML(st) {
    var n = st.next && st.nextDay === st.day ? st.next : null;
    return '<section class="w nowcard compact" aria-label="Now and next"><a class="nc-mini" href="#d' + st.day + '" data-jump="' + esc((st.cur || st.next || {}).uid || '') + '">' +
      '<span class="nc-clock"><span class="live" aria-hidden="true"></span>' + esc(fmtJST(st.t)) + '</span>' +
      '<span class="nc-mini-t">' + (st.cur ? '<span class="nc-k">Now</span> ' + esc(st.cur.stop.name) : n ? '<span class="nc-k">Next</span> ' + esc(n.stop.name) + ' · ' + esc(until(n.t)) : 'Back to today') + '</span>' +
      '<span class="nc-go">Today ›</span></a></section>';
  }
  /* js/live.js (Firebase add-on) fills this: link status, Nic/Elly locations, trip alerts. */
  function liveSlot() { var L = window.JP27_LIVE; try { return '<div class="live-slot">' + (L && L.html ? L.html() : '') + '</div>'; } catch (e) { return ''; } }
  /* One quiet line in the Now card pointing to the You sheet when something needs doing. */
  function liveNudge() {
    var L = window.JP27_LIVE, s = null; try { s = L && L.summary ? L.summary() : null; } catch (e) {}
    if (!s) return '';
    var msg = !s.who ? (s.revoked ? 'Re-link this phone' : 'Link this phone for alerts') : !s.alertsOn ? 'Trip alerts are off' : s.warn ? s.warn : '';
    if (!msg) return '';
    return '<button type="button" class="nc-nudge" data-act="me">' + svgI(!s.who ? 'link' : 'bell') + '<span>' + esc(msg) + '</span><span class="chev" aria-hidden="true">›</span></button>';
  }
  /* Wanderlog/TripIt-style one-tap directions to the next stop (transit). Apple Maps on Apple devices. */
  function isApple() { return /iP(hone|ad|od)|Macintosh/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
  /* p = {lat,lng} (verified coordinates) or {q} (name + address). Apple Maps (opens the Maps app from Safari and the
     home-screen app) on Apple devices, Google Maps elsewhere; transit directions from wherever you are. */
  function dirURL(p, apple) {
    if (apple == null) apple = isApple();
    var dest = p.lat != null ? p.lat.toFixed(6) + ',' + p.lng.toFixed(6) : encodeURIComponent(p.q);
    return apple ? 'https://maps.apple.com/?daddr=' + dest + '&dirflg=r'
      : 'https://www.google.com/maps/dir/?api=1&destination=' + dest + '&travelmode=transit';
  }
  function navHTML(stop) {
    var t = navTarget(stop); if (!t) return '';
    return '<a class="lk lk-b lk-nav" href="' + esc(dirURL(t)) + '" target="_blank" rel="noopener" data-nav="' + (t.lat != null ? 'll' : 'q') + '"' +
      ' aria-label="Navigate to ' + esc(t.label || stop.name) + '">' + svgI('nav') + 'Navigate</a>';
  }
  function GEO_DENIED() { return !!LS.get('geoDenied', false); }
  var lastAnnounce = '', lastToday = null;
  function renderLive() {
    var html = nowHTML(), st = state();
    $('#now-d').innerHTML = html;
    // Phone: on a day other than today, a one-line "back to today" pill so the day itself comes first.
    $('#now-m').innerHTML = (ROUTE.view !== 'day') ? '' : (st.phase === 'trip' && ROUTE.day !== st.day) ? compactNowHTML(st) : html;
    $('#dl-d').innerHTML = st.phase === 'pre' ? deadlinesHTML(6) : (st.phase === 'trip' ? deadlinesHTML(3, 'Still to do') : '');
    var ld = $('#live-d'); if (ld) ld.innerHTML = '<section class="w" aria-label="Together and alerts"><h2 class="w-h">You &amp; alerts</h2>' + liveSlot() + '</section>';
    var mb = $('#me-b'); if (mb && $('#mesheet').open) mb.innerHTML = liveSlot();
    renderWeather();
    highlightNow();
    nextBar(st);
    // screen readers: announce only when the next stop changes, not every 30 s tick
    var say = st.phase === 'trip' && st.next ? 'Next: ' + st.next.stop.name + ', ' + st.next.stop.time + (st.nextDay !== st.day ? ', ' + dayWord(st.next.t) : '') : '';
    if (say !== lastAnnounce) { lastAnnounce = say; var sr = $('#sr-live'); if (sr && rendered) sr.textContent = say; }
    // left open across midnight (or resumed next morning): follow the new day if we were on "today"
    var td = st.phase === 'trip' ? st.day : null;
    if (lastToday !== null && td !== lastToday) {
      buildNav();
      if (ROUTE.view === 'day' && ROUTE.day === lastToday && td) { lastToday = td; lastDay = td; location.hash = '#d' + td; return; }
    }
    lastToday = td;
  }
  /* Phone: once the Now card scrolls away, a slim "Next · Navigate" bar docks above the tab bar. */
  function nextBar(st) {
    var bar = $('#nextbar'); if (!bar) return;
    st = st || state();
    var ok = st.phase === 'trip' && st.next && st.nextDay === st.day && ROUTE.view === 'day' && ROUTE.day === st.day;
    document.body.classList.toggle('has-next', !!ok);
    if (!ok) { bar.innerHTML = ''; bar.classList.remove('show'); return; }
    var t = navTarget(st.next.stop);
    bar.innerHTML = '<a class="nb-i" href="#d' + st.day + '" data-jump="' + st.next.uid + '"><span class="nb-k">Next · ' + esc(until(st.next.t)) + '</span><span class="nb-n">' + esc(st.next.stop.name) + '</span></a>' +
      (t ? '<a class="nb-go" href="' + esc(dirURL(t)) + '" target="_blank" rel="noopener" aria-label="Navigate to ' + esc(st.next.stop.name) + '">' + svgI('nav') + 'Go</a>' : '');
    nextBarVis();
  }
  function nextBarVis() {
    var bar = $('#nextbar'), card = $('#now-m .nowcard'); if (!bar) return;
    var show = !!bar.innerHTML && !!card && !card.classList.contains('compact') && card.getBoundingClientRect().bottom < 60;
    bar.classList.toggle('show', show);
  }
  function highlightNow() {
    $$('.it.is-now,.it.is-next,.it.is-past').forEach(function (e) { e.classList.remove('is-now', 'is-next', 'is-past'); });
    var st = state(); if (st.phase !== 'trip' || ROUTE.view !== 'day') return;
    if (ROUTE.day === st.day) {
      timed(st.day).forEach(function (s) {
        var el = document.getElementById(s.uid); if (!el) return;
        if (st.cur && s.uid === st.cur.uid) el.classList.add('is-now');
        else if (s.t < st.t) el.classList.add('is-past');
      });
    }
    if (st.next && st.nextDay === ROUTE.day) { var n = document.getElementById(st.next.uid); if (n) n.classList.add('is-next'); }
  }

  /* ---------------- rendering: day ---------------- */
  function flagsHTML(fl) {
    return (fl || []).map(function (f) {
      return '<p class="fl fl-' + esc(f.kind) + '"><span class="fl-k">' + (FLAG_IC[f.kind] ? ic(FLAG_IC[f.kind]) : '') + esc(f.key) + '</span><span class="fl-t">' + f.html + '</span></p>'; }).join('');
  }
  function qcHTML(q) {
    var done = LS.get('qc', {});
    return '<div class="qc">' + (q.who ? '<p class="qc-who">' + esc(q.who) + '</p>' : '') + q.items.map(function (it) {
      return '<div class="qc-i"><div class="qc-h"><span>' + esc(it.title) + '</span>' + (it.verdict ? '<span class="qc-v ' + esc(it.verdictKind) + '">' + esc(it.verdict) + '</span>' : '') + '</div>' +
        it.rows.map(function (r) { return '<p>' + (r.key ? '<span class="qc-k">' + esc(r.key) + '</span>' : '') + r.html + '</p>'; }).join('') +
        (it.checks.length ? '<ul class="qc-l">' + it.checks.map(function (c) {
          return '<li><label class="chk"><input type="checkbox" data-qc="' + esc(c.id) + '"' + (done[c.id] ? ' checked' : '') + '><span>' + esc(c.text) + '</span></label></li>'; }).join('') + '</ul>' : '') + '</div>';
    }).join('') + (q.notes || []).map(function (n) { return '<p class="qc-who">' + n + '</p>'; }).join('') + '</div>';
  }
  function rowsHTML(rows) {
    return rows.map(function (r) {
      return '<div class="dr' + (r.why ? ' why' : '') + '"><span class="dr-k">' + esc(r.key) + updTag(r) + '</span><div class="dr-v">' + r.html + (r.qc ? r.qc.map(qcHTML).join('') : '') + '</div></div>';
    }).join('');
  }
  function stopHTML(s) {
    var cls = 'stop ' + s.variant + (s.optional ? ' opt' : '') + (s.moved ? ' moved' : '');
    var st = s.status ? '<span class="st st-' + esc(s.status.kind) + '">' + (STATUS_IC[s.status.kind] ? ic(STATUS_IC[s.status.kind]) : '') + esc(s.status.text) + '</span>' : '';
    var ti = typeIcon(s.typeLabel);
    var h = '<article class="' + cls + '"><div class="s-top"><div><h3 class="s-name">' + esc(s.name) + '</h3>' +
      (s.typeLabel || s._upd ? '<p class="s-what">' + (ti ? ic(ti) : '') + esc(s.typeLabel || '') + (s._upd ? ' ' + updTag(s) : '') + '</p>' : '') + '</div>' + st + '</div>';
    if (s.action) h += '<p class="s-act">' + esc(s.action) + '</p>';
    if (s.flags && s.flags.length) h += '<div class="fls">' + flagsHTML(s.flags) + '</div>';
    if (s.getThere) h += '<p class="s-get">' + ic('📍') + '<b>' + esc(s.getThere.label) + '</b> ' + s.getThere.html + '</p>';
    if (s.meta && s.meta.length) h += '<p class="s-meta">' + s.meta.map(function (m) {
      return '<span' + (m.who ? ' class="who w-' + esc(m.who) + '"' : '') + '>' + (/^Open\b|^Always open/.test(m.text) ? ic('🕘') : '') + esc(m.text) + '</span>'; }).join('') + '</p>';
    var nav = navHTML(s);
    // Navigate replaces the planner's address-only "Map" link (same destination, but by verified coordinates).
    var links = (s.links || []).filter(function (l) { return !(nav && /^https:\/\/maps\.apple\.com\//.test(l.href || '')); });
    if (nav || links.length) h += '<div class="s-links">' + nav + links.map(function (l) {
      return '<a class="lk' + (l.primary ? ' lk-t' : '') + '" href="' + esc(l.href) + '" target="_blank" rel="noopener">' + esc(l.label) + '</a>'; }).join('') + '</div>';
    if (s.details && s.details.length) h += '<details class="more"><summary>Details</summary><div class="more-b">' + rowsHTML(s.details) + '</div></details>';
    return h + '</article>';
  }
  function railHTML(r) {
    return '<div class="rail-d">' + r.map(function (l, i) {
      var c = '--c:' + esc(l.color || '#888');
      return (i ? '<div class="rl-x" aria-hidden="true">›</div>' : '') + '<div class="rl" style="' + c + '"><span class="rl-b"></span><span class="rl-n">' + esc(l.line) + '</span><span class="rl-s">' +
        l.stations.map(function (s, k) { return (k ? '<span class="arr" aria-label="to">→</span>' : '') + '<span>' + (s.code ? '<span class="code">' + esc(s.code) + '</span> ' : '') + esc(s.name) + '</span>'; }).join('') + '</span></div>';
    }).join('') + '</div>';
  }
  /* A " · "-joined planner sentence → a lead line plus one step per line (same words, same order). */
  function stepsHTML(html, cls, lead) {
    var p = splitDots(html), L = lead ? ic(lead) : '';
    if (p.length < 2) return '<p class="' + cls + '-t">' + L + html + '</p>';
    return '<p class="' + cls + '-t ' + cls + '-h">' + L + p[0] + '</p><ul class="steps">' + p.slice(1).map(function (x) {
      return '<li' + (/^(or|backup)\b/i.test(x.replace(/<[^>]+>/g, '')) ? ' class="alt"' : '') + '>' + x + '</li>'; }).join('') + '</ul>';
  }
  function itemHTML(it) {
    switch (it.kind) {
      case 'stop':
        return '<div class="it rv" id="' + it._uid + '"><p class="it-t">' + esc(it.time) + '</p><div class="it-c">' + stopHTML(it) + '</div></div>';
      case 'route':
        return '<div class="it route-it rv" id="' + it._uid + '"><p class="it-t">' + ic('🚆') + esc(it.time) + '</p><div class="it-c route">' + (it.head ? '<p class="route-h">' + esc(it.head) + '</p>' : '') +
          it.legs.map(function (l) { return '<div class="leg">' + stepsHTML(l.html, 'leg') + (l.rail ? railHTML(l.rail) : '') + '</div>'; }).join('') + '</div></div>';
      case 'walk':
        return '<div class="it"><span></span><p class="walk">' + ic('🚶') + esc(it.text) + '</p></div>';
      case 'notice':
        var nic = { warn: '⚠️', plan: '🔁', info: '💡' }[it.tone] || '';
        return '<div class="it full rv"><div class="nt nt-' + esc(it.tone) + '">' + (it.key ? '<p class="nt-k">' + (nic ? ic(nic) : '') + esc(it.key) + (it._upd ? ' ' + updTag(it) : '') + '</p>' : (it._upd ? '<div class="s-tags" style="margin:0 0 6px">' + updTag(it) + '</div>' : '')) +
          stepsHTML(it.html, 'nt', it.key ? '' : nic) + (it.more ? '<details class="more"><summary>More</summary><div class="more-b"><p class="nt-t">' + it.more + '</p></div></details>' : '') + '</div></div>';
      case 'nearby':
        return '<div class="it full"><p class="nearby"><b>' + esc(it.label) + '</b>' + it.html + '</p></div>';
      case 'party':
        return '<div class="party p-' + esc(it.party) + '" data-party="' + esc(it.party) + '"><p class="party-h"><span class="who w-' + esc(it.party) + '">' + esc(it.who) + '</span>' + esc(it.heading) + '</p>' +
          it.items.map(itemHTML).join('') + '</div>';
      default:
        return '<div class="it full prose">' + (it.html || '') + '</div>';
    }
  }
  function dayHTML(d) {
    var i = DAYS.indexOf(d.day), prev = DAYS[i - 1], next = DAYS[i + 1];
    var h = '<header class="d-hero"><p class="d-eyebrow">' + esc(d.eyebrow) + '</p><h1 class="d-title">' + esc(d.title) + '</h1>' +
      '<p class="d-start"><span class="k">' + esc(d.start.label) + '</span>' + d.start.html + ' <span class="tz">' + esc(d.start.tz) + '</span></p>' +
      d.start2.map(function (s) { return '<p class="d-start2">' + s + '</p>'; }).join('');
    if (d.glance) {
      // short facts → chips; the long cost caveat → a quiet line under them (still visible, same words)
      var chips = [], longs = [], money = false;
      splitDots(d.glance).forEach(function (g) {
        var t = g.replace(/<[^>]+>/g, '');
        if (t.length > 48) { longs.push(g); return; }
        var e = /^[~≈]?[¥$]/.test(t) ? (money ? '' : (money = true, '💴')) : /\d(\.\d)?\s?(mi|km)$/.test(t) ? '📍' : /^(easy|moderate|hard|steady|light|busy)/i.test(t) ? '🚶' : /loose|free\b/i.test(t) ? '⏳' : '';
        chips.push('<li>' + (e ? ic(e) : '') + g + '</li>');
      });
      h += '<ul class="glance" aria-label="At a glance">' + chips.join('') + '</ul>' + longs.map(function (g) { return '<p class="glance-n">' + g + '</p>'; }).join('');
    }
    if (d.partyFilter && d.partyFilter.length) {
      var cur = LS.get('party', 'all');
      h += '<div class="party-f" role="group" aria-label="Show">' + d.partyFilter.map(function (b) {
        return '<button type="button" data-show="' + esc(b.show) + '" aria-pressed="' + (cur === b.show) + '">' + esc(b.label) + '</button>'; }).join('') + '</div>';
    }
    h += '</header>';
    if (d.first) h += '<section class="first rv"><h2>' + esc(d.first.heading) + '</h2><ul>' + d.first.items.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>' +
      (d.first.more ? '<details class="more"><summary>Details</summary><div class="more-b">' + d.first.more + '</div></details>' : '') + '</section>';
    d.blocks.forEach(function (b) {
      var inner = '<div class="tl">' + b.items.map(itemHTML).join('') + '</div>';
      if (b.optional) h += '<details class="blk opt"><summary><span class="ok">' + esc(b.optKey) + '</span><span>' + esc(b.heading) + '</span></summary>' + inner + '</details>';
      else h += '<section class="blk"><h2 class="blk-h">' + esc(b.heading) + '</h2>' + inner + '</section>';
    });
    if (d.notes) {
      h += '<details class="dnotes"><summary>' + esc(d.notes.summary) + (d._upd ? ' ' + updTag(d) : '') + '</summary><div class="more-b">' + rowsHTML(d.notes.rows) +
        (d.notes.figure ? '<figure class="fig" role="group" aria-label="' + esc(d.notes.figure.label) + '" style="margin:0">' + d.notes.figure.svg + (d.notes.figure.caption ? '<figcaption>' + esc(d.notes.figure.caption) + '</figcaption>' : '') + '</figure>' : '') +
        '</div></details>';
    }
    h += '<nav class="d-nav" aria-label="Day navigation">' + (prev ? '<a href="#d' + prev + '" class="pv"><span>‹ Previous</span>' + esc(dayObj(prev).eyebrow.split(' · ')[0]) + '</a>' : '<span></span>') +
      (next ? '<a href="#d' + next + '" class="nx"><span>Next ›</span>' + esc(dayObj(next).eyebrow.split(' · ')[0]) + '</a>' : '<span></span>') + '</nav>';
    return h;
  }
  function applyParty() {
    var cur = LS.get('party', 'all');
    $$('.party[data-party]').forEach(function (p) { p.hidden = !(cur === 'all' || p.getAttribute('data-party') === cur); });
    $$('.party-f button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-show') === cur)); });
  }

  /* ---------------- rendering: panels ---------------- */
  function panelHTML(p) {
    var h = '<header class="p-hero"><h1 class="p-title">' + esc(p.title) + '</h1>' + (p.lead ? '<p class="p-lead">' + esc(p.lead) + '</p>' : '') + '</header>';
    var done = LS.get('bk', {}), inList = false;
    p.parts.forEach(function (x) {
      if (x.kind !== 'booking' && inList) { h += '</div>'; inList = false; }
      if (x.kind === 'heading') h += '<h2 class="p-h">' + esc(x.text) + '</h2>';
      else if (x.kind === 'para') h += '<p class="p-para' + (x.muted ? ' muted' : '') + '">' + x.html + '</p>';
      else if (x.kind === 'confirmed') {
        h += '<section class="cf-box"><h2>' + esc(x.heading) + '</h2><p class="muted small">' + x.note + '</p>' + x.facts.map(function (f) {
          return '<div class="cf"><span class="cf-k">' + ic(/flight/i.test(f.key) ? '✈️' : /bed|hotel/i.test(f.key) ? '🏨' : /people/i.test(f.key) ? '👥' : '🎟️') + esc(f.key) + '</span><div class="cf-m">' + f.paras.map(function (q) { return '<p>' + q + '</p>'; }).join('') + '</div>' +
            f.more.map(function (m) { return '<details class="more"><summary>Details</summary><div class="more-b"><div class="prose">' + m + '</div></div></details>'; }).join('') + '</div>';
        }).join('') + '</section>';
      } else if (x.kind === 'booking') {
        if (!inList) { h += '<div class="bk-list">'; inList = true; }
        var on = !!done[x.key];
        h += '<div class="bk' + (x.urgent ? ' urgent' : '') + (on ? ' is-done' : '') + ' rv"><label class="bk-c"><input type="checkbox" data-bk="' + esc(x.key) + '"' + (on ? ' checked' : '') + ' aria-label="My checklist: ' + esc(x.what) + '"></label>' +
          '<div><p class="bk-when">' + ic(x.urgent ? '⚠️' : '⏰') + esc(x.when) + '</p><p class="bk-what">' + esc(x.what) + ' ' + updTag(x) + '</p>' + x.notes.map(function (n) { return '<p class="bk-n">' + n + '</p>'; }).join('') + '</div>' +
          x.more.map(function (m) { return '<details class="more"><summary>Details</summary><div class="more-b"><div class="prose">' + m + '</div></div></details>'; }).join('') + '</div>';
      } else if (x.kind === 'group') {
        h += '<details class="grp rv"' + (x.open ? ' open' : '') + '><summary><span>' + x.title + '</span>' + updTag(x) + '</summary><div class="grp-b prose">' + x.html +
          (x.shoes || []).map(function (s) {
            return '<div class="shoe"><a class="shoe-n" href="' + esc(s.href) + '" target="_blank" rel="noopener">' + esc(s.name) + '</a><div class="shoe-s">' + s.spec.concat(s.meta).map(function (z) { return '<span>' + z + '</span>'; }).join('') + '</div>' + s.html + '</div>';
          }).join('') + (x.qc || []).map(qcHTML).join('') + '</div></details>';
      } else h += '<div class="prose">' + (x.html || '') + '</div>';
    });
    if (inList) h += '</div>';
    return h;
  }

  /* ---------------- diet sheet ---------------- */
  function dietHTML() {
    var prep = TRIP.panels.filter(function (p) { return p.id === 'prep'; })[0];
    var card = prep && prep.parts.filter(function (x) { return x.kind === 'group' && /allergy card/i.test(x.title); })[0];
    var h = card ? '<div class="diet-card">' + card.html + '</div>' : '';
    var day = ROUTE.view === 'day' ? ROUTE.day : (state().day || DAYS[0]), d = dayObj(day), rows = [];
    (STOPS[day] || []).forEach(function (s) { (s.stop.flags || []).forEach(function (f) { if (f.kind === 'diet') rows.push('<li><b>' + esc(s.stop.name) + '</b> — ' + f.html + '</li>'); }); });
    h += '<div class="diet-today"><h3>Diet notes · ' + esc(d.eyebrow.split(' · ')[0]) + '</h3>' + (rows.length ? '<ul>' + rows.join('') + '</ul>' : '<p class="muted">No diet flags on this day’s stops.</p>') + '</div>';
    return h;
  }

  /* ---------------- chrome: strip, rail ---------------- */
  function buildNav() {
    var td = tripDayAt(now()), strip = '', rail = '', lastCity = null;
    TRIP.nav.forEach(function (g, gi) {
      if (gi) strip += '<span class="s-sep" aria-hidden="true"></span>';
      rail += '<h3>' + esc(g.city) + '</h3>';
      g.days.forEach(function (x) {
        var n = +x.id.slice(1), d = dayObj(n), parts = x.label.split(' ');
        strip += '<a href="#' + x.id + '" data-day="' + n + '" class="' + (n === td ? 'is-today' : '') + '" title="' + esc(x.label + ' · ' + g.city) + '"><span class="s-w">' + esc(parts[0]) + '</span><span class="s-d">' + esc(parts[1]) + '</span><span class="s-c">' + esc(g.city.split(' · ')[0]) + '</span></a>';
        rail += '<a href="#' + x.id + '" data-day="' + n + '" class="' + (n === td ? 'is-today' : '') + '"><span class="r-d">' + n + '</span><span class="r-l" title="' + esc(d.title) + '">' + esc(parts[0] + ' · ' + d.title) + '</span>' + (n === td ? '<span class="r-today">Today</span>' : '') + '</a>';
      });
    });
    rail += '<h3>Planning</h3>' + TRIP.panels.map(function (p) { return '<a href="#' + p.id + '" data-view="' + p.id + '"><span class="r-l">' + esc(p.title) + '</span></a>'; }).join('');
    $('#strip').innerHTML = strip; $('#rail').innerHTML = rail;
  }

  /* ---------------- routing ---------------- */
  var ROUTE = { view: 'day', day: 9 }, lastDay = null;
  function defaultDay() { var st = state(); return st.phase === 'trip' ? st.day : (st.phase === 'post' ? DAYS[DAYS.length - 1] : DAYS[0]); }
  function parseHash() {
    var h = location.hash.replace(/^#/, ''), m = /^d(\d{1,2})$/.exec(h);
    if (m && DAYS.indexOf(+m[1]) >= 0) return { view: 'day', day: +m[1] };
    if (/^(bookings|watch|prep|sources)$/.test(h)) return { view: h };
    return { view: 'day', day: lastDay || defaultDay() };
  }
  var pendingJump = null, rendered = false, quietRender = false;
  function render() {
    var prev = ROUTE; ROUTE = parseHash();
    var v = $('#view');
    document.body.classList.toggle('v-panel', ROUTE.view !== 'day');
    if (ROUTE.view === 'day') {
      lastDay = ROUTE.day;
      var d = dayObj(ROUTE.day);
      v.innerHTML = dayHTML(d);
      document.title = d.eyebrow.split(' · ')[0] + ' · ' + (CFG.title || 'Japan 2027');
      applyParty();
    } else {
      var p = TRIP.panels.filter(function (x) { return x.id === ROUTE.view; })[0];
      v.innerHTML = panelHTML(p);
      document.title = p.title + ' · ' + (CFG.title || 'Japan 2027');
    }
    // nav state
    $$('[data-view]').forEach(function (a) {
      var on = a.getAttribute('data-view') === ROUTE.view;
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
      if (a.getAttribute('data-view') === 'day') a.setAttribute('href', '#d' + (lastDay || defaultDay()));
    });
    $$('#strip a, #rail a[data-day]').forEach(function (a) {
      if (ROUTE.view === 'day' && +a.getAttribute('data-day') === ROUTE.day) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    var sc = $('#strip a[aria-current]');
    if (sc) { var s = $('#strip'); s.scrollTo({ left: sc.offsetLeft - s.clientWidth / 2 + sc.clientWidth / 2, behavior: reduceMotion ? 'auto' : 'smooth' }); }
    // motion
    if (!reduceMotion && rendered && !quietRender) {
      v.classList.remove('enter', 'enter-l', 'enter-r'); void v.offsetWidth;
      var dir = (prev.view === 'day' && ROUTE.view === 'day' && prev.day !== ROUTE.day) ? (ROUTE.day > prev.day ? 'enter-r' : 'enter-l') : 'enter';
      v.classList.add(dir);
    }
    rendered = true;
    renderLive();
    reveal();
    if (pendingJump) {
      var el = document.getElementById(pendingJump); pendingJump = null;
      if (el) { setTimeout(function () { el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' }); }, 60); return; }
    }
    if (!quietRender && (prev.view !== ROUTE.view || prev.day !== ROUTE.day)) window.scrollTo(0, 0);
  }
  function go(delta) {
    if (ROUTE.view !== 'day') return;
    var i = DAYS.indexOf(ROUTE.day) + delta;
    if (i >= 0 && i < DAYS.length) location.hash = '#d' + DAYS[i];
  }

  /* ---------------- reveal on scroll (cheap) ---------------- */
  var io = null;
  function reveal() {
    var els = $$('.rv');
    if (reduceMotion || !('IntersectionObserver' in window)) { els.forEach(function (e) { e.classList.add('in'); }); return; }
    if (io) io.disconnect();
    io = new IntersectionObserver(function (ents) {
      ents.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.01 });
    var vh = innerHeight;
    els.forEach(function (e) { if (e.getBoundingClientRect().top < vh) e.classList.add('in'); else io.observe(e); });
  }

  /* ---------------- sheets ---------------- */
  var SHEET = { open: null }, nbRaf = 0;
  function showSheet(d) {
    d.classList.remove('closing');
    if (!d.open) { if (d.showModal) d.showModal(); else d.setAttribute('open', ''); }
  }
  function closeSheet(d) {
    if (!d || !d.open || d.classList.contains('closing')) return;
    if (d.id === 'mesheet') SHEET.open = null;
    if (reduceMotion) { d.close(); return; }
    d.classList.add('closing');
    setTimeout(function () { d.classList.remove('closing'); d.style.transform = ''; if (d.open) d.close(); }, 230);
  }
  window.JP27_closeSheet = closeSheet;
  function openInfo(kind) {
    var d = $('#mesheet'); SHEET.open = kind;
    $('#me-h').textContent = kind === 'wx' ? 'Weather' + (WX.city ? ' · ' + WX.city : '') : 'You & alerts';
    d.classList.toggle('is-wx', kind === 'wx');
    $('#me-b').innerHTML = kind === 'wx' ? weatherHTML(false) : liveSlot();
    if (kind === 'wx' && !WX.data && !WX.loading) loadWeather(true);
    showSheet(d);
  }
  function sheetDrag() {
    var y0 = 0, dy = 0, d = null;
    document.addEventListener('touchstart', function (e) {
      var h = e.target.closest && e.target.closest('dialog.sheet .grab, dialog.sheet .sheet-h');
      if (!h || e.target.closest('button')) { d = null; return; }
      d = h.closest('dialog'); y0 = e.touches[0].clientY; dy = 0; d.style.transition = 'none';
    }, { passive: true });
    document.addEventListener('touchmove', function (e) {
      if (!d) return; dy = Math.max(0, e.touches[0].clientY - y0); d.style.transform = 'translateY(' + dy + 'px)';
    }, { passive: true });
    document.addEventListener('touchend', function () {
      if (!d) return; var dd = d; d = null; dd.style.transition = '';
      if (dy > 90) closeSheet(dd); else dd.style.transform = '';
    }, { passive: true });
  }
  function goToday() {
    lastDay = null; var st = state(), h = '#d' + defaultDay();
    if (st.phase === 'trip') pendingJump = (st.cur || st.next || {}).uid || null;
    if (location.hash === h) { render(); if (!pendingJump) window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }); } else location.hash = h;
  }

  /* ---------------- events ---------------- */
  function bind() {
    window.addEventListener('hashchange', render);
    document.addEventListener('click', function (e) {
      var a = e.target.closest('[data-act],[data-jump],[data-show],[data-close]');
      if (!a) return;
      if (a.hasAttribute('data-jump') && a.getAttribute('data-jump')) {
        pendingJump = a.getAttribute('data-jump');
        if (location.hash === a.getAttribute('href')) { e.preventDefault(); render(); }
        return;
      }
      if (a.hasAttribute('data-show')) { LS.set('party', a.getAttribute('data-show')); applyParty(); renderLive(); return; }
      if (a.hasAttribute('data-close')) { closeSheet(a.closest('dialog')); return; }
      var act = a.getAttribute('data-act');
      if (act === 'me') openInfo('me');
      else if (act === 'wxsheet') openInfo('wx');
      else if (act === 'geo') askLocation(a);
      else if (act === 'notify') askNotify(a);
      else if (act === 'wx') loadWeather(true);
    });
    document.addEventListener('change', function (e) {
      var t = e.target;
      if (t.hasAttribute('data-qc')) { var q = LS.get('qc', {}); if (t.checked) q[t.getAttribute('data-qc')] = 1; else delete q[t.getAttribute('data-qc')]; LS.set('qc', q); }
      if (t.hasAttribute('data-bk')) { var b = LS.get('bk', {}); if (t.checked) b[t.getAttribute('data-bk')] = 1; else delete b[t.getAttribute('data-bk')]; LS.set('bk', b); t.closest('.bk').classList.toggle('is-done', t.checked); renderLive(); }
    });
    document.addEventListener('keydown', function (e) {
      if (e.target.closest('input,textarea,select,[contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowLeft') go(-1); else if (e.key === 'ArrowRight') go(1);
    });
    // swipe between days (phone): the page follows the finger a little, then springs to the next day
    var sx = 0, sy = 0, st = 0, ok = false, horiz = null, V = $('#view');
    V.addEventListener('touchstart', function (e) {
      var t = e.touches[0]; ok = ROUTE.view === 'day' && e.touches.length === 1 && !e.target.closest('.fig,.strip,.rail-d,input,label,.glance,select,textarea');
      sx = t.clientX; sy = t.clientY; st = Date.now(); horiz = null;
    }, { passive: true });
    V.addEventListener('touchmove', function (e) {
      if (!ok || reduceMotion) return; var t = e.touches[0], dx = t.clientX - sx, dy = t.clientY - sy;
      if (horiz === null && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) horiz = Math.abs(dx) > Math.abs(dy) * 1.4;
      if (!horiz) return;
      var i = DAYS.indexOf(ROUTE.day), edge = (dx > 0 && i === 0) || (dx < 0 && i === DAYS.length - 1);
      V.style.transition = 'none'; V.style.transform = 'translate3d(' + (dx * (edge ? 0.12 : 0.3)) + 'px,0,0)';
    }, { passive: true });
    V.addEventListener('touchend', function (e) {
      if (!ok) return; var t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
      V.style.transition = ''; V.style.transform = '';
      if (Math.abs(dx) > 70 && Math.abs(dy) < Math.abs(dx) * 0.6 && Date.now() - st < 800) go(dx < 0 ? 1 : -1);
    }, { passive: true });
    V.addEventListener('touchcancel', function () { V.style.transition = ''; V.style.transform = ''; }, { passive: true });
    // sheets: diet, You & alerts, weather (bottom sheets on phone; drag the handle down to close)
    $('#dietbtn').addEventListener('click', function () { $('#diet-b').innerHTML = dietHTML(); showSheet($('#dietsheet')); });
    $('#mebtn').addEventListener('click', function () { openInfo('me'); });
    document.addEventListener('click', function (e) { if (e.target.matches && e.target.matches('dialog.sheet')) closeSheet(e.target); });
    document.addEventListener('cancel', function (e) { if (e.target.matches && e.target.matches('dialog.sheet')) { e.preventDefault(); closeSheet(e.target); } }, true);
    sheetDrag();
    // theme: auto → light → dark
    var tb = $('#themebtn'), modes = ['auto', 'light', 'dark'];
    function setTheme(m) {
      if (m === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', m);
      tb.setAttribute('aria-label', 'Appearance: ' + m + '. Tap to change'); tb.title = 'Appearance: ' + m; tb.setAttribute('data-mode', m);
      $$('meta[name="theme-color"]').forEach(function (x) {
        var dark = /dark/.test(x.getAttribute('media') || '') ;
        if (m === 'auto') x.setAttribute('content', dark ? '#15110E' : '#FBF7F1'); else x.setAttribute('content', m === 'dark' ? '#15110E' : '#FBF7F1');
      });
    }
    setTheme(LS.get('theme', 'auto'));
    tb.addEventListener('click', function () { var m = modes[(modes.indexOf(LS.get('theme', 'auto')) + 1) % 3]; LS.set('theme', m); setTheme(m); toast('Appearance: ' + { auto: 'Automatic', light: 'Light', dark: 'Dark' }[m]); });
    $('#brand').addEventListener('click', function (e) { e.preventDefault(); goToday(); });
    // tab bar: tapping "Days" again while on a day jumps back to today (like re-tapping an iOS tab)
    $$('#tabbar a[data-view="day"]').forEach(function (a) { a.addEventListener('click', function (e) { if (ROUTE.view === 'day') { e.preventDefault(); goToday(); } }); });
    window.addEventListener('scroll', function () { if (!nbRaf) nbRaf = requestAnimationFrame(function () { nbRaf = 0; nextBarVis(); }); }, { passive: true });
    // network status: one quiet pill, never a blocking banner
    function net() { $('#net').hidden = navigator.onLine; document.documentElement.classList.toggle('is-offline', !navigator.onLine); }
    window.addEventListener('offline', net); window.addEventListener('online', net); net();
    window.addEventListener('online', function () { if (WX.city) loadWeather(); });
  }

  /* ---------------- passcode gate (client-side only — NOT security) ---------------- */
  function sha256(s) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)).then(function (b) {
      return Array.prototype.map.call(new Uint8Array(b), function (x) { return x.toString(16).padStart(2, '0'); }).join('');
    });
  }
  function gate() {
    var pc = CFG.passcode || {};
    if (!pc.enabled || !pc.sha256) return Promise.resolve();
    if (LS.get('gate', '') === pc.sha256) return Promise.resolve();
    return new Promise(function (res) {
      var g = $('#gate'); g.hidden = false; $('#gate-i').focus();
      $('#gate-f').addEventListener('submit', function (e) {
        e.preventDefault();
        sha256($('#gate-i').value).then(function (h) {
          if (h === pc.sha256) { LS.set('gate', h); g.hidden = true; res(); } else $('#gate-e').textContent = 'That’s not it.';
        });
      });
    });
  }

  /* QA (?qa=1): report horizontal overflow + override hits into <pre id="qa"> for headless checks */
  function qaReport() {
    var W = document.documentElement.clientWidth, bad = [];
    $('#view').classList.remove('enter', 'enter-l', 'enter-r');
    $$('#view details').forEach(function (d) { d.open = true; });
    $$('.party').forEach(function (p) { p.hidden = false; });
    $$('body *').forEach(function (e) {
      var r = e.getBoundingClientRect();
      if (r.width && (r.right > W + 1 || r.left < -1) && !e.closest('.strip,.fig,dialog,.skip,.rail,.side')) bad.push(e.tagName + '.' + e.className + ' ' + Math.round(r.left) + '/' + Math.round(r.right));
    });
    var pre = document.createElement('pre'); pre.id = 'qa'; pre.hidden = true;
    pre.textContent = JSON.stringify({ width: W, scrollWidth: document.documentElement.scrollWidth, overflow: bad.slice(0, 20), overrides: TRIP._overrideReport, state: state().phase, sw: !!(navigator.serviceWorker && navigator.serviceWorker.controller) });
    document.body.appendChild(pre);
    if (window.parent !== window) window.parent.postMessage(pre.textContent, '*');
  }

  /* ---------------- live plan updates ---------------- */
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function toast(msg) {
    var t = document.getElementById('plan-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'plan-toast'; t.className = 'plan-toast'; t.setAttribute('role', 'status');
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._tm);
    toast._tm = setTimeout(function () { t.classList.remove('show'); }, 3200);
  }
  function ingest(trip, overrides, places, opts) {
    opts = opts || {};
    TRIP = clone(trip);
    OVERRIDES = Array.isArray(overrides) ? overrides : ((overrides && overrides.overrides) || []);
    if (places && places.places) { PLACES = places.places; CITIES = places.cities || CITIES || {}; }
    else { PLACES = places || PLACES || {}; }
    applyOverrides(); indexTrip();
    if (!window.JP27.ready) return;
    quietRender = true; buildNav(); render(); quietRender = false;
    var sheet = $('#dietsheet');
    if (sheet && (sheet.open || sheet.hasAttribute('open'))) $('#diet-b').innerHTML = dietHTML();
    if (opts.updated) toast('Plan updated');
    window.__trip = { trip: TRIP, state: state, overrides: function () { return TRIP._overrideReport; } };
  }

  /* ---------------- boot ---------------- */
  function getJSON(u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); }); }
  window.JP27 = { renderLive: function () { if (TRIP) renderLive(); }, now: now, ls: LS, state: function () { return TRIP ? state() : null }, ready: false,
    provideData: function (d, opts) { window.JP27._pending = { d: d, opts: opts || {} }; } };
  function boot() {
    if (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) document.documentElement.classList.add('ios');
    if (MOCK) { var mb = $('#mockbar'); mb.hidden = false; mb.textContent = 'Mock clock · ' + fmtDayJST(now()) + ' · ' + fmtJST(now()) + ' JST'; }
    gate().then(function () {
      // App-shell mode (CFG.dataSource === 'firestore'): the public site carries no itinerary; js/live.js
      // fetches it from Firestore after this phone is linked and hands it over via JP27.provideData().
      if (CFG.dataSource === 'firestore') {
        $('#view').innerHTML = '<div class="shell-wait"><span class="sun big" aria-hidden="true"></span><h1>Japan 2027</h1><p class="shell-sub">Nic &amp; Elly · 9–21 January</p><div class="live-slot" id="shell-slot"></div></div>';
        document.body.classList.add('v-shell');
        if (window.JP27._pending) return Promise.resolve([window.JP27._pending.d.trip, window.JP27._pending.d.overrides || [], window.JP27._pending.d.places || {}]);
        return new Promise(function (res) {
          window.JP27.provideData = function (d, opts) {
            window.JP27._pending = { d: d, opts: opts || {} };
            res([d.trip, d.overrides || [], d.places || {}]);
            if (window.JP27.ready) ingest(d.trip, d.overrides || [], d.places || {}, opts || {});
          };
          if (window.JP27_LIVE && window.JP27_LIVE.refresh) window.JP27_LIVE.refresh();
        });
      }
      return Promise.all([getJSON('data/trip.json'), getJSON('data/overrides.json').catch(function () { return { overrides: [] }; }), getJSON('data/places.json').catch(function () { return {}; })]);
    }).then(function (r) {
      document.body.classList.remove('v-shell');
      TRIP = clone(r[0]); OVERRIDES = Array.isArray(r[1]) ? r[1] : (r[1].overrides || []); PLACES = r[2].places || {}; CITIES = r[2].cities || {};
      applyOverrides(); indexTrip(); buildNav(); bind(); render();
      $('#dietbtn').hidden = false; // only once a plan is loaded (app-shell mode starts without one)
      document.body.classList.add('has-plan');
      if (wxWanted()) loadWeather(); else renderWeather();
      setInterval(function () { if (MOCK) $('#mockbar').textContent = 'Mock clock · ' + fmtDayJST(now()) + ' · ' + fmtJST(now()) + ' JST'; renderLive(); }, 30000);
      document.addEventListener('visibilitychange', function () { if (!document.hidden) renderLive(); });
      if (/[?&]qa=1/.test(location.search)) setTimeout(qaReport, 1200);
      window.JP27.ready = true;
      window.JP27.provideData = function (d, opts) { window.JP27._pending = { d: d, opts: opts || {} }; ingest(d.trip, d.overrides || [], d.places || {}, opts || {}); };
      if (window.JP27._pending) ingest(window.JP27._pending.d.trip, window.JP27._pending.d.overrides || [], window.JP27._pending.d.places || {}, window.JP27._pending.opts || {});
      document.dispatchEvent(new Event('jp27:ready'));
      window.__trip = { trip: TRIP, state: state, overrides: function () { return TRIP._overrideReport; } };
    }).catch(function (e) {
      $('#view').innerHTML = '<div class="empty"><span class="sun big" aria-hidden="true"></span><h2>Couldn’t load the plan</h2><p>' + (navigator.onLine ? 'Something went wrong — try again.' : 'You’re offline and this device hasn’t saved the plan yet. Open it once with internet.') + '</p><button class="btn btn-p" onclick="location.reload()">Try again</button><p class="fine">' + esc(e.message) + '</p></div>';
    });
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(function (reg) {
          // a Home Screen app can stay "open" for days: look for a new version whenever it comes back
          document.addEventListener('visibilitychange', function () { if (!document.hidden && navigator.onLine) reg.update().catch(function () {}); });
        }).catch(function () {});
      });
      // A new version took over. Reload only when it can't interrupt anything: right after launch, or the next
      // time the app comes back to the foreground. The first install has nothing stale (and reloading then
      // used to drop a tapped setup link).
      var swOnce = false, hadController = !!navigator.serviceWorker.controller, t0 = Date.now();
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (swOnce || !hadController) return; swOnce = true;
        var busy = function () { return document.querySelector('dialog[open]') || (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)); };
        if (Date.now() - t0 < 8000 && !busy()) { location.reload(); return; }
        document.addEventListener('visibilitychange', function () { if (!document.hidden && !busy()) location.reload(); });
      });
    }
  }
  boot();
})();
