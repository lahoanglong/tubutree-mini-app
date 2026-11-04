import { call, sql, short } from './_lib.mjs';
console.log(JSON.stringify(await sql(`select enumlabel from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname in ('PayoutMethod','PayoutStatus') order by 1`)));
console.log(JSON.stringify(await sql(`select column_name, is_nullable, column_default from information_schema.columns where table_name='payouts' and is_nullable='NO'`)));
console.log(JSON.stringify(await sql(`select p.id, p.method, p.status, p.amount, u.role from payouts p join users u on u.id=p.\"userId\" limit 5`)));
const ctv = await call('ctv','GET','/me'); console.log(short(ctv.body,300));
console.log(JSON.stringify(await sql(`select status, count(*)::int n, sum(amount)::int s from commissions group by 1`)));
console.log(JSON.stringify(await sql(`select id, phone, "fullName", role, "staffPermissions" from users where role in ('STAFF','ADMIN','AFFILIATE') order by role limit 20`)));
