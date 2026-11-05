import { CatalogService } from './catalog.service';
import { WishlistService } from '../wishlist/wishlist.service';
import { CartService } from '../cart/cart.service';
import { CARD_PRODUCT_SELECT, CARD_SELECT, cardInStock, withCoverImages } from './card-select';
import { PUBLIC_IMAGE_PREFIX } from '../../common/public-image';
import type { PrismaService } from '../../prisma/prisma.service';
import type { CouponsService } from '../coupons/coupons.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { FlashSaleService } from '../flash-sale/flash-sale.service';
import type { AnalyticsEventsService } from '../analytics/analytics-events.service';
import type { ComboService } from '../storefront/combo.service';

const HEAVY = ['description', 'ingredients', 'images', 'dealerPrices', 'affiliateRate'];

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  slug: id,
  brand: 'b',
  name: id,
  thumbnail: '/public-image/product/x/thumb?v=1',
  basePrice: 1000,
  salePrice: null,
  isFeatured: false,
  ratingAvg: 4,
  reviewCount: 2,
  soldExternal: 1,
  soldApp: 2,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  fulfilment: 'TUBU',
  storefrontId: null,
  variations: [{ id: `${id}-v`, sku: `${id}-s`, retailPrice: 1000, salePrice: null, stock: 3 }],
  ...over,
});

describe('CARD_SELECT / CARD_PRODUCT_SELECT', () => {
  it('thẻ không đọc văn bản dài, ảnh base64 hay giá sỉ', () => {
    for (const col of HEAVY) expect(CARD_SELECT).not.toHaveProperty(col);
    for (const col of HEAVY) expect(CARD_PRODUCT_SELECT.variations.select).not.toHaveProperty(col);
    expect(CARD_PRODUCT_SELECT.variations.select).toEqual({ id: true, sku: true, retailPrice: true, salePrice: true, stock: true });
    expect(CARD_PRODUCT_SELECT.variations.where).toEqual({ isActive: true });
  });
});

describe('withCoverImages', () => {
  it('thẻ đã có thumbnail hoặc đã mang images thì không truy vấn', async () => {
    const $queryRaw = jest.fn();
    const out = await withCoverImages({ $queryRaw } as never, [row('a'), row('b', { thumbnail: null, images: ['https://x/y.jpg'] })]);
    expect($queryRaw).not.toHaveBeenCalled();
    expect(out[1]!.images).toEqual(['https://x/y.jpg']);
  });

  it('thẻ không có thumbnail: một câu SQL lấy đúng images[1], gộp cho mọi thẻ thiếu', async () => {
    const $queryRaw = jest.fn().mockResolvedValue([{ id: 'a', cover: 'https://res.cloudinary.com/x/a.jpg' }, { id: 'b', cover: null }]);
    const out = await withCoverImages({ $queryRaw } as never, [row('a', { thumbnail: null }), row('b', { thumbnail: null }), row('c')]);
    expect($queryRaw).toHaveBeenCalledTimes(1);
    const [strings, ids] = $queryRaw.mock.calls[0]!;
    expect((strings as string[]).join('?')).toContain('"images"[1]');
    expect(ids).toEqual(['a', 'b']);
    expect(out.map((r) => r.images)).toEqual([['https://res.cloudinary.com/x/a.jpg'], [], []]);
  });
});

/** Prisma giả ghi lại mọi tham số `product.findMany`/`findUnique`, trả thẻ đã chọn cột như DB thật. */
function fakePrisma(cards: ReturnType<typeof row>[], extra: Record<string, unknown> = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const findMany = jest.fn(async (args: Record<string, unknown>) => {
    calls.push({ fn: 'findMany', args });
    const sel = args.select as Record<string, unknown> | undefined;
    if (sel && !('variations' in sel)) return cards.map((c) => ({ id: c.id, soldApp: c.soldApp, soldExternal: c.soldExternal, categoryIds: ['C'], brandId: null }));
    return cards;
  });
  const findUnique = jest.fn(async (args: Record<string, unknown>) => {
    calls.push({ fn: 'findUnique', args });
    return { id: 'p0', brand: 'b' };
  });
  const prisma = {
    product: { findMany, findUnique, count: jest.fn().mockResolvedValue(cards.length) },
    orderItem: { findMany: jest.fn().mockResolvedValue([]) },
    brandFollow: { findMany: jest.fn().mockResolvedValue([{ brandId: 'b1' }]) },
    flashSaleItem: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    $queryRaw: jest.fn().mockResolvedValue([{ productId: 'a' }]),
    ...extra,
  } as unknown as PrismaService;
  return { prisma, calls };
}

/** Mọi lần đọc bảng products của đường khách: không `include` trần, `select` không có cột nặng. */
function expectLean(calls: { fn: string; args: Record<string, unknown> }[]) {
  expect(calls.length).toBeGreaterThan(0);
  for (const { args } of calls) {
    expect(args.include).toBeUndefined();
    const select = args.select as Record<string, unknown> | undefined;
    expect(select).toBeDefined();
    for (const col of ['description', 'ingredients', 'dealerPrices']) expect(select).not.toHaveProperty(col);
    expect(select).not.toHaveProperty('images');
  }
}

describe('đường thẻ sản phẩm của khách không đọc cột nặng (D2)', () => {
  const cards = [row('a'), row('b')];

  it.each([
    ['list mặc định', (s: CatalogService) => s.list({ page: 1, limit: 5 } as never)],
    ['list best_seller', (s: CatalogService) => s.list({ page: 1, limit: 5, sort: 'best_seller' } as never)],
    ['list lọc giá', (s: CatalogService) => s.list({ page: 1, limit: 5, minPrice: 1, maxPrice: 99999 } as never)],
    ['related', (s: CatalogService) => s.related('x')],
    ['boughtTogether', (s: CatalogService) => s.boughtTogether('x')],
    ['cardsByIds', (s: CatalogService) => s.cardsByIds(['a', 'b'])],
    ['getForYou', (s: CatalogService) => s.getForYou('u1')],
    ['getForYou fallback', (s: CatalogService) => s.getForYou('u1', { hasOrders: false })],
  ])('%s', async (_name, run) => {
    const { prisma, calls } = fakePrisma(cards);
    await run(new CatalogService(prisma));
    expectLean(calls);
  });

  it('wishlist.list', async () => {
    const { prisma, calls } = fakePrisma(cards, { wishlist: { findMany: jest.fn().mockResolvedValue([{ productId: 'a' }, { productId: 'b' }]) } });
    await new WishlistService(prisma).list('u1');
    expectLean(calls);
  });

  it('getForYou: bước một chỉ chọn cột xếp hạng, bước hai nạp thẻ cho đúng các món được chọn', async () => {
    const { prisma, calls } = fakePrisma(cards);
    await new CatalogService(prisma).getForYou('u1');
    const finds = calls.filter((c) => c.fn === 'findMany');
    expect(finds).toHaveLength(2);
    expect(finds[0]!.args.select).toEqual({ id: true, soldExternal: true, soldApp: true });
    expect(finds[0]!.args.take).toBe(200);
    expect(finds[1]!.args.select).toBe(CARD_PRODUCT_SELECT);
    expect((finds[1]!.args.where as { id: { in: string[] } }).id.in.sort()).toEqual(['a', 'b']);
  });

  it('hình dạng thẻ không đổi: đủ các trường cũ, ảnh đại diện base64 của hàng không thumbnail vẫn ra đường dẫn ảnh', async () => {
    const dataUrl = `data:image/png;base64,${'iVBORw0KGgo='}`;
    const { prisma } = fakePrisma([row('a'), row('np', { thumbnail: null })], {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'np', cover: dataUrl }]),
    });
    const out = await new CatalogService(prisma).cardsByIds(['a', 'np']);
    expect(Object.keys(out[0]!).sort()).toEqual(
      ['basePrice', 'brand', 'createdAt', 'fulfiller', 'id', 'inStock', 'isFeatured', 'isLoved', 'name', 'ratingAvg', 'repVariationId', 'reviewCount', 'salePrice', 'slug', 'sold', 'thumbnail'].sort(),
    );
    expect(out[0]!.thumbnail).toBe('/public-image/product/x/thumb?v=1');
    expect(out[1]!.thumbnail).toMatch(new RegExp(`^${PUBLIC_IMAGE_PREFIX}/product/np/0\\?v=[0-9a-f]{16}$`));
  });
});

describe('thẻ sản phẩm không mang số tồn ra ngoài (Smart Stock, tồn ảo 99.999.988)', () => {
  const virtual = [row('a', { variations: [{ id: 'a-v', sku: 'a-s', retailPrice: 1000, salePrice: null, stock: 99_999_988 }] }), row('b', { variations: [{ id: 'b-v', sku: 'b-s', retailPrice: 1000, salePrice: null, stock: 0 }] })];
  const noStock = (out: unknown) => {
    const json = JSON.stringify(out);
    expect(json).not.toContain('99999988');
    expect(json).not.toContain('"stock"');
    expect(json).not.toContain('"variations"');
  };

  it.each([
    ['list', (s: CatalogService) => s.list({ page: 1, limit: 5 } as never)],
    ['list best_seller', (s: CatalogService) => s.list({ page: 1, limit: 5, sort: 'best_seller' } as never)],
    ['related', (s: CatalogService) => s.related('x')],
    ['boughtTogether', (s: CatalogService) => s.boughtTogether('x')],
    ['cardsByIds', (s: CatalogService) => s.cardsByIds(['a', 'b'])],
    ['getForYou', (s: CatalogService) => s.getForYou('u1')],
  ])('%s: chỉ còn cờ inStock', async (_name, run) => {
    const { prisma } = fakePrisma(virtual);
    const out = await run(new CatalogService(prisma));
    noStock(out);
    const cards = (Array.isArray(out) ? out : (out as { data: { id: string; inStock: boolean }[] }).data) as { id: string; inStock: boolean }[];
    expect(cards.length).toBeGreaterThan(0);
    for (const c of cards) expect(c.inStock).toBe(c.id === 'a');
  });

  it('wishlist.list: chỉ còn cờ inStock', async () => {
    const { prisma } = fakePrisma(virtual, { wishlist: { findMany: jest.fn().mockResolvedValue([{ productId: 'a' }, { productId: 'b' }]) } });
    const out = await new WishlistService(prisma).list('u1');
    noStock(out);
    expect(out.map((c) => [c.id, c.inStock])).toEqual([['a', true], ['b', false]]);
  });

  it('cardInStock: còn hàng khi có ít nhất một phân loại tồn > 0; tồn 0, âm hay không có phân loại là hết', () => {
    expect(cardInStock([{ stock: 0 }, { stock: 1 }])).toBe(true);
    expect(cardInStock([{ stock: 99_999_988 }])).toBe(true);
    expect(cardInStock([{ stock: 0 }, { stock: -2 }])).toBe(false);
    expect(cardInStock([])).toBe(false);
  });
});

describe('giỏ hàng chỉ đọc cột giỏ cần', () => {
  it('select của dòng giỏ không có description, images, dealerPrices, affiliateRate', async () => {
    const findUnique = jest.fn().mockResolvedValue({ id: 'c1', couponCode: null, items: [] });
    const prisma = { cart: { findUnique }, user: { findUnique: jest.fn().mockResolvedValue(null) } } as unknown as PrismaService;
    const cfg = { get: async <T>(_k: string, fb?: T) => fb as T } as unknown as SystemConfigService;
    const combo = { computeWithGroups: jest.fn().mockResolvedValue({ total: 0, perLine: {}, groups: [] }) } as unknown as ComboService;
    const flash = { resolveEffective: jest.fn().mockResolvedValue(new Map()) } as unknown as FlashSaleService;
    const svc = new CartService(prisma, {} as CouponsService, cfg, flash, { record: jest.fn() } as unknown as AnalyticsEventsService, combo);
    await svc.getCartForCheckout('u1');
    const args = findUnique.mock.calls[0]![0] as { include: { items: { include?: unknown; select: { variation: { select: Record<string, unknown> & { product: { select: Record<string, unknown> } } } } } } };
    expect(args.include.items.include).toBeUndefined();
    const variation = args.include.items.select.variation.select;
    const product = variation.product.select;
    for (const col of HEAVY) {
      expect(variation).not.toHaveProperty(col);
      expect(product).not.toHaveProperty(col);
    }
    expect(product).toMatchObject({ name: true, slug: true, thumbnail: true, fulfilment: true, storefrontId: true, isActive: true, approvalStatus: true });
  });
});
