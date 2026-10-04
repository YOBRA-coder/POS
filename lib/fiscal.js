// Fiscalisation layer (eTIMS). Sales queue as 'pending'; a worker submits with retry. Duplicate-safe via UNIQUE(sale_id,kind).
// 'mock' adapter issues fake numbers. 'etims' adapter posts to your certified VSCU/OSCU service: map fields to the KRA spec before go-live.
const adapters={
 mock:async d=>({fiscal_no:'MOCK-'+d.sale.no}),
 etims:async d=>{const r=await fetch(process.env.ETIMS_URL+'/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});if(!r.ok)throw new Error('eTIMS HTTP '+r.status);const j=await r.json();if(!j.fiscal_no)throw new Error(j.message||'No fiscal number returned');return j}};
exports.run=async(db,getSale)=>{const ad=adapters[process.env.FISCAL||'mock'];
 for(const d of db.prepare("SELECT * FROM fiscal_docs WHERE status IN('pending','failed') AND attempts<5").all()){
  try{const r=await ad({kind:d.kind,sale:getSale(d.sale_id)});db.prepare("UPDATE fiscal_docs SET status='done',fiscal_no=?,response=?,attempts=attempts+1,error=NULL WHERE id=?").run(r.fiscal_no,JSON.stringify(r),d.id)}
  catch(e){db.prepare("UPDATE fiscal_docs SET status='failed',attempts=attempts+1,error=? WHERE id=?").run(e.message,d.id)}}};
