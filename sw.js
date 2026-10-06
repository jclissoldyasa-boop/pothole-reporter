// Keeps the app opening with no signal. Road lookups still need the internet.
const CACHE="pothole-reporter-v12";
const FILES=["./","index.html","style.css","councils.js","app.js","manifest.webmanifest","icon-192.png","icon-512.png","icon-maskable-192.png","icon-maskable-512.png","sign.webp","qr.svg"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)));self.skipWaiting()});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE).map(x=>caches.delete(x)))));self.clients.claim()});
self.addEventListener("fetch",e=>{
  const u=new URL(e.request.url);
  if(u.origin!==location.origin)return; // never cache map lookups
  // Network first so updates show up, cache when offline. no-cache makes the browser check with the
  // server every time, so a new page never runs with yesterday's app.js.
  // Only real pages are saved for offline use. If the site is briefly down (an error page), the saved copy is used.
  const saved=()=>caches.match(e.request).then(r=>r||caches.match("index.html"));
  e.respondWith(fetch(e.request,{cache:"no-cache"}).then(r=>{
    if(!r.ok)return saved().then(s=>s||r);
    const c=r.clone();caches.open(CACHE).then(x=>x.put(e.request,c));return r;
  }).catch(saved));
});
