import { A, done } from './lib3.mjs';
const n = await A('returning', 'GET', '/me/notifications'); console.log(n.status, JSON.stringify(n.body).slice(0, 700));
const u = await A('returning', 'GET', '/me/notifications/unread-count'); console.log(JSON.stringify(u.body));
const p = await A('returning', 'GET', '/me/notifications/prefs'); console.log(JSON.stringify(p.body));
const s = await A('returning', 'GET', '/me/subscriptions'); console.log(JSON.stringify(s.body).slice(0, 300));
const a = await A('returning', 'GET', '/me/addresses'); console.log(JSON.stringify(a.body).slice(0, 300));
await done();
