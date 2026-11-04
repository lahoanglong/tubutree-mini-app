const A='http://localhost:3261/api';
for (const n of [5000,20000]) {
  const o={}; for(let i=0;i<n;i++) o['k'+i]=1; const b=JSON.stringify(o); const t=Date.now();
  const r=await fetch(A+'/affiliate/click',{method:'POST',headers:{'content-type':'application/json'},body:b}); const txt=await r.text();
  console.log(`one object, ${n} unknown keys, body=${(b.length/1024).toFixed(0)}KB status=${r.status} time=${Date.now()-t}ms resp=${(txt.length/1024).toFixed(0)}KB`);
}
