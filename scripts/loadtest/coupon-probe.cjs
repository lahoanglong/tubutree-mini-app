const { tokenFor } = require('./lib.cjs');
const t = tokenFor('perf_u_10004');
(async()=>{
  for (const p of ['/me/coupons','/me/coupons','/me/coupons','/me/points','/loyalty/overview','/products/perf-san-pham-1712/bought-together','/products/perf-san-pham-1712/bought-together']) {
    const s=Date.now(); const r=await fetch('http://127.0.0.1:3301/api'+p,{headers:{...(process.env.PERF_BYPASS ? { 'x-throttle-bypass': process.env.PERF_BYPASS } : {}), Authorization:'Bearer '+t,'X-Forwarded-For':'10.55.'+Math.floor(Math.random()*250)+'.'+Math.floor(Math.random()*250)}});
    const b=await r.text(); console.log(p,r.status,Date.now()-s+'ms',b.length+'B');
  }})();
