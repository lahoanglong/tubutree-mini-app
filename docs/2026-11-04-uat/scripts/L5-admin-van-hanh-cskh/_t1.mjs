import { placeOrder, waitPancake, orderRow, userState, sql, call } from './_lib.mjs';
const w = await sql(`SELECT column_name FROM information_schema.columns WHERE table_name='wallet_transactions'`);
console.log(JSON.stringify(w.map(x=>x.column_name)));
const p = await sql(`SELECT column_name FROM information_schema.columns WHERE table_name='points_transactions'`);
console.log(JSON.stringify(p.map(x=>x.column_name)));
