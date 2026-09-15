const CACHE = 'syncaboutit-shell-v7';
const SHELL = ['./', './index.html', './styles.css', './themes.css', './markdown.css', './workspace.css', './theme.js', './app.js', './library.js', './markdown.js', './core.js', './store.js', './drive.js', './auth.js', './icons/icon-16.png', './icons/icon-32.png', './icons/icon-128.png', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png', './manifest.webmanifest'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('syncaboutit-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request).then(cached => cached || (event.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
});
self.addEventListener('notificationclick', event => { event.notification.close(); event.waitUntil(self.clients.matchAll({ type: 'window' }).then(clients => clients[0]?.focus() || self.clients.openWindow('./index.html'))); });
