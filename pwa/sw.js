/* CellarPOS service worker. Served by pro.js, which stamps a per-deploy build id into the cache name.
   - App shell and static files: cached, so the till opens instantly and even with no network.
   - /api/*: never cached here. The app keeps its own offline queue and catalogue copy.
   - Product photos: cached on first view.
   - Push: shows phone notifications for new orders / stock alerts and opens the right screen on tap. */
const V='cellarpos-__BUILD__',IMG='cellarpos-img-v1',SHELL=['/','/barcode.js','/vendor/zxing.min.js','/manifest.webmanifest','/icons/icon-192.png','/icons/icon-512.png','/icons/favicon-32.png'];

self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>Promise.all(SHELL.map(u=>c.add(new Request(u,{cache:'reload'})).catch(()=>{})))))});
self.addEventListener('activate',e=>{e.waitUntil((async()=>{for(const k of await caches.keys())if(k!==V&&k!==IMG&&k.startsWith('cellarpos-')&&!k.startsWith('cellarpos-shop'))await caches.delete(k);await self.clients.claim()})())});
self.addEventListener('message',e=>{if(e.data==='SKIP_WAITING')self.skipWaiting()});

const trim=async(name,max)=>{const c=await caches.open(name),k=await c.keys();for(let i=0;i<k.length-max;i++)await c.delete(k[i])};
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET')return;const u=new URL(r.url);
 if(u.origin===location.origin&&(u.pathname.startsWith('/api/')||u.pathname==='/sw.js'))return;
 if(r.mode==='navigate'){e.respondWith((async()=>{try{const n=await fetch(r);if(n.ok&&u.pathname==='/'){(await caches.open(V)).put('/',n.clone())}return n}catch(x){return(u.pathname==='/'&&await caches.match('/'))||Response.error()}})());return}
 if(u.pathname.startsWith('/uploads/')||u.hostname==='res.cloudinary.com'){e.respondWith((async()=>{const c=await caches.open(IMG),h=await c.match(r);if(h)return h;try{const n=await fetch(r);if(n.ok||n.type==='opaque'){c.put(r,n.clone());trim(IMG,150)}return n}catch(x){return Response.error()}})());return}
 if(u.origin===location.origin){e.respondWith((async()=>{const c=await caches.open(V),h=await c.match(r),f=fetch(r).then(n=>{if(n.ok)c.put(r,n.clone());return n}).catch(()=>h);return h||f})())}});

self.addEventListener('push',e=>{let d={};try{d=e.data.json()}catch(x){d={title:'CellarPOS',body:e.data?e.data.text():''}}
 e.waitUntil(self.registration.showNotification(d.title||'CellarPOS',{body:d.body||'',tag:d.tag||undefined,renotify:!!d.tag,icon:'/icons/icon-192.png',badge:'/icons/badge-96.png',vibrate:[120,60,120],data:{url:d.url||'/'}}))});
self.addEventListener('notificationclick',e=>{e.notification.close();const url=new URL((e.notification.data&&e.notification.data.url)||'/',location.origin);
 e.waitUntil((async()=>{const all=await clients.matchAll({type:'window',includeUncontrolled:true});for(const c of all){if(new URL(c.url).origin===location.origin){await c.focus();c.postMessage({go:url.searchParams.get('go')||'sell'});return}}await clients.openWindow(url.href)})())});
