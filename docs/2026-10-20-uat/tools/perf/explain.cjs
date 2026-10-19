// EXPLAIN (ANALYZE, BUFFERS) một file SQL trên tubutree_perf. Dùng: DATABASE_URL=... node explain.cjs file.sql [lần-chạy]
const path = require('path'); const fs = require('fs');
const { PrismaClient } = require(require.resolve('@prisma/client', { paths: [path.resolve(__dirname, '../../../../apps/api')] }));
if (!/tubutree_perf/.test(process.env.DATABASE_URL || '')) throw new Error('chỉ tubutree_perf');
(async () => {
  const p = new PrismaClient(); const sql = fs.readFileSync(process.argv[2], 'utf8').replace(/;\s*$/, '');
  const n = Number(process.argv[3] || 1); let out;
  for (let i = 0; i < n; i++) out = await p.$queryRawUnsafe('EXPLAIN (ANALYZE, BUFFERS) ' + sql);
  console.log(out.map((x) => x['QUERY PLAN']).join('\n'));
  await p.$disconnect();
})().catch((e) => { console.error(e.message.slice(0, 800)); process.exit(1); });
