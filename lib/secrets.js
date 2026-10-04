// Encrypts API keys/secrets before they are stored in the settings table (AES-256-GCM).
// The key lives OUTSIDE the database (SETTINGS_KEY env var, or a settings.key file next to pos.db),
// so a copied or leaked database backup does not expose M-Pesa / Cloudinary credentials.
const crypto=require('crypto'),fs=require('fs'),path=require('path');
let key=null;
function getKey(){
 if(key)return key;
 if(process.env.SETTINGS_KEY){key=crypto.createHash('sha256').update(process.env.SETTINGS_KEY).digest();return key}
 const f=process.env.KEY_FILE||path.join(path.dirname(path.resolve(process.env.DB||'pos.db')),'settings.key');
 try{key=Buffer.from(fs.readFileSync(f,'utf8').trim(),'hex');if(key.length!==32)throw 0}
 catch(e){key=crypto.randomBytes(32);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,key.toString('hex'),{mode:0o600})}
 return key}
exports.enc=text=>{const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',getKey(),iv),ct=Buffer.concat([c.update(String(text),'utf8'),c.final()]);return 'v1:'+Buffer.concat([iv,c.getAuthTag(),ct]).toString('base64')};
exports.dec=s=>{try{if(!s||!String(s).startsWith('v1:'))return '';const b=Buffer.from(String(s).slice(3),'base64'),d=crypto.createDecipheriv('aes-256-gcm',getKey(),b.subarray(0,12));d.setAuthTag(b.subarray(12,28));return Buffer.concat([d.update(b.subarray(28)),d.final()]).toString('utf8')}catch(e){return ''}};
exports.hint=t=>t?'••••'+String(t).slice(-4):'';
