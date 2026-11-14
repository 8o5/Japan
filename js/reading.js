/* reading: planner text on the card face. Splits and selects the planner's own words (never rewords them):
   step splitting, clauses, boarding lines, bag moves, diet, booking references, place-type icons. */
(function (T) {
  'use strict';
  var P = T.plan;
  var R = T.reading = {};

  /* Split planner HTML on " · " into steps without breaking a tag pair (e.g. <b>…</b> spanning a dot). */
  R.splitDots = function (html) {
    var parts = String(html || '').split(' · '), out = [], acc = null;
    function open(s) { return (s.match(/<[a-z][^>]*>/gi) || []).filter(function (t) { return !/\/>$|^<br/i.test(t); }).length - (s.match(/<\/[a-z]+>/gi) || []).length; }
    parts.forEach(function (p) {
      acc = acc === null ? p : acc + ' · ' + p;
      if (open(acc) <= 0) { out.push(acc); acc = null; }
    });
    if (acc !== null) out.push(acc);
    return out;
  };
  var _tx = document.createElement('div');
  /* planner HTML → one line of text, block breaks become " · " */
  var plain = R.plain = function (h) { _tx.innerHTML = String(h || '').replace(/<br\s*\/?>|<\/(p|div|li)>/gi, ' · '); return (_tx.textContent || '').replace(/\s+/g, ' ').replace(/^( · )+|( · )+$/g, '').replace(/( · ){2,}/g, ' · ').trim(); };
  /* sentences → clauses split on " · ", "; ", " — " and ", and " (the planner's own separators) */
  var clauses = R.clauses = function (text) {
    var out = [];
    String(text || '').replace(/([.!?])\s+(?=[A-Z(])/g, '$1\u0001').split('\u0001').forEach(function (sen) {
      sen.split(/ · |; | — |, and /).forEach(function (c) { c = c.trim(); if (c) out.push(c); });
    });
    return out;
  };
  var detailText = R.detailText = function (stop, keys) {
    return (stop.details || []).filter(function (r) { return !keys || keys.test(r.key || ''); }).map(function (r) { return plain(r.html); }).join(' ');
  };
  var overlaps = R.overlaps = function (a, b) { // does clause a repeat 4+ consecutive words of b?
    var w = a.toLowerCase().replace(/[^\w\s’']/g, '').split(/\s+/), B = ' ' + b.toLowerCase().replace(/[^\w\s’']/g, '') + ' ';
    for (var i = 0; i + 3 < w.length; i++) if (B.indexOf(' ' + w.slice(i, i + 4).join(' ') + ' ') >= 0) return true;
    return false;
  };
  R.shortName = function (n) { return String(n || '').split(' · ')[0].trim(); };

  /* ---------------- bags: the day's "Luggage" / "Hotel move" stop ---------------- */
  R.BAG_RX = /\bbefore\b|\bcollect\b|hand-over|\bby \d/i;
  R.isBag = function (stop) { return /^luggage$/i.test(stop.name || '') || /hotel move/i.test(stop.typeLabel || ''); };

  /* ---------------- trains: boarding platform, line, gates and exits ---------------- */
  var TRAIN_RX = R.TRAIN_RX = /train|express|shinkansen|romancecar|\bbus\b/i, BOARD_RX = /platform|\bexit\b|\bgates?\b|concourse|through-service|\bline\b|change at|transfer/i;
  R.isTrain = function (stop) { return TRAIN_RX.test(stop.typeLabel || ''); };
  /* From the day's start note, the route next to the stop and its details (max 3, no repeats). */
  var transitLines = R.transitLines = function (s) {
    var stop = s.stop || s; if (!TRAIN_RX.test(stop.typeLabel || '')) return [];
    var day = s.day || null, out = [], seen = [];
    function add(c) { c = c.trim(); if (!c || out.length >= 3) return; if (seen.some(function (x) { return x === c || overlaps(c, x); })) return; seen.push(c); out.push(c); }
    var d = day && P.day(day);
    if (d) (d.start2 || []).forEach(function (h) { clauses(plain(h)).forEach(function (c) { if (BOARD_RX.test(c)) add(c); }); });
    var flat = day ? P.flat[day] || [] : [], i = flat.indexOf(stop), r = flat[i - 1] && flat[i - 1].kind === 'route' ? flat[i - 1] : (flat[i + 1] && flat[i + 1].kind === 'route' && /through-service|same train/i.test(plain((flat[i + 1].legs || [])[0] && flat[i + 1].legs[0].html)) ? flat[i + 1] : null);
    if (r) (r.legs || []).forEach(function (l) {
      var parts = R.splitDots(l.html).map(plain);
      if (parts[0]) add(parts[0]);
      parts.slice(1).forEach(function (c) { if (BOARD_RX.test(c)) add(c); });
      (l.rail || []).forEach(function (x) { add(x.line + ': ' + x.stations.map(function (z) { return (z.code && /\d/.test(z.code) ? z.code + ' ' : '') + z.name; }).join(' → ')); });
    });
    clauses(detailText(stop, /about|notes|why|getting/i)).forEach(function (c) { if (BOARD_RX.test(c)) add(c); });
    return out;
  };
  /* How to get to a stop without Maps (offline): planner "Getting there", else the transit lines. */
  R.wayLines = function (s) {
    var stop = s.stop || s;
    if (stop.getThere) return [plain(stop.getThere.html)];
    return transitLines(s);
  };
  /* already printed by the route card right before this stop */
  R.routeHas = function (stop, c) {
    var flat = P.flat[stop._day] || [], i = flat.indexOf(stop), r = flat[i - 1];
    return !!(r && r.kind === 'route' && (r.legs || []).some(function (l) { return plain(l.html).indexOf(c) >= 0; }));
  };
  /* where Navigate actually goes: for "A → B" trains that is the boarding station A */
  R.navName = function (stop) { var n = R.shortName(stop.name); return TRAIN_RX.test(stop.typeLabel || '') && /→/.test(n) ? n.split('→')[0].trim() : n; };

  /* ---------------- Elly's diet on food stops ---------------- */
  /* the stop's own diet line, else the app's standing summary of the diet card */
  var DIET_GENERIC = 'Elly: allergic to garlic and onion · avoids tomato · cooked salmon is the only fish · no matcha, no alcohol'; // app summary of the diet card (generated — flagged for Nic)
  var FOOD_RX = /restaurant|ramen|noodle|tsukemen|katsudon|yakitori|skewer|taco|steak|wagyu|food|dinner|lunch|breakfast|kaiseki|okonomiyaki|pancake|café|cafe|bakery|crêpe|ekiben|konbini|counter|izakaya|sushi|tonkatsu/i;
  function ownDiet(stop) { return (stop.flags || []).filter(function (x) { return x.kind === 'diet'; })[0]; }
  R.isFood = function (stop) {
    if (ownDiet(stop)) return true;
    if (/coffee|tea shop|bean/i.test(stop.typeLabel || '') && !/café|cafe/i.test(stop.typeLabel || '')) return false;
    return FOOD_RX.test([stop.typeLabel, stop.action, stop.time].join(' ')) && !/shopping|store|mall floors/i.test(stop.typeLabel || '') || /restaurant floors|food hall/i.test(stop.typeLabel || '');
  };
  R.hasOwnDiet = function (stop) { return !!ownDiet(stop); };
  R.dietText = function (stop) { var f = ownDiet(stop); return f ? plain(f.html) : DIET_GENERIC; };

  /* ---------------- booking references the planner already holds (teamLab, Daruma …) ---------------- */
  var REF_RX = /\b(Reference|Viator ref|Viator|itinerary|Confirmation(?: no\.?| number)?|Booking (?:no\.?|number|ID))\s+([A-Z0-9][A-Z0-9-]{5,}\d[A-Z0-9-]*)/g;
  R.flagText = function (stop) { return plain((stop.flags || []).map(function (f) { return f.html; }).join(' · ')); };
  R.refsOf = function (stop) {
    var txt = [R.flagText(stop), detailText(stop)].join(' · '), out = [], codes = {}, m;
    REF_RX.lastIndex = 0;
    while ((m = REF_RX.exec(txt))) { if (!codes[m[2]]) { codes[m[2]] = 1; out.push({ label: m[1], code: m[2], text: m[0] }); } }
    return out;
  };
  R.allRefs = function () {
    var out = [];
    P.days.forEach(function (n) { (P.stops[n] || []).forEach(function (s) { var r = R.refsOf(s.stop); if (r.length) out.push({ s: s, day: n, refs: r }); }); });
    return out;
  };
  /* Confirmation codes, display only (Miller's law): codes that already carry "-" or spaces stay as written; others
     (6+ chars) split into the fewest groups of ≤ 4, as even as possible, longer groups first: FBGFCR → FBG FCR,
     3523223096 → 3523 223 096. The gap is CSS margin between spans, so selecting / copying still gives the raw code. */
  R.chunkCode = function (code) {
    code = String(code == null ? '' : code);
    if (/[\s-]/.test(code) || code.length < 6) return [code];
    var n = Math.ceil(code.length / 4), base = Math.floor(code.length / n), extra = code.length % n, out = [], i = 0;
    for (var g = 0; g < n; g++) { var len = base + (g < extra ? 1 : 0); out.push(code.slice(i, i + len)); i += len; }
    return out;
  };

  /* ---------------- place-type icon (presentation only) ---------------- */
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
  R.typeIcon = function (t) { for (var i = 0; i < TYPE_IC.length; i++) if (TYPE_IC[i][0].test(t || '')) return TYPE_IC[i][1]; return ''; };

  /* ---------------- the trip at a glance: moves + highlights per day ---------------- */
  R.moves = function (d) { // how we get between places that day: block headings with "→" + train stops named "A → B"
    var out = [];
    d.blocks.forEach(function (b) { if (/→/.test(b.heading) && !b.optional) out.push({ t: b.heading, sub: '' }); });
    (P.stops[d.day] || []).forEach(function (x) { if (TRAIN_RX.test(x.stop.typeLabel || '') && /→/.test(x.stop.name) && !x.stop.optional && !x.party) out.push({ t: x.stop.name, sub: x.stop.typeLabel, s: x }); });
    return out;
  };
  R.highlights = function (d) { // the day's main named stops, in planner order (GEN: assembled list)
    var seen = {}, out = [];
    (P.stops[d.day] || []).forEach(function (x) {
      var st = x.stop, n = R.shortName(st.name);
      if (out.length >= 4 || st.optional || st.moved || x.ob || R.isBag(st) || TRAIN_RX.test(st.typeLabel || '') || /^(pack|konbini)/i.test(n) || seen[n]) return;
      if (/airport|arrival|hotel|ryokan|inn\b/i.test(st.typeLabel || '') && !/kaiseki|dinner/i.test(st.typeLabel || '')) return;
      seen[n] = 1; out.push(n);
    });
    return out;
  };
})(window.TripApp);
