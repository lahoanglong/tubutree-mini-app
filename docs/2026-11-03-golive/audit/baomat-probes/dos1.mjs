const A='http://localhost:3261/api';
const mk=(n)=>'['+Array(n).fill('{"a":1}').join(',')+']';
for (const n of [1000,5000,20000]) {
  const b=mk(n); const t=Date.now();
  const r=await fetch(A+'/auth/guest',{method:'POST',headers:{'content-type':'application/json'},body:b}); const txt=await r.text();
  console.log(`n=${n} body=${(b.length/1024).toFixed(0)}KB status=${r.status} time=${Date.now()-t}ms respBytes=${txt.length}`);
}
// concurrency impact: start a 20000-object attack, then time /health
const b=mk(20000);
const atk=fetch(A+'/auth/guest',{method:'POST',headers:{'content-type':'application/json'},body:b}).then(r=>r.text());
await new Promise(r=>setTimeout(r,300));
const probes=[];
for(let i=0;i<3;i++){const t=Date.now(); const r=await fetch(A+'/health'); await r.text(); probes.push(Date.now()-t); }
console.log('health latency during attack (ms):',probes.join(','));
await atk;
const t=Date.now(); await (await fetch(A+'/health')).text(); console.log('health after', Date.now()-t,'ms');
