import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * C-010 (Q-16): quyền lợi hạng chỉ được hứa khi mã có cơ chế thực hiện; lời hứa "cây thật/PanNature" bỏ
 * khỏi dữ liệu seed. Đọc thẳng prisma/seed.ts (import seed.ts sẽ chạy main() → cần DB) và file migration
 * cập nhật dữ liệu đã có trên PROD (PROD không chạy seed).
 */
const PRISMA_DIR = join(__dirname, '../../../prisma');
const seedSrc = readFileSync(join(PRISMA_DIR, 'seed.ts'), 'utf-8');

function seededArray<T>(marker: string): T[] {
  const start = seedSrc.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const open = seedSrc.indexOf('[', seedSrc.indexOf('=', start));
  const end = seedSrc.indexOf('\n];', open);
  expect(end).toBeGreaterThan(open);
  const factory = new Function('Prisma', `return ${seedSrc.slice(open, end + 2)};`) as (p: unknown) => unknown;
  return factory({ Decimal: Number }) as T[];
}

type Tier = {
  id: string;
  name: string;
  pointMultiplier: unknown;
  discountPct: unknown;
  perks: string[];
  birthdayVoucherAmount: number | null;
};
const TIERS = seededArray<Tier>('const TIERS = [');
const CONFIGS = seededArray<{ key: string; value: unknown; description: string }>('const SYSTEM_CONFIGS: ConfigSeed[] = [');
const QUIZZES = seededArray<{ id: string; question: string; options: string[]; correct: number }>('const QUIZZES = [');
const freeshipOverrides = CONFIGS.find((c) => c.key === 'shipping.tier_freeship_overrides')!.value as Record<string, number>;

/** Mỗi dạng quyền lợi hợp lệ gắn với cơ chế thật trong mã; trả về lý do sai (rỗng = có cơ chế). */
function mechanismProblem(tier: Tier, perk: string): string {
  let m: RegExpExecArray | null;
  if ((m = /^Tích Điểm Xanh x([\d.]+)$/.exec(perk))) {
    // LoyaltyService.getMultiplier / calcPointsEarned đọc MembershipTier.pointMultiplier
    return Number(tier.pointMultiplier) === Number(m[1]) ? '' : 'hệ số tích điểm lệch pointMultiplier';
  }
  if ((m = /^Freeship đơn ≥ (\d+)k$/.exec(perk))) {
    // PricingService.calcShippingFee đọc shipping.tier_freeship_overrides[tier.id]
    return freeshipOverrides[tier.id] === Number(m[1]) * 1000 ? '' : 'ngưỡng freeship lệch shipping.tier_freeship_overrides';
  }
  if (perk === 'Freeship toàn shop') {
    return freeshipOverrides[tier.id] === 0 ? '' : 'freeship toàn shop lệch shipping.tier_freeship_overrides';
  }
  if (perk === 'Freeship + giảm 5% mọi đơn') {
    // CheckoutService tính tierDiscount từ MembershipTier.discountPct
    return freeshipOverrides[tier.id] === 0 && Number(tier.discountPct) === 0.05 ? '' : 'lệch freeship/discountPct';
  }
  if ((m = /^Mã giảm giá sinh nhật (\d+)k$/.exec(perk))) {
    // VouchersService.birthdayVouchers cấp đúng MembershipTier.birthdayVoucherAmount
    return tier.birthdayVoucherAmount === Number(m[1]) * 1000 ? '' : 'mức mã sinh nhật lệch birthdayVoucherAmount';
  }
  return 'không có cơ chế thực hiện trong mã';
}

describe('quyền lợi hạng trong seed (C-010, Q-16)', () => {
  it('có đủ bốn hạng', () => {
    expect(TIERS.map((t) => t.id)).toEqual(['MAM_XANH', 'LOC_BIEC', 'DAI_THU', 'CO_THU']);
  });

  it('mỗi quyền lợi đều có cơ chế thực hiện trong mã và khớp số liệu hạng', () => {
    const problems = TIERS.flatMap((t) =>
      t.perks.map((p) => ({ tier: t.id, perk: p, problem: mechanismProblem(t, p) })).filter((r) => r.problem !== ''),
    );
    expect(problems).toEqual([]);
  });

  it('danh sách quyền lợi chốt cho từng hạng', () => {
    expect(Object.fromEntries(TIERS.map((t) => [t.id, t.perks]))).toEqual({
      MAM_XANH: ['Tích Điểm Xanh x1'],
      LOC_BIEC: ['Tích Điểm Xanh x1.2', 'Freeship đơn ≥ 99k', 'Mã giảm giá sinh nhật 50k'],
      DAI_THU: ['Tích Điểm Xanh x1.5', 'Freeship toàn shop', 'Mã giảm giá sinh nhật 150k'],
      CO_THU: ['Tích Điểm Xanh x2', 'Freeship + giảm 5% mọi đơn', 'Mã giảm giá sinh nhật 300k'],
    });
  });
});

describe('câu chữ "cây thật/PanNature" trong seed (C-010, Q-16)', () => {
  it('câu quiz q6 không hỏi/đáp về đối tác PanNature', () => {
    const q6 = QUIZZES.find((q) => q.id === 'q6')!;
    expect(`${q6.question} ${q6.options.join(' ')}`).not.toMatch(/PanNature|cây thật/i);
    expect(q6.options[q6.correct]).toBe('Hồ nước chung của cộng đồng');
  });

  it('mô tả cấu hình giá góp cây nói góp quỹ trồng cây', () => {
    const cfg = CONFIGS.find((c) => c.key === 'game.tree_xu_price')!;
    expect(cfg.description).toBe('Giá góp 1 cây vào quỹ trồng cây bằng xu');
  });

  it('không còn chữ cây thật/PanNature/Rừng Xanh Lên ở dữ liệu hướng khách của seed', () => {
    const lines = seedSrc.split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*)/.test(l) && /cây thật|PanNature|Rừng Xanh Lên/i.test(l));
    expect(lines).toEqual([]);
  });
});

const toPointsXanh = (perk: string) => perk.replace(/^Tích điểm ([\d.]+)x$/, 'Tích Điểm Xanh x$1');

describe('migration cập nhật chữ + quyền lợi hạng đã có trên PROD (C-010)', () => {
  const dir = readdirSync(join(PRISMA_DIR, 'migrations')).find((d) => d.endsWith('_pd1_tree_fund_wording_tier_perks'));
  const sql = dir ? readFileSync(join(PRISMA_DIR, 'migrations', dir, 'migration.sql'), 'utf-8') : '';
  const code = sql.replace(/^\s*--.*$/gm, '');
  const statements = code.split(';').map((s) => s.trim()).filter(Boolean);

  it('có thư mục migration', () => {
    expect(dir).toBeDefined();
  });

  it('chỉ UPDATE có WHERE, không xoá/bỏ dữ liệu hay cấu trúc', () => {
    expect(code).not.toMatch(/\b(DELETE|DROP|TRUNCATE|ALTER|INSERT)\b/i);
    expect(statements).toHaveLength(5);
    for (const s of statements) {
      expect(s).toMatch(/^UPDATE\b/);
      expect(s).toMatch(/\bWHERE\b/);
    }
  });

  it('quyền lợi hạng: khớp đúng mảng cũ theo tên hạng, đặt đúng mảng mới của seed', () => {
    const perkUpdates = statements.filter((s) => s.includes('"membership_tiers"'));
    const parsed = perkUpdates.map((s) => {
      const m = /SET "perks" = '(\[.*?\])'::jsonb\s+WHERE "name" = '([^']+)'\s+AND "perks" = '(\[.*?\])'::jsonb$/s.exec(s);
      expect(m).not.toBeNull();
      return { name: m![2]!, next: JSON.parse(m![1]!) as string[], prev: JSON.parse(m![3]!) as string[] };
    });
    expect(parsed.map((p) => p.name).sort()).toEqual(['Cổ Thụ', 'Đại Thụ', 'Lộc Biếc'].sort());
    for (const p of parsed) {
      const tier = TIERS.find((t) => t.name === p.name)!;
      // Chữ "Tích điểm Nx" của migration này được migration _pd1_review_wording đổi tiếp sang "Tích Điểm Xanh xN".
      expect(p.next.map(toPointsXanh)).toEqual(tier.perks);
      expect(p.prev).not.toEqual(p.next);
    }
    const prevOf = Object.fromEntries(parsed.map((p) => [p.name, p.prev]));
    expect(prevOf).toEqual({
      'Lộc Biếc': ['Tích điểm 1.2x', 'Freeship đơn ≥ 99k', 'Voucher sinh nhật 50k'],
      'Đại Thụ': ['Tích điểm 1.5x', 'Freeship toàn shop', 'Ưu tiên hotline', 'Beta tester', 'Voucher sinh nhật 150k + 1 sample'],
      'Cổ Thụ': ['Tích điểm 2x', 'Freeship + giảm 5% mọi đơn', 'Quà sinh nhật cá nhân hóa', 'Voucher sinh nhật 300k + hộp quà'],
    });
  });

  it('quiz q6 và mô tả cấu hình: chỉ đổi khi còn đúng nội dung cũ', () => {
    const quiz = statements.find((s) => s.includes('"game_quizzes"'))!;
    expect(quiz).toContain(`"question" = 'Cây thật được trồng qua đối tác nào?'`);
    expect(quiz).toContain(`"options" = '["PanNature","WWF","GreenID","IUCN"]'::jsonb`);
    const q6 = QUIZZES.find((q) => q.id === 'q6')!;
    expect(quiz).toContain(`SET "question" = '${q6.question}'`);
    expect(quiz).toContain(`"options" = '${JSON.stringify(q6.options)}'::jsonb`);
    const cfg = statements.find((s) => s.includes('"system_configs"'))!;
    expect(cfg).toContain(`"description" = 'Giá mua 1 cây thật bằng xu'`);
    expect(cfg).toContain(`SET "description" = '${CONFIGS.find((c) => c.key === 'game.tree_xu_price')!.description}'`);
  });
});

describe('migration _pd1_review_wording: "Điểm Xanh" cho quyền lợi tích điểm + mốc cộng đồng không hứa địa điểm (C-010, Q-26)', () => {
  const dir = readdirSync(join(PRISMA_DIR, 'migrations')).find((d) => d.endsWith('_pd1_review_wording'));
  const sql = dir ? readFileSync(join(PRISMA_DIR, 'migrations', dir, 'migration.sql'), 'utf-8') : '';
  const code = sql.replace(/^\s*--.*$/gm, '');
  const statements = code.split(';').map((s) => s.trim()).filter(Boolean);
  const firstDir = readdirSync(join(PRISMA_DIR, 'migrations')).find((d) => d.endsWith('_pd1_tree_fund_wording_tier_perks'))!;
  const firstSql = readFileSync(join(PRISMA_DIR, 'migrations', firstDir, 'migration.sql'), 'utf-8');

  it('đứng sau migration _pd1_tree_fund_wording_tier_perks (chuỗi UPDATE khớp được kết quả của migration trước)', () => {
    expect(dir).toBeDefined();
    const names = readdirSync(join(PRISMA_DIR, 'migrations')).sort();
    expect(names.indexOf(dir!)).toBeGreaterThan(names.indexOf(firstDir));
  });

  it('chỉ UPDATE có WHERE, không xoá/bỏ dữ liệu hay cấu trúc', () => {
    expect(code).not.toMatch(/\b(DELETE|DROP|TRUNCATE|ALTER|INSERT)\b/i);
    expect(statements).toHaveLength(5);
    for (const s of statements) {
      expect(s).toMatch(/^UPDATE\b/);
      expect(s).toMatch(/\bWHERE\b/);
    }
  });

  it('quyền lợi hạng: bốn hạng, mảng cũ = kết quả migration trước (hoặc seed cũ), mảng mới = seed', () => {
    const perkUpdates = statements.filter((s) => s.includes('"membership_tiers"'));
    expect(perkUpdates).toHaveLength(4);
    const parsed = perkUpdates.map((s) => {
      const m = /SET "perks" = '(\[.*?\])'::jsonb\s+WHERE "name" = '([^']+)'\s+AND "perks" = '(\[.*?\])'::jsonb$/s.exec(s);
      expect(m).not.toBeNull();
      return { name: m![2]!, next: JSON.parse(m![1]!) as string[], prev: JSON.parse(m![3]!) as string[] };
    });
    for (const p of parsed) {
      const tier = TIERS.find((t) => t.name === p.name)!;
      expect(p.next).toEqual(tier.perks);
      expect(p.prev.map(toPointsXanh)).toEqual(p.next);
      expect(p.prev).not.toEqual(p.next);
      // Hạng đã được migration trước đổi mảng: mảng cũ ở đây phải đúng là mảng mới của migration đó.
      if (firstSql.includes(`WHERE "name" = '${p.name}'`)) expect(firstSql).toContain(`SET "perks" = '${JSON.stringify(p.prev)}'::jsonb`);
    }
    expect(parsed.map((p) => p.name).sort()).toEqual(TIERS.map((t) => t.name).sort());
  });

  const goalSeed = /id: 'cg-cangio-2026',\s+title: '([^']+)',\s+region: '([^']+)'/.exec(seedSrc);

  it('seed mốc cộng đồng không nêu địa điểm trồng hay "phủ xanh" (không có quy trình trồng thật)', () => {
    expect(goalSeed).not.toBeNull();
    expect(`${goalSeed![1]} ${goalSeed![2]}`).not.toMatch(/Cần Giờ|phủ xanh|rừng/i);
  });

  it('mốc cộng đồng: chỉ đổi khi id + tên + vùng còn đúng bản seed cũ, đặt đúng chữ của seed', () => {
    const goal = statements.find((s) => s.includes('"community_goals"'))!;
    expect(goal).toContain(`"id" = 'cg-cangio-2026'`);
    expect(goal).toContain(`"title" = 'Cùng Tubu phủ xanh Cần Giờ'`);
    expect(goal).toContain(`"region" = 'Rừng ngập mặn Cần Giờ, TP.HCM'`);
    expect(goal).toContain(`SET "title" = '${goalSeed![1]}'`);
    expect(goal).toContain(`"region" = '${goalSeed![2]}'`);
  });
});
