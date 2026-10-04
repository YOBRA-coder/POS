// Safaricom Daraja STK Push.
// Credentials are now managed by the owner in Settings → Payments (stored encrypted in the database).
// Two separate profiles are kept (sandbox and production) and `mpesa_mode` picks the active one:
//   mock        no network calls, payments auto-succeed after 4s (training / demos)
//   sandbox     https://sandbox.safaricom.co.ke  (test credentials, no real money)
//   production  https://api.safaricom.co.ke      (real money)
// Environment variables (MPESA_KEY, MPESA_SECRET, MPESA_SHORTCODE, MPESA_PASSKEY, MPESA_ENV, MPESA_TYPE, MPESA_TILL, PUBLIC_URL)
// still work as a fallback so existing installs keep running until credentials are saved in Settings.
const {setting}=require('../db'),sec=require('./secrets'),e=process.env;
const TYPES=['CustomerPayBillOnline','CustomerBuyGoodsOnline'];
const URLS={sandbox:'https://sandbox.safaricom.co.ke',production:'https://api.safaricom.co.ke'};
const field=(profile,k)=>setting(`mp_${profile}_${k}`,'');
function profileCfg(profile){
 const env=e.MPESA_KEY&&(e.MPESA_ENV==='production'?'production':'sandbox')===profile;
 const secret=n=>sec.dec(field(profile,n+'_enc'))||(env?e['MPESA_'+n.toUpperCase()]||'':'');
 return{key:secret('key'),secret:secret('secret'),passkey:secret('passkey'),
  shortcode:field(profile,'shortcode')||(env?e.MPESA_SHORTCODE||'':''),
  type:field(profile,'type')||(env?e.MPESA_TYPE:'')||TYPES[0],
  till:field(profile,'till')||(env?e.MPESA_TILL||'':'')}}
function mode(){const m=setting('mpesa_mode','');if(['mock','sandbox','production'].includes(m))return m;return e.MPESA_KEY?(e.MPESA_ENV==='production'?'production':'sandbox'):'mock'}
function publicUrl(){return String(setting('public_url','')||e.PUBLIC_URL||'').replace(/\/+$/,'')}
function config(m=mode()){
 const c=m==='mock'?{}:profileCfg(m),missing=[];
 if(m!=='mock'){if(!c.key)missing.push('consumer key');if(!c.secret)missing.push('consumer secret');if(!c.shortcode)missing.push('shortcode');if(!c.passkey)missing.push('passkey');if(c.type===TYPES[1]&&!c.till)missing.push('till number')}
 return{mode:m,base:URLS[m],...c,account:setting('mpesa_account','POS'),publicUrl:publicUrl(),cbSecret:e.MPESA_CB_SECRET||'',missing,ready:m==='mock'||!missing.length}}
// Never returns secrets: only whether each one is set and the last 4 characters of the consumer key.
function summary(){const pr=p=>{const c=profileCfg(p);return{key_set:!!c.key,key_hint:sec.hint(c.key),secret_set:!!c.secret,passkey_set:!!c.passkey,shortcode:c.shortcode,type:c.type,till:c.till}},c=config();
 return{mode:c.mode,ready:c.ready,missing:c.missing,sandbox:pr('sandbox'),production:pr('production'),account:c.account,public_url:c.publicUrl,
  callback_url:c.publicUrl?c.publicUrl+'/api/mpesa/callback/'+c.cbSecret:'',https_ok:/^https:\/\//.test(c.publicUrl)}}
const phone=p=>{p=String(p||'').replace(/\D/g,'');if(/^0[17]\d{8}$/.test(p))return '254'+p.slice(1);if(/^254[17]\d{8}$/.test(p))return p;if(/^[17]\d{8}$/.test(p))return '254'+p;throw Object.assign(new Error('Invalid Safaricom number'),{status:400})};
const fail=(msg,status=502)=>Object.assign(new Error(msg),{status});
const tokens={};
async function token(c){const id=c.mode+':'+c.key,t=tokens[id];if(t&&Date.now()<t.x)return t.v;
 let r,j;try{r=await fetch(c.base+'/oauth/v1/generate?grant_type=client_credentials',{headers:{Authorization:'Basic '+Buffer.from(c.key+':'+c.secret).toString('base64')},signal:AbortSignal.timeout(15000)});j=await r.json().catch(()=>({}))}
 catch(x){throw fail('Cannot reach Safaricom ('+(x.name==='TimeoutError'?'timed out':x.message)+'). Check the internet connection.',504)}
 if(!r.ok||!j.access_token)throw fail('Safaricom rejected the consumer key/secret for '+c.mode+' mode. Check you copied the right app credentials and the right mode.');
 tokens[id]={v:j.access_token,x:Date.now()+Math.max((+j.expires_in||3599)-60,60)*1000};return tokens[id].v}
exports.stk=async({phone:ph,amount})=>{const p=phone(ph),c=config();
 if(c.mode==='mock')return{checkout_id:'MOCK'+Date.now(),mock:true,mode:'mock'};
 if(!c.ready)throw fail('M-Pesa ('+c.mode+') is not fully set up. Missing: '+c.missing.join(', ')+'. Owner: Settings → Payments.',400);
 if(!/^https:\/\//.test(c.publicUrl))throw fail('M-Pesa needs the shop\'s public HTTPS address so Safaricom can confirm payments. Owner: Settings → Payments → Public URL.',400);
 const ts=new Date(Date.now()+3*36e5).toISOString().replace(/\D/g,'').slice(0,14),pw=Buffer.from(c.shortcode+c.passkey+ts).toString('base64');
 const body={BusinessShortCode:c.shortcode,Password:pw,Timestamp:ts,TransactionType:c.type,Amount:Math.ceil(amount),PartyA:p,PartyB:c.type===TYPES[1]?c.till:c.shortcode,PhoneNumber:p,CallBackURL:c.publicUrl+'/api/mpesa/callback/'+c.cbSecret,AccountReference:String(c.account||'POS').replace(/[^A-Za-z0-9]/g,'').slice(0,12)||'POS',TransactionDesc:'Sale'};
 let r,j;try{r=await fetch(c.base+'/mpesa/stkpush/v1/processrequest',{method:'POST',headers:{Authorization:'Bearer '+await token(c),'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});j=await r.json().catch(()=>({}))}
 catch(x){if(x.status)throw x;throw fail('Cannot reach Safaricom ('+x.message+').',504)}
 if(!j.CheckoutRequestID||(j.ResponseCode!==undefined&&String(j.ResponseCode)!=='0'))throw fail(j.errorMessage||j.CustomerMessage||j.ResponseDescription||'STK push failed');
 return{checkout_id:j.CheckoutRequestID,mode:c.mode}};
// Used by the Settings "Test connection" button: asks Safaricom for an access token with the saved credentials.
exports.test=async(m)=>{const c=config(m||mode());if(c.mode==='mock')return{ok:true,mode:'mock',message:'Mock mode: no real M-Pesa calls are made.'};
 if(c.missing.length)return{ok:false,mode:c.mode,message:'Missing: '+c.missing.join(', ')};
 try{delete tokens[c.mode+':'+c.key];await token(c);return{ok:true,mode:c.mode,message:'Connected to Safaricom ('+c.mode+'). Credentials are valid.'+(/^https:\/\//.test(c.publicUrl)?'':' Public HTTPS URL is still missing, so STK pushes will be refused.')}}catch(x){return{ok:false,mode:c.mode,message:x.message}}};
exports.mockCb=(id,amount,ph)=>({Body:{stkCallback:{CheckoutRequestID:id,ResultCode:0,ResultDesc:'Mock success',CallbackMetadata:{Item:[{Name:'Amount',Value:amount},{Name:'MpesaReceiptNumber',Value:'MK'+Math.random().toString(36).slice(2,10).toUpperCase()},{Name:'PhoneNumber',Value:ph}]}}}});
exports.config=config;exports.summary=summary;exports.mode=mode;exports.phone=phone;exports.TYPES=TYPES;
Object.defineProperty(exports,'MOCK',{get:()=>mode()==='mock'});
