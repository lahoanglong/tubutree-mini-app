import { createRequire } from 'node:module';
import fs from 'node:fs';
const WT = '/Users/longla/coding/tubutree-mini-app/.claude/worktrees/r1028e-do';
const env = fs.readFileSync(WT + '/docs/2026-10-20-uat/tools/uat-harness/state/lane-3/lane.env', 'utf8').match(/^DATABASE_URL=(.*)$/m)[1];
const { PrismaClient } = createRequire(WT + '/apps/api/package.json')('@prisma/client');
const p = new PrismaClient({ datasources: { db: { url: env } } });
const cs = await p.coupon.findMany({ where: { isActive: true }, take: 5, select: { code: true, minOrder: true, type: true } }).catch((e) => e.message);
console.log(cs);
await p.$disconnect();
