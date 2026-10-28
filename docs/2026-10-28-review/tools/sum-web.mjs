import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const S=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../screens');
const L=fs.readdirSync(S).filter(f=>/^index-(web|admin).*\.jsonl$/.test(f)).flatMap(f=>fs.readFileSync(path.join(S,f),'utf8').split('\n').filter(Boolean).map(l=>({...JSON.parse(l),label:f.slice(6,-6)})));
const by=(a,f)=>a.reduce((m,x)=>{const k=f(x);(m[k]??=[]).push(x);return m},{});
const norm=p=>p.split('?')[0].replace(/[0-9a-f]{20,}|c[a-z0-9]{24}/g,':id').replace(/TUBU\d{6,}/g,':code');
const cnt=(a)=>Object.entries(a.reduce((m,k)=>(m[k]=(m[k]||0)+1,m),{})).sort((x,y)=>y[1]-x[1]);
const o=[];
o.push('LABEL | ô | ảnh | blank | pageErr | consoleErr | apiErr | lỗi chụp');
for(const [k,a] of Object.entries(by(L,x=>x.label)).sort())o.push([k,a.length,a.reduce((n,x)=>n+x.files.length,0),a.filter(x=>x.blank).length,a.filter(x=>x.pageErrors.length).length,a.filter(x=>x.consoleErrors.length).length,a.filter(x=>x.apiErrors.length).length,a.filter(x=>x.error).length].join(' | '));
const okc=L.filter(x=>x.state==='ok'&&!x.error);
o.push('\nBLANK ok:');okc.filter(x=>x.blank).forEach(x=>o.push(x.id+' :: '+x.textHead.slice(0,80)));
o.push('\nBLANK state:');L.filter(x=>x.state!=='ok'&&x.blank).forEach(x=>o.push(x.id+' :: '+x.textHead.slice(0,80)));
o.push('\nPAGEERR:');for(const x of L.filter(x=>x.pageErrors.length))o.push(x.id+' :: '+x.pageErrors[0].slice(0,160));
o.push('\nCONSOLE (ok):');cnt(okc.flatMap(x=>[...new Set(x.consoleErrors.map(e=>(typeof e==='string'?e:JSON.stringify(e)).replace(/\d{6,}/g,'N').slice(0,150)))])).slice(0,25).forEach(([k,n])=>o.push(n+'x '+k));
o.push('\nAPIERR (ok):');cnt(okc.flatMap(x=>[...new Set(x.apiErrors.map(e=>`${e.method} ${norm(e.path)} ${e.status}`))])).slice(0,30).forEach(([k,n])=>o.push(n+'x '+k));
o.push('\nAXE serious/critical rules: (axe byRule không có mức; liệt kê tất cả)');
const ax={};for(const x of okc)if(x.axe?.byRule)for(const [r,n] of Object.entries(x.axe.byRule)){(ax[r]??={screens:0,nodes:0});ax[r].screens++;ax[r].nodes+=n}
Object.entries(ax).sort((a,b)=>b[1].screens-a[1].screens).forEach(([r,v])=>o.push(`${r}: ${v.screens} ô, ${v.nodes} node`));
o.push('\nAXE theo khổ:');for(const [k,a] of Object.entries(by(okc,x=>x.label)))o.push(k+': '+JSON.stringify(cnt(a.flatMap(x=>Object.keys(x.axe?.byRule??{}))).slice(0,6)));
o.push('\nSMALL top15 (ok):');okc.filter(x=>x.smallTargets?.count).sort((a,b)=>b.smallTargets.count-a.smallTargets.count).slice(0,15).forEach(x=>o.push(`${x.id} ${x.smallTargets.count} :: ${x.smallTargets.examples.slice(0,2).map(e=>e.sel+'"'+e.text+'" '+e.w+'x'+e.h).join('; ')}`));
o.push('\nSMALL tổng theo khổ:');for(const [k,a] of Object.entries(by(okc,x=>x.label)))o.push(k+': '+a.reduce((n,x)=>n+(x.smallTargets?.count||0),0));
for(const st of ['error500','offline']){o.push(`\nNORETRY ${st}:`);L.filter(x=>x.state===st).forEach(x=>o.push(`${x.id} retry=${x.hasRetry} blank=${x.blank} :: ${x.textHead.slice(0,90)}`))}
o.push('\nNOSKELETON loading/slow5s s1:');L.filter(x=>x.state==='loading').forEach(x=>o.push(`${x.id} skel=${x.hasSkeleton} blank=${x.blank}`));L.filter(x=>x.state==='slow5s').forEach(x=>o.push(`${x.id} s1skel=${x.s1?.hasSkeleton} s1blank=${x.s1?.blank} endblank=${x.blank}`));
o.push('\nEMPTY:');L.filter(x=>x.state==='empty').forEach(x=>o.push(`${x.id} blank=${x.blank} retry=${x.hasRetry} :: ${x.textHead.slice(0,90)}`));
o.push('\nLONGTEXT:');L.filter(x=>x.state==='longtext').forEach(x=>o.push(`${x.id} blank=${x.blank} :: ${x.textHead.slice(0,70)}`));
o.push('\nERR textHead in ok:');okc.filter(x=>/Không tải|Lỗi|Thử lại|404|Something went wrong|not found/i.test(x.textHead)).forEach(x=>o.push(x.id+' :: '+x.textHead.slice(0,100)));
console.log(o.join('\n'));
