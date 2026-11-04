import { tok, L, ENV, sql } from './_lib.mjs';
for (const who of ['ketoan','admin']) {
  const t = await tok(who);
  const res = await fetch(`${L.apiUrl127}/admin/orders/export`, { headers: { authorization: `Bearer ${t}`, 'x-throttle-bypass': ENV.THROTTLE_BYPASS_TOKEN } });
  const txt = await res.text();
  console.log(who, res.status); console.log(txt.split('\n').slice(0,3).join('\n'));
}
console.log(JSON.stringify(await sql(`SELECT "shippingAddress" FROM orders LIMIT 1`)));
