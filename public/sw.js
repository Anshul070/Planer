const CACHE_NAME = 'dinplan-cache-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  // A simple pass-through that caches if network fails.
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
