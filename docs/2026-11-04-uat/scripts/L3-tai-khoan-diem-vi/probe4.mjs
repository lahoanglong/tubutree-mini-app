import { A, done } from './lib3.mjs';
const r = await A('returning', 'GET', '/me/loyalty'); console.log(JSON.stringify({ b: r.body.pointsBalance, e: r.body.expiringPoints, locked: r.body.lockedPoints }));
await done();
