/* Push handlers for the app's service worker. In ../sw.js, add as the FIRST line:
     importScripts('backend/push-sw.js');
   Handles FCM web push payloads ({ notification, data, ... }) without loading the
   Firebase SDK in the worker. iOS requires every push to show a notification. */
self.addEventListener('push', function (e) {
  var p = {};
  try { p = e.data ? e.data.json() : {}; } catch (_) { p = { notification: { body: e.data && e.data.text() } }; }
  var n = p.notification || {}, d = p.data || {};
  var title = n.title || d.title || 'Japan 2027';
  var opts = {
    body: n.body || d.body || '',
    tag: d.tag || n.tag || undefined,
    renotify: !!(d.tag || n.tag),
    icon: n.icon || 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    data: { jp27push: 1, url: d.url || (p.fcmOptions && p.fcmOptions.link) || './', msg: d.jp27msg || null }
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});
self.addEventListener('notificationclick', function (e) {
  var d = e.notification.data || {};
  if (!d.jp27push) return;               // not ours → let the app's handler run
  e.stopImmediatePropagation();
  e.notification.close();
  var url = new URL(d.url || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cs) {
    for (var i = 0; i < cs.length; i++) { if ('navigate' in cs[i]) { return cs[i].navigate(url).then(function (c) { return c && c.focus(); }); } }
    return self.clients.openWindow(url);
  }));
});
