import { A, ensureAddress, done, L } from './lib3.mjs';
const r = await A('returning', 'GET', '/me/loyalty'); console.log(JSON.stringify(r.body, null, 1).slice(0, 3000));
const t = await A('returning', 'GET', '/me/points/transactions'); console.log(JSON.stringify(t.body, null, 1).slice(0, 1500));
const w = await A('returning', 'GET', '/me/wallet'); console.log(JSON.stringify(w.body));
const a = await ensureAddress('new'); console.log('addr new', a);
const nu = await A('new', 'GET', '/me'); console.log(JSON.stringify(nu.body));
await done();
