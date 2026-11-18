import type { PrismaService } from '../../prisma/prisma.service';
import type { MssFlagsService } from '../integrations/mss/mss-flags';
import { CatalogService } from './catalog.service';
import {
  EMPTY_MSS_PAYLOAD,
  effectiveCategoryIds,
  enrichedCategoryWhere,
  mergeCardOverride,
  mergeEnrichment,
  readStoredPayload,
  type MssEnrichmentPayload,
} from './mss-enrichment';

const MSS = 'https://mss.example.test/api/pub/media';

const tubu = () => ({
  id: 'p1',
  slug: 'nuoc-giat',
  brand: 'Fuwa3e',
  brandId: null,
  fulfilment: 'TUBU',
  name: 'Nước giặt Fuwa3e 2L',
  description: '<p>Mô tả Tubu</p>',
  shortDesc: null as string | null,
  images: ['https://content.pancake.vn/a.jpg', 'https://content.pancake.vn/b.jpg'],
  videos: [] as string[],
  thumbnail: null as string | null,
  categoryIds: ['cat-tubu'],
  tags: ['giat'],
  isActive: true,
  isFeatured: false,
  isCombo: false,
  ratingAvg: 4.5,
  reviewCount: 2,
  soldExternal: 3,
  soldApp: 4,
  basePrice: 195_000,
  salePrice: null,
  metaTitle: 'SEO Tubu' as string | null,
  metaDesc: null as string | null,
  forSegment: [],
  ingredients: [{ name: 'Enzyme', benefit: 'Theo bao bì' }] as unknown as MssJson,
  storyConfig: null,
  certifications: ['Tubu cert'],
  storefrontId: null,
  approvalStatus: 'APPROVED',
  createdAt: new Date('2026-11-01T00:00:00Z'),
  updatedAt: new Date('2026-11-02T00:00:00Z'),
  variations: [{ id: 'v1', sku: 'FW-2L', name: '2L', attributes: {}, isActive: true, retailPrice: 195_000, salePrice: null, stock: 14, weight: 2100, imageUrl: null }],
  brandRef: null,
  reviews: [],
  storefront: null,
});
type MssJson = Parameters<typeof mergeEnrichment>[0]['ingredients'];

const fullPayload = (): MssEnrichmentPayload => ({
  v: 1,
  title: 'Nước giặt sinh học Fuwa3e hương bồ hòn',
  shortDesc: 'Giặt sạch, an toàn cho da.',
  descriptionHtml: '<p>Mô tả <strong>MSS</strong></p>',
  images: [
    { url: `${MSS}/var000001.webp`, alt: null, w: null, h: null, variationId: 'pv1' },
    { url: `${MSS}/cover00001.webp`, alt: 'Chai', w: 1600, h: 1600, variationId: null },
  ],
  videos: [{ url: `${MSS}/video00001.mp4`, posterUrl: null, durationS: 42 }],
  ingredients: [
    { name: 'Enzyme dứa', note: 'Lên men' },
    { name: 'Bồ hòn', note: null },
  ],
  certifications: ['Không thử trên động vật'],
  metaTitle: 'SEO MSS',
  metaDesc: '',
  categoryIds: ['cat-mss'],
});

describe('mergeEnrichment: ghép từng trường', () => {
  it('giá trị MSS khác null thắng; ảnh chung trước ảnh biến thể; ảnh đại diện = ảnh đầu; note thành benefit', () => {
    const out = mergeEnrichment(tubu(), fullPayload());
    expect(out).toMatchObject({
      name: 'Nước giặt sinh học Fuwa3e hương bồ hòn',
      shortDesc: 'Giặt sạch, an toàn cho da.',
      description: '<p>Mô tả <strong>MSS</strong></p>',
      images: [`${MSS}/cover00001.webp`, `${MSS}/var000001.webp`],
      thumbnail: `${MSS}/cover00001.webp`,
      videos: [`${MSS}/video00001.mp4`],
      ingredients: [{ name: 'Enzyme dứa', benefit: 'Lên men' }, { name: 'Bồ hòn' }],
      certifications: ['Không thử trên động vật'],
      metaTitle: 'SEO MSS',
      metaDesc: '',
      categoryIds: ['cat-mss'],
    });
    // Giá, tồn, slug, nhãn, biến thể không bao giờ do MSS quyết.
    expect(out).toMatchObject({ basePrice: 195_000, slug: 'nuoc-giat', brand: 'Fuwa3e', variations: tubu().variations, tags: ['giat'] });
  });

  it('payload toàn null: đầu ra giống hệt Tubu', () => {
    expect(mergeEnrichment(tubu(), EMPTY_MSS_PAYLOAD)).toEqual(tubu());
  });

  it('chỉ một trường có giá trị: chỉ trường đó đổi', () => {
    const out = mergeEnrichment(tubu(), { ...EMPTY_MSS_PAYLOAD, shortDesc: 'Chỉ mô tả ngắn' });
    expect(out).toEqual({ ...tubu(), shortDesc: 'Chỉ mô tả ngắn' });
  });

  it('mảng rỗng là cố ý để trống: không ảnh, không video, không thành phần, không danh mục; tựa rỗng thì giữ tên Tubu', () => {
    const out = mergeEnrichment(tubu(), {
      ...EMPTY_MSS_PAYLOAD,
      title: '',
      images: [],
      videos: [],
      ingredients: [],
      certifications: [],
      categoryIds: [],
    });
    expect(out).toMatchObject({ images: [], thumbnail: null, videos: [], ingredients: [], certifications: [], categoryIds: [] });
    expect(out.name).toBe(tubu().name);
  });

  it('thẻ: tên và ảnh đại diện; MSS cố ý không ảnh thì thẻ không rơi về ảnh Pancake', () => {
    const row = { id: 'p1', name: 'Tubu', thumbnail: 'https://content.pancake.vn/a.jpg' as string | null, images: ['https://content.pancake.vn/a.jpg'] };
    expect(mergeCardOverride(row, { title: 'MSS', imagesOverride: true, coverImage: `${MSS}/c0000001.webp` })).toEqual({
      id: 'p1',
      name: 'MSS',
      thumbnail: `${MSS}/c0000001.webp`,
      images: [`${MSS}/c0000001.webp`],
    });
    expect(mergeCardOverride(row, { title: null, imagesOverride: true, coverImage: null })).toEqual({ id: 'p1', name: 'Tubu', thumbnail: null, images: [] });
    expect(mergeCardOverride(row, { title: null, imagesOverride: false, coverImage: null })).toEqual(row);
  });

  it('readStoredPayload: dòng hỏng hoặc phiên bản lạ thành không có ý kiến; trường sai kiểu thành null', () => {
    expect(readStoredPayload(null)).toEqual(EMPTY_MSS_PAYLOAD);
    expect(readStoredPayload('x')).toEqual(EMPTY_MSS_PAYLOAD);
    expect(readStoredPayload({ v: 2, title: 'x' })).toEqual(EMPTY_MSS_PAYLOAD);
    expect(readStoredPayload({ v: 1, title: 5, images: 'x', certifications: ['a', 3] })).toMatchObject({ title: null, images: null, certifications: ['a'] });
    expect(readStoredPayload(JSON.parse(JSON.stringify(fullPayload())))).toEqual(fullPayload());
  });

  it('câu chuyện xanh MSS thay câu chuyện Tubu; không gửi hoặc MSS tắt thì giữ của Tubu; dòng đã lưu hỏng khung thì coi như không có ý kiến', () => {
    const storyConfig = { version: 1 as const, enabled: true, scenes: [{ kind: 'variant_arc' as const, items: [{ variationId: 'v1', label: '2L', ambient: 'leaf' as const }] }] };
    expect(mergeEnrichment(tubu(), { ...EMPTY_MSS_PAYLOAD, storyConfig }).storyConfig).toEqual(storyConfig);
    expect(mergeEnrichment({ ...tubu(), storyConfig: { version: 1, enabled: false, scenes: [] } }, EMPTY_MSS_PAYLOAD).storyConfig).toEqual({ version: 1, enabled: false, scenes: [] });
    const admin = { version: 1 as const, enabled: true, scenes: [] };
    expect(mergeEnrichment({ ...tubu(), storyConfig: admin }, { ...EMPTY_MSS_PAYLOAD, storyConfig: { ...storyConfig, enabled: false } }).storyConfig).toEqual(admin);
    expect(readStoredPayload({ v: 1, storyConfig }).storyConfig).toEqual(storyConfig);
    expect('storyConfig' in readStoredPayload({ v: 1, storyConfig: { version: 9 } })).toBe(false);
  });

  it('danh mục hiệu lực và điều kiện lọc khi cờ bật', () => {
    expect(effectiveCategoryIds({ categoryIds: ['a'], mssEnrichment: { state: 'published', categoryOverride: true, categoryIds: ['b'] } })).toEqual(['b']);
    expect(effectiveCategoryIds({ categoryIds: ['a'], mssEnrichment: { state: 'unpublished', categoryOverride: true, categoryIds: ['b'] } })).toEqual(['a']);
    expect(effectiveCategoryIds({ categoryIds: ['a'], mssEnrichment: { state: 'published', categoryOverride: false, categoryIds: [] } })).toEqual(['a']);
    expect(effectiveCategoryIds({ categoryIds: ['a'], mssEnrichment: null })).toEqual(['a']);
    expect(enrichedCategoryWhere({ has: 'x' })).toEqual({
      OR: [
        { categoryIds: { has: 'x' }, NOT: { mssEnrichment: { is: { state: 'published', categoryOverride: true } } } },
        { mssEnrichment: { is: { state: 'published', categoryOverride: true, categoryIds: { has: 'x' } } } },
      ],
    });
  });
});

describe('CatalogService + nội dung MSS', () => {
  const flags = (on: boolean) => ({ isEnabled: jest.fn(async () => on) }) as unknown as MssFlagsService;

  function prismaWith(row: { state: string; payload: unknown } | null, cardRows: unknown[] = []) {
    const enrichFindUnique = jest.fn().mockResolvedValue(row);
    const enrichFindMany = jest.fn().mockResolvedValue(cardRows);
    const prisma = {
      product: {
        findUnique: jest.fn().mockResolvedValue(tubu()),
        findMany: jest.fn().mockResolvedValue([
          { ...tubu(), id: 'p1', slug: 'a' },
          { ...tubu(), id: 'p2', slug: 'b', name: 'Khác', thumbnail: 'https://content.pancake.vn/x.jpg' },
        ]),
      },
      productMssEnrichment: { findUnique: enrichFindUnique, findMany: enrichFindMany },
    } as unknown as PrismaService;
    return { prisma, enrichFindUnique, enrichFindMany };
  }

  describe('cờ tắt: đầu ra API giống hệt trước wave (so chuỗi JSON), bảng mới không được đọc', () => {
    it('getBySlug', async () => {
      const before = await new CatalogService(prismaWith(null).prisma).getBySlug('nuoc-giat');
      const m = prismaWith({ state: 'published', payload: fullPayload() });
      const after = await new CatalogService(m.prisma, undefined, flags(false)).getBySlug('nuoc-giat');
      expect(JSON.stringify(after)).toBe(JSON.stringify(before));
      expect(m.enrichFindUnique).not.toHaveBeenCalled();
    });

    it('thẻ (cardsByIds)', async () => {
      const before = await new CatalogService(prismaWith(null).prisma).cardsByIds(['p1', 'p2']);
      const m = prismaWith(null, [{ productId: 'p1', title: 'MSS', imagesOverride: true, coverImage: `${MSS}/c0000001.webp` }]);
      const after = await new CatalogService(m.prisma, undefined, flags(false)).cardsByIds(['p1', 'p2']);
      expect(JSON.stringify(after)).toBe(JSON.stringify(before));
      expect(m.enrichFindMany).not.toHaveBeenCalled();
    });

    it('đọc cờ lỗi: coi như tắt', async () => {
      const before = await new CatalogService(prismaWith(null).prisma).getBySlug('nuoc-giat');
      const broken = { isEnabled: jest.fn().mockRejectedValue(new Error('redis down')) } as unknown as MssFlagsService;
      const m = prismaWith({ state: 'published', payload: fullPayload() });
      expect(JSON.stringify(await new CatalogService(m.prisma, undefined, broken).getBySlug('nuoc-giat'))).toBe(JSON.stringify(before));
      expect(m.enrichFindUnique).not.toHaveBeenCalled();
    });

    it('cờ bật nhưng sản phẩm chưa có dòng bổ sung (hoặc dòng chưa xuất bản): PDP như cũ', async () => {
      const before = await new CatalogService(prismaWith(null).prisma).getBySlug('nuoc-giat');
      for (const row of [null, { state: 'unpublished', payload: fullPayload() }, { state: 'removed', payload: fullPayload() }]) {
        const after = await new CatalogService(prismaWith(row).prisma, undefined, flags(true)).getBySlug('nuoc-giat');
        expect(JSON.stringify(after)).toBe(JSON.stringify(before));
      }
    });
  });

  it('cờ bật: PDP ghép nội dung đã xuất bản, giá/tồn/biến thể vẫn của Tubu', async () => {
    const r = await new CatalogService(prismaWith({ state: 'published', payload: fullPayload() }).prisma, undefined, flags(true)).getBySlug('nuoc-giat');
    expect(r).toMatchObject({
      name: 'Nước giặt sinh học Fuwa3e hương bồ hòn',
      description: '<p>Mô tả <strong>MSS</strong></p>',
      images: [`${MSS}/cover00001.webp`, `${MSS}/var000001.webp`],
      thumbnail: `${MSS}/cover00001.webp`,
      videos: [`${MSS}/video00001.mp4`],
      categoryIds: ['cat-mss'],
      basePrice: 195_000,
      sold: 7,
    });
    expect(r.variations).toEqual([expect.objectContaining({ id: 'v1', retailPrice: 195_000, stock: 14 })]);
  });

  it('cờ bật: đọc bảng mới lỗi thì phục vụ nội dung Tubu, không làm hỏng PDP', async () => {
    const m = prismaWith(null);
    m.enrichFindUnique.mockRejectedValue(new Error('relation does not exist'));
    const r = await new CatalogService(m.prisma, undefined, flags(true)).getBySlug('nuoc-giat');
    expect(r.name).toBe('Nước giặt Fuwa3e 2L');
  });

  it('bản nháp truyền thẳng (trang xem trước) thắng mà không đọc bảng, kể cả khi cờ tắt', async () => {
    const m = prismaWith(null);
    const r = await new CatalogService(m.prisma, undefined, flags(false)).getBySlug('nuoc-giat', { enrichment: { ...EMPTY_MSS_PAYLOAD, title: 'Bản nháp' } });
    expect(r.name).toBe('Bản nháp');
    expect(m.enrichFindUnique).not.toHaveBeenCalled();
  });

  it('cờ bật: thẻ dùng tên và ảnh đại diện MSS bằng một truy vấn theo lô', async () => {
    const m = prismaWith(null, [{ productId: 'p1', title: 'Tên MSS', imagesOverride: true, coverImage: `${MSS}/c0000001.webp` }]);
    const cards = await new CatalogService(m.prisma, undefined, flags(true)).cardsByIds(['p1', 'p2']);
    expect(cards.map((c) => [c.id, c.name, c.thumbnail])).toEqual([
      ['p1', 'Tên MSS', `${MSS}/c0000001.webp`],
      ['p2', 'Khác', 'https://content.pancake.vn/x.jpg'],
    ]);
    expect(m.enrichFindMany).toHaveBeenCalledTimes(1);
    expect(m.enrichFindMany.mock.calls[0][0].where).toEqual({ productId: { in: ['p1', 'p2'] }, state: 'published' });
  });

  describe('lọc và đếm danh mục', () => {
    function listSetup(on: boolean) {
      const findMany = jest.fn(async (args: { select?: Record<string, unknown> }) =>
        args.select && 'mssEnrichment' in args.select
          ? [
              { categoryIds: ['tubu-a'], mssEnrichment: { state: 'published', categoryOverride: true, categoryIds: ['mss-b'] } },
              { categoryIds: ['tubu-a'], mssEnrichment: null },
            ]
          : args.select && Object.keys(args.select).join() === 'categoryIds'
            ? [{ categoryIds: ['tubu-a'] }, { categoryIds: ['tubu-a'] }]
            : [],
      );
      const prisma = {
        product: { findMany, count: jest.fn().mockResolvedValue(0) },
        category: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'tubu-a', parentId: null, sortOrder: 0 },
            { id: 'mss-b', parentId: null, sortOrder: 1 },
          ]),
        },
        productMssEnrichment: { findMany: jest.fn().mockResolvedValue([]) },
        $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
      } as unknown as PrismaService;
      return { svc: new CatalogService(prisma, undefined, flags(on)), findMany };
    }
    type FindArgs = { where?: Record<string, unknown> };

    it('cờ tắt: đếm theo danh mục Tubu, lọc bằng cột categoryIds như cũ', async () => {
      const { svc, findMany } = listSetup(false);
      expect((await svc.categoriesFlat()).map((c) => [c.id, c.productCount])).toEqual([
        ['tubu-a', 2],
        ['mss-b', 0],
      ]);
      await svc.list({ page: 1, limit: 20, category: 'tubu-a' });
      const where = (findMany.mock.calls.map((c) => c[0]) as FindArgs[]).find((a) => a.where && 'categoryIds' in a.where)?.where;
      expect(where?.categoryIds).toEqual({ has: 'tubu-a' });
      expect(JSON.stringify(findMany.mock.calls)).not.toContain('mssEnrichment');
    });

    it('cờ bật: đếm theo danh mục hiệu lực; lọc xét danh mục MSS khi có, không thì danh mục Tubu', async () => {
      const { svc, findMany } = listSetup(true);
      expect((await svc.categoriesFlat()).map((c) => [c.id, c.productCount])).toEqual([
        ['tubu-a', 1],
        ['mss-b', 1],
      ]);
      await svc.list({ page: 1, limit: 20, category: 'mss-b' });
      const where = (findMany.mock.calls.map((c) => c[0]) as FindArgs[]).find((a) => Array.isArray(a.where?.AND))?.where;
      expect(where?.categoryIds).toBeUndefined();
      expect(where?.AND).toContainEqual(enrichedCategoryWhere({ has: 'mss-b' }));
    });
  });
});
