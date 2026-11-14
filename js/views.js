/* views: HTML for the day view, the planning panels (bookings / watch / prep / sources), the trip overview (#trip),
   the diet sheet and the deadlines box. Planner HTML is inserted as extracted (verbatim); app text is escaped. */
(function (T) {
  'use strict';
  var P = T.plan, R = T.reading, N = T.nowModel, LS = T.LS, esc = T.esc, ic = T.ic, svgI = T.svgI;
  var V = T.views = {};
  var FLAG_IC = { access: '🎟️', ok: '✅', diet: '⚠️', act: '📅', deadline: '⏰', time: '⏰', info: '💡', alert: '⚠️' };
  var STATUS_IC = { booked: '✅', walkin: '🚶', target: '🎯', plan: '📌', moved: '↪️' };

  /* ---------------- shared atoms ---------------- */
  /* small "updated Nov 10" tag on anything an override touched */
  var updTag = V.updTag = function (o) {
    if (!o || !o._upd || !o._upd.length) return '';
    var u = o._upd[0], d = new Date(u.date + 'T12:00:00Z');
    var lbl = 'updated ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    return '<span class="upd" title="' + esc(o._upd.map(function (x) { return x.reason; }).join(' · ')) + '">' + esc(lbl) + '</span>';
  };
  var codeHTML = function (code) { return '<span class="ref-c">' + R.chunkCode(code).map(function (c) { return '<span class="cc">' + esc(c) + '</span>'; }).join('') + '</span>'; };
  var COPY_I = '<svg class="ref-ic" aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>' +
    '<svg class="ref-ok-i" aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  /* tap-to-copy chip: shows the chunked code, copies the raw one (data-copy) */
  function copyRefHTML(r) { return '<button type="button" class="ref ref-copy" data-copy="' + esc(r.code) + '" data-label="' + esc(r.label) + '" aria-label="Copy ' + esc(r.label) + ' ' + esc(r.code) + '"><span class="ref-k">' + esc(r.label) + '</span>' + codeHTML(r.code) + COPY_I + '</button>'; }
  /* Elly's diet chip on food stops (force: also when the stop's own diet line is on the card) */
  V.dietChip = function (stop, force) {
    if (!R.isFood(stop)) return '';
    if (R.hasOwnDiet(stop) && !force) return ''; // the stop's own diet line is already on the card face
    return '<button type="button" class="diet-chip" data-act="diet" aria-label="Elly’s diet: ' + esc(R.dietText(stop)) + '. Open the diet card"><span class="dc-i" aria-hidden="true">⚠️</span><span class="dc-t">' + esc(R.dietText(stop)) + '</span></button>';
  };
  /* Navigate link on a stop card */
  function navHTML(stop) {
    var t = N.navTarget(stop); if (!t) return '';
    return '<a class="lk lk-b lk-nav" href="' + esc(N.dirURL(t)) + '" target="_blank" rel="noopener" data-nav="' + (t.lat != null ? 'll' : 'q') + '"' +
      ' aria-label="Navigate to ' + esc(t.label || stop.name) + '">' + svgI('nav') + 'Navigate</a>';
  }
  function moreHTML(m) { return '<details class="more"><summary>Details</summary><div class="more-b"><div class="prose">' + m + '</div></div></details>'; }

  /* ---------------- booking windows ---------------- */
  var dlItemHTML = V.dlItemHTML = function (x) {
    return '<li class="' + (x.b.urgent || x.open ? 'urgent' : '') + '"><span class="dl-w">' + ic('⏰') + (x.open ? '<b class="dl-open">' + (/open/i.test(x.b.when || '') ? 'Open now' : 'Due now') + '</b> · ' : '') + esc(x.b.when) + '</span><span class="dl-t">' + esc(x.b.what) + '</span></li>';
  };
  V.deadlinesHTML = function (n, title) {
    var list = N.deadlines(n);
    if (!list.length) return '';
    return '<section class="w" aria-label="Upcoming deadlines"><h2 class="w-h">' + esc(title || 'Coming up · booking windows') + '</h2><ul class="dl-list">' +
      list.map(dlItemHTML).join('') + '</ul><div class="w-act"><a class="btn" href="#bookings">All bookings</a></div><p class="fine">Times as written in the planner (Pacific unless marked JST).</p></section>';
  };

  /* ---------------- day view ---------------- */
  function flagsHTML(fl) {
    return (fl || []).map(function (f) {
      return '<p class="fl fl-' + esc(f.kind) + '"><span class="fl-k">' + (FLAG_IC[f.kind] ? ic(FLAG_IC[f.kind]) : '') + esc(f.key) + '</span><span class="fl-t">' + f.html + '</span></p>'; }).join('');
  }
  /* quick checks (QC): verdict + rows + my own checklist (jp27.qc) */
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
    var ti = R.typeIcon(s.typeLabel);
    var h = '<article class="' + cls + '"><div class="s-top"><div><h3 class="s-name">' + esc(s.name) + '</h3>' +
      (s.typeLabel || s._upd ? '<p class="s-what">' + (ti ? ic(ti) : '') + esc(s.typeLabel || '') + (s._upd ? ' ' + updTag(s) : '') + '</p>' : '') + '</div>' + st + '</div>';
    if (s.action) h += '<p class="s-act">' + esc(s.action) + '</p>';
    if (s.flags && s.flags.length) h += '<div class="fls">' + flagsHTML(s.flags) + '</div>';
    if (s.getThere) h += '<p class="s-get">' + ic('📍') + '<b>' + esc(s.getThere.label) + '</b> ' + s.getThere.html + '</p>';
    // boarding lines not already printed by the day's start note or the route card right before
    var board = s._day ? R.transitLines({ stop: s, day: s._day }).filter(function (c) { return !(P.day(s._day).start2 || []).some(function (h) { return R.plain(h).indexOf(c) >= 0; }) && !R.routeHas(s, c); }) : [];
    if (board.length) h += '<div class="s-board"><span class="sb-k">' + ic('🚉') + 'Boarding</span><ul>' + board.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul></div>';
    var refs = R.refsOf(s).filter(function (r) { return (s.flags || []).map(function (f) { return R.plain(f.html); }).join(' ').indexOf(r.code) < 0; });
    if (refs.length) h += '<p class="s-refs">' + refs.map(copyRefHTML).join('') + '</p>';
    h += V.dietChip(s);
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
    var p = R.splitDots(html), L = lead ? ic(lead) : '';
    if (p.length < 2) return '<p class="' + cls + '-t">' + L + html + '</p>';
    return '<p class="' + cls + '-t ' + cls + '-h">' + L + p[0] + '</p><ul class="steps">' + p.slice(1).map(function (x) {
      return '<li' + (/^(or|backup)\b/i.test(x.replace(/<[^>]+>/g, '')) ? ' class="alt"' : '') + '>' + x + '</li>'; }).join('') + '</ul>';
  }
  var NOTICE_IC = { warn: '⚠️', plan: '🔁', info: '💡' };
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
        var nic = NOTICE_IC[it.tone] || '';
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
  /* glance facts → chips (short) and quiet lines (the long cost caveat), same words */
  function glanceHTML(glance) {
    var chips = [], longs = [], money = false;
    R.splitDots(glance).forEach(function (g) {
      var t = g.replace(/<[^>]+>/g, '');
      if (t.length > 48) { longs.push(g); return; }
      var e = /^[~≈]?[¥$]/.test(t) ? (money ? '' : (money = true, '💴')) : /\d(\.\d)?\s?(mi|km)$/.test(t) ? '📍' : /^(easy|moderate|hard|steady|light|busy)/i.test(t) ? '🚶' : /loose|free\b/i.test(t) ? '⏳' : '';
      chips.push('<li>' + (e ? ic(e) : '') + g + '</li>');
    });
    return '<ul class="glance" aria-label="At a glance">' + chips.join('') + '</ul>' + longs.map(function (g) { return '<p class="glance-n">' + g + '</p>'; }).join('');
  }
  V.dayHTML = function (d) {
    var i = P.days.indexOf(d.day), prev = P.days[i - 1], next = P.days[i + 1];
    var pf = V.partyFilterHTML(d), stT = N.state();
    if (pf && stT.phase === 'trip' && stT.day === d.day) pf = pf.replace('class="party-f"', 'class="party-f pf-hero-today"');
    var h = '<header class="d-hero"><p class="d-eyebrow">' + esc(d.eyebrow) + '</p><h1 class="d-title">' + esc(d.title) + '</h1>' + pf +
      '<p class="d-start"><span class="k">' + esc(d.start.label) + '</span>' + d.start.html + ' <span class="tz">' + esc(d.start.tz) + '</span></p>' +
      d.start2.map(function (s) { return '<p class="d-start2">' + s + '</p>'; }).join('');
    if (d.glance) h += glanceHTML(d.glance);
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
    h += '<nav class="d-nav" aria-label="Day navigation">' + (prev ? '<a href="#d' + prev + '" class="pv"><span>‹ Previous</span>' + esc(P.dayLabel(P.day(prev))) + '</a>' : '<span></span>') +
      (next ? '<a href="#d' + next + '" class="nx"><span>Next ›</span>' + esc(P.dayLabel(P.day(next))) + '</a>' : '<span></span>') + '</nav>';
    return h;
  };
  /* split day: Both / Nic / Elly buttons (choice kept in jp27.party) */
  V.partyFilterHTML = function (d) {
    if (!d || !d.partyFilter || !d.partyFilter.length) return '';
    var curP = N.partyPick();
    return '<div class="party-f" role="group" aria-label="Show whose plan">' + d.partyFilter.map(function (b) {
      return '<button type="button" data-show="' + esc(b.show) + '" aria-pressed="' + (curP === b.show) + '">' + esc(b.label) + '</button>'; }).join('') + '</div>';
  };
  V.applyParty = function () {
    var cur = N.partyPick();
    T.$$('.party[data-party]').forEach(function (p) { p.hidden = !(cur === 'all' || p.getAttribute('data-party') === cur); });
    T.$$('.party-f button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-show') === cur)); });
  };

  /* ---------------- the trip at a glance (#trip) ----------------
     Everything here is planner text (day titles, hotels from the day headers, the confirmed facts, stop names and their
     type labels) except the few app labels marked GEN, which Nic should review (see CLAUDE-REPORT). */
  function confirmedFacts() {
    var bk = P.panel('bookings'), c = bk && bk.parts.filter(function (x) { return x.kind === 'confirmed'; })[0];
    return c ? c.facts : [];
  }
  var GLOSSARY = [ // GEN: app's own explanations of words the planner uses
    ['JST', 'Japan time'], ['N’EX', 'Narita Express — the airport train'], ['Shinkansen', 'bullet train'], ['Hikari · Nozomi', 'bullet-train services'],
    ['Romancecar', 'Odakyu’s express train to Hakone'], ['Ryokan', 'traditional Japanese inn'], ['Konbini', 'convenience store'],
    ['Suica', 'tap-on transit card'], ['Kaiseki', 'multi-course Japanese dinner'], ['Ekiben', 'boxed lunch for the train']];
  function navDays(g) { return g.days.map(function (x) { return +x.id.slice(1); }); } // nav group "d14" ids → day numbers
  V.tripHTML = function () {
    var DAYS = P.days, first = P.day(DAYS[0]), last = P.day(DAYS[DAYS.length - 1]), facts = confirmedFacts(), st = N.state(), today = st.phase === 'trip' ? st.day : null;
    var factOf = function (re) { return facts.filter(function (f) { return re.test(f.key); })[0]; };
    var h = '<header class="p-hero"><p class="d-eyebrow">' + esc(P.dayLabel(first)) + ' – ' + esc(P.dayLabel(last)) + '</p><h1 class="p-title">The trip</h1></header>';
    // route: city → city, nights, hotel (hotel = the day header after the date)
    h += '<section class="ov-route" aria-label="Route"><ol>' + P.trip.nav.map(function (g) {
      var ds = navDays(g), d0 = P.day(ds[0]), hotel = d0.eyebrow.split(' · ').slice(1).join(' · ').replace(/^→\s*/, '');
      return '<li><a href="#d' + ds[0] + '"><span class="ov-c">' + esc(g.city) + '</span><span class="ov-dates">' + esc(g.days[0].label) + (ds.length > 1 ? ' – ' + esc(g.days[ds.length - 1].label) : '') + '</span>' +
        '<span class="ov-h">' + ic('🏨') + esc(hotel) + '</span></a></li>';
    }).join('') + '</ol></section>';
    var fl = factOf(/flight/i), beds = factOf(/bed/i);
    if (fl || beds) h += '<section class="ov-box"><h2 class="ov-k">Flights &amp; hotels</h2>' + (fl ? '<p>' + ic('✈️') + fl.paras[0] + '</p>' : '') + (beds ? '<p>' + ic('🛏️') + beds.paras[0] + '</p>' : '') + '</section>';
    // getting between cities
    var mv = [];
    DAYS.forEach(function (n) { R.moves(P.day(n)).forEach(function (m) { mv.push({ day: n, m: m }); }); });
    if (mv.length) h += '<section class="ov-box"><h2 class="ov-k">Getting between places</h2><ul class="ov-moves">' + mv.map(function (x) {
      return '<li><a href="#d' + x.day + '"' + (x.m.s ? ' data-jump="' + x.m.s.uid + '"' : '') + '><span class="ov-md">' + esc(P.dayLabel(P.day(x.day))) + '</span><span><b>' + esc(x.m.t) + '</b>' + (x.m.sub ? '<span class="ov-ms">' + ic('🚆') + esc(x.m.sub) + '</span>' : '') + '</span></a></li>'; }).join('') + '</ul></section>';
    // day by day
    h += '<h2 class="p-h">Day by day</h2><ol class="ov-days">' + DAYS.map(function (n) {
      var d = P.day(n), hl = R.highlights(d), booked = (P.stops[n] || []).filter(function (x) { return x.stop.status && x.stop.status.kind === 'booked'; }).length, travel = R.moves(d).length;
      return '<li class="' + (n === today ? 'is-today' : '') + '"><a href="#d' + n + '"><span class="ov-dd"><b>' + n + '</b>' + esc(d.eyebrow.split(' ')[0]) + '</span><span class="ov-db"><span class="ov-dt">' + esc(d.title) + (n === today ? ' <span class="ov-now">Today</span>' : '') + '</span>' +
        (hl.length ? '<span class="ov-hl">' + esc(hl.join(' · ')) + '</span>' : '') +
        '<span class="ov-tags"><span>' + esc(N.cityOf(d)) + '</span>' + (travel ? '<span>' + ic('🚆') + 'travel day</span>' : '') + (booked ? '<span class="ok">' + ic('✅') + booked + ' booked</span>' : '') + '</span></span><span class="chev" aria-hidden="true">›</span></a></li>';
    }).join('') + '</ol>';
    // booked vs flexible
    var conf = facts.filter(function (f) { return !/people|flight|bed/i.test(f.key); });
    h += '<section class="ov-box"><h2 class="ov-k">Booked for sure</h2><ul class="ov-conf">' + conf.map(function (f) { return '<li>' + ic('✅') + '<b>' + esc(f.key) + '</b> ' + f.paras[0] + '</li>'; }).join('') + '</ul>' +
      '<p class="ov-legend"><span class="st st-booked">' + ic('✅') + 'Booked</span><span class="st st-target">' + ic('🎯') + 'Target</span><span class="st st-walkin">' + ic('🚶') + 'Walk-in</span><span class="st">' + ic('📌') + 'Plan</span></p>' +
      '<p class="fine">Everything without “Booked” is flexible. ~ before a time means about.</p><div class="w-act"><a class="btn" href="#bookings">All bookings</a></div></section>';
    h += '<details class="grp ov-gl"><summary><span>Words you’ll see</span></summary><dl class="gl">' + GLOSSARY.map(function (g) { return '<dt>' + esc(g[0]) + '</dt><dd>' + esc(g[1]) + '</dd>'; }).join('') + '</dl></details>';
    h += '<p class="ov-foot"><a href="#sources">Sources</a> · <a href="#prep">Prep</a> · <a href="#watch">Watch list</a><span class="kbd-hint"> · ' + (/Mac|iP(hone|ad)/.test(navigator.platform || navigator.userAgent) ? '⌘K' : 'Ctrl+K') + ' to jump</span></p>';
    return h;
  };
  V.navDays = navDays;
  V.meLinks = function () {
    return '<div class="me-links"><a class="row-link" href="#trip">' + ic('🗺️') + 'The trip at a glance<span class="chev" aria-hidden="true">›</span></a>' +
      '<a class="row-link" href="#sources">' + ic('📚') + 'Sources<span class="chev" aria-hidden="true">›</span></a></div>';
  };

  /* ---------------- planning panels ---------------- */
  /* Bookings: confirmations (overrides.confirmations, tap to copy) + references the plan itself holds */
  function refsBoxHTML() {
    var refs = R.allRefs(), CI = (P.confs && P.confs.items) || [], CM = (P.confs && P.confs.missing) || [];
    if (!refs.length && !CI.length) return '';
    var fine = !CI.length ? '<p class="fine">Only these are written in the plan. Other confirmations are in your email.</p>'
      : CM.length ? '<p class="fine">Not in email yet: ' + CM.map(function (m) { return esc(m.name) + ' (' + esc(m.dates) + ') · see the ' + esc(m.where); }).join('; ') + '. Tap a number to copy it.</p>'
      : '<p class="fine">Tap a number to copy it.</p>';
    return '<section class="refs-box" aria-label="Booking references"><h2>' + ic('🎫') + 'Booking references</h2>' +
      CI.map(function (c) { return '<div class="refs-i"><span class="refs-n">' + esc(c.name) + '<span class="refs-d">' + esc(c.dates) + (c.provider ? ' · ' + esc(c.provider) : '') + '</span></span>' + (c.refs || []).map(copyRefHTML).join('') + '</div>'; }).join('') +
      refs.map(function (x) {
        return '<a class="refs-i" href="#d' + x.day + '" data-jump="' + x.s.uid + '"><span class="refs-n">' + esc(x.s.stop.name) + '<span class="refs-d">' + esc(P.dayLabel(P.day(x.day))) + ' · ' + esc(x.s.stop.time) + '</span></span>' +
          x.refs.map(function (r) { return '<span class="ref"><span class="ref-k">' + esc(r.label) + '</span> ' + codeHTML(r.code) + '</span>'; }).join('') + '</a>';
      }).join('') + fine + '</section>';
  }
  function factIcon(key) { return /flight/i.test(key) ? '✈️' : /bed|hotel/i.test(key) ? '🏨' : /people/i.test(key) ? '👥' : '🎟️'; }
  /* one part of a panel; consecutive bookings share a .bk-list wrapper (opened/closed by panelHTML) */
  function partHTML(x, done) {
    switch (x.kind) {
      case 'heading': return '<h2 class="p-h">' + esc(x.text) + '</h2>';
      case 'para': return '<p class="p-para' + (x.muted ? ' muted' : '') + '">' + x.html + '</p>';
      case 'confirmed':
        return '<section class="cf-box"><h2>' + esc(x.heading) + '</h2><p class="muted small">' + x.note + '</p>' + x.facts.map(function (f) {
          return '<div class="cf"><span class="cf-k">' + ic(factIcon(f.key)) + esc(f.key) + '</span><div class="cf-m">' + f.paras.map(function (q) { return '<p>' + q + '</p>'; }).join('') + '</div>' +
            f.more.map(moreHTML).join('') + '</div>';
        }).join('') + '</section>';
      case 'booking':
        var on = !!done[x.key];
        return '<div class="bk' + (x.urgent ? ' urgent' : '') + (on ? ' is-done' : '') + ' rv"><label class="bk-c"><input type="checkbox" data-bk="' + esc(x.key) + '"' + (on ? ' checked' : '') + ' aria-label="My checklist: ' + esc(x.what) + '"></label>' +
          '<div><p class="bk-when">' + ic(x.urgent ? '⚠️' : '⏰') + esc(x.when) + '</p><p class="bk-what">' + esc(x.what) + ' ' + updTag(x) + '</p>' + x.notes.map(function (n) { return '<p class="bk-n">' + n + '</p>'; }).join('') + '</div>' +
          x.more.map(moreHTML).join('') + '</div>';
      case 'group':
        return '<details class="grp rv"' + (x.open ? ' open' : '') + '><summary><span>' + x.title + '</span>' + updTag(x) + '</summary><div class="grp-b prose">' + x.html +
          (x.shoes || []).map(function (s) {
            return '<div class="shoe"><a class="shoe-n" href="' + esc(s.href) + '" target="_blank" rel="noopener">' + esc(s.name) + '</a><div class="shoe-s">' + s.spec.concat(s.meta).map(function (z) { return '<span>' + z + '</span>'; }).join('') + '</div>' + s.html + '</div>';
          }).join('') + (x.qc || []).map(qcHTML).join('') + '</div></details>';
      default: return '<div class="prose">' + (x.html || '') + '</div>';
    }
  }
  V.panelHTML = function (p) {
    var h = '<header class="p-hero"><h1 class="p-title">' + esc(p.title) + '</h1>' + (p.lead ? '<p class="p-lead">' + esc(p.lead) + '</p>' : '') + '</header>';
    if (p.id === 'bookings') h += refsBoxHTML();
    var done = LS.get('bk', {}), inList = false;
    p.parts.forEach(function (x) {
      var isBk = x.kind === 'booking';
      if (isBk !== inList) { h += isBk ? '<div class="bk-list">' : '</div>'; inList = isBk; }
      h += partHTML(x, done);
    });
    if (inList) h += '</div>';
    return h;
  };

  /* ---------------- diet sheet: the planner's allergy card + the diet flags of the day on screen ---------------- */
  V.dietHTML = function () {
    var prep = P.panel('prep');
    var card = prep && prep.parts.filter(function (x) { return x.kind === 'group' && /allergy card/i.test(x.title); })[0];
    var h = card ? '<div class="diet-card">' + card.html + '</div>' : '';
    var route = T.router.route, day = route.view === 'day' ? route.day : (N.state().day || P.days[0]), d = P.day(day), rows = [];
    (P.stops[day] || []).forEach(function (s) { (s.stop.flags || []).forEach(function (f) { if (f.kind === 'diet') rows.push('<li><b>' + esc(s.stop.name) + '</b> — ' + f.html + '</li>'); }); });
    h += '<div class="diet-today"><h3>Diet notes · ' + esc(P.dayLabel(d)) + '</h3>' + (rows.length ? '<ul>' + rows.join('') + '</ul>' : '<p class="muted">No diet flags on this day’s stops.</p>') + '</div>';
    return h;
  };
})(window.TripApp);
