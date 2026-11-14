/* app: router + View Transitions, sheets, gestures, events, ⌘K, passcode gate, plan intake (static files or
   js/live.js in app-shell mode), stale-while-revalidate, boot. Owns the public window.JP27 interface used by js/live.js:
   { renderLive, now, ls, state, ready, provideData(d, opts), _pending } + the 'jp27:ready' event. */
(function (T) {
  'use strict';
  var P = T.plan, N = T.nowModel, V = T.views, C = T.nowcard, W = T.weather, LS = T.LS, CFG = T.CFG, RT = T.router;
  var $ = T.$, $$ = T.$$, esc = T.esc, now = T.now, reduceMotion = T.reduceMotion;
  var A = T.app = {};

  /* ---------------- chrome: day strip (phone/tablet), rail (desktop) ---------------- */
  A.buildNav = function () {
    var td = N.tripDayAt(now()), strip = '', rail = '';
    P.trip.nav.forEach(function (g, gi) {
      if (gi) strip += '<span class="s-sep" aria-hidden="true"></span>';
      rail += '<h3>' + esc(g.city) + '</h3>';
      g.days.forEach(function (x) {
        var n = +x.id.slice(1), d = P.day(n), parts = x.label.split(' ');
        strip += '<a href="#' + x.id + '" data-day="' + n + '" class="' + (n === td ? 'is-today' : '') + '" title="' + esc(x.label + ' · ' + g.city) + '"><span class="s-w">' + esc(parts[0]) + '</span><span class="s-d">' + esc(parts[1]) + '</span><span class="s-c">' + esc(g.city.split(' · ')[0]) + '</span></a>';
        rail += '<a href="#' + x.id + '" data-day="' + n + '" class="' + (n === td ? 'is-today' : '') + '"><span class="r-d">' + n + '</span><span class="r-l" title="' + esc(d.title) + '">' + esc(parts[0] + ' · ' + d.title) + '</span>' + (n === td ? '<span class="r-today">Today</span>' : '') + '</a>';
      });
    });
    rail += '<h3>Planning</h3><a href="#trip" data-view="trip"><span class="r-l">The trip at a glance</span></a>' + P.trip.panels.map(function (p) { return '<a href="#' + p.id + '" data-view="' + p.id + '"><span class="r-l">' + esc(p.title) + '</span></a>'; }).join('');
    $('#strip').innerHTML = strip; $('#rail').innerHTML = rail;
  };

  /* ---------------- routing: #d9…#d21 · #today · #trip · #bookings · #watch · #prep · #sources ---------------- */
  function defaultDay() { var st = N.state(); return st.phase === 'trip' ? st.day : (st.phase === 'post' ? P.days[P.days.length - 1] : P.days[0]); }
  function parseHash() {
    var h = location.hash.replace(/^#/, ''), m = /^d(\d{1,2})$/.exec(h);
    if (m && P.days.indexOf(+m[1]) >= 0) return { view: 'day', day: +m[1] };
    if (/^(bookings|watch|prep|sources|trip)$/.test(h)) return { view: h };
    if (h === 'today') return { view: 'day', day: defaultDay(), today: true };
    return { view: 'day', day: RT.lastDay || defaultDay() };
  }
  var curVT = null, swipeHold = false;
  /* View Transitions (tab / day changes): chrome stays, content cross-slides. Falls back to the .enter classes when
     the API is missing; nothing at all with reduced motion. A new navigation skips the running one (interruptible). */
  var hasVT = typeof document.startViewTransition === 'function';
  function slideDir(prev, next) { return (prev.view === 'day' && next.view === 'day' && prev.day !== next.day) ? (next.day > prev.day ? 'r' : 'l') : ''; }
  function render() {
    var prev = RT.route; RT.route = parseHash();
    var animate = !reduceMotion && RT.rendered && !RT.quiet;
    if (curVT) { try { curVT.skipTransition(); } catch (e) {} curVT = null; }
    if (animate && hasVT) {
      document.documentElement.setAttribute('data-vt', slideDir(prev, RT.route) || 'fade');
      var vt = curVT = document.startViewTransition(function () { paint(prev, false); });
      vt.finished.then(function () { if (curVT === vt) { curVT = null; document.documentElement.removeAttribute('data-vt'); } }, function () {});
      return;
    }
    paint(prev, animate);
  }
  A.render = render;
  function paint(prev, animate) {
    var v = $('#view'), ROUTE = RT.route, title = CFG.title || 'Japan 2027';
    if (swipeHold) { swipeHold = false; v.style.transition = 'none'; v.style.transform = ''; void v.offsetWidth; v.style.transition = ''; }
    document.body.classList.toggle('v-panel', ROUTE.view !== 'day');
    if (ROUTE.view === 'day') {
      RT.lastDay = ROUTE.day;
      var d = P.day(ROUTE.day);
      v.innerHTML = V.dayHTML(d);
      document.title = P.dayLabel(d) + ' · ' + title;
      V.applyParty();
    } else if (ROUTE.view === 'trip') {
      v.innerHTML = V.tripHTML();
      document.title = 'The trip · ' + title;
    } else {
      var p = P.panel(ROUTE.view);
      v.innerHTML = V.panelHTML(p);
      document.title = p.title + ' · ' + title;
    }
    if (ROUTE.today) { history.replaceState(null, '', location.pathname + location.search + '#d' + ROUTE.day); }
    markCurrent();
    // motion (fallback when View Transitions aren't available)
    if (animate) {
      v.classList.remove('enter', 'enter-l', 'enter-r'); void v.offsetWidth;
      var dir = slideDir(prev, ROUTE);
      v.classList.add(dir ? 'enter-' + dir : 'enter');
    }
    RT.rendered = true;
    C.renderLive();
    reveal();
    if (RT.pendingJump) {
      var el = document.getElementById(RT.pendingJump); RT.pendingJump = null;
      if (el && el.closest('.party[hidden]')) { LS.set('party', 'all'); V.applyParty(); C.renderLive(); }
      if (el) { setTimeout(function () { el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' }); }, 60); return; }
    }
    if (!RT.quiet && (prev.view !== ROUTE.view || prev.day !== ROUTE.day)) window.scrollTo(0, 0);
  }
  /* nav state: Today = today's day view; Days = the trip overview or any other day; strip/rail = the day on screen */
  function markCurrent() {
    var ROUTE = RT.route, isToday = ROUTE.view === 'day' && ROUTE.day === defaultDay();
    function cur(a, on) { if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
    $$('[data-view]').forEach(function (a) {
      var k = a.getAttribute('data-view');
      cur(a, k === 'today' ? isToday : k === 'trip' ? (ROUTE.view === 'trip' || (ROUTE.view === 'day' && !isToday)) : k === ROUTE.view);
    });
    $$('#strip a, #rail a[data-day]').forEach(function (a) { cur(a, ROUTE.view === 'day' && +a.getAttribute('data-day') === ROUTE.day); });
    var sc = $('#strip a[aria-current]');
    if (sc) { var s = $('#strip'); s.scrollTo({ left: sc.offsetLeft - s.clientWidth / 2 + sc.clientWidth / 2, behavior: reduceMotion ? 'auto' : 'smooth' }); }
  }
  function go(delta) {
    if (RT.route.view !== 'day') return;
    var i = P.days.indexOf(RT.route.day) + delta;
    if (i >= 0 && i < P.days.length) location.hash = '#d' + P.days[i];
  }
  /* brand / Today tab / ⌘K "Today": today's view, scrolled to the current or next stop */
  function goToday() {
    RT.lastDay = null; var st = N.state(), h = '#d' + defaultDay();
    if (st.phase === 'trip') RT.pendingJump = (st.cur || st.next || {}).uid || null;
    if (location.hash === h) { render(); if (!RT.pendingJump) window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }); } else location.hash = h;
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

  /* ---------------- sheets (diet, You & alerts, weather): bottom sheets on phone, centred on desktop ---------------- */
  function showSheet(d) {
    d.classList.remove('closing');
    if (!d.open) { if (d.showModal) d.showModal(); else d.setAttribute('open', ''); }
  }
  function closeSheet(d) {
    if (!d || !d.open || d.classList.contains('closing')) return;
    if (d.id === 'mesheet') T.sheet.open = null;
    if (reduceMotion) { d.close(); return; }
    d.classList.add('closing');
    d.style.animation = ''; d.style.transition = ''; // hand over from a drag to the close animation (starts where the finger left it)
    setTimeout(function () { d.classList.remove('closing'); d.style.transform = ''; if (d.open) d.close(); }, 240);
  }
  window.JP27_closeSheet = closeSheet;
  /* #mesheet shows either "You & alerts" (kind 'me') or the weather list (kind 'wx') */
  function openInfo(kind) {
    var d = $('#mesheet'), WX = W.get(); T.sheet.open = kind;
    $('#me-h').textContent = kind === 'wx' ? 'Weather' + (WX.city ? ' · ' + WX.city : '') : 'You & alerts';
    d.classList.toggle('is-wx', kind === 'wx');
    $('#me-b').innerHTML = kind === 'wx' ? W.html(false) : C.liveSlot() + V.meLinks();
    if (kind === 'wx' && !WX.data && !WX.loading) W.load(true);
    showSheet(d);
  }
  function openDiet() { $('#diet-b').innerHTML = V.dietHTML(); showSheet($('#dietsheet')); }
  /* Swipe-to-dismiss: from the handle / header any time, or from the content when it is scrolled to the top and the
     first move is downward (an upward first move scrolls as usual). Grabbing a sheet mid-animation takes it from where
     it is (interruptible). Release: > 90 px or a quick flick closes; otherwise it eases back. */
  function sheetDrag() {
    var y0 = 0, x0 = 0, dy = 0, base = 0, d = null, engaged = false, fromHead = false, lastY = 0, lastT = 0, vel = 0;
    function engage(y) {
      var m = getComputedStyle(d).transform, ty = 0;
      if (m && m !== 'none') { var p = m.match(/matrix(3d)?\(([^)]+)\)/); if (p) { var n = p[2].split(','); ty = parseFloat(n[p[1] ? 13 : 5]) || 0; } }
      base = Math.max(0, ty); d.style.animation = 'none'; d.style.transition = 'none'; d.style.transform = 'translateY(' + base + 'px)';
      engaged = true; y0 = y; lastY = y; lastT = Date.now(); vel = 0;
    }
    document.addEventListener('touchstart', function (e) {
      d = null; engaged = false;
      var dlg = e.target.closest && e.target.closest('dialog.sheet');
      if (!dlg || e.touches.length !== 1 || dlg.classList.contains('closing') || e.target.closest('input,textarea,select,.fig,.wx-d')) return;
      fromHead = !!e.target.closest('.grab, .sheet-h') && !e.target.closest('button');
      var sc = dlg.querySelector('.sheet-in');
      if (!fromHead && sc && sc.scrollTop > 0) return; // content is scrolled: let it scroll
      d = dlg; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dy = 0;
      if (fromHead) engage(y0);
    }, { passive: true });
    document.addEventListener('touchmove', function (e) {
      if (!d) return;
      var t = e.touches[0];
      if (!engaged) {
        var mx = t.clientX - x0, my = t.clientY - y0;
        if (Math.abs(mx) < 6 && Math.abs(my) < 6) return;
        if (my > 0 && Math.abs(my) > Math.abs(mx)) engage(t.clientY); else { d = null; return; }
      }
      e.preventDefault(); // the sheet moves, not the content behind/inside it
      dy = Math.max(0, base + t.clientY - y0);
      var now_ = Date.now(); if (now_ > lastT) { vel = (t.clientY - lastY) / (now_ - lastT); lastY = t.clientY; lastT = now_; }
      d.style.transform = 'translateY(' + dy + 'px)';
    }, { passive: false });
    function end() {
      if (!d) return; var dd = d; d = null;
      if (!engaged) return; engaged = false;
      dd.style.transition = '';
      if (dy > 90 || (dy > 24 && vel > 0.5)) closeSheet(dd); else dd.style.transform = '';
    }
    document.addEventListener('touchend', end, { passive: true });
    document.addEventListener('touchcancel', end, { passive: true });
    // whichever way a sheet closes, the next open starts clean
    document.addEventListener('close', function (e) { var t = e.target; if (t && t.matches && t.matches('dialog.sheet')) { t.style.animation = ''; t.style.transition = ''; t.style.transform = ''; t.classList.remove('closing'); } }, true);
  }

  /* ---------------- swipe between days (phone): the page follows the finger a little, then springs to the next day ---------------- */
  function daySwipe() {
    var sx = 0, sy = 0, st = 0, ok = false, horiz = null, Vw = $('#view');
    Vw.addEventListener('touchstart', function (e) {
      var t = e.touches[0]; ok = RT.route.view === 'day' && e.touches.length === 1 && !e.target.closest('.fig,.strip,.rail-d,input,label,.glance,select,textarea');
      sx = t.clientX; sy = t.clientY; st = Date.now(); horiz = null;
    }, { passive: true });
    Vw.addEventListener('touchmove', function (e) {
      if (!ok || reduceMotion) return; var t = e.touches[0], dx = t.clientX - sx, dy = t.clientY - sy;
      if (horiz === null && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) horiz = Math.abs(dx) > Math.abs(dy) * 1.4;
      if (!horiz) return;
      var i = P.days.indexOf(RT.route.day), edge = (dx > 0 && i === 0) || (dx < 0 && i === P.days.length - 1);
      Vw.style.transition = 'none'; Vw.style.transform = 'translate3d(' + (dx * (edge ? 0.12 : 0.3)) + 'px,0,0)';
    }, { passive: true });
    Vw.addEventListener('touchend', function (e) {
      if (!ok) return; var t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
      var i = P.days.indexOf(RT.route.day) + (dx < 0 ? 1 : -1);
      var nav = Math.abs(dx) > 70 && Math.abs(dy) < Math.abs(dx) * 0.6 && Date.now() - st < 800 && i >= 0 && i < P.days.length;
      // with View Transitions the page stays where the finger left it; the transition takes it from there
      if (nav && hasVT && !reduceMotion && horiz) { swipeHold = true; go(dx < 0 ? 1 : -1); return; }
      Vw.style.transition = ''; Vw.style.transform = '';
      if (nav) go(dx < 0 ? 1 : -1);
    }, { passive: true });
    Vw.addEventListener('touchcancel', function () { Vw.style.transition = ''; Vw.style.transform = ''; }, { passive: true });
  }

  /* ---------------- tap-to-copy (booking references) ---------------- */
  /* Copy success: the chip itself turns green with a check and says "Copied", then reverts (tip 20). */
  function copiedMorph(b) {
    var k = b.querySelector('.ref-k'), lbl = b.getAttribute('data-label') || (k && k.textContent) || '';
    clearTimeout(b._cpT);
    if (!b.classList.contains('is-copied')) b.style.minWidth = b.offsetWidth + 'px'; // the chip never shrinks mid-morph
    b.classList.add('is-copied'); if (k) k.textContent = 'Copied';
    var sr = $('#sr-copy'); if (!sr) { sr = document.createElement('p'); sr.id = 'sr-copy'; sr.className = 'sr'; sr.setAttribute('aria-live', 'polite'); document.body.appendChild(sr); }
    sr.textContent = ''; setTimeout(function () { sr.textContent = 'Copied ' + lbl; }, 30);
    b._cpT = setTimeout(function () { b.classList.remove('is-copied'); if (k) k.textContent = lbl; b.style.minWidth = ''; }, 1400);
  }
  /* old iOS / no Clipboard API: a hidden textarea + execCommand; if even that fails, show the code in a toast */
  function legacyCopy(v, done) {
    try {
      var ta = document.createElement('textarea'); ta.value = v; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
      document.body.appendChild(ta); ta.select(); var ok = document.execCommand('copy'); ta.remove();
      if (ok) done(); else T.toast(v);
    } catch (x) { T.toast(v); }
  }
  function onCopyClick(e) {
    var b = e.target.closest && e.target.closest('[data-copy]'); if (!b) return;
    e.preventDefault(); var v = b.getAttribute('data-copy'); // always the raw code from the data, never the chunked display
    var done = function () { copiedMorph(b); }, fail = function () { legacyCopy(v, done); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(v).then(done, fail); else fail();
  }

  /* ---------------- events ---------------- */
  var ACTIONS = { // data-act="…" buttons rendered by the views
    me: function () { openInfo('me'); },
    diet: function (a, e) { e.preventDefault(); $('#dietbtn').click(); },
    wxsheet: function () { openInfo('wx'); },
    geo: function (a) { C.askLocation(a); },
    wx: function () { W.load(true); }
  };
  function onClick(e) {
    var a = e.target.closest('[data-act],[data-jump],[data-show],[data-close]');
    if (!a) return;
    if (a.hasAttribute('data-jump') && a.getAttribute('data-jump')) { // links to a stop: scroll to it after the route renders
      RT.pendingJump = a.getAttribute('data-jump');
      if (location.hash === a.getAttribute('href')) { e.preventDefault(); render(); }
      return;
    }
    if (a.hasAttribute('data-show')) { LS.set('party', a.getAttribute('data-show')); V.applyParty(); C.renderLive(); return; }
    if (a.hasAttribute('data-close')) { closeSheet(a.closest('dialog')); return; }
    var f = ACTIONS[a.getAttribute('data-act')]; if (f) f(a, e);
  }
  /* my own checklists: quick checks (jp27.qc) and bookings (jp27.bk) */
  function toggleKey(store, key, on) { var m = LS.get(store, {}); if (on) m[key] = 1; else delete m[key]; LS.set(store, m); }
  function onChange(e) {
    var t = e.target;
    if (t.hasAttribute('data-qc')) toggleKey('qc', t.getAttribute('data-qc'), t.checked);
    if (t.hasAttribute('data-bk')) { toggleKey('bk', t.getAttribute('data-bk'), t.checked); t.closest('.bk').classList.toggle('is-done', t.checked); C.renderLive(); }
  }
  function onKey(e) {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (e.key === 'k' || e.key === 'K') && cmdOK()) { e.preventDefault(); var c = $('#cmdk'); if (c && c.open) c.close(); else openCmd(); return; }
    if (e.target.closest('input,textarea,select,[contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowLeft') go(-1); else if (e.key === 'ArrowRight') go(1);
  }
  /* theme: auto → light → dark (jp27.theme; index.html applies it before first paint) */
  function themeButton() {
    var tb = $('#themebtn'), modes = ['auto', 'light', 'dark'];
    function setTheme(m) {
      if (m === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', m);
      tb.setAttribute('aria-label', 'Appearance: ' + m + '. Tap to change'); tb.title = 'Appearance: ' + m; tb.setAttribute('data-mode', m);
      $$('meta[name="theme-color"]').forEach(function (x) {
        var dark = /dark/.test(x.getAttribute('media') || '');
        if (m === 'auto') x.setAttribute('content', dark ? '#15110E' : '#FBF7F1'); else x.setAttribute('content', m === 'dark' ? '#15110E' : '#FBF7F1');
      });
    }
    setTheme(LS.get('theme', 'auto'));
    tb.addEventListener('click', function () { var m = modes[(modes.indexOf(LS.get('theme', 'auto')) + 1) % 3]; LS.set('theme', m); setTheme(m); T.toast('Appearance: ' + { auto: 'Automatic', light: 'Light', dark: 'Dark' }[m]); });
  }
  function bind() {
    window.addEventListener('hashchange', render);
    document.addEventListener('click', onClick);
    document.addEventListener('change', onChange);
    document.addEventListener('keydown', onKey);
    daySwipe();
    $('#dietbtn').addEventListener('click', openDiet);
    $('#mebtn').addEventListener('click', function () { openInfo('me'); });
    document.addEventListener('click', onCopyClick);
    document.addEventListener('click', function (e) { if (e.target.matches && e.target.matches('dialog.sheet')) closeSheet(e.target); }); // backdrop tap
    document.addEventListener('cancel', function (e) { if (e.target.matches && e.target.matches('dialog.sheet')) { e.preventDefault(); closeSheet(e.target); } }, true);
    sheetDrag();
    themeButton();
    $('#brand').addEventListener('click', function (e) { e.preventDefault(); goToday(); });
    // tab bar: tapping "Today" again while on a day jumps back to today (like re-tapping an iOS tab)
    $$('[data-view="today"]').forEach(function (a) { a.addEventListener('click', function (e) { e.preventDefault(); goToday(); }); });
    window.addEventListener('hashchange', function () { $$('dialog.sheet[open]').forEach(function (d) { closeSheet(d); }); });
    var nbRaf = 0;
    window.addEventListener('scroll', function () { if (!nbRaf) nbRaf = requestAnimationFrame(function () { nbRaf = 0; C.nextBarVis(); }); }, { passive: true });
    // network status: one quiet pill, never a blocking banner
    function net() { $('#net').hidden = navigator.onLine; document.documentElement.classList.toggle('is-offline', !navigator.onLine); }
    window.addEventListener('offline', net); window.addEventListener('online', net); net();
    window.addEventListener('online', function () { if (W.get().city) W.load(); });
  }

  /* ---------------- command menu (desktop, Cmd/Ctrl+K): jump to a view or a day; no search beyond this list ---------------- */
  function cmdItems() {
    var out = [['', 'Today', '#today'], ['', 'Days · the trip at a glance', '#trip']];
    P.trip.panels.forEach(function (p) { out.push(['', p.title, '#' + p.id]); });
    P.days.forEach(function (n) { var d = P.day(n); out.push([P.dayLabel(d), d.title, '#d' + n]); });
    return out;
  }
  function cmdOK() { return matchMedia('(min-width: 760px) and (hover: hover) and (pointer: fine)').matches; }
  function openCmd() {
    if (!P.trip || !cmdOK()) return;
    var dlg = $('#cmdk');
    if (!dlg) {
      dlg = document.createElement('dialog'); dlg.id = 'cmdk'; dlg.className = 'cmdk'; dlg.setAttribute('aria-label', 'Jump to');
      dlg.innerHTML = '<input type="text" id="cmdk-i" placeholder="Jump to a day or view…" autocomplete="off" spellcheck="false" aria-controls="cmdk-l" aria-label="Jump to"><ul id="cmdk-l" role="listbox"></ul>';
      document.body.appendChild(dlg);
      var inp = $('#cmdk-i', dlg), list = $('#cmdk-l', dlg), sel = 0;
      var draw = function () {
        var q = inp.value.trim().toLowerCase(), items = cmdItems().filter(function (x) { return !q || (x[0] + ' ' + x[1]).toLowerCase().indexOf(q) >= 0; });
        sel = Math.min(sel, Math.max(0, items.length - 1));
        list.innerHTML = items.length ? items.map(function (x, i) { return '<li><a href="' + x[2] + '" role="option" aria-selected="' + (i === sel) + '">' + (x[0] ? '<span class="cm-k">' + esc(x[0]) + '</span>' : '') + '<span>' + esc(x[1]) + '</span></a></li>'; }).join('') : '<li class="cm-none">No match</li>';
        var on = $('[aria-selected="true"]', list); if (on) on.scrollIntoView({ block: 'nearest' });
      };
      dlg._draw = function () { sel = 0; draw(); };
      inp.addEventListener('input', function () { sel = 0; draw(); });
      inp.addEventListener('keydown', function (e) {
        var n = $$('a', list).length;
        if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(n - 1, sel + 1); draw(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); }
        else if (e.key === 'Enter') { e.preventDefault(); var a = $('[aria-selected="true"]', list); if (a) a.click(); }
      });
      list.addEventListener('click', function (e) {
        var a = e.target.closest('a'); if (!a) return;
        e.preventDefault(); dlg.close();
        if (a.getAttribute('href') === '#today') goToday(); else location.hash = a.getAttribute('href');
      });
      dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
    }
    $('#cmdk-i').value = ''; dlg._draw();
    if (!dlg.open) dlg.showModal();
    $('#cmdk-i').focus();
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
    var Wd = document.documentElement.clientWidth, bad = [];
    $('#view').classList.remove('enter', 'enter-l', 'enter-r');
    $$('#view details').forEach(function (d) { d.open = true; });
    $$('.party').forEach(function (p) { p.hidden = false; });
    $$('body *').forEach(function (e) {
      var r = e.getBoundingClientRect();
      if (r.width && (r.right > Wd + 1 || r.left < -1) && !e.closest('.strip,.fig,dialog,.skip,.rail,.side')) bad.push(e.tagName + '.' + e.className + ' ' + Math.round(r.left) + '/' + Math.round(r.right));
    });
    var pre = document.createElement('pre'); pre.id = 'qa'; pre.hidden = true;
    pre.textContent = JSON.stringify({ width: Wd, scrollWidth: document.documentElement.scrollWidth, overflow: bad.slice(0, 20), overrides: P.trip._overrideReport, state: N.state().phase, sw: !!(navigator.serviceWorker && navigator.serviceWorker.controller) });
    document.body.appendChild(pre);
    if (window.parent !== window) window.parent.postMessage(pre.textContent, '*');
  }

  /* ---------------- plan intake ----------------
     Two adapters feed the same Plan.set(): static data/*.json (fetched here, refreshed by the service worker's
     stale-while-revalidate) and app-shell mode, where js/live.js hands over the Firestore copy via JP27.provideData(). */
  function loadStatic() {
    return Promise.all([T.getJSON('data/trip.json'), T.getJSON('data/overrides.json').catch(function () { return { overrides: [] }; }), T.getJSON('data/places.json').catch(function () { return {}; })]);
  }
  function fromPayload(d) { return [d.trip, d.overrides || [], d.places || {}]; }
  function exposeTrip() { window.__trip = { trip: P.trip, state: N.state, overrides: function () { return P.trip._overrideReport; } }; }
  /* a new plan while the app is running: re-render quietly, keep an open diet sheet current, toast if it changed */
  function ingest(r, opts) {
    opts = opts || {};
    P.set(r[0], r[1], r[2]);
    if (!window.JP27.ready) return;
    RT.quiet = true; A.buildNav(); render(); RT.quiet = false;
    var sheet = $('#dietsheet');
    if (sheet && (sheet.open || sheet.hasAttribute('open'))) $('#diet-b').innerHTML = V.dietHTML();
    if (opts.updated) T.toast('Plan updated');
    exposeTrip();
  }

  /* ---------------- stale-while-revalidate (static data mode) ----------------
     sw.js serves data/*.json from cache at once and refreshes it in the background; when a newer body lands it posts
     {type:'jp27-data'}. Re-read the three files (now fresh in the cache) and re-render only if the plan really changed. */
  var DATA_FP = null, swrBusy = false;
  function dataFp(r) { try { return JSON.stringify(r); } catch (e) { return null; } }
  function revalidateData() {
    if (CFG.dataSource === 'firestore' || !window.JP27.ready || swrBusy) return;
    swrBusy = true;
    loadStatic().then(function (r) {
      var fp = dataFp(r);
      if (fp && DATA_FP && fp !== DATA_FP) { DATA_FP = fp; ingest(r, { updated: true }); }
    }).catch(function () {}).then(function () { swrBusy = false; });
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'jp27-data') { clearTimeout(revalidateData._t); revalidateData._t = setTimeout(revalidateData, 400); }
  });

  /* ---------------- public interface for js/live.js ----------------
     provideData(d, opts): d = {trip, overrides, places, …}. Before boot: parked in _pending. App-shell boot waiting for
     a plan: also hands it to the waiter. After boot: ingested (re-render, "Plan updated" toast when opts.updated). */
  var JP27 = window.JP27 = { renderLive: function () { if (P.trip) C.renderLive(); }, now: now, ls: LS, state: function () { return P.trip ? N.state() : null }, ready: false };
  var waiter = null;
  /* What's on screen, as a key-order-independent fingerprint of [trip, overrides, places]. A re-delivery of the
     same plan (the saved copy again, or the server answering with what we already have) is not re-rendered. */
  var SHOWN = null, SHOWN_FP = null; // SHOWN: the payload on screen; its fingerprint is taken lazily (not on the boot path)
  function planFp(r) {
    try { return JSON.stringify(r, function (k, v) { if (!v || typeof v !== 'object' || Array.isArray(v)) return v; var o = {}; Object.keys(v).sort().forEach(function (x) { o[x] = v[x]; }); return o; }); }
    catch (e) { return null; }
  }
  function take(d, opts) {
    var r = fromPayload(d), fp = planFp(r);
    if (SHOWN && SHOWN_FP === null) SHOWN_FP = planFp(SHOWN);
    if (!opts.updated && fp && fp === SHOWN_FP) return;
    SHOWN = r; SHOWN_FP = fp; ingest(r, opts);
  }
  JP27.provideData = function (d, opts) {
    JP27._pending = { d: d, opts: opts || {} };
    if (JP27.ready) take(d, opts || {});
    else if (waiter) waiter(fromPayload(d));
  };
  /* The plan this phone saved last time (js/live.js keeps it in jp27.tripCache and hands the same copy over
     once it starts). Reading it here lets a cold launch go skeleton → plan without the waiting screen. */
  function savedPlan() {
    var c = LS.get('tripCache', null);
    return c && c.trip && Array.isArray(c.trip.days) ? fromPayload(c) : null;
  }
  /* App-shell mode (CFG.dataSource === 'firestore'): the public site carries no itinerary; js/live.js
     fetches it from Firestore after this phone is linked and hands it over via JP27.provideData(). */
  function shellPlan() {
    if (JP27._pending) return Promise.resolve(fromPayload(JP27._pending.d));
    var saved = savedPlan();
    if (saved) return Promise.resolve(saved);
    $('#view').innerHTML = '<div class="shell-wait"><span class="sun big" aria-hidden="true"></span><h1>Japan 2027</h1><p class="shell-sub">Nic &amp; Elly · 9–21 January</p><div class="live-slot" id="shell-slot"></div></div>';
    document.body.classList.add('v-shell');
    return new Promise(function (res) {
      waiter = res;
      if (window.JP27_LIVE && window.JP27_LIVE.refresh) window.JP27_LIVE.refresh();
    });
  }
  function mockBar() { $('#mockbar').textContent = 'Mock clock · ' + T.fmtDayJST(now()) + ' · ' + T.fmtJST(now()) + ' JST'; }

  /* ---------------- boot ---------------- */
  function start(r) {
    document.body.classList.remove('v-shell');
    if (CFG.dataSource !== 'firestore') DATA_FP = dataFp(r);
    SHOWN = r; SHOWN_FP = null;
    P.set(r[0], r[1], r[2]);
    A.buildNav(); bind(); render();
    $('#dietbtn').hidden = false; // only once a plan is loaded (app-shell mode starts without one)
    document.body.classList.add('has-plan');
    if (W.wanted()) W.load(); else W.render();
    setInterval(function () { if (T.MOCK) mockBar(); C.renderLive(); }, 30000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) C.renderLive(); });
    if (/[?&]qa=1/.test(location.search)) setTimeout(qaReport, 1200);
    JP27.ready = true; waiter = null;
    if (JP27._pending) take(JP27._pending.d, JP27._pending.opts || {});
    document.dispatchEvent(new Event('jp27:ready'));
    exposeTrip();
  }
  function failed(e) {
    $('#view').innerHTML = '<div class="empty"><span class="sun big" aria-hidden="true"></span><h2>Couldn’t load the plan</h2><p>' + (navigator.onLine ? 'Something went wrong — try again.' : 'You’re offline and this device hasn’t saved the plan yet. Open it once with internet.') + '</p><button class="btn btn-p" onclick="location.reload()">Try again</button><p class="fine">' + esc(e.message) + '</p></div>';
  }
  function serviceWorker() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
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
  function boot() {
    if (T.IS_IOS) document.documentElement.classList.add('ios');
    if (T.MOCK) { $('#mockbar').hidden = false; mockBar(); }
    gate().then(function () { return CFG.dataSource === 'firestore' ? shellPlan() : loadStatic(); }).then(start).catch(failed);
    serviceWorker();
  }
  boot();
})(window.TripApp);
