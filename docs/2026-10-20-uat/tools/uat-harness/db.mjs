#!/usr/bin/env node
// Chạy SQL trên DB lane, in JSON. Chỉ DB tubutree_uat_l1..8 (lane 9 = mẫu cần --tpl); mọi DB khác bị từ chối trước khi kết nối.
// Dùng: db.mjs <lane> "<SQL>" [--tpl] [--unsafe]
//   SELECT/WITH/SHOW/EXPLAIN/VALUES → $queryRawUnsafe, in mảng dòng
//   UPDATE/INSERT/DELETE            → $executeRawUnsafe, in {affected}
//   DDL và lệnh khác (DROP, TRUNCATE, ALTER, CREATE...) cần --unsafe
// Ghi chú: API cache role/khoá của user 5 giây (SessionStateService) — đổi role bằng SQL có hiệu lực sau ≤5 giây.
import { closePrisma, jsonOut, lane, prismaFor } from './lib.mjs';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const flags = new Set(args.filter((a) => a.startsWith('--')));
if (pos.length < 2) {
  console.error('dùng: db.mjs <lane> "<SQL>" [--tpl] [--unsafe]');
  process.exit(2);
}
const L = lane(pos[0]);
if (L.n === 9 && !flags.has('--tpl')) {
  console.error('lane 9 là DB mẫu tubutree_uat_tpl: thêm --tpl nếu thật sự muốn đụng mẫu (mẫu phải không còn kết nối khi lane copy)');
  process.exit(2);
}
const sql = pos.slice(1).join(' ').trim();
const verb = sql.replace(/^\s*(--[^\n]*\n\s*)*/, '').split(/\s+/)[0]?.toUpperCase() ?? '';
const READ = ['SELECT', 'WITH', 'SHOW', 'EXPLAIN', 'VALUES', 'TABLE'];
const WRITE = ['UPDATE', 'INSERT', 'DELETE'];
if (!READ.includes(verb) && !WRITE.includes(verb) && !flags.has('--unsafe')) {
  console.error(`Lệnh "${verb}" không phải SELECT/UPDATE/INSERT/DELETE — thêm --unsafe nếu cố ý`);
  process.exit(2);
}
const prisma = prismaFor(L);
try {
  if (READ.includes(verb) || (verb === 'WITH' && /\bselect\b/i.test(sql))) {
    jsonOut(await prisma.$queryRawUnsafe(sql));
  } else {
    jsonOut({ db: L.db, affected: await prisma.$executeRawUnsafe(sql) });
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await closePrisma();
}
