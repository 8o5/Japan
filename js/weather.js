/* weather: Open-Meteo forecast (no key) for the current day's city, cached an hour in jp27.wx.<city>.
   Interface: Weather.load(force) · Weather.render() · Weather.html(compact) · Weather.wanted() · Weather.city() · Weather.get(). */
(function (T) {
  'use strict';
  var P = T.plan, N = T.nowModel, LS = T.LS, esc = T.esc, $ = T.$, $$ = T.$$;
  var W = T.weather = {};
  var WMO = { 0: ['☀️', 'Clear'], 1: ['🌤️', 'Mostly clear'], 2: ['⛅', 'Partly cloudy'], 3: ['☁️', 'Overcast'], 45: ['🌫️', 'Fog'], 48: ['🌫️', 'Fog'],
    51: ['🌦️', 'Drizzle'], 53: ['🌦️', 'Drizzle'], 55: ['🌧️', 'Drizzle'], 61: ['🌧️', 'Light rain'], 63: ['🌧️', 'Rain'], 65: ['🌧️', 'Heavy rain'],
    66: ['🌧️', 'Freezing rain'], 67: ['🌧️', 'Freezing rain'], 71: ['🌨️', 'Light snow'], 73: ['🌨️', 'Snow'], 75: ['❄️', 'Heavy snow'], 77: ['🌨️', 'Snow grains'],
    80: ['🌦️', 'Showers'], 81: ['🌧️', 'Showers'], 82: ['⛈️', 'Heavy showers'], 85: ['🌨️', 'Snow showers'], 86: ['❄️', 'Snow showers'], 95: ['⛈️', 'Thunderstorm'], 96: ['⛈️', 'Thunderstorm'], 99: ['⛈️', 'Thunderstorm'] };
  var WX = { city: null, data: null, err: null, loading: false };
  W.get = function () { return WX; };
  /* auto-fetch only from CFG.weatherAutoDaysBefore days before the trip until it ends; otherwise on tap */
  W.wanted = function () {
    var t = T.now(), start = T.jstAt(P.days[0], 0), end = Date.parse(T.CFG.tripEnd);
    return t >= start - (T.CFG.weatherAutoDaysBefore || 14) * 864e5 && t <= end;
  };
  /* today's city during the trip, else the city of the day on screen, else the first day's */
  W.city = function () {
    var st = N.state(), route = T.router.route, d = st.phase === 'trip' ? P.day(st.day) : (route.view === 'day' ? P.day(route.day) : P.day(P.days[0]));
    return N.cityOf(d);
  };
  W.load = function (force) {
    var city = W.city(), c = P.cities[city]; if (!c) return;
    var key = 'wx.' + city, cached = LS.get(key, null);
    if (cached && Date.now() - cached.at < 60 * 60e3 && !force) { WX = { city: city, data: cached.data }; W.render(); return; }
    if (!navigator.onLine) { WX = { city: city, data: cached && cached.data, err: 'Offline' + (cached ? ' — showing last forecast' : ''), stale: !!cached }; W.render(); return; }
    WX.loading = true; WX.city = city; W.render();
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + c[0] + '&longitude=' + c[1] +
      '&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FTokyo&forecast_days=7';
    fetch(url).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (j) {
      LS.set(key, { at: Date.now(), data: j }); WX = { city: city, data: j }; W.render();
    }).catch(function () { WX = { city: city, data: cached && cached.data, err: 'Weather unavailable right now', stale: !!cached }; W.render(); });
  };
  /* compact = the chip in the Now card; full = the side card / weather sheet */
  W.html = function (compact) {
    if (!WX.city) {
      return compact ? '' : '<section class="w" aria-label="Weather"><h2 class="w-h">Weather</h2><p class="now-sub">Forecasts load automatically from two weeks before the trip.</p><div class="w-act"><button class="btn" data-act="wx">Check ' + esc(W.city()) + ' now</button></div><p class="fine">Open-Meteo · no tracking.</p></section>';
    }
    if (WX.loading && !WX.data) { // skeleton in the card's own shape (no "Loading…" text)
      if (compact) return '<span class="wx-chip sk" aria-hidden="true"></span>';
      return '<section class="w wx-sk" aria-busy="true" aria-label="Weather · ' + esc(WX.city) + ', loading"><h2 class="w-h">Weather · ' + esc(WX.city) + '</h2><div class="wx-row"><span class="sk sk-ic"></span><div><span class="sk sk-t"></span><span class="sk sk-s"></span></div></div>' +
        '<div class="wx-d" aria-hidden="true">' + new Array(8).join('<span class="sk"></span>') + '</div></section>';
    }
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
  };
  /* every place weather shows: side card, Now-card chips, the open weather sheet */
  W.render = function () {
    var el = $('#wx-d'); if (el) el.innerHTML = W.html(false);
    $$('.wx-inline').forEach(function (e) { e.innerHTML = W.html(true); });
    if (T.sheet.open === 'wx') $('#me-b').innerHTML = W.html(false);
  };
})(window.TripApp);
