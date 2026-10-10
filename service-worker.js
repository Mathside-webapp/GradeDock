/* GradeDock PWA v1 — GitHub Pages subpath/localhost safe.
   Cache only static app files; never intercept Supabase/API or third-party requests.
   Navigation is network-first, with an informational offline fallback.
*/
const CACHE_NAME = 'gradedock-shell-v3-20261010-logo';
const CACHE_PREFIX = 'gradedock-shell-';
const SHELL = [
  './offline.html', './manifest.webmanifest', './assets/favicon.png?v=3.26', './assets/gradedock-logo-icon.png?v=3.26',
  './icons/icon-192.png?v=3.26', './icons/icon-512.png?v=3.26', './icons/apple-touch-icon.png?v=3.26',
  './icons/maskable-512.png?v=3.26', './css/styles.css?v=3.25', './css/pwa.css?v=1',
  './js/pwa.js?v=1', './js/item-analysis.js?v=1', './js/app.js?v=3.25'
];
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.add('./offline.html'); // Required for a reliable offline screen.
    await Promise.allSettled(SHELL.filter(x=>x!=='./offline.html').map(x=>cache.add(x)));
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key=>key.startsWith(CACHE_PREFIX)&&key!==CACHE_NAME).map(key=>caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  if(event.data && event.data.type==='SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if(req.method!=='GET') return;
  const url = new URL(req.url);
  if(url.origin!==self.location.origin) return; // Supabase, CDNs are always network-controlled.
  const base = new URL(self.registration.scope);
  if(!url.pathname.startsWith(base.pathname)) return;
  if(req.mode==='navigate') {
    event.respondWith((async()=>{
      try {
        const res = await fetch(req);
        if(res.ok) return res;
      } catch(_) { /* Offline */ }
      return (await caches.match('./offline.html')) || Response.error();
    })());
    return;
  }
  // Configuration and user downloads are never cached.
  if(url.pathname.endsWith('/js/config.js')) return;
  if(!/\.(?:js|css|png|jpe?g|webp|svg|ico|webmanifest)$/i.test(url.pathname)) return;
  event.respondWith((async()=>{
    try {
      const fresh=await fetch(req);
      if(fresh.ok){
        const cache=await caches.open(CACHE_NAME);
        cache.put(req,fresh.clone());
      }
      return fresh;
    }catch(_){return (await caches.match(req))||Response.error();}
  })());
});
