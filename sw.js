const CACHE = 'liteworship-cache-v1';
const ASSETS = ['./index.html','./projection.html','./remote.html','./style.css','./app.js','./storage.js','./bible.js','./bible_rv1960.json','./manifest.json','./icon.svg'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then(res => { const copy=res.clone(); caches.open(CACHE).then(c=>c.put(e.request,copy)); return res; }).catch(()=>caches.match(e.request)));
});
