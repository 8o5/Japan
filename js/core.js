/* Japan 2027 · Nic & Elly — static trip app. No framework, no build step.
   Classic scripts sharing one namespace (window.TripApp), loaded with `defer` in this order:
   core → plan → reading → now → weather → views → nowcard → app (see CLAUDE.md, docs/adr/0004).
   core: DOM + storage helpers, the Japan-time clock, icons, toast. */
(function (T) {
  'use strict';
  T.CFG = window.APP_CONFIG || {};
  T.$ = function (s, r) { return (r || document).querySelector(s); };
  T.$$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  /* The only storage seam: every key is "jp27." + k, JSON-encoded. */
  T.LS = {
    get: function (k, d) { try { var v = localStorage.getItem('jp27.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('jp27.' + k, JSON.stringify(v)); } catch (e) {} }
  };
  T.reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var touchMac = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  T.IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || touchMac;
  T.IS_APPLE = /iP(hone|ad|od)|Macintosh/.test(navigator.userAgent) || touchMac; // Apple Maps vs Google Maps
  /* Router state shared by the renderers (owned by js/app.js). */
  T.router = { route: { view: 'day', day: 9 }, lastDay: null, rendered: false, quiet: false, pendingJump: null };
  T.sheet = { open: null }; // which content the shared #mesheet shows: 'me' | 'wx' | null

  /* ---------------- time (always Asia/Tokyo; Japan has no DST → fixed +09:00) ---------------- */
  var MOCK = null;
  (function () {
    var q = new URLSearchParams(location.search).get('now');
    if (q) { var t = Date.parse(q.replace(' ', '+')); if (!isNaN(t)) MOCK = { base: t, at: Date.now() }; }
  })();
  T.MOCK = MOCK;
  var now = T.now = function () { return MOCK ? MOCK.base + (Date.now() - MOCK.at) : Date.now(); };
  var JST = 9 * 3600e3;
  var jst = T.jst = function (ms) { var d = new Date(ms + JST); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() }; };
  T.jstAt = function (day, mins) { return Date.UTC(2027, 0, day, 0, mins) - JST; };
  T.fmtJST = function (ms) {
    var j = jst(ms), h = j.h % 12 || 12;
    return h + ':' + String(j.mi).padStart(2, '0') + ' ' + (j.h < 12 ? 'AM' : 'PM');
  };
  T.parseClock = function (s) {
    if (!s || /^by\b/i.test(s)) return null;
    var m = /(\d{1,2}):(\d{2})\s*(?:[–-]\s*\d{1,2}:\d{2}\s*)?(AM|PM)/.exec(s);
    if (!m) return null;
    var h = (+m[1]) % 12 + (m[3] === 'PM' ? 12 : 0);
    return h * 60 + (+m[2]);
  };
  T.until = function (ms) {
    var min = Math.round((ms - now()) / 60000);
    if (min <= 0) return 'now';
    if (min < 60) return 'in ' + min + ' min';
    var h = Math.floor(min / 60), mm = min % 60;
    if (h < 24) return 'in ' + h + ' h' + (mm && h < 5 ? ' ' + mm + ' min' : '');
    var d = Math.floor(h / 24), hh = h % 24;
    return 'in ' + d + (d === 1 ? ' day' : ' days') + (d < 3 && hh ? ' ' + hh + ' h' : '');
  };
  var WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var fmtDayJST = T.fmtDayJST = function (ms) { var j = jst(ms), wd = new Date(Date.UTC(j.y, j.m - 1, j.d)).getUTCDay(); return WD[wd] + ' ' + j.d + ' ' + MON[j.m - 1]; };
  /* "Today" / "Tomorrow" / "Sat 16 Jan", always by the Japan calendar */
  T.dayWord = function (ms) {
    var a = jst(now()), b = jst(ms), da = Date.UTC(a.y, a.m - 1, a.d), db = Date.UTC(b.y, b.m - 1, b.d), n = Math.round((db - da) / 864e5);
    return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : fmtDayJST(ms);
  };

  /* ---------------- markup atoms ---------------- */
  T.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  T.ic = function (e) { return '<span class="ic" aria-hidden="true">' + e + '</span>'; };
  /* tiny stroke icons (own drawings, currentColor) */
  var SVG = {
    nav: '<path d="M20.5 3.5 3.8 10.6c-.8.4-.7 1.5.1 1.7l6.6 1.2 1.2 6.6c.2.9 1.3 1 1.7.1z" fill="currentColor" stroke="none"/>',
    loc: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
    link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3.2-3.2a4.5 4.5 0 0 0-6.4-6.4l-1.3 1.3"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3.2 3.2a4.5 4.5 0 0 0 6.4 6.4l1.3-1.3"/>',
    bell: '<path d="M18 9.5a6 6 0 0 0-12 0c0 6.5-2.5 8-2.5 8h17S18 16 18 9.5"/><path d="M10.2 20.5a2 2 0 0 0 3.6 0"/>'
  };
  T.svgI = function (k) { return '<svg class="i" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + (SVG[k] || '') + '</svg>'; };

  /* ---------------- small shared utilities ---------------- */
  T.clone = function (o) { return JSON.parse(JSON.stringify(o)); };
  T.getJSON = function (u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); }); };
  T.toast = function toast(msg) {
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
  };
})(window.TripApp = {});
