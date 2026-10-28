import fs from 'node:fs';import path from 'node:path';import cp from 'node:child_process';
const root=process.argv[2];
const files=cp.execSync(`grep -rl "ErrorState\\|isError\\|Không tải được" ${root}`).toString().trim().split('\n').filter(f=>f&&!/\.(spec|test)\./.test(f));
const out=[];
for(const f of files){const L=fs.readFileSync(f,'utf8').split('\n');
 L.forEach((l,i)=>{ if(/<ErrorState\b/.test(l)){ const blk=L.slice(i,i+10).join('\n'); const closeIdx=blk.indexOf('/>'); const b2=closeIdx>=0?blk.slice(0,closeIdx+2):blk; if(!/onRetry|refetch|Thử lại|retry/i.test(b2)) out.push(`ES ${path.relative(process.cwd(),f)}:${i+1}`);} });
}
console.log(out.join('\n'));console.log('noRetry ErrorState:',out.length);
