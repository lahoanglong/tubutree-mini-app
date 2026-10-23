// So kế hoạch custom và generic của một câu có tham số $1..$n (Prisma dùng câu đã prepare và tái dùng kế hoạch sau 5 lần).
// Dùng: DATABASE_URL=...tubutree_perf node plan-modes.cjs file.sql "text,timestamptz,timestamptz" "'unknown','2026-09-19','2026-10-19'"
const path = require('path'); const fs = require('fs');
const { PrismaClient } = require(require.resolve('@prisma/client', { paths: [path.resolve(__dirname, '../../../../apps/api')] }));
if (!/tubutree_perf/.test(process.env.DATABASE_URL || '')) throw new Error('chỉ tubutree_perf');
(async () => {
  const p = new PrismaClient(); const sql = fs.readFileSync(process.argv[2], 'utf8').replace(/;\s*$/, ''); const [types, args] = [process.argv[3], process.argv[4]];
  for (const mode of ['force_custom_plan', 'force_generic_plan']) {
    const res = await p.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL plan_cache_mode = ${mode}`);
      await tx.$executeRawUnsafe(`PREPARE q(${types}) AS ${sql}`);
      const times = [];
      let plan;
      for (let i = 0; i < Number(process.env.REPS || 4); i++) { plan = await tx.$queryRawUnsafe(`EXPLAIN (ANALYZE, BUFFERS OFF, SUMMARY ON) EXECUTE q(${args})`); times.push(plan[plan.length - 1]['QUERY PLAN']); }
      const nl = plan.map((x) => x['QUERY PLAN']).filter((l) => /Nested Loop|Rows Removed by Join Filter|Seq Scan/.test(l)).slice(0, 12);
      await tx.$executeRawUnsafe('DEALLOCATE q');
      return { times, nl };
    }, { timeout: 300000, maxWait: 20000 });
    console.log(`== ${mode}\n${res.times.join(' | ')}\n${res.nl.map((l) => l.trim().slice(0, 150)).join('\n')}`);
  }
  await p.$disconnect();
})().catch((e) => { console.error(e.message.slice(0, 1200)); process.exit(1); });
