// SMS notifications. Orders queue messages in sms_log; a worker sends them with retry (max 3).
// MOCK mode (default) just marks them sent. Live: SMS_PROVIDER=africastalking AT_USER AT_KEY [AT_ENV=production] [SMS_SENDER]. Check against your provider's current API before relying on it.
const mpesa=require('./mpesa'),e=process.env;
exports.MOCK=!(e.SMS_PROVIDER=='africastalking'&&e.AT_KEY);
async function provider(to,text){if(exports.MOCK)return;
 const base=e.AT_ENV=='production'?'https://api.africastalking.com':'https://api.sandbox.africastalking.com',body=new URLSearchParams({username:e.AT_USER,to:'+'+to,message:text,...(e.SMS_SENDER?{from:e.SMS_SENDER}:{})});
 const r=await fetch(base+'/version1/messaging',{method:'POST',headers:{apiKey:e.AT_KEY,Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},body});if(!r.ok)throw new Error('SMS HTTP '+r.status);
 const j=await r.json().catch(()=>({})),rec=j.SMSMessageData&&j.SMSMessageData.Recipients&&j.SMSMessageData.Recipients[0];if(!rec||!/success/i.test(rec.status))throw new Error(rec?rec.status:'SMS rejected')}
exports.queue=(db,setting,o)=>{if(setting('sms_enabled','0')!='1')return;let ph;try{ph=mpesa.phone(o.phone)}catch(x){return}
 db.prepare('INSERT OR IGNORE INTO sms_log(ts,phone,text,status,order_id,kind) VALUES(?,?,?,?,?,?)').run(Date.now(),ph,String(o.text).slice(0,300),'pending',o.order_id||null,o.kind||null)};
exports.run=async db=>{for(const m of db.prepare("SELECT * FROM sms_log WHERE status='pending' AND attempts<3 ORDER BY id LIMIT 20").all()){
 try{await provider(m.phone,m.text);db.prepare("UPDATE sms_log SET status='sent',attempts=attempts+1,error=NULL WHERE id=?").run(m.id)}
 catch(x){db.prepare("UPDATE sms_log SET status=CASE WHEN attempts+1>=3 THEN 'failed' ELSE 'pending' END,attempts=attempts+1,error=? WHERE id=?").run(x.message,m.id)}}};
