/* App configuration. Plain script, loaded before app.js. */
window.APP_CONFIG = {
  title: 'Japan 2027 · Nic & Elly',

  /* Outbound flight (pre-trip countdown). */
  departure: { iso: '2027-01-08T12:45:00-08:00', label: 'the flight to Japan', when: 'Fri 8 Jan · 12:45 PM at LAX' },
  /* Trip is done after the return flight. */
  tripEnd: '2027-01-21T18:15:00+09:00',

  /* Weather (Open-Meteo, no key). Auto-fetch only from this many days before the trip; otherwise on tap. */
  weatherAutoDaysBefore: 14,

  /* Leave-by estimate (straight-line distance; deliberately conservative). */
  leaveBy: { walkKmh: 4.5, walkMaxKm: 1.2, transitKmh: 20, transitBufferMin: 10, extraBufferMin: 10 },
  notifyLeadMin: 30, /* default heads-up; each phone can change it in Trip alerts */

  /* Where the itinerary comes from.
     'static'    — data/*.json on the site (public: anyone with the URL can read them).
     'firestore' — APP-SHELL MODE: the public site ships no itinerary; js/live.js loads it from Firestore
                   after this phone is linked (needs backend.loadTrip(); see NOTES.md). Build with
                   `python3 tools/build.py --shell` so dist/ has no data/trip.json. */
  dataSource: 'firestore',

  /* OPTIONAL PASSCODE GATE — OFF by default.
     ⚠ Client-side only. This is NOT security: anyone can read the data files
     directly or bypass this check in devtools. It only keeps casual visitors
     (someone who stumbles on the URL) from browsing the plan.
     To enable: set enabled:true and put the SHA-256 hex of your passcode in sha256
     (e.g. `printf %s 'mycode' | sha256sum`). */
  passcode: { enabled: false, sha256: '' }
};
