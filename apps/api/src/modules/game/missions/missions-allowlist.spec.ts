import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';
import { BADGE_IDS } from '@tubutree/shared-types';
import { BADGE_RULES, badgeUserFilter, grantBadgeSql } from './badges';

/**
 * Nhiệm vụ hằng ngày và huy hiệu không có đường cộng thưởng riêng: mọi 💧 và Điểm Xanh đi qua GameMiniRewardService.settleDailyMission
 * (thư mục game/mini, đã ghim bởi game-mint-allowlist.spec.ts). Thư mục này chỉ đọc dữ liệu và ghi đúng bảng user_badges.
 */

const ROOT = __dirname;

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const FORBIDDEN: Array<[string, RegExp]> = [
  ['applyPointsDelta', /\bapplyPointsDelta\s*\(/],
  ['loyalty.grant', /\.grant\s*\(/],
  ['ghi pointsTransaction', /\.pointsTransaction\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/],
  ['ghi coinTransaction', /\.coinTransaction\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/],
  ['cộng pointsBalance', /\bpointsBalance\s*:\s*\{\s*(increment|decrement|set)\b/],
  ['cộng totalSeeds', /\btotalSeeds\s*:\s*\{\s*(increment|decrement|set)\b/],
  ['ghi gameWaterEvent', /\.gameWaterEvent\s*\.\s*(create|createMany|update|updateMany|upsert)\s*\(/],
  ['ghi missionProgress', /\.missionProgress\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/],
  ['ghi gameDailyLedger', /\.gameDailyLedger\s*\.\s*(create|createMany|update|updateMany|upsert)\s*\(/],
  ['SQL ghi sổ', /(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?(points_transactions|coin_transactions|game_water_events|game_daily_ledger|game_profiles|users|mission_progress)"?/i],
  ['SQL ghi waste_*', /(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?waste_/i],
];

function sources(): Array<[string, string]> {
  return readdirSync(ROOT)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
    .sort()
    .map((f) => [f, stripComments(readFileSync(join(ROOT, f), 'utf-8'))]);
}

describe('game/missions: không có đường cộng thưởng riêng', () => {
  const files = sources();

  it('quét được đủ tệp nguồn của thư mục', () => {
    expect(files.map(([f]) => f)).toEqual(
      expect.arrayContaining(['badges.service.ts', 'badges.ts', 'daily-missions.service.ts', 'daily-missions.ts', 'engagement.controller.ts']),
    );
  });

  it.each(FORBIDDEN)('không tệp nào có: %s', (_label, re) => {
    expect(files.filter(([, code]) => re.test(code)).map(([f]) => f)).toEqual([]);
  });

  it('thưởng nhiệm vụ ngày chỉ đi qua settleDailyMission của GameMiniRewardService', () => {
    const svc = files.find(([f]) => f === 'daily-missions.service.ts')?.[1] ?? '';
    expect(svc.match(/\.settleDailyMission\s*\(/g)).toHaveLength(1);
    expect(svc).toContain("from '../mini/game-mini-reward.service'");
  });

  it('chỉ badges.ts viết SQL chèn, và chỉ vào user_badges', () => {
    const inserts = files.flatMap(([f, code]) => [...code.matchAll(/INSERT\s+INTO\s+"?(\w+)"?/gi)].map((m) => `${f}:${m[1]}`));
    expect(inserts).toEqual(['badges.ts:user_badges']);
  });
});

describe('câu SQL huy hiệu', () => {
  const NOW = new Date('2026-11-17T03:00:00.000Z');

  it.each(BADGE_IDS)('%s: chèn user_badges, chạy lại không đổi (ON CONFLICT DO NOTHING), lọc đúng một khách khi có userId', (badge) => {
    const all = grantBadgeSql(badge, null, NOW);
    expect(all.sql).toMatch(/INSERT INTO user_badges/);
    expect(all.sql).toMatch(/ON CONFLICT DO NOTHING/);
    expect(all.values).toContain(badge);
    expect(all.values).toContain(NOW);

    const one = grantBadgeSql(badge, 'user-9', NOW);
    expect(one.values).toContain('user-9');
    expect(one.text).toMatch(/AND \w\."userId" = \$\d+/);
    expect(all.values).not.toContain('user-9');
  });

  it('mỗi luật là câu SELECT, không ghi gì (kể cả bảng waste_*)', () => {
    for (const badge of BADGE_IDS) {
      const sql = BADGE_RULES[badge](Prisma.empty).sql;
      expect(sql.trim()).toMatch(/^SELECT/);
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/i);
    }
  });

  it('không có userId thì không lọc', () => {
    expect(badgeUserFilter('FIRST_ORDER', null)).toBe(Prisma.empty);
  });
});
