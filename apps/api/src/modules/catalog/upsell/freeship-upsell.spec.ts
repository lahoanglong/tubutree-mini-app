import { NotFoundException } from '@nestjs/common';
import { FREESHIP_UPSELL_EXCLUDE_MAX, FREESHIP_UPSELL_LIMIT, FREESHIP_UPSELL_WINDOW } from '@tubutree/shared-types';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { PUBLIC_CACHE_POLICY_KEY } from '../../../common/decorators/public-cache.decorator';
import { createValidationPipe } from '../../../common/validation-pipe';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { SystemConfigService } from '../../system-config/system-config.service';
import type { CatalogService } from '../catalog.service';
import { FREESHIP_BOOSTER_ENABLED_KEY, parseExcludeSlugs, rankFreeshipUpsell, type FreeshipUpsellRow } from './freeship-upsell';
import { FreeshipUpsellController, FreeshipUpsellQuery } from './freeship-upsell.controller';
import { FREESHIP_UPSELL_POOL_TTL_MS, FreeshipUpsellService } from './freeship-upsell.service';

const row = (id: string, price: number, soldApp30d = 0, sold = 0, slug = id): FreeshipUpsellRow => ({ id, slug, price, soldApp30d, sold });

describe('rankFreeshipUpsell', () => {
  it('món đóng được khoảng thiếu (gap ≤ giá ≤ gap + 45.000) đứng trước, bán chạy 30 ngày trước; rồi tới món rẻ hơn khoảng thiếu', () => {
    const rows = [
      row('cheap-hot', 20_000, 90),
      row('close-slow', 52_000, 1),
      row('close-hot', 90_000, 40),
      row('too-dear', 95_001, 500),
      row('cheap-cold', 10_000, 0, 3),
      row('exact', 50_000, 40, 10),
    ];
    expect(rankFreeshipUpsell(rows, { gap: 50_000 })).toEqual(['exact', 'close-hot', 'close-slow', 'cheap-hot', 'cheap-cold']);
  });

  it('biên cửa sổ: đúng gap + 45.000 vẫn vào, hơn 1 đồng thì không', () => {
    expect(rankFreeshipUpsell([row('edge', 30_000 + FREESHIP_UPSELL_WINDOW), row('over', 30_001 + FREESHIP_UPSELL_WINDOW)], { gap: 30_000 })).toEqual(['edge']);
  });

  it('hoà số bán 30 ngày thì tổng đã bán, rồi giá rẻ hơn, rồi id: hai lần gọi cùng thứ tự', () => {
    const rows = [row('b', 60_000, 5, 1), row('a', 60_000, 5, 1), row('c', 55_000, 5, 1), row('d', 70_000, 5, 9)];
    expect(rankFreeshipUpsell(rows, { gap: 50_000 })).toEqual(['d', 'c', 'a', 'b']);
  });

  it('bỏ món trong giỏ (theo slug), giá 0, trùng slug; tối đa FREESHIP_UPSELL_LIMIT', () => {
    const many = Array.from({ length: 12 }, (_, i) => row(`m${i}`, 60_000, 12 - i));
    expect(rankFreeshipUpsell(many, { gap: 50_000 })).toHaveLength(FREESHIP_UPSELL_LIMIT);
    const rows = [row('in-cart', 60_000, 99), row('free', 0, 99), row('p1', 60_000, 5, 0, 'same'), row('p2', 61_000, 50, 0, 'same')];
    expect(rankFreeshipUpsell(rows, { gap: 50_000, exclude: new Set(['in-cart']) })).toEqual(['p1']);
  });

  it('gap 0, âm hay NaN: rỗng (đã đạt mốc thì không gợi ý)', () => {
    for (const gap of [0, -1, Number.NaN]) expect(rankFreeshipUpsell([row('a', 10_000, 5)], { gap })).toEqual([]);
  });
});

describe('parseExcludeSlugs', () => {
  it('tách dấu phẩy, bỏ khoảng trắng và phần rỗng; không truyền thì rỗng', () => {
    expect([...parseExcludeSlugs(' a, b ,,c ')]).toEqual(['a', 'b', 'c']);
    expect(parseExcludeSlugs(undefined).size).toBe(0);
  });
});

type Product = { id: string; slug: string; basePrice: number; salePrice: number | null; soldApp30d: number; soldApp: number; soldExternal: number; variations: { id: string; sku: string; retailPrice: number; salePrice: number | null; stock: number }[] };
const product = (id: string, price: number, soldApp30d: number, extra: Partial<Product> = {}): Product => ({
  id,
  slug: `sp-${id}`,
  basePrice: price,
  salePrice: null,
  soldApp30d,
  soldApp: 0,
  soldExternal: 0,
  variations: [{ id: `v-${id}`, sku: `S-${id}`, retailPrice: price, salePrice: null, stock: 5 }],
  ...extra,
});

function setup(opts: { enabled?: unknown; products?: Product[]; offers?: Map<string, { variationId: string; flashPrice: number; retailPrice: number; salePrice: number | null }[]> } = {}) {
  const findMany = jest.fn().mockResolvedValue(opts.products ?? []);
  const prisma = { product: { findMany } } as unknown as PrismaService;
  const cardsByIds = jest.fn(async (ids: readonly string[]) => ids.map((id) => ({ id })));
  const activeFlashOffers = jest.fn().mockResolvedValue(opts.offers ?? new Map());
  const catalog = { cardsByIds, activeFlashOffers } as unknown as CatalogService;
  const get = jest.fn(async (key: string, fb: unknown) => (key === FREESHIP_BOOSTER_ENABLED_KEY && 'enabled' in opts ? opts.enabled : fb));
  const config = { get } as unknown as SystemConfigService;
  return { service: new FreeshipUpsellService(prisma, catalog, config), findMany, cardsByIds, activeFlashOffers };
}

describe('FreeshipUpsellService.addons', () => {
  afterEach(() => jest.useRealTimers());

  it('cờ tắt (mặc định, hay giá trị không phải boolean true): 404 và không đọc catalog', async () => {
    for (const enabled of [undefined, false, 'true', 1]) {
      const s = setup(enabled === undefined ? {} : { enabled });
      await expect(s.service.addons(50_000, new Set())).rejects.toBeInstanceOf(NotFoundException);
      expect(s.findMany).not.toHaveBeenCalled();
    }
  });

  it('cờ bật: chỉ món công khai, Tubu giao, không combo, còn phân loại có tồn; trả thẻ theo thứ tự xếp hạng', async () => {
    const s = setup({ enabled: true, products: [product('slow', 60_000, 1), product('hot', 70_000, 30), product('dear', 200_000, 99), product('cheap', 20_000, 50)] });
    await expect(s.service.addons(50_000, new Set(['sp-none']))).resolves.toEqual([{ id: 'hot' }, { id: 'slow' }, { id: 'cheap' }]);
    expect(s.cardsByIds).toHaveBeenCalledWith(['hot', 'slow', 'cheap']);
    const where = s.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ isActive: true, approvalStatus: 'APPROVED', fulfilment: 'TUBU', isCombo: false, variations: { some: { isActive: true, stock: { gt: 0 } } } });
  });

  it('bỏ món đã có trong giỏ theo slug', async () => {
    const s = setup({ enabled: true, products: [product('a', 60_000, 9), product('b', 60_000, 1)] });
    await expect(s.service.addons(50_000, new Set(['sp-a']))).resolves.toEqual([{ id: 'b' }]);
  });

  it('giá xếp hạng là giá thẻ gồm Giờ vàng: suất rẻ hơn kéo món vào cửa sổ', async () => {
    const offers = new Map([['flash', [{ variationId: 'v-flash', flashPrice: 80_000, retailPrice: 120_000, salePrice: null }]]]);
    const s = setup({ enabled: true, products: [product('flash', 120_000, 9)], offers });
    await expect(s.service.addons(50_000, new Set())).resolves.toEqual([{ id: 'flash' }]);
  });

  it('giá thẻ theo phân loại đại diện còn hàng (giá đang bán thấp nhất), không theo cột của sản phẩm', async () => {
    const p = product('multi', 999_000, 3, {
      variations: [
        { id: 'v-out', sku: 'A', retailPrice: 40_000, salePrice: null, stock: 0 },
        { id: 'v-in', sku: 'B', retailPrice: 70_000, salePrice: 60_000, stock: 3 },
      ],
    });
    const s = setup({ enabled: true, products: [p] });
    await expect(s.service.addons(50_000, new Set())).resolves.toEqual([{ id: 'multi' }]);
    await expect(s.service.addons(61_000, new Set())).resolves.toEqual([{ id: 'multi' }]);
    await expect(s.service.addons(10_000, new Set())).resolves.toEqual([]);
  });

  it('kho ứng viên nhớ FREESHIP_UPSELL_POOL_TTL_MS; các lần gọi cùng lúc khi kho trống chỉ quét catalog một lần', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-18T08:00:00Z') });
    const s = setup({ enabled: true, products: [product('a', 60_000, 1)] });
    await Promise.all([s.service.addons(50_000, new Set()), s.service.addons(40_000, new Set())]);
    await s.service.addons(30_000, new Set());
    expect(s.findMany).toHaveBeenCalledTimes(1);
    jest.setSystemTime(Date.now() + FREESHIP_UPSELL_POOL_TTL_MS + 1);
    await s.service.addons(30_000, new Set());
    expect(s.findMany).toHaveBeenCalledTimes(2);
  });

  it('lần nạp kho lỗi không bị nhớ: lần sau đọc lại', async () => {
    const s = setup({ enabled: true, products: [product('a', 60_000, 1)] });
    s.findMany.mockRejectedValueOnce(new Error('db down'));
    await expect(s.service.addons(50_000, new Set())).rejects.toThrow('db down');
    await expect(s.service.addons(50_000, new Set())).resolves.toEqual([{ id: 'a' }]);
  });
});

describe('GET /upsell/freeship', () => {
  const pipe = createValidationPipe();
  const asQuery = (value: Record<string, unknown>) => pipe.transform(value, { type: 'query', metatype: FreeshipUpsellQuery, data: undefined });

  it('công khai, Cache-Control CATALOG, chuyển gap và tập slug sang service', async () => {
    const handler = FreeshipUpsellController.prototype.freeship;
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
    expect(Reflect.getMetadata(PUBLIC_CACHE_POLICY_KEY, handler)).toBe('CATALOG');
    const addons = jest.fn().mockResolvedValue([{ id: 'a' }]);
    const controller = new FreeshipUpsellController({ addons } as unknown as FreeshipUpsellService);
    await expect(controller.freeship({ gap: 42_000, exclude: 'a,b' })).resolves.toEqual([{ id: 'a' }]);
    expect(addons).toHaveBeenCalledWith(42_000, new Set(['a', 'b']));
  });

  it('gap ép sang số nguyên dương; thiếu, 0, số lẻ hay chữ thì 400 bằng lời tiếng Việt', async () => {
    await expect(asQuery({ gap: '42000', exclude: 'a,b' })).resolves.toMatchObject({ gap: 42_000, exclude: 'a,b' });
    for (const bad of [{}, { gap: '0' }, { gap: '1.5' }, { gap: 'abc' }]) {
      await expect(asQuery(bad)).rejects.toMatchObject({ response: { message: expect.arrayContaining([expect.stringContaining('Số tiền còn thiếu')]) } });
    }
  });

  it('exclude quá FREESHIP_UPSELL_EXCLUDE_MAX slug thì 400; tham số lạ bị từ chối', async () => {
    const tooMany = Array.from({ length: FREESHIP_UPSELL_EXCLUDE_MAX + 1 }, (_, i) => `s${i}`).join(',');
    await expect(asQuery({ gap: '1000', exclude: tooMany })).rejects.toBeDefined();
    await expect(asQuery({ gap: '1000', foo: '1' })).rejects.toBeDefined();
  });
});
