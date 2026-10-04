// ESC/POS over network (TCP 9100). Set PRINTER_HOST. USB/serial printers: use a network-capable printer or a local print agent.
const net=require('net'),ESC=0x1b,GS=0x1d,W=42;
const pad=(a,b)=>{a=String(a);b=String(b);return a.slice(0,W-b.length-1).padEnd(W-b.length)+b+'\n'};
const money=n=>Math.round(n).toLocaleString('en-KE');
exports.receipt=(s,biz,kick)=>{const o=[Buffer.from([ESC,0x40,ESC,0x61,1,ESC,0x45,1])],t=x=>o.push(Buffer.from(x,'latin1'));
 t(biz.biz+'\n');o.push(Buffer.from([ESC,0x45,0]));if(biz.kra)t('KRA PIN '+biz.kra+'\n');t(s.no+'  '+new Date(s.ts).toLocaleString('en-KE')+'\n');o.push(Buffer.from([ESC,0x61,0]));t('-'.repeat(W)+'\n');
 s.items.forEach(i=>t(pad(i.qty+' x '+i.name+' '+i.label,money(i.qty*i.price))));if(s.discount)t(pad('Discount','-'+money(s.discount)));
 t('-'.repeat(W)+'\n');o.push(Buffer.from([ESC,0x45,1]));t(pad('TOTAL KSh',money(s.total)));o.push(Buffer.from([ESC,0x45,0]));
 t(pad('incl. VAT',money(s.vat)));s.payments.forEach(p=>t(pad(p.method,money(p.amount))));if(s.fiscal_no)t('Fiscal no: '+s.fiscal_no+'\n');
 t('\nThank you. Drink responsibly.\n\n\n');o.push(Buffer.from([GS,0x56,66,0]));if(kick)o.push(Buffer.from([ESC,0x70,0,25,250]));return Buffer.concat(o)};
exports.drawer=()=>Buffer.from([ESC,0x70,0,25,250]);
// PRINTER_DEVICE writes raw bytes to a USB/serial device or shared printer (e.g. /dev/usb/lp0, \\\\localhost\\POS80); PRINTER_HOST uses network port 9100.
exports.print=buf=>process.env.PRINTER_DEVICE?require('fs').promises.writeFile(process.env.PRINTER_DEVICE,buf).catch(e=>{throw Object.assign(new Error('Printer device error: '+e.message),{status:504})}):new Promise((ok,no)=>{const h=process.env.PRINTER_HOST;if(!h)return no(Object.assign(new Error('No printer configured (set PRINTER_HOST)'),{status:503}));
 const c=net.connect(+process.env.PRINTER_PORT||9100,h,()=>c.end(buf));c.setTimeout(4000,()=>{c.destroy();no(Object.assign(new Error('Printer timeout'),{status:504}))});c.on('error',e=>no(Object.assign(e,{status:504})));c.on('close',ok)});
