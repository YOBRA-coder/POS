/* Online shop service worker (scope /shop). Makes the shop installable, opens fast, and keeps the last menu
   and product photos so browsing still works on a weak connection. Orders and payments always go to the network. */
const V='cellarpos-shop-__BUILD__',IMG='cellarpos-shop-img-v1';
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.add(new Request('/shop',{cache:'reload'})).catch(()=>{})))});
self.addEventListener('activate',e=>{e.waitUntil((async()=>{for(const k of await caches.keys())if(k.startsWith('cellarpos-shop-')&&k!==V&&k!==IMG)await caches.delete(k);await self.clients.claim()})())});
self.addEventListener('message',e=>{if(e.data==='SKIP_WAITING')self.skipWaiting()});
const trim=async(name,max)=>{const c=await caches.open(name),k=await c.keys();for(let i=0;i<k.length-max;i++)await c.delete(k[i])};
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET')return;const u=new URL(r.url);
 if(r.mode==='navigate'&&u.pathname.startsWith('/shop')){e.respondWith((async()=>{try{const n=await fetch(r);if(n.ok)(await caches.open(V)).put('/shop',n.clone());return n}catch(x){return(await caches.match('/shop'))||Response.error()}})());return}
 if(u.pathname==='/api/public/catalog'){e.respondWith((async()=>{const c=await caches.open(V);try{const n=await fetch(r);if(n.ok)c.put(r,n.clone());return n}catch(x){return(await c.match(r))||Response.error()}})());return}
 if(u.pathname.startsWith('/uploads/')||u.hostname==='res.cloudinary.com'||u.pathname.startsWith('/icons/')){e.respondWith((async()=>{const c=await caches.open(IMG),h=await c.match(r);if(h)return h;try{const n=await fetch(r);if(n.ok||n.type==='opaque'){c.put(r,n.clone());trim(IMG,200)}return n}catch(x){return Response.error()}})())}});
