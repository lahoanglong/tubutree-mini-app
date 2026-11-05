import { CatalogController } from './catalog.controller';
import type { CatalogService } from './catalog.service';

/** R2-BUYERMINI-11 / R2-BUYERWEB-12: GET /products/:slug là @Public — chỉ trả các trường khách cần. */
describe('GET /products/:slug — chỉ trả trường công khai', () => {
  const row = {
    id: 'p1',
    slug: 'xa-phong',
    name: 'Xà phòng',
    brand: 'Shop A',
    brandId: 'brand-1',
    brandSlug: 'shop-a',
    shortDesc: null,
    description: 'Mô tả',
    images: ['a.jpg'],
    thumbnail: 'a.jpg',
    basePrice: 90_000,
    salePrice: null,
    certifications: [],
    ingredients: null,
    ratingAvg: 4.5,
    reviewCount: 2,
    metaTitle: null,
    metaDesc: null,
    fulfilment: 'MERCHANT',
    fulfiller: { kind: 'MERCHANT', name: 'Shop A', shippingFee: 30_000, freeShipFrom: null },
    partnerOwned: true,
    sold: 3,
    variations: [{ id: 'v1' }],
    reviews: [],
    approvalStatus: 'APPROVED',
    rejectReason: 'cũ',
    pancakeHold: null,
    pancakeLinkCode: 'PK-SECRET',
    nameSearch: 'xa phong',
    affiliateBlocked: false,
    soldApp: 1,
    soldExternal: 2,
    storefrontId: 'sf-1',
    categoryIds: ['c1'],
    forSegment: ['eco'],
    isActive: true,
  };

  it('bỏ mọi cột nội bộ (Pancake, duyệt, số bán tách nguồn, gian hàng), giữ đủ trường trang chi tiết dùng', async () => {
    const catalog = { getBySlug: jest.fn().mockResolvedValue(row) } as unknown as CatalogService;
    const res = (await new CatalogController(catalog).detail('xa-phong')) as Record<string, unknown>;
    for (const k of [
      'approvalStatus',
      'rejectReason',
      'pancakeHold',
      'pancakeLinkCode',
      'nameSearch',
      'affiliateBlocked',
      'soldApp',
      'soldExternal',
      'storefrontId',
      'brandId',
      'categoryIds',
      'forSegment',
      'isActive',
    ]) {
      expect(res).not.toHaveProperty(k);
    }
    expect(JSON.stringify(res)).not.toContain('PK-SECRET');
    expect(res).toMatchObject({
      id: 'p1',
      slug: 'xa-phong',
      name: 'Xà phòng',
      brand: 'Shop A',
      brandSlug: 'shop-a',
      basePrice: 90_000,
      ratingAvg: 4.5,
      reviewCount: 2,
      fulfilment: 'MERCHANT',
      fulfiller: row.fulfiller,
      partnerOwned: true,
      sold: 3,
      variations: [{ id: 'v1' }],
      reviews: [],
    });
  });
});

describe('GET /products/:slug — storyConfig', () => {
  const story = { version: 1, enabled: true, scenes: [] };
  const base = { id: 'p1', slug: 's', name: 'n', brand: 'b', description: 'd', images: [], basePrice: 1, variations: [], reviews: [] };

  it('trả storyConfig của sản phẩm cho trang chi tiết', async () => {
    const catalog = { getBySlug: jest.fn().mockResolvedValue({ ...base, storyConfig: story }) } as unknown as CatalogService;
    const res = (await new CatalogController(catalog).detail('s')) as Record<string, unknown>;
    expect(res.storyConfig).toEqual(story);
  });

  it('thẻ danh sách không mang storyConfig', async () => {
    const { CARD_SELECT } = await import('./card-select');
    expect(CARD_SELECT).not.toHaveProperty('storyConfig');
  });
});
