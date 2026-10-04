// Product management (sizes such as half-quarter, barcodes, photos), bulk stock receiving by scanning,
// and the owner's payment (M-Pesa) and photo-storage settings.
const {db,setting,setSetting,audit,stock,ledger}=require('./db'),mpesa=require('./lib/mpesa'),images=require('./lib/images'),sec=require('./lib/secrets');
module.exports=(app,{auth,H,E,now})=>{
 const get=(s,...a)=>db.prepare(s).get(...a),all=(s,...a)=>db.prepare(s).all(...a),r2=n=>Math.round(n*100)/100;
 const prod=id=>get('SELECT * FROM products WHERE id=? AND active=1',id)||(()=>{throw E(404,'Product not found')})();
 const codeOk=c=>/^[A-Za-z0-9][A-Za-z0-9 ._\-\/]{2,39}$/.test(c);
 const takeCode=(code,unit,mult)=>{if(!codeOk(code))throw E(400,'Barcode must be 3-40 letters/numbers');const used=get('SELECT p.name FROM barcodes b JOIN units u ON u.id=b.unit_id JOIN products p ON p.id=u.product_id WHERE b.code=?',code);if(used)throw E(409,'That barcode already belongs to '+used.name);db.prepare('INSERT INTO barcodes VALUES(?,?,?)').run(code,unit,mult)};

 /* ---- sizes (units): any sell size, e.g. Half, Quarter, Half-quarter, Shot ---- */
 app.post('/api/products/:id/units',auth('manager'),H(req=>{const p=prod(req.params.id),b=req.body,label=String(b.label||'').trim().slice(0,24),ml=r2(+b.ml),price=r2(+b.price);
  if(!label)throw E(400,'Give this size a name, e.g. "Half quarter"');if(!(ml>0)||ml>p.bottle_ml*24)throw E(400,'Quantity must be more than 0 ml');if(!(price>0))throw E(400,'Price must be more than 0');
  if(get('SELECT 1 FROM units WHERE product_id=? AND active=1 AND lower(label)=lower(?)',p.id,label))throw E(409,'This product already has a size called "'+label+'"');
  return db.transaction(()=>{const id=db.prepare('INSERT INTO units(product_id,label,ml,price) VALUES(?,?,?,?)').run(p.id,label,ml,price).lastInsertRowid;if(b.barcode)takeCode(String(b.barcode).trim(),id,1);audit(req.user.id,'size added','product',p.id,null,{label,ml,price});return{id}})()}));
 app.patch('/api/units/:id',auth('manager'),H(req=>{const u=get('SELECT u.*,p.bottle_ml FROM units u JOIN products p ON p.id=u.product_id WHERE u.id=? AND p.active=1',req.params.id);if(!u)throw E(404,'Size not found');const b=req.body,n={label:u.label,ml:u.ml,price:u.price,active:u.active};
  if(b.label!==undefined){n.label=String(b.label).trim().slice(0,24);if(!n.label)throw E(400,'Name required')}
  if(b.ml!==undefined){n.ml=r2(+b.ml);if(!(n.ml>0)||n.ml>u.bottle_ml*24)throw E(400,'Quantity must be more than 0 ml')}
  if(b.price!==undefined){n.price=r2(+b.price);if(!(n.price>0))throw E(400,'Price must be more than 0')}
  if(b.active!==undefined){n.active=b.active?1:0;if(!n.active&&get('SELECT COUNT(*) n FROM units WHERE product_id=? AND active=1 AND id!=?',u.product_id,u.id).n<1)throw E(409,'A product needs at least one size')}
  if(n.label.toLowerCase()!=String(u.label).toLowerCase()&&get('SELECT 1 FROM units WHERE product_id=? AND active=1 AND lower(label)=lower(?) AND id!=?',u.product_id,n.label,u.id))throw E(409,'This product already has a size with that name');
  db.prepare('UPDATE units SET label=?,ml=?,price=?,active=? WHERE id=?').run(n.label,n.ml,n.price,n.active,u.id);audit(req.user.id,n.active?'size edited':'size removed','product',u.product_id,{label:u.label,ml:u.ml,price:u.price},n,b.reason)}));

 /* ---- barcodes: link extra codes (e.g. a supplier's code or a case code) to a size ---- */
 app.post('/api/barcodes',auth('manager'),H(req=>{const code=String(req.body.code||'').trim(),u=get('SELECT u.id,u.product_id FROM units u JOIN products p ON p.id=u.product_id WHERE u.id=? AND u.active=1 AND p.active=1',req.body.unit_id);if(!u)throw E(400,'Choose a product size');
  const mult=Math.min(Math.max(Math.floor(+req.body.multiplier||1),1),1000);takeCode(code,u.id,mult);audit(req.user.id,'barcode linked','product',u.product_id,null,{code,unit_id:u.id,multiplier:mult});return{ok:1}}));
 app.delete('/api/barcodes/:code',auth('manager'),H(req=>{const b=get('SELECT b.*,u.product_id FROM barcodes b JOIN units u ON u.id=b.unit_id WHERE b.code=?',req.params.code);if(!b)throw E(404,'Barcode not found');db.prepare('DELETE FROM barcodes WHERE code=?').run(b.code);audit(req.user.id,'barcode removed','product',b.product_id,{code:b.code},null)}));

 /* ---- archive a product (history stays; it just disappears from the till) ---- */
 app.delete('/api/products/:id',auth('manager'),H(req=>{const p=prod(req.params.id);
  if(get("SELECT 1 FROM order_items i JOIN orders o ON o.id=i.order_id JOIN units u ON u.id=i.unit_id WHERE u.product_id=? AND o.sale_id IS NULL AND o.status IN('new','picking','packed','dispatched')",p.id))throw E(409,'This product is on an open delivery order. Finish or cancel the order first.');
  db.transaction(()=>{db.prepare('UPDATE products SET active=0 WHERE id=?').run(p.id);db.prepare('DELETE FROM barcodes WHERE unit_id IN(SELECT id FROM units WHERE product_id=?)').run(p.id);audit(req.user.id,'product archived','product',p.id,{name:p.name,stock_ml:stock(p.id)},null,req.body&&req.body.reason)})()}));

 /* ---- photos ---- */
 app.post('/api/products/:id/images',auth('manager'),H(async req=>{const p=prod(req.params.id);if(get('SELECT COUNT(*) n FROM product_images WHERE product_id=?',p.id).n>=6)throw E(409,'Up to 6 photos per product');
  const saved=await images.save(req.body.data,p.id),sort=(get('SELECT COALESCE(MAX(sort),-1)+1 n FROM product_images WHERE product_id=?',p.id).n),id=db.prepare('INSERT INTO product_images(product_id,url,provider,public_id,sort,ts) VALUES(?,?,?,?,?,?)').run(p.id,saved.url,saved.provider,saved.public_id,sort,now()).lastInsertRowid;
  audit(req.user.id,'photo added','product',p.id,null,{provider:saved.provider});return{id,url:images.view(saved)}}));
 app.delete('/api/products/:id/images/:iid',auth('manager'),H(async req=>{const im=get('SELECT * FROM product_images WHERE id=? AND product_id=?',req.params.iid,req.params.id);if(!im)throw E(404,'Photo not found');db.prepare('DELETE FROM product_images WHERE id=?').run(im.id);await images.remove(im);audit(req.user.id,'photo removed','product',im.product_id)}));
 app.post('/api/products/:id/images/:iid/primary',auth('manager'),H(req=>{const im=get('SELECT * FROM product_images WHERE id=? AND product_id=?',req.params.iid,req.params.id);if(!im)throw E(404,'Photo not found');db.transaction(()=>{db.prepare('UPDATE product_images SET sort=sort+1 WHERE product_id=?').run(im.product_id);db.prepare('UPDATE product_images SET sort=0 WHERE id=?').run(im.id)})()}));

 /* ---- receive many products at once (scan, set quantity and cost, post together) ---- */
 app.post('/api/purchases/bulk',auth('manager'),H(req=>{const{supplier,invoice,items}=req.body;if(!Array.isArray(items)||!items.length||items.length>200)throw E(400,'Add at least one product');
  return db.transaction(()=>{const out=[];for(const it of items){const p=prod(it.product_id),btl=Math.floor(+it.bottles),uc=+it.unit_cost||0;if(!(btl>0))throw E(400,'Enter a quantity for '+p.name);if(uc<0)throw E(400,'Invalid cost for '+p.name);
    if(uc>0){const old=Math.max(stock(p.id),0)/p.bottle_ml;db.prepare('UPDATE products SET cost=? WHERE id=?').run((old*p.cost+btl*uc)/(old+btl),p.id)}
    db.prepare('INSERT INTO purchases(ts,supplier,invoice,product_id,cases,per_case,case_cost,user_id) VALUES(?,?,?,?,?,?,?,?)').run(now(),supplier||'',invoice||'',p.id,btl,1,uc,req.user.id);
    ledger(p.id,btl*p.bottle_ml,'purchase',invoice||null,supplier||null,req.user.id,undefined,req.user.branch);out.push({product_id:p.id,name:p.name,bottles:btl,stock:stock(p.id,req.user.branch)})}
   audit(req.user.id,'bulk stock received','purchase','',null,{supplier,invoice,lines:out.length,bottles:out.reduce((a,x)=>a+x.bottles,0)});return{received:out}})()}));

 /* ---- owner settings: M-Pesa ---- */
 app.get('/api/settings/mpesa',auth('owner'),H(()=>mpesa.summary()));
 app.post('/api/settings/mpesa',auth('owner'),H(req=>{const b=req.body,changed=[];
  db.transaction(()=>{
   if(b.profile){if(!['sandbox','production'].includes(b.profile))throw E(400,'Unknown profile');const pf=b.profile;
    for(const k of['key','secret','passkey'])if(typeof b[k]=='string'&&b[k].trim()){if(b[k].trim().length<6||b[k].length>300)throw E(400,'That '+k+' looks wrong');setSetting(`mp_${pf}_${k}_enc`,sec.enc(b[k].trim()));changed.push(k)}
    if(b.clear_secrets){['key','secret','passkey'].forEach(k=>db.prepare('DELETE FROM settings WHERE k=?').run(`mp_${pf}_${k}_enc`));changed.push('cleared')}
    if(b.shortcode!==undefined){const v=String(b.shortcode).trim();if(v&&!/^\d{4,8}$/.test(v))throw E(400,'Shortcode must be 4-8 digits');setSetting(`mp_${pf}_shortcode`,v);changed.push('shortcode')}
    if(b.type!==undefined){if(!mpesa.TYPES.includes(b.type))throw E(400,'Unknown transaction type');setSetting(`mp_${pf}_type`,b.type);changed.push('type')}
    if(b.till!==undefined){const v=String(b.till).trim();if(v&&!/^\d{4,8}$/.test(v))throw E(400,'Till number must be 4-8 digits');setSetting(`mp_${pf}_till`,v);changed.push('till')}}
   if(b.account!==undefined){const v=String(b.account).trim();if(!/^[A-Za-z0-9 ]{0,12}$/.test(v))throw E(400,'Account reference: up to 12 letters/numbers');setSetting('mpesa_account',v||'POS');changed.push('account')}
   if(b.public_url!==undefined){let v=String(b.public_url).trim().replace(/\/+$/,'');if(v&&!/^https?:\/\/[^\s\/]+(:\d+)?(\/\S*)?$/.test(v))throw E(400,'Public URL must look like https://shop.example.com');setSetting('public_url',v);changed.push('public_url')}
   if(b.mode!==undefined){if(!['mock','sandbox','production'].includes(b.mode))throw E(400,'Unknown mode');const c=mpesa.config(b.mode);if(!c.ready)throw E(400,'Cannot switch to '+b.mode+' yet. Missing: '+c.missing.join(', '));setSetting('mpesa_mode',b.mode);changed.push('mode='+b.mode)}
   audit(req.user.id,'M-Pesa settings changed','settings','',null,{fields:changed,profile:b.profile})})();return mpesa.summary()}));
 app.post('/api/settings/mpesa/test',auth('owner'),H(req=>mpesa.test(['sandbox','production','mock'].includes(req.body.profile)?req.body.profile:undefined)));

 /* ---- owner settings: photo storage ---- */
 app.get('/api/settings/images',auth('owner'),H(()=>({...images.summary(),count:get('SELECT COUNT(*) n FROM product_images').n})));
 app.post('/api/settings/images',auth('owner'),H(req=>{const b=req.body;
  db.transaction(()=>{
   if(b.cloud!==undefined){const v=String(b.cloud).trim();if(v&&!/^[A-Za-z0-9_-]{2,60}$/.test(v))throw E(400,'Cloud name looks wrong (letters, numbers, - and _ only)');setSetting('img_cloud',v)}
   if(typeof b.key=='string'&&b.key.trim()){if(!/^[\w-]{4,60}$/.test(b.key.trim()))throw E(400,'API key looks wrong');setSetting('img_key_enc',sec.enc(b.key.trim()))}
   if(typeof b.secret=='string'&&b.secret.trim()){if(b.secret.trim().length<8||b.secret.length>120)throw E(400,'API secret looks wrong');setSetting('img_secret_enc',sec.enc(b.secret.trim()))}
   if(b.provider!==undefined){if(!['local','cloudinary'].includes(b.provider))throw E(400,'Unknown storage');setSetting('img_provider',b.provider);if(b.provider=='cloudinary'&&!images.config().ready)throw E(400,'Enter the Cloudinary cloud name, API key and API secret first')}
   audit(req.user.id,'photo storage settings changed','settings','',null,{provider:b.provider,cloud:b.cloud})})();return images.summary()}));
 app.post('/api/settings/images/test',auth('owner'),H(req=>images.test(['local','cloudinary'].includes(req.body.provider)?req.body.provider:undefined)));
};
