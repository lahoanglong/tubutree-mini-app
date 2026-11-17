import { HttpException } from '@nestjs/common';
import { MINI_ERROR_CODES } from '@tubutree/shared-types';
import { loadGameMiniPack } from '../../../../../prisma/seed-game-mini';
import { cardPriceWithFlash } from '../../../catalog/variation-order';
import { MATCHER_CACHE_MS, MatcherService } from './matcher.service';
import { MATCHER_ENABLED_KEY, MATCHER_REWARD, outcomeSlugs, readMatcherOutcome } from './matcher.rules';

jest.mock('../../game-profile', () => ({ ensureGameProfile: jest.fn().mockResolvedValue(undefined) }));

const pack = loadGameMiniPack();
const ROWS = pack.matcher.map((i) => ({ id: i.id, kind: i.kind, payload: i.payload, explanation: i.explanation, sourceUrl: i.sourceUrl }));
const ALL_SLUGS = [...new Set(pack.matcher.filter((i) => i.kind === 'outcome').flatMap((i) => outcomeSlugs(readMatcherOutcome(i.payload)!)))];
const NOW = new Date('2026-11-18T03:00:00Z');

const LAUNDRY_REFILL = [
  { code: 'need', value: 'laundry' },
  { code: 'laundry_who', value: 'family' },
  { code: 'size_home', value: 'refill' },
];

interface FakeVariation {
  id: string;
  sku: string;
  name: string;
  retailPrice: number;
  salePrice: number | null;
  stock: number;
}

function product(slug: string, i: number, over: Partial<FakeVariation>[] = [{}]) {
  return {
    id: `p-${slug}`,
    slug,
    name: `Món ${slug}`,
    thumbnail: `thumb-${i}.webp`,
    basePrice: 100_000,
    salePrice: null,
    categoryIds: ['cat-home'],
    soldApp: i,
    soldExternal: 0,
    variations: over.map((o, k) => ({ id: `v-${slug}-${k}`, sku: `SKU-${i}-${k}`, name: `Loại ${k}`, retailPrice: 100_000 + i * 1_000, salePrice: 90_000 + i * 1_000, stock: 5, ...o })),
  };
}

function setup(
  opts: { flag?: boolean; mini?: boolean; rows?: typeof ROWS; stockOut?: string[]; flash?: { slug: string; flashPrice: number }[]; variations?: Record<string, Partial<FakeVariation>[]> } = {},
) {
  const config = new Map<string, unknown>([
    [MATCHER_ENABLED_KEY, opts.flag ?? true],
    ['game.mini.enabled', opts.mini ?? false],
  ]);
  const catalog = ALL_SLUGS.map((s, i) => product(s, i, opts.variations?.[s] ?? [{ stock: opts.stockOut?.includes(s) ? 0 : 5 }]));
  const prisma = {
    gameContentItem: { findMany: jest.fn().mockResolvedValue(opts.rows ?? ROWS) },
    product: {
      findMany: jest.fn(async (args: { where: { slug?: { in: string[] } } }) => {
        if (args.where.slug) return catalog.filter((p) => args.where.slug!.in.includes(p.slug));
        return catalog
          .filter((p) => p.variations.some((v) => v.stock > 0))
          .map((p) => ({ slug: p.slug, soldApp: p.soldApp, soldExternal: p.soldExternal }))
          .sort((a, b) => b.soldApp - a.soldApp);
      }),
    },
    flashSaleItem: {
      findMany: jest.fn().mockResolvedValue(
        (opts.flash ?? []).map((f) => {
          const v = catalog.find((p) => p.slug === f.slug)!.variations[0]!;
          return { flashPrice: f.flashPrice, soldCount: 0, quota: 10, variationId: v.id, variation: { productId: `p-${f.slug}`, retailPrice: v.retailPrice, salePrice: v.salePrice } };
        }),
      ),
    },
    category: { findMany: jest.fn().mockResolvedValue([{ id: 'cat-home' }]) },
    user: { findUnique: jest.fn().mockResolvedValue({ zaloId: 'z-1', phone: '0900000000', createdAt: new Date('2026-01-01T00:00:00Z') }) },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  const systemConfig = { get: jest.fn(async (key: string, fallback: unknown) => (config.has(key) ? config.get(key) : fallback)) };
  const env = { get: jest.fn().mockReturnValue('secret-for-test') };
  const rewards = { settleMatcher: jest.fn().mockResolvedValue({ rewarded: true, water: MATCHER_REWARD.water }) };
  const svc = new MatcherService(prisma as never, systemConfig as never, env as never, rewards as never);
  return { svc, prisma, rewards, catalog };
}

async function httpError(p: Promise<unknown>): Promise<{ status: number; code: string }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpException) return { status: e.getStatus(), code: (e.getResponse() as { code: string }).code };
    throw e;
  }
  throw new Error('không ném lỗi');
}

describe('MatcherService: cờ và nội dung', () => {
  it('cờ tắt: nội dung và kết quả trả 404 GAME_DISABLED, không đọc DB nội dung, không thưởng', async () => {
    const { svc, prisma, rewards } = setup({ flag: false });
    expect(await svc.enabled()).toBe(false);
    expect(await httpError(svc.publicContent())).toEqual({ status: 404, code: MINI_ERROR_CODES.disabled });
    expect(await httpError(svc.result('u1', { answers: LAUNDRY_REFILL }, NOW))).toEqual({ status: 404, code: MINI_ERROR_CODES.disabled });
    expect(prisma.gameContentItem.findMany).not.toHaveBeenCalled();
    expect(prisma.product.findMany).not.toHaveBeenCalled();
    expect(rewards.settleMatcher).not.toHaveBeenCalled();
  });

  it('cờ bật nhưng chưa bật mục nào (seed để tắt hết): 404 GAME_NO_CONTENT', async () => {
    const { svc } = setup({ rows: [] });
    expect(await httpError(svc.publicContent())).toEqual({ status: 404, code: MINI_ERROR_CODES.noContent });
  });

  it('ready(): chỉ true khi cờ bật và nội dung bật đủ (lối vào không dẫn tới câu "đang cập nhật")', async () => {
    expect(await setup({ flag: false }).svc.ready()).toBe(false);
    expect(await setup({ rows: [] }).svc.ready()).toBe(false);
    expect(await setup({ rows: ROWS.filter((r) => r.id !== 'gm-matcher-o-kitchen-machine') }).svc.ready()).toBe(false);
    expect(await setup().svc.ready()).toBe(true);
  });

  it('bật thiếu một bộ làm hở nhánh: 404 GAME_NO_CONTENT (không phát nửa vời)', async () => {
    const { svc } = setup({ rows: ROWS.filter((r) => r.id !== 'gm-matcher-o-kitchen-machine') });
    expect(await httpError(svc.publicContent())).toEqual({ status: 404, code: MINI_ERROR_CODES.noContent });
  });

  it('nội dung công khai: 8 câu theo bước, 20 câu đố có nguồn https; không lộ bộ sản phẩm', async () => {
    const { svc } = setup();
    const c = await svc.publicContent();
    expect(c.questions).toHaveLength(8);
    expect(c.questions.map((q) => q.step)).toEqual([...c.questions.map((q) => q.step)].sort());
    expect(c.trivia).toHaveLength(20);
    expect(c.trivia.every((t) => t.sourceUrl.startsWith('https://') && t.explanation.length > 0)).toBe(true);
    expect(JSON.stringify(c)).not.toMatch(/"slots"|"pick"|nuoc-giat-/);
  });

  it('nội dung đọc lại sau 10 phút, không mỗi lượt', async () => {
    const { svc, prisma } = setup();
    await svc.publicContent();
    await svc.result(null, { answers: LAUNDRY_REFILL }, NOW);
    expect(prisma.gameContentItem.findMany).toHaveBeenCalledTimes(1);
    const later = Date.now() + MATCHER_CACHE_MS + 1;
    const spy = jest.spyOn(Date, 'now').mockReturnValue(later);
    await svc.publicContent();
    spy.mockRestore();
    expect(prisma.gameContentItem.findMany).toHaveBeenCalledTimes(2);
  });
});

describe('MatcherService: kết quả', () => {
  it('đáp án sai dạng, sai nhánh, thiếu câu: 400 ANSWERS_INVALID', async () => {
    const { svc } = setup();
    for (const answers of [
      ['laundry'],
      [{ code: 'need', value: 'laundry' }],
      [{ code: 'need', value: 'laundry' }, { code: 'kitchen_how', value: 'hand' }, { code: 'size_home', value: 'small' }],
      [{ code: 'need', value: 'x'.repeat(41) }, { code: 'laundry_who', value: 'family' }, { code: 'size_home', value: 'small' }],
    ]) {
      expect(await httpError(svc.result(null, { answers }, NOW))).toEqual({ status: 400, code: MINI_ERROR_CODES.answersInvalid });
    }
  });

  it('tất định: cùng đáp án ra cùng bộ, cùng món, cùng thứ tự; có variationId, tổng = cộng giá', async () => {
    const { svc } = setup();
    const a = await svc.result(null, { answers: LAUNDRY_REFILL }, NOW);
    const b = await svc.result(null, { answers: [...LAUNDRY_REFILL].reverse() }, NOW);
    expect(b).toEqual(a);
    expect(a.code).toBe('laundry_family');
    expect(a.fallback).toBe(false);
    expect(a.items.map((i) => i.slug)).toEqual(['refill-nuoc-giat-bac-ha-fuwa3e-10l-a5ea8f', 'nuoc-giat-do-lot-fuwa3e-500ml-3e76e4']);
    expect(a.items.every((i) => i.variationId.startsWith('v-') && i.why.length > 0)).toBe(true);
    expect(a.items[0]!.why).toMatch(/refill/);
    expect(a.total).toBe(a.items.reduce((n, i) => n + i.price, 0));
    expect(a.water).toBe(0);
  });

  it('món đầu hết hàng thì lấy ứng viên kế cùng vị trí', async () => {
    const { svc } = setup({ stockOut: ['refill-nuoc-giat-bac-ha-fuwa3e-10l-a5ea8f'] });
    const r = await svc.result(null, { answers: LAUNDRY_REFILL }, NOW);
    expect(r.items[0]!.slug).toBe('refill-nuoc-giat-cam-fuwa3e-10l-dc4433');
  });

  it('không đủ 2 món còn hàng: bộ dự phòng "bán chạy còn hàng" của danh mục, fallback = true', async () => {
    const outOfLaundry = ALL_SLUGS.filter((s) => s.includes('giat'));
    const { svc, prisma } = setup({ stockOut: outOfLaundry });
    const r = await svc.result(null, { answers: LAUNDRY_REFILL }, NOW);
    expect(r.fallback).toBe(true);
    expect(r.items.length).toBeGreaterThanOrEqual(2);
    expect(r.items.length).toBeLessThanOrEqual(3);
    expect(r.items.some((i) => outOfLaundry.includes(i.slug))).toBe(false);
    expect(prisma.category.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { OR: [{ slug: 'tay-rua-sinh-hoc' }, { parent: { slug: 'tay-rua-sinh-hoc' } }] } }),
    );
  });

  it('giá đúng hàm giá thẻ, gồm Giờ vàng: suất rẻ hơn thắng, phân loại thêm vào giỏ là phân loại có suất', async () => {
    const slug = 'nuoc-giat-do-lot-fuwa3e-500ml-3e76e4';
    const { svc, catalog } = setup({ flash: [{ slug, flashPrice: 50_000 }] });
    const p = catalog.find((x) => x.slug === slug)!;
    const v = p.variations[0]!;
    const r = await svc.result(null, { answers: LAUNDRY_REFILL }, NOW);
    const item = r.items.find((i) => i.slug === slug)!;
    expect(item.price).toBe(cardPriceWithFlash(p, p.variations, [{ flashPrice: 50_000, variationId: v.id, retailPrice: v.retailPrice, salePrice: v.salePrice }]));
    expect(item.price).toBe(50_000);
    expect(item.flash).toBe(true);
    expect(item.variationId).toBe(v.id);
    expect(item.compareAtPrice).toBe(v.retailPrice);
    const other = r.items.find((i) => i.slug !== slug)!;
    const op = catalog.find((x) => x.slug === other.slug)!;
    expect(other.price).toBe(cardPriceWithFlash(op, op.variations, undefined));
    expect(other.flash).toBe(false);
  });

  it('Giờ vàng ở phân loại đã hết hàng: món vẫn vào bộ bằng phân loại còn hàng, giá thường, không nhãn Giờ vàng', async () => {
    const slug = 'nuoc-giat-do-lot-fuwa3e-500ml-3e76e4';
    const { svc, catalog } = setup({ flash: [{ slug, flashPrice: 50_000 }], variations: { [slug]: [{ stock: 0 }, { stock: 5 }] } });
    const p = catalog.find((x) => x.slug === slug)!;
    const r = await svc.result(null, { answers: LAUNDRY_REFILL }, NOW);
    const item = r.items.find((i) => i.slug === slug)!;
    expect(item).toBeDefined();
    expect(item.flash).toBe(false);
    expect(item.price).toBe(cardPriceWithFlash(p, p.variations, undefined));
    expect(item.price).toBeGreaterThan(50_000);
    expect(item.variationId).toBe(p.variations[1]!.id);
  });
});

describe('MatcherService: thưởng', () => {
  it('khách chưa đăng nhập: 0 💧, không gọi thưởng', async () => {
    const { svc, rewards } = setup({ mini: true });
    expect((await svc.result(null, { answers: LAUNDRY_REFILL }, NOW)).water).toBe(0);
    expect(rewards.settleMatcher).not.toHaveBeenCalled();
  });

  it('game mini tắt: 0 💧 dù đã đăng nhập (giao diện không hứa thưởng)', async () => {
    const { svc, rewards } = setup({ mini: false });
    expect((await svc.result('u1', { answers: LAUNDRY_REFILL, deviceId: 'device-12345678' }, NOW)).water).toBe(0);
    expect(rewards.settleMatcher).not.toHaveBeenCalled();
  });

  it('thiếu mã thiết bị: 0 💧 và không ghi ván (không đốt lượt thưởng của ngày)', async () => {
    const { svc, rewards } = setup({ mini: true });
    expect((await svc.result('u1', { answers: LAUNDRY_REFILL }, NOW)).water).toBe(0);
    expect(rewards.settleMatcher).not.toHaveBeenCalled();
  });

  it('game mini bật + tài khoản thật: gọi settleMatcher một lần với mã bộ, ngày VN, 💧 cơ bản; không Điểm Xanh', async () => {
    const { svc, rewards } = setup({ mini: true });
    const r = await svc.result('u1', { answers: LAUNDRY_REFILL, deviceId: 'device-12345678' }, NOW);
    expect(r.water).toBe(MATCHER_REWARD.water);
    expect(rewards.settleMatcher).toHaveBeenCalledTimes(1);
    expect(rewards.settleMatcher).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', dayKey: '2026-11-18', outcomeId: 'gm-matcher-o-laundry-family', water: MATCHER_REWARD.water, deviceHash: expect.any(String) }),
    );
    expect(MATCHER_REWARD.points).toBe(0);
  });

  it('bộ rỗng (cả nhóm dự phòng hết hàng): 0 💧, không dùng lượt thưởng của ngày', async () => {
    const { svc, rewards } = setup({ mini: true, stockOut: ALL_SLUGS });
    const r = await svc.result('u1', { answers: LAUNDRY_REFILL, deviceId: 'device-12345678' }, NOW);
    expect(r.items).toEqual([]);
    expect(r.water).toBe(0);
    expect(rewards.settleMatcher).not.toHaveBeenCalled();
  });

  it('lỗi ở bước thưởng không làm hỏng gợi ý: vẫn trả bộ, 0 💧', async () => {
    const { svc, rewards } = setup({ mini: true });
    rewards.settleMatcher.mockRejectedValueOnce(new Error('deadlock'));
    const r = await svc.result('u1', { answers: LAUNDRY_REFILL, deviceId: 'device-12345678' }, NOW);
    expect(r.water).toBe(0);
    expect(rewards.settleMatcher).toHaveBeenCalledTimes(1);
    expect(r.items.length).toBeGreaterThanOrEqual(2);
  });
});
