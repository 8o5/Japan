/* nowcard: the Now / Next card (desktop side column + phone top slot), the phone "Next · Go" bar, the timeline's
   now/next/past marks, page-open trip alerts, and renderLive() — the 30-second tick that redraws all of them. */
(function (T) {
  'use strict';
  var P = T.plan, R = T.reading, N = T.nowModel, V = T.views, W = T.weather, LS = T.LS, CFG = T.CFG;
  var $ = T.$, $$ = T.$$, esc = T.esc, ic = T.ic, svgI = T.svgI, now = T.now, until = T.until, fmtJST = T.fmtJST;
  var C = T.nowcard = {};

  /* ---------------- page-open notifications (fallback when closed-app push is off) ---------------- */
  var notified = LS.get('notified', {});
  function notify(key, title, body) {
    if (!LS.get('notify', false) || LS.get('pushOn', false) || !('Notification' in window) || Notification.permission !== 'granted' || notified[key]) return;
    notified[key] = 1; LS.set('notified', notified);
    var opts = { body: body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: key };
    if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.ready.then(function (r) { r.showNotification(title, opts); });
    else try { new Notification(title, opts); } catch (e) {}
  }
  /* "My location" button: one fix on tap (jp27.geo), denial remembered (jp27.geoDenied) */
  C.askLocation = function (btn) {
    var lbl = btn.querySelector('span') || btn;
    if (!navigator.geolocation) { lbl.textContent = 'Unavailable'; return; }
    lbl.textContent = 'Locating…'; btn.classList.add('busy');
    navigator.geolocation.getCurrentPosition(function (p) {
      N.geo = { lat: p.coords.latitude, lng: p.coords.longitude, at: now() }; LS.set('geo', N.geo); LS.set('geoDenied', false); C.renderLive();
    }, function (err) {
      if (err && err.code === 1) { LS.set('geoDenied', true); N.geo = null; LS.set('geo', null); C.renderLive(); }
      else { lbl.textContent = 'Try again'; btn.classList.remove('busy'); T.toast('Couldn’t get your location'); }
    }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 });
  };

  /* ---------------- Now card pieces ---------------- */
  function clockHead(st) {
    return '<div class="nc-top"><p class="nc-clock"><span class="live" aria-hidden="true"></span>' + esc(fmtJST(st.t)) +
      '<span class="nc-tz">' + esc(T.fmtDayJST(st.t)) + ' · Japan</span></p>' + (navigator.onLine ? '' : '<span class="nc-net">Offline · saved plan</span>') + '<div class="wx-inline"></div></div>';
  }
  function partyTag(s) { return s.party && !N.partyMe() ? '<span class="who w-' + esc(s.party) + '">' + (s.party === 'nic' ? 'Nic' : 'Elly') + '</span> ' : ''; }
  function ncRow(kind, s, day, st) {
    var other = day !== st.day, when = other ? T.dayWord(s.t) : '';
    var badge = kind === 'Next' ? (other ? '<span class="nc-badge nc-badge-q">' + esc(when) + '</span>' : '<span class="nc-badge">' + esc(until(s.t)) + '</span>') : '';
    return '<a class="nc-row nc-' + kind.toLowerCase() + '" href="#d' + day + '" data-jump="' + s.uid + '">' +
      '<span class="nc-k">' + kind + '</span>' + badge +
      '<span class="nc-n">' + partyTag(s) + esc(s.stop.name) + '</span>' +
      '<span class="nc-m">' + esc(s.stop.time) + (s.stop.typeLabel ? ' · ' + esc(s.stop.typeLabel) : '') + '</span>' +
      (s.stop.action ? '<span class="nc-a">' + esc(s.stop.action) + '</span>' : '') + '</a>' + (R.isFood(s.stop) ? '<div class="nc-chip">' + V.dietChip(s.stop, true) + '</div>' : '');
  }
  /* untimed stops still ahead today (max 2 shown), without the bag move (it has its own row) */
  function laterHTML(st) {
    var bi = st.phase === 'trip' ? N.bagInfo(st.day) : null;
    if (bi && st.later) st = Object.assign({}, st, { later: st.later.filter(function (x) { return x.uid !== bi.s.uid; }) });
    if (!st.later || !st.later.length) return '';
    var head = N.nextToday(st) ? 'Before that' : 'Later today', more = st.later.length - 2;
    return '<div class="nc-later"><p class="nc-k">' + head + '</p><ul>' + st.later.slice(0, 2).map(function (s) {
      return '<li><a href="#d' + st.day + '" data-jump="' + s.uid + '"><span class="nc-lt">' + esc(s.stop.time) + '</span><span class="nc-ln">' + partyTag(s) + esc(s.stop.name) +
        (s.stop.action ? '<span class="nc-la">' + esc(s.stop.action) + '</span>' : '') + '</span></a>' + (R.isFood(s.stop) ? V.dietChip(s.stop, true) : '') + '</li>'; }).join('') + '</ul>' +
      (more > 0 ? '<a class="nc-more" href="#d' + st.day + '" data-jump="' + st.later[2].uid + '">+' + more + ' more today</a>' : '') + '</div>';
  }
  function navBtn(stop) {
    var t = stop && N.navTarget(stop); if (!t) return '';
    return '<a class="btn btn-p btn-nav" href="' + esc(N.dirURL(t)) + '" target="_blank" rel="noopener" aria-label="Navigate to ' + esc(R.navName(stop)) + '">' + svgI('nav') + '<span class="bn-t">Navigate to ' + esc(R.navName(stop)) + '</span></a>';
  }
  /* Planner directions next to Navigate — readable with no signal (Maps can't route offline). */
  function wayHTML(s) {
    var w = R.wayLines(s); if (!w.length) return '';
    return '<div class="nc-way"><p class="nc-k">' + (R.isTrain(s.stop) ? 'Boarding' : 'Getting there') + ' · ' + esc(R.shortName(s.stop.name)) + '</p><ul>' +
      w.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' + (navigator.onLine ? '' : '<p class="nc-off">Offline — Maps can’t plan a route; use these.</p>') + '</div>';
  }
  /* today's bag move, unless it is over, already the Now/Next row, or the Now stop already says it */
  function bagHTML(st) {
    var b = N.bagInfo(st.day); if (!b) return '';
    if (b.s.t != null && N.over(b.s, now())) return '';
    if (st.cur && /\bbags?\b|luggage/i.test(st.cur.stop.action || '')) return '';
    if ((st.cur && st.cur.uid === b.s.uid) || (st.next && st.next.uid === b.s.uid)) return '';
    return '<a class="nc-bags" href="#d' + st.day + '" data-jump="' + b.s.uid + '"><span class="nc-bi" aria-hidden="true">🧳</span><span><b>' + esc(b.action) + '</b>' + (b.key ? '<span class="nc-bk">' + esc(b.key) + '</span>' : '') + '</span></a>';
  }
  /* Split day: in one person's lane, the other's current/next solo stop as a quiet line. */
  function otherLaneHTML(st) {
    var me = N.partyMe(); if (!me) return '';
    var other = me === 'nic' ? 'elly' : 'nic', theirs = (P.stops[st.day] || []).filter(function (x) { return x.party === other; });
    if (!theirs.length) return '';
    var cn = N.curNext(theirs.filter(function (x) { return x.t != null; }).sort(function (a, b) { return a.t - b.t; }), st.t);
    var x = cn.cur || cn.next || theirs[0], nm = other === 'nic' ? 'Nic' : 'Elly';
    return '<a class="nc-other" href="#d' + st.day + '" data-jump="' + x.uid + '"><span class="who w-' + other + '">' + nm + '</span> ' + (cn.cur ? 'now' : 'next') + ' · ' + esc(x.stop.name) + ' <span class="nc-ot">' + esc(x.stop.time) + '</span></a>';
  }
  /* js/live.js (Firebase add-on) fills this: link status, Nic/Elly locations, trip alerts. */
  C.liveSlot = function () { var L = window.JP27_LIVE; try { return '<div class="live-slot">' + (L && L.html ? L.html() : '') + '</div>'; } catch (e) { return ''; } };
  /* One quiet line in the Now card pointing to the You sheet when something needs doing. */
  function liveNudge() {
    var L = window.JP27_LIVE, s = null; try { s = L && L.summary ? L.summary() : null; } catch (e) {}
    if (!s) return '';
    var msg = !s.who ? (s.revoked ? 'Re-link this phone' : 'Link this phone for alerts') : !s.alertsOn ? 'Trip alerts are off' : s.warn ? s.warn : '';
    if (!msg) return '';
    return '<button type="button" class="nc-nudge" data-act="me">' + svgI(!s.who ? 'link' : 'bell') + '<span>' + esc(msg) + '</span><span class="chev" aria-hidden="true">›</span></button>';
  }

  /* ---------------- Now card by phase ---------------- */
  function preHTML() {
    var DAYS = P.days, dep = Date.parse(CFG.departure.iso), d0 = P.day(DAYS[0]);
    var h = '<div class="nc-top"><p class="nc-clock"><span class="live" aria-hidden="true"></span>Countdown</p><div class="wx-inline"></div></div>' +
      '<p class="now-big">' + esc(until(dep).replace(/^in /, '')) + '</p>' +
      '<p class="now-sub">to ' + esc(CFG.departure.label) + ' · ' + esc(CFG.departure.when) + '</p>' +
      '<a class="nc-row nc-then" href="#d' + DAYS[0] + '"><span class="nc-k">Then · ' + esc(P.dayLabel(d0)) + '</span><span class="nc-n">' + esc(d0.title) + '</span></a>';
    h += '<a class="nc-trip" href="#trip">' + ic('🗺️') + '<span><b>The trip at a glance</b><span class="nc-tsub">' + esc(P.trip.nav.map(function (g) { return g.city.split(' · ')[0]; }).filter(function (c, i, a) { return a.indexOf(c) === i || i === a.length - 1; }).join(' → ')) + '</span></span><span class="chev" aria-hidden="true">›</span></a>';
    var dl = N.deadlines(3);
    if (dl.length) h += '<div class="now-dl"><p class="nc-k">Next booking windows</p><ul class="dl-list">' + dl.map(V.dlItemHTML).join('') + '</ul></div>';
    return h + liveNudge();
  }
  function postHTML() {
    return '<div class="nc-top"><p class="nc-clock">Trip complete</p></div><p class="now-big">おかえり</p><p class="now-sub">Japan 9–21 Jan 2027 is done. Everything stays here to look back on.</p>';
  }
  function leaveHTML(lb) {
    return '<div class="leave' + (lb.go ? ' go' : lb.soon ? ' soon' : '') + '">' + (lb.go ? ic('🚶') + 'Time to head out' : ic('⏰') + 'Leave by ~' + esc(fmtJST(lb.leaveAt))) +
      '<small>~' + lb.est + ' min ' + (lb.walk ? 'walk' : 'by transit') + ' · ' + lb.km.toFixed(1) + ' km from ' + esc(lb.from) + ' · app estimate</small></div>';
  }
  /* "My location" follows the leave-by window: shown while leave-by shows, or (no known origin yet) once the next stop
     is within 90 min — the 60-min window plus a conservative trip. */
  function geoBtn() {
    var denied = N.geoDenied();
    return '<button class="btn btn-ic" data-act="geo" aria-label="' + (denied ? 'Location is off — try again' : 'Use my location for the leave-by time') + '">' + svgI('loc') + '<span>' + (denied ? 'Location off' : N.geoFresh() ? 'Update' : 'My location') + '</span></button>';
  }
  function tripHTML(st) {
    var lb = N.leaveBy(st), pick = N.navPick(st), tgt = pick ? pick.s.stop : null, today = N.nextToday(st), tomorrow = st.next && !today;
    var h = clockHead(st);
    if (st.flying) h += '<div class="nc-row nc-now"><span class="nc-k">Now</span><span class="nc-n">' + ic('✈️') + 'In the air</span><span class="nc-m">' + esc(CFG.departure.label) + '</span></div>';
    if (st.cur) h += ncRow('Now', st.cur, st.day, st);
    h += bagHTML(st) + otherLaneHTML(st);
    if (tomorrow) h += laterHTML(st);
    if (st.next) h += ncRow('Next', st.next, st.nextDay, st);
    else if (st.home) h += '<div class="nc-row nc-next"><span class="nc-k">Next</span><span class="nc-badge">' + esc(until(st.home)) + '</span><span class="nc-n">' + ic('✈️') + 'Flight home</span><span class="nc-m">' + esc(fmtJST(st.home)) + '</span></div>';
    if (tomorrow) {
      var nd = P.day(st.nextDay);
      h += '<p class="nc-start"><span class="nc-k">' + esc(nd.start.label) + '</span>' + nd.start.html + '</p>';
    }
    if (!st.cur && !st.next && !st.home && !st.flying) h += '<p class="now-sub">Nothing timed left today.</p>';
    if (lb) {
      h += leaveHTML(lb);
      if (lb.go && st.next) notify('lb-' + st.next.uid, 'Start heading out', st.next.stop.name + ' at ' + st.next.stop.time);
    }
    if (!tomorrow) h += laterHTML(st);
    if (today && st.next.t - now() <= LS.get('leadMin', CFG.notifyLeadMin || 30) * 60000 && st.next.t > now()) notify('nx-' + st.next.uid, 'Next: ' + st.next.stop.name, st.next.stop.time + ' · ' + until(st.next.t));
    var showGeo = lb || (today && N.placeOf(st.next.stop) && st.next.t - now() <= 90 * 60000);
    var acts = (st.flying ? '' : navBtn(tgt)) + (showGeo ? geoBtn() : '');
    if (pick) h += wayHTML(pick.s);
    if (acts) h += '<div class="w-act nc-act">' + acts + '</div>';
    if (N.geoDenied() && showGeo) h += '<p class="fine warn">Location is off, so leave-by uses the current stop. Turn on: Settings → Privacy &amp; Security → Location Services → Safari Websites → While Using.</p>';
    return h + liveNudge();
  }
  function nowHTML(st) {
    var h = st.phase === 'pre' ? preHTML() : st.phase === 'post' ? postHTML() : tripHTML(st);
    return '<section class="w nowcard" aria-label="Now and next">' + h + '</section>';
  }
  /* phone, on a day other than today: a one-line "back to today" pill so the day itself comes first */
  function compactNowHTML(st) {
    var n = N.nextToday(st) ? st.next : null;
    return '<section class="w nowcard compact" aria-label="Now and next"><a class="nc-mini" href="#d' + st.day + '" data-jump="' + esc((st.cur || st.next || {}).uid || '') + '">' +
      '<span class="nc-clock"><span class="live" aria-hidden="true"></span>' + esc(fmtJST(st.t)) + '</span>' +
      '<span class="nc-mini-t">' + (st.cur ? '<span class="nc-k">Now</span> ' + esc(st.cur.stop.name) : n ? '<span class="nc-k">Next</span> ' + esc(n.stop.name) + ' · ' + esc(until(n.t)) : 'Back to today') + '</span>' +
      '<span class="nc-go">Today ›</span></a></section>';
  }

  /* ---------------- the tick ---------------- */
  var lastAnnounce = '', lastToday = null;
  C.renderLive = function () {
    var html = nowHTML(N.state()), st = N.state(), route = T.router.route;
    // 1. Now card: desktop side column, phone top slot (compact pill on other days, split-day filter on today)
    $('#now-d').innerHTML = html;
    var pfTop = st.phase === 'trip' && route.view === 'day' && route.day === st.day ? V.partyFilterHTML(P.day(st.day)) : '';
    $('#now-m').innerHTML = (route.view !== 'day') ? '' : (st.phase === 'trip' && route.day !== st.day) ? compactNowHTML(st) : (pfTop ? '<div class="pf-top">' + pfTop + '</div>' : '') + html;
    // 2. side column: booking windows, You & alerts; the open You sheet
    $('#dl-d').innerHTML = st.phase === 'pre' ? V.deadlinesHTML(6) : (st.phase === 'trip' ? V.deadlinesHTML(3, 'Still to do') : '');
    var ld = $('#live-d'); if (ld) ld.innerHTML = '<section class="w" aria-label="Together and alerts"><h2 class="w-h">You &amp; alerts</h2>' + C.liveSlot() + '</section>';
    var mb = $('#me-b'); if (mb && $('#mesheet').open && T.sheet.open === 'me') mb.innerHTML = C.liveSlot() + V.meLinks();
    // 3. weather chips, timeline marks, next bar
    W.render();
    C.highlightNow();
    C.nextBar(st);
    // 4. screen readers: announce only when the next stop changes, not every 30 s tick
    var say = st.phase === 'trip' && st.next ? 'Next: ' + st.next.stop.name + ', ' + st.next.stop.time + (st.nextDay !== st.day ? ', ' + T.dayWord(st.next.t) : '') : '';
    if (say !== lastAnnounce) { lastAnnounce = say; var sr = $('#sr-live'); if (sr && T.router.rendered) sr.textContent = say; }
    // 5. left open across midnight (or resumed next morning): follow the new day if we were on "today"
    var td = st.phase === 'trip' ? st.day : null;
    if (lastToday !== null && td !== lastToday) {
      T.app.buildNav();
      if (route.view === 'day' && route.day === lastToday && td) { lastToday = td; T.router.lastDay = td; location.hash = '#d' + td; return; }
    }
    lastToday = td;
  };
  /* Phone: once the Now card scrolls away, a slim "Next · Navigate" bar docks above the tab bar. */
  C.nextBar = function (st) {
    var bar = $('#nextbar'); if (!bar) return;
    st = st || N.state();
    var route = T.router.route, pick = st.phase === 'trip' && route.view === 'day' && route.day === st.day ? N.navPick(st) : null;
    document.body.classList.toggle('has-next', !!pick);
    if (!pick) { bar.innerHTML = ''; bar.classList.remove('show'); return; }
    var t = N.navTarget(pick.s.stop), nm = R.navName(pick.s.stop);
    bar.innerHTML = '<a class="nb-i" href="#d' + st.day + '" data-jump="' + pick.s.uid + '"><span class="nb-k">' + esc(pick.k) + '</span><span class="nb-n">' + esc(nm) + '</span></a>' +
      '<a class="nb-go" href="' + esc(N.dirURL(t)) + '" target="_blank" rel="noopener" aria-label="Navigate to ' + esc(nm) + '">' + svgI('nav') + '<span class="nb-gt">Go</span></a>';
    C.nextBarVis();
  };
  C.nextBarVis = function () {
    var bar = $('#nextbar'), card = $('#now-m .nowcard'); if (!bar) return;
    var show = !!bar.innerHTML && !!card && !card.classList.contains('compact') && card.getBoundingClientRect().bottom < 60;
    bar.classList.toggle('show', show);
  };
  /* timeline: today's current stop (is-now), started ones (is-past), the next stop (is-next, may be on the next day) */
  C.highlightNow = function () {
    $$('.it.is-now,.it.is-next,.it.is-past').forEach(function (e) { e.classList.remove('is-now', 'is-next', 'is-past'); });
    var st = N.state(), route = T.router.route; if (st.phase !== 'trip' || route.view !== 'day') return;
    if (route.day === st.day) {
      N.timed(st.day).forEach(function (s) {
        var el = document.getElementById(s.uid); if (!el) return;
        if (st.cur && s.uid === st.cur.uid) el.classList.add('is-now');
        else if (s.t < st.t) el.classList.add('is-past');
      });
    }
    if (st.next && st.nextDay === route.day) { var n = document.getElementById(st.next.uid); if (n) n.classList.add('is-next'); }
  };
})(window.TripApp);
