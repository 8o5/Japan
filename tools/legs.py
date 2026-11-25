#!/usr/bin/env python3
"""Precompute door-to-door transit times between consecutive timed stops, for the app's leave-by.

Reads trip.json (planner) and places.json ({"places": {name: [lat, lng, label, q]}, "cities": ...}),
asks the Google Routes API (transit) for each leg, and writes the result back into places.json under "legs":

  "legs": { "From stop→To stop": {"min": 27, "walkMin": 9, "transfers": 1, "lines": ["Ginza", "Yamanote"],
                                  "board": "Asakusa", "source": "google", "computed": "2026-12-01"} }

The app (Plan.legs / Now.leg) uses a leg only when you're at or near the "from" stop; everything else keeps the
straight-line estimate. Publish places.json the usual way afterwards so phones get it offline.

  GOOGLE_MAPS_KEY=... python3 tools/legs.py trip.json places.json [--dry-run] [--only-missing]

Timetables for Jan 2027 may not exist yet, so each leg is asked for the same weekday and arrival time in the
coming week (Tokyo timetables rarely change). Rebuild in early January to refresh.
Never commit the key: this repo is published as-is to GitHub Pages.
"""
import argparse, datetime as dt, json, os, re, sys, urllib.request

JST = dt.timezone(dt.timedelta(hours=9))
URL = 'https://routes.googleapis.com/directions/v2:computeRoutes'
FIELDS = 'routes.duration,routes.legs.steps.travelMode,routes.legs.steps.staticDuration,routes.legs.steps.transitDetails'


def parse_clock(s):
    """Same rule as core.js T.parseClock: '2:30 PM' or '2:30–4:00 PM' → minutes; 'by …' → None."""
    if not s or re.match(r'^by\b', s, re.I):
        return None
    m = re.search(r'(\d{1,2}):(\d{2})\s*(?:[–-]\s*\d{1,2}:\d{2}\s*)?(AM|PM)', s)
    if not m:
        return None
    return (int(m.group(1)) % 12 + (12 if m.group(3) == 'PM' else 0)) * 60 + int(m.group(2))


def timed_stops(day):
    """Same filter as plan.js index(): timed, not optional/moved, not in an optional block. Party lanes kept apart."""
    lanes = {}
    def rec(items, party, ob):
        for it in items:
            if it.get('kind') == 'party':
                rec(it.get('items', []), it.get('party', ''), ob)
            elif it.get('kind') == 'stop':
                mins = parse_clock(it.get('time'))
                if mins is not None and not it.get('optional') and not it.get('moved') and not ob:
                    lanes.setdefault(party or '', []).append((mins, it))
    for b in day.get('blocks', []):
        rec(b.get('items', []), '', b.get('optional'))
    shared = lanes.pop('', [])
    out = [sorted(shared, key=lambda x: x[0])]
    out += [sorted(shared + v, key=lambda x: x[0]) for v in lanes.values()]  # each person's lane includes shared stops
    return out


def proxy_arrival(day_num, mins, today):
    """Jan <day_num> 2027 at mins JST → same weekday + time in the next 7 days (strictly after today)."""
    real = dt.datetime(2027, 1, day_num, tzinfo=JST) + dt.timedelta(minutes=mins)
    d = today + dt.timedelta(days=1)
    while d.weekday() != real.weekday():
        d += dt.timedelta(days=1)
    return dt.datetime(d.year, d.month, d.day, tzinfo=JST) + dt.timedelta(minutes=mins)


def latlng(p):
    return {'location': {'latLng': {'latitude': float(p[0]), 'longitude': float(p[1])}}}


def route(key, a, b, arrive):
    body = {'origin': latlng(a), 'destination': latlng(b), 'travelMode': 'TRANSIT',
            'arrivalTime': arrive.isoformat(), 'languageCode': 'en', 'regionCode': 'JP'}
    req = urllib.request.Request(URL, json.dumps(body).encode(), method='POST', headers={
        'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELDS})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.load(r)
    rs = data.get('routes') or []
    if not rs:
        return None
    r0, walk, lines, board = rs[0], 0, [], None
    for leg in r0.get('legs', []):
        for s in leg.get('steps', []):
            sec = int(str(s.get('staticDuration', '0s')).rstrip('s') or 0)
            if s.get('travelMode') == 'WALK':
                walk += sec
            td = s.get('transitDetails')
            if td:
                ln = td.get('transitLine', {})
                lines.append(ln.get('nameShort') or ln.get('name') or '?')
                board = board or td.get('stopDetails', {}).get('departureStop', {}).get('name')
    total = int(str(r0.get('duration', '0s')).rstrip('s') or 0)
    return {'min': round(total / 60), 'walkMin': round(walk / 60), 'transfers': max(len(lines) - 1, 0),
            'lines': lines, 'board': board, 'source': 'google'}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('trip'); ap.add_argument('places')
    ap.add_argument('--dry-run', action='store_true', help='list legs, call nothing, write nothing')
    ap.add_argument('--only-missing', action='store_true', help='keep legs already in places.json')
    a = ap.parse_args()
    trip = json.load(open(a.trip)); pj = json.load(open(a.places))
    places = pj.get('places', pj)
    legs = dict(pj.get('legs', {})) if a.only_missing else {}
    key = os.environ.get('GOOGLE_MAPS_KEY')
    if not a.dry_run and not key:
        sys.exit('Set GOOGLE_MAPS_KEY (Routes API enabled).')
    today = dt.datetime.now(JST).date()
    todo = {}
    for day in trip['days']:
        for lane in timed_stops(day):
            for (m1, s1), (m2, s2) in zip(lane, lane[1:]):
                if s1['name'] == s2['name'] or s1['name'] not in places or s2['name'] not in places:
                    continue
                todo.setdefault(s1['name'] + '→' + s2['name'], (day['day'], m2, places[s1['name']], places[s2['name']]))
    stamp = today.isoformat()
    for k, (dn, m2, p1, p2) in todo.items():
        if k in legs:
            continue
        arrive = proxy_arrival(dn, m2, today)
        if a.dry_run:
            print('Jan %d  %s  (ask for arrival %s)' % (dn, k, arrive.strftime('%a %d %b %H:%M'))); continue
        try:
            r = route(key, p1, p2, arrive)
        except Exception as e:  # keep going; a missing leg just falls back to the straight-line estimate
            print('FAIL', k, e, file=sys.stderr); continue
        if r:
            r['computed'] = stamp; legs[k] = r
            print('%3d min  %s  %s' % (r['min'], k, ' → '.join(r['lines']) or 'walk'))
        else:
            print('no route', k, file=sys.stderr)
    print('%d legs (%d pairs in the plan)' % (len(legs), len(todo)), file=sys.stderr)
    if not a.dry_run:
        pj['legs'] = legs
        json.dump(pj, open(a.places, 'w'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
