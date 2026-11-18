// Łącznik — service worker: działanie offline powłoki, powiadomienia, menu „Udostępnij” (Android, Windows)
const WERSJA = '1.2.0';
const PAMIEC = 'lacznik-' + WERSJA;
const SKRZYNKA = 'lacznik-udostepnione';
const POWLOKA = ['./', 'index.html', 'css/app.css?v=' + WERSJA, 'js/app.js?v=' + WERSJA, 'manifest.webmanifest',
  'img/logowanie.webp', 'img/pusto.webp', 'ikony/ikona-180.png', 'ikony/ikona-192.png', 'ikony/ikona-32.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(PAMIEC).then((c) => c.addAll(POWLOKA)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('lacznik-') && k !== PAMIEC && k !== SKRZYNKA) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  // menu „Udostępnij”: system wysyła tu pliki/tekst, odkładamy je i otwieramy aplikację
  if (e.request.method === 'POST' && u.origin === location.origin && u.pathname.endsWith('/udostepnij')) {
    e.respondWith((async () => {
      const f = await e.request.formData();
      const c = await caches.open(SKRZYNKA);
      const id = Date.now();
      const tekst = [f.get('title'), f.get('text'), f.get('url')].filter((x) => x && String(x).trim()).join('\n');
      const pliki = f.getAll('pliki').filter((x) => x && typeof x === 'object' && x.size);
      const opis = { tekst, pliki: pliki.map((p, i) => ({ k: `./udostepnione/${id}/${i}`, nazwa: p.name, typ: p.type })) };
      for (let i = 0; i < pliki.length; i++) await c.put(opis.pliki[i].k, new Response(pliki[i], { headers: { 'Content-Type': pliki[i].type || 'application/octet-stream' } }));
      await c.put('./udostepnione/opis', new Response(JSON.stringify(opis), { headers: { 'Content-Type': 'application/json' } }));
      return Response.redirect('./?udostepnione=1', 303);
    })());
    return;
  }
  if (e.request.method !== 'GET') return;
  const powloka = u.origin === location.origin || u.hostname.endsWith('fonts.googleapis.com') || u.hostname.endsWith('fonts.gstatic.com');
  if (!powloka) return; // API serwera zawsze z sieci
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).then((r) => { const k = r.clone(); caches.open(PAMIEC).then((c) => c.put('index.html', k)); return r; })
      .catch(() => caches.match('index.html')));
    return;
  }
  e.respondWith(caches.match(e.request).then((z) => z || fetch(e.request).then((r) => {
    if (r.ok || r.type === 'opaque') { const k = r.clone(); caches.open(PAMIEC).then((c) => c.put(e.request, k)); }
    return r;
  })));
});

self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data.json(); } catch { d = { tresc: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.tytul || 'Łącznik', {
    body: d.tresc || 'Nowa rzecz w Łączniku', tag: d.tag || undefined, icon: 'ikony/ikona-192.png', badge: 'ikony/ikona-192.png', data: { id: d.id || null },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const cel = new URL('./' + (e.notification.data?.id ? '?rzecz=' + encodeURIComponent(e.notification.data.id) : ''), self.registration.scope).href;
  e.waitUntil((async () => {
    const okna = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const o of okna) { if ('focus' in o) { o.postMessage({ rzecz: e.notification.data?.id || null }); return o.focus(); } }
    return self.clients.openWindow(cel);
  })());
});
