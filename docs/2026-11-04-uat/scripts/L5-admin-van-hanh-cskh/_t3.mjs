import { call } from './_lib.mjs';
const h = await call('admin', 'GET', '/admin/ops/health');
console.log(JSON.stringify(h.body.problems, null, 1));
console.log(JSON.stringify(h.body.zns).slice(0,600));
