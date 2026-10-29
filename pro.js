// Owner / manager tools and app plumbing:
//   - /api/dashboard  one-call home screen (today vs yesterday, expenses, cash, debtors, creditors, branches)
//   - /api/alerts     the notification feed (new web orders, low stock, overdue bills, failed fiscal docs, long shifts)
//   - /api/push/*     Web Push (phone notifications while the app is closed). Needs HTTPS; falls back silently without it.
//   - /api/expenses   running costs (rent, power, salaries ...) so profit is real, not just gross margin
//   - /manifest.webmanifest, /shop.webmanifest, /sw.js, /shop-sw.js   PWA install + offline
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {db,setting,setSetting,audit,stock,custBalance}=require('./db'),sec=require('./lib/secrets');
let webpush=null;try{webpush=require('web-push')}catch(e){console.warn('web-push not installed: phone push notifications are off (npm install web-push)')}

db.exec(`CREATE TABLE IF NOT EXISTS expenses(id INTEGER PRIMARY KEY,ts INT,branch_id INT DEFAULT 1,category TEXT,amount REAL,method TEXT DEFAULT 'cash',note TEXT,user_id INT,voided INT DEFAULT 0,voided_by INT);
CREATE INDEX IF NOT EXISTS ix_exp_ts ON expenses(ts);
CREATE TABLE IF NOT EXISTS push_subs(id INTEGER PRIMARY KEY,user_id INT,endpoint TEXT UNIQUE,p256dh TEXT,auth TEXT,ua TEXT,ts INT);
CREATE TABLE IF NOT EXISTS push_sent(user_id INT,k TEXT,ts INT,PRIMARY KEY(user_id,k));`);

const CATS=['Rent','Salaries','Electricity & water','Internet & airtime','Transport & fuel','Licences & permits','Repairs','Marketing','Packaging','Other'];
const PUB=path.join(__dirname,'public'),PWA=path.join(__dirname,'pwa');

module.exports=(app,{auth,H,E,now,RANK})=>{
 const get=(s,...a)=>db.prepare(s).get(...a),all=(s,...a)=>db.prepare(s).all(...a),r0=n=>Math.round(n),mgr=u=>RANK[u.role]>=2;

 /* ---------- PWA files ---------- */
 const build=(()=>{const h=crypto.createHash('sha1');const walk=d=>{for(const f of fs.readdirSync(d).sort()){const p=path.join(d,f),s=fs.statSync(p);if(s.isDirectory())walk(p);else h.update(p+s.size+s.mtimeMs)}};try{walk(PUB);walk(PWA)}catch(e){}return h.digest('hex').slice(0,10)})();
 const icons=[{src:'/icons/icon-192.png',sizes:'192x192',type:'image/png',purpose:'any'},{src:'/icons/icon-512.png',sizes:'512x512',type:'image/png',purpose:'any'},{src:'/icons/maskable-512.png',sizes:'512x512',type:'image/png',purpose:'maskable'}];
 const manifest=(res,o)=>res.type('application/manifest+json').set('Cache-Control','no-cache').send(JSON.stringify({lang:'en',dir:'ltr',display:'standalone',display_override:['standalone','minimal-ui'],orientation:'any',background_color:'#6b1d33',theme_color:'#6b1d33',icons,categories:['business','shopping'],...o}));
 app.get('/manifest.webmanifest',(q,r)=>{const biz=setting('biz','CellarPOS');manifest(r,{id:'/',name:biz+' POS',short_name:biz.length>12?'CellarPOS':biz,description:'Wines & spirits point of sale',start_url:'/?source=pwa',scope:'/',shortcuts:[{name:'Sell',short_name:'Sell',url:'/?go=sell',icons:[icons[0]]},{name:'Orders',short_name:'Orders',url:'/?go=orders',icons:[icons[0]]},{name:'Stock',short_name:'Stock',url:'/?go=stock',icons:[icons[0]]}]})});
 app.get('/shop.webmanifest',(q,r)=>{const biz=setting('biz','Shop');manifest(r,{id:'/shop',name:biz+' — order online',short_name:biz.length>12?'Order':biz,description:'Order wines & spirits for delivery',start_url:'/shop?source=pwa',scope:'/shop',background_color:'#f6f1ea',theme_color:'#6b1d33'})});
 const sw=name=>(q,r)=>{r.set({'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-cache','Service-Worker-Allowed':name=='sw.js'?'/':'/shop'});r.send(fs.readFileSync(path.join(PWA,name),'utf8').replace(/__BUILD__/g,build))};
 app.get('/sw.js',sw('sw.js'));app.get('/shop-sw.js',sw('shop-sw.js'));

 /* ---------- expenses ---------- */
 app.get('/api/expenses',auth('manager'),H(req=>{const a=+req.query.from||0,b=+req.query.to||now(),br=req.query.branch=='all'&&req.user.role=='owner'?null:req.user.branch,w=(br==null?'1=1':'e.branch_id='+br)+' AND e.voided=0 AND e.ts BETWEEN ? AND ?';
  const rows=all(`SELECT e.*,u.name user FROM expenses e LEFT JOIN users u ON u.id=e.user_id WHERE ${w} ORDER BY e.ts DESC LIMIT 300`,a,b);
  return{rows,total:get(`SELECT COALESCE(SUM(amount),0) s FROM expenses e WHERE ${w}`,a,b).s,by_cat:all(`SELECT category,SUM(amount) amount FROM expenses e WHERE ${w} GROUP BY category ORDER BY amount DESC`,a,b),categories:CATS}}));
 app.post('/api/expenses',auth('manager'),H(req=>{const b=req.body,amount=Math.round((+b.amount||0)*100)/100,cat=String(b.category||'').trim().slice(0,40)||'Other',note=String(b.note||'').slice(0,200),method=['cash','mpesa','bank','other'].includes(b.method)?b.method:'cash';
  if(!(amount>0)||amount>1e8)throw E(400,'Enter an amount greater than 0');let ts=+b.ts||now();if(ts>now()+36e5||ts<now()-90*864e5)ts=now();
  const id=db.prepare('INSERT INTO expenses(ts,branch_id,category,amount,method,note,user_id) VALUES(?,?,?,?,?,?,?)').run(ts,req.user.branch,cat,amount,method,note,req.user.id).lastInsertRowid;
  audit(req.user.id,'expense added','expense',id,null,{cat,amount,method});return{id}}));
 app.delete('/api/expenses/:id',auth('manager'),H(req=>{const e=get('SELECT * FROM expenses WHERE id=? AND voided=0',req.params.id);if(!e)throw E(404,'Not found');
  if(req.user.role!='owner'&&(e.user_id!=req.user.id||now()-e.ts>36e5))throw E(403,'Managers can remove their own entry within an hour. Ask the owner.');
  db.prepare('UPDATE expenses SET voided=1,voided_by=? WHERE id=?').run(req.user.id,e.id);audit(req.user.id,'expense removed','expense',e.id,{cat:e.category,amount:e.amount},null)}));

 /* ---------- dashboard ---------- */
 const day=(a,b,br)=>{const w=(br==null?'1=1':'s.branch_id='+br)+" AND s.status='completed' AND s.ts>=? AND s.ts<?",t=get(`SELECT COUNT(*) n,COALESCE(SUM(total),0) revenue,COALESCE(SUM(cogs),0) cogs FROM sales s WHERE ${w}`,a,b),
   rt=get('SELECT COALESCE(SUM(r.amount),0) a,COALESCE(SUM(r.cogs),0) c FROM returns r JOIN sales s ON s.id=r.sale_id WHERE '+(br==null?'1=1':'s.branch_id='+br)+' AND r.ts>=? AND r.ts<?',a,b),
   ex=get('SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE voided=0 AND '+(br==null?'1=1':'branch_id='+br)+' AND ts>=? AND ts<?',a,b).s,rev=t.revenue-rt.a,profit=rev-(t.cogs-rt.c);
   return{n:t.n,revenue:rev,profit,expenses:ex,net:profit-ex}};
 app.get('/api/dashboard',auth('manager'),H(req=>{const t=now(),from=Math.min(+req.query.from||t-864e5,t),all_=req.query.branch=='all'&&req.user.role=='owner',br=all_?null:req.user.branch,tz=Math.max(-840,Math.min(840,req.query.tz===undefined||!isFinite(+req.query.tz)?180:Math.round(+req.query.tz))),span=Math.max(Math.min(+req.query.span||864e5,31*864e5),36e5),
  today=day(from,t+1,br),prev=day(from-span,from,br),
  top=all(`SELECT i.name,SUM(i.qty*i.ml)/MAX(p.bottle_ml,1) bottles,SUM(i.qty*i.price) revenue FROM sale_items i JOIN sales s ON s.id=i.sale_id JOIN products p ON p.id=i.product_id WHERE i.product_id IS NOT NULL AND s.status='completed' AND s.ts>=? ${br==null?'':'AND s.branch_id='+br} GROUP BY i.product_id ORDER BY revenue DESC LIMIT 5`,from),
  hourly=all(`SELECT CAST(strftime('%H',s.ts/1000,'unixepoch',?) AS INT) h,SUM(s.total) revenue FROM sales s WHERE s.status='completed' AND s.ts>=? ${br==null?'':'AND s.branch_id='+br} GROUP BY h ORDER BY h`,(tz>=0?'+':'')+tz+' minutes',from),
  cashiers=all(`SELECT u.name,COUNT(*) n,SUM(s.total) total FROM sales s JOIN users u ON u.id=s.user_id WHERE s.status='completed' AND s.ts>=? ${br==null?'':'AND s.branch_id='+br} GROUP BY u.id ORDER BY total DESC LIMIT 8`,from),
  shifts=all(`SELECT s.id,s.open_ts,s.open_cash,u.name,s.branch_id,(SELECT COALESCE(SUM(p.amount),0) FROM payments p JOIN sales x ON x.id=p.sale_id WHERE x.shift_id=s.id AND x.status='completed' AND p.method='cash') cash_sales FROM shifts s JOIN users u ON u.id=s.user_id WHERE s.close_ts IS NULL ${br==null?'':'AND s.branch_id='+br}`),
  ps=all('SELECT id,reorder_ml FROM products WHERE active=1'),bs=br==null?all('SELECT id FROM branches').map(b=>b.id):[br];
  let low=0,out=0;for(const p of ps){const s=bs.reduce((a,b)=>a+stock(p.id,b),0),r=p.reorder_ml*bs.length;if(s<=0)out++;else if(s<=r)low++}
  let owed=0,debtors=0;for(const c of all('SELECT id FROM customers WHERE active=1')){const b=custBalance(c.id);if(b>0.005){owed+=b;debtors++}}
  const pay=all('SELECT amount-paid o,due_ts FROM supplier_invoices WHERE paid<amount-0.005'),ob=(br==null?'':' AND branch_id='+br),
  orders={new:get("SELECT COUNT(*) n FROM orders WHERE status='new'"+ob).n,open:get("SELECT COUNT(*) n FROM orders WHERE status IN('picking','packed','dispatched')"+ob).n,web:get("SELECT COUNT(*) n FROM orders WHERE channel='web' AND status='new'"+ob).n},
  out_={today,prev,top,hourly,cashiers,shifts,stock:{low,out},receivables:{total:owed,debtors},payables:{total:pay.reduce((a,x)=>a+x.o,0),n:pay.length,overdue:pay.filter(x=>x.due_ts<t).reduce((a,x)=>a+x.o,0)},orders,
   discounts:get("SELECT COALESCE(SUM(discount),0) s,COUNT(CASE WHEN discount>0 THEN 1 END) n FROM sales s WHERE status='completed' AND ts>=?"+(br==null?'':' AND branch_id='+br),from)};
  if(req.user.role=='owner'){out_.branches=all('SELECT id,name FROM branches').map(b=>({...b,...day(from,t+1,b.id)}))}
  return out_}));

 /* ---------- alerts (the bell) ---------- */
 const alertsFor=u=>{const L=[],br=u.branch,m=mgr(u);
  for(const o of all("SELECT id,no,name,phone,ts FROM orders WHERE channel='web' AND status='new' AND branch_id=? ORDER BY ts DESC LIMIT 20",br))L.push({id:'web:'+o.id,kind:'order',sev:'info',title:'New web order '+o.no,body:(o.name||o.phone||'Customer')+' is waiting to be picked',tab:'orders',ts:o.ts});
  if(m){
   for(const p of all('SELECT id,name,reorder_ml,bottle_ml FROM products WHERE active=1')){const s=stock(p.id,br);if(s<=0)L.push({id:`low:${p.id}:${br}:out`,kind:'stock',sev:'bad',title:p.name+' is out of stock',body:'Reorder it or hide it from the shop',tab:'stock',pid:p.id,ts:0});else if(s<=p.reorder_ml)L.push({id:`low:${p.id}:${br}:low`,kind:'stock',sev:'warn',title:p.name+' is running low',body:Math.round(s/p.bottle_ml*10)/10+' bottle(s) left, reorder level '+Math.round(p.reorder_ml/p.bottle_ml*10)/10,tab:'stock',pid:p.id,ts:0})}
   for(const i of all('SELECT i.id,i.amount-i.paid o,i.due_ts,i.invoice,s.name FROM supplier_invoices i JOIN suppliers s ON s.id=i.supplier_id WHERE i.paid<i.amount-0.005 AND i.due_ts<? ORDER BY i.due_ts LIMIT 10',now()))L.push({id:'bill:'+i.id,kind:'bill',sev:'warn',title:'Overdue bill: '+i.name,body:'KSh '+r0(i.o).toLocaleString('en-KE')+(i.invoice?' · invoice '+i.invoice:''),tab:'buy',ts:i.due_ts});
   const ff=get("SELECT COUNT(*) n,MAX(id) m FROM fiscal_docs WHERE status='failed'");if(ff.n)L.push({id:'fis:'+ff.m,kind:'fiscal',sev:'bad',title:ff.n+' tax document(s) failed to send',body:'Open Settings → Logs to retry',tab:'more',ts:0});
   for(const s of all('SELECT s.id,s.open_ts,u.name FROM shifts s JOIN users u ON u.id=s.user_id WHERE s.close_ts IS NULL AND s.branch_id=? AND s.open_ts<?',br,now()-14*36e5))L.push({id:'shift:'+s.id,kind:'shift',sev:'warn',title:s.name+"'s shift has been open "+Math.round((now()-s.open_ts)/36e5)+'h',body:'Remind them to count the till and close',tab:'shift',ts:s.open_ts});
   const tr=get("SELECT COUNT(*) n,MAX(id) m FROM transfers WHERE status IN('requested','dispatched') AND (from_branch=? OR to_branch=?)",br,br);if(tr.n)L.push({id:'tr:'+tr.m+':'+tr.n,kind:'transfer',sev:'info',title:tr.n+' stock transfer(s) need action',body:'Approve, dispatch or confirm receipt',tab:'stock',ts:0})}
  return L};
 app.get('/api/alerts',auth(),H(req=>alertsFor(req.user)));

 /* ---------- Web Push ---------- */
 const vapid=()=>{if(!webpush)return null;let pub=setting('vapid_pub',''),priv=sec.dec(setting('vapid_priv_enc',''));if(!pub||!priv){const k=webpush.generateVAPIDKeys();pub=k.publicKey;priv=k.privateKey;setSetting('vapid_pub',pub);setSetting('vapid_priv_enc',sec.enc(priv))}
  return{pub,priv,subject:process.env.VAPID_SUBJECT||(process.env.PUBLIC_URL&&/^https:/.test(process.env.PUBLIC_URL)?process.env.PUBLIC_URL:'mailto:admin@example.com')}};
 app.get('/api/push/key',auth(),H(()=>{const v=vapid();return{enabled:!!v,key:v&&v.pub}}));
 app.post('/api/push/subscribe',auth(),H(req=>{const s=req.body.subscription||{},k=s.keys||{};if(!vapid())throw E(501,'Push is not available on this server');
  if(!/^https:\/\/[^\s]{10,900}$/.test(String(s.endpoint||''))||!k.p256dh||!k.auth)throw E(400,'Invalid subscription');
  // Everything currently pending is treated as already seen, so turning notifications on does not blast old alerts.
  db.prepare('INSERT INTO push_subs(user_id,endpoint,p256dh,auth,ua,ts) VALUES(?,?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,p256dh=excluded.p256dh,auth=excluded.auth,ua=excluded.ua,ts=excluded.ts').run(req.user.id,s.endpoint,String(k.p256dh).slice(0,200),String(k.auth).slice(0,100),String(req.headers['user-agent']||'').slice(0,160),now());
  const ins=db.prepare('INSERT OR IGNORE INTO push_sent(user_id,k,ts) VALUES(?,?,?)');for(const a of alertsFor(req.user))ins.run(req.user.id,a.id,now())}));
 app.post('/api/push/unsubscribe',auth(),H(req=>{db.prepare('DELETE FROM push_subs WHERE endpoint=? AND user_id=?').run(String(req.body.endpoint||''),req.user.id)}));
 app.post('/api/push/test',auth(),H(async req=>{const n=await send(all('SELECT * FROM push_subs WHERE user_id=?',req.user.id),{title:'Notifications are on',body:'You will be alerted about new orders and stock here.',tag:'test',url:'/'});if(!n)throw E(404,'This device is not subscribed yet');return{sent:n}}));
 async function send(subs,payload){const v=vapid();if(!v||!subs.length)return 0;webpush.setVapidDetails(v.subject,v.pub,v.priv);let n=0;
  for(const s of subs){try{await webpush.sendNotification({endpoint:s.endpoint,keys:{p256dh:s.p256dh,auth:s.auth}},JSON.stringify(payload),{TTL:3600,urgency:'high'});n++}catch(e){if(e.statusCode==404||e.statusCode==410)db.prepare('DELETE FROM push_subs WHERE id=?').run(s.id);else console.warn('push:',e.statusCode||e.message)}}return n}
 let busy=false;
 async function tick(){if(busy||!webpush||!get('SELECT 1 FROM push_subs'))return;busy=true;try{
  const users=all('SELECT DISTINCT u.*,COALESCE(u.branch_id,1) branch FROM push_subs p JOIN users u ON u.id=p.user_id WHERE u.active=1');
  for(const u of users){const al=alertsFor({...u,branch:u.branch}),keys=new Set(al.map(a=>a.id)),seen=new Set(all('SELECT k FROM push_sent WHERE user_id=?',u.id).map(x=>x.k));
   for(const k of seen)if(!keys.has(k))db.prepare('DELETE FROM push_sent WHERE user_id=? AND k=?').run(u.id,k);
   const fresh=al.filter(a=>!seen.has(a.id)).sort((a,b)=>(b.kind=='order')-(a.kind=='order'));if(!fresh.length)continue;
   for(const a of fresh)db.prepare('INSERT OR IGNORE INTO push_sent(user_id,k,ts) VALUES(?,?,?)').run(u.id,a.id,now());
   const subs=all('SELECT * FROM push_subs WHERE user_id=?',u.id),top=fresh.slice(0,3);
   if(fresh.length<=3)for(const a of top)await send(subs,{title:a.title,body:a.body,tag:a.id,url:'/?go='+a.tab});
   else await send(subs,{title:fresh.length+' new alerts',body:top.map(a=>a.title).join(' · '),tag:'digest',url:'/?go=home'})}
  }catch(e){console.error('push tick',e.message)}finally{busy=false}}
 // Baseline once at start so a restart does not re-send everything already on the screen.
 setTimeout(()=>{try{for(const u of all('SELECT DISTINCT u.*,COALESCE(u.branch_id,1) branch FROM push_subs p JOIN users u ON u.id=p.user_id WHERE u.active=1'))for(const a of alertsFor(u))db.prepare('INSERT OR IGNORE INTO push_sent(user_id,k,ts) VALUES(?,?,?)').run(u.id,a.id,now())}catch(e){}},500);
 setInterval(tick,30000).unref();
 app.pro={tick,alertsFor};
};
module.exports.CATS=CATS;
