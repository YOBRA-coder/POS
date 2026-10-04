// Product photos. Two storage options, chosen by the owner in Settings → Photos:
//   local       saved on the POS server (UPLOAD_DIR, default: "uploads" next to pos.db). Free, works with no internet,
//               fastest on the shop network. Include the uploads folder in your backups.
//   cloudinary  uploaded to your Cloudinary account (CDN, automatic resizing). Good for the online shop; needs internet.
// The browser shrinks photos before uploading, and the server re-checks the file type and size.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {setting}=require('../db'),sec=require('./secrets');
const dir=()=>process.env.UPLOAD_DIR||path.join(path.dirname(path.resolve(process.env.DB||'pos.db')),'uploads');
const MAX=3*1024*1024,fail=(m,s=400)=>Object.assign(new Error(m),{status:s});
const detect=b=>b.length>12&&b[0]==0xFF&&b[1]==0xD8&&b[2]==0xFF?['image/jpeg','jpg']:b.length>12&&b.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]))?['image/png','png']:b.length>12&&b.subarray(0,4).toString()=='RIFF'&&b.subarray(8,12).toString()=='WEBP'?['image/webp','webp']:null;
function config(){const provider=setting('img_provider','local'),cloud=setting('img_cloud',''),key=sec.dec(setting('img_key_enc','')),secret=sec.dec(setting('img_secret_enc',''));
 return{provider,cloud,key,secret,ready:provider==='cloudinary'&&!!(cloud&&key&&secret)}}
function summary(){const c=config();return{provider:c.provider,cloud:c.cloud,key_hint:sec.hint(c.key),secret_set:!!c.secret,ready:c.provider==='local'||c.ready}}
const sign=(params,secret)=>crypto.createHash('sha1').update(Object.keys(params).sort().map(k=>k+'='+params[k]).join('&')+secret).digest('hex');
async function cloudPost(c,action,params,extra){const ts=Math.floor(Date.now()/1000),p={...params,timestamp:ts},fd=new FormData();
 for(const[k,v]of Object.entries({...p,...(extra||{})}))fd.append(k,String(v));fd.append('api_key',c.key);fd.append('signature',sign(p,c.secret));
 let r,j;try{r=await fetch(`https://api.cloudinary.com/v1_1/${c.cloud}/image/${action}`,{method:'POST',body:fd,signal:AbortSignal.timeout(30000)});j=await r.json().catch(()=>({}))}catch(x){throw fail('Cannot reach Cloudinary ('+x.message+')',504)}
 if(!r.ok)throw fail('Cloudinary: '+((j.error&&j.error.message)||r.status),502);return j}
exports.save=async(base64,productId)=>{const buf=Buffer.from(String(base64||''),'base64'),t=detect(buf);if(!t)throw fail('Use a JPG, PNG or WebP photo');if(buf.length>MAX)throw fail('Photo is too large (max 3 MB)');
 const c=config();
 if(c.provider==='cloudinary'){if(!c.ready)throw fail('Cloudinary is selected but not fully set up. Owner: Settings → Photos.');
  const j=await cloudPost(c,'upload',{folder:'cellarpos'},{file:`data:${t[0]};base64,${buf.toString('base64')}`});return{url:j.secure_url,provider:'cloudinary',public_id:j.public_id}}
 fs.mkdirSync(dir(),{recursive:true});const name=`${+productId||0}-${crypto.randomBytes(6).toString('hex')}.${t[1]}`;fs.writeFileSync(path.join(dir(),name),buf);return{url:'/uploads/'+name,provider:'local',public_id:name}};
exports.remove=async img=>{try{if(img.provider==='local')fs.unlinkSync(path.join(dir(),path.basename(img.public_id||'')));else if(img.provider==='cloudinary'){const c=config();if(c.ready)await cloudPost(c,'destroy',{public_id:img.public_id})}}catch(x){console.warn('image cleanup:',x.message)}};
exports.test=async(prov)=>{const c=config(),p=prov||c.provider;c.ready=!!(c.cloud&&c.key&&c.secret);if(p==='local'){try{fs.mkdirSync(dir(),{recursive:true});fs.accessSync(dir(),fs.constants.W_OK);return{ok:true,message:'Photos are saved on this server in '+dir()}}catch(x){return{ok:false,message:'Cannot write to '+dir()+': '+x.message}}}
 if(!c.ready)return{ok:false,message:'Enter cloud name, API key and API secret first.'};
 try{const r=await fetch(`https://api.cloudinary.com/v1_1/${c.cloud}/resources/image?max_results=1`,{headers:{Authorization:'Basic '+Buffer.from(c.key+':'+c.secret).toString('base64')},signal:AbortSignal.timeout(15000)});
  return r.ok?{ok:true,message:'Connected to Cloudinary ('+c.cloud+').'}:{ok:false,message:r.status==401||r.status==403?'Cloudinary rejected the API key/secret.':'Cloudinary replied '+r.status+' (check the cloud name).'}}catch(x){return{ok:false,message:'Cannot reach Cloudinary: '+x.message}}};
// Smaller, optimised version for the till and shop (Cloudinary only; local files are already resized by the browser).
exports.view=(img,w=640)=>img.provider==='cloudinary'?img.url.replace('/upload/',`/upload/f_auto,q_auto,w_${w},c_limit/`):img.url;
exports.dir=dir;exports.config=config;exports.summary=summary;
