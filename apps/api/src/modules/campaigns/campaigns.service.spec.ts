import { NotFoundException } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import { liveWhere } from './campaign-public';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const NOW = new Date('2026-11-05T05:00:00Z');

const coupon = (over: Record<string, unknown> = {}) => ({
  code: 'THU10',
  type: 'PERCENT',
  value: 10,
  minOrder: 100_000,
  maxDiscount: 30_000,
  isActive: true,
  scope: 'PUBLIC',
  batch: null,
  usageLimit: null,
  usedCount: 0,
  startAt: new Date('2026-11-01T00:00:00Z'),
  endAt: new Date('2026-11-30T00:00:00Z'),
  ...over,
});
const link = (c: ReturnType<typeof coupon>, sortOrder = 0) => ({ sortOrder, coupon: c });

const campaign = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  slug: 'giua-thu',
  title: 'Giữa Thu',
  subtitle: 'Giảm sâu',
  placement: 'HOME_TOP',
  image: 'https://cdn.example.com/a.jpg',
  linkType: 'CAMPAIGN_PAGE',
  linkValue: null,
  audience: 'ALL',
  startAt: new Date('2026-11-01T00:00:00Z'),
  endAt: new Date('2026-11-11T16:59:59Z'),
  coupons: [],
  ...over,
});

function setup(opts: { campaign?: unknown; productIds?: string[]; cards?: { id: string }[] } = {}) {
  const prisma = {
    campaign: { findFirst: jest.fn().mockResolvedValue(opts.campaign === undefined ? campaign() : opts.campaign), findMany: jest.fn().mockResolvedValue([]) },
    campaignProduct: {
      count: jest.fn().mockResolvedValue(opts.productIds?.length ?? 0),
      findMany: jest.fn().mockResolvedValue((opts.productIds ?? []).map((productId) => ({ productId }))),
    },
  };
  const catalog = { cardsByIds: jest.fn().mockResolvedValue(opts.cards ?? []) };
  return { svc: new CampaignsService(prisma as never, catalog as never), prisma, catalog };
}

describe('CampaignsService.listPublic', () => {
  it('đọc banner đang chạy của đúng vị trí và loại khách', async () => {
    const { svc, prisma } = setup();
    await svc.listPublic('OFFERS_TOP', 'NEW');
    expect(prisma.campaign.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ placement: 'OFFERS_TOP', isActive: true, audience: { in: ['ALL', 'NEW'] } }) }));
  });
});

describe('CampaignsService.getPublic', () => {
  it('không có / đã tắt / chưa tới giờ / hết hạn: 404, điều kiện nằm trong truy vấn (không lộ bản nháp)', async () => {
    const { svc, prisma } = setup({ campaign: null });
    await expect(svc.getPublic('khong-co', NOW)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.campaign.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { slug: 'khong-co', ...liveWhere(NOW) } }));
  });

  it('trả chi tiết: ảnh base64 thành đường dẫn công khai, số sản phẩm công khai, ngày ISO', async () => {
    const { svc, prisma } = setup({ campaign: campaign({ image: PNG }), productIds: ['p1', 'p2', 'p3'] });
    const d = await svc.getPublic('giua-thu', NOW);
    expect(d).toMatchObject({ id: 'c1', slug: 'giua-thu', title: 'Giữa Thu', subtitle: 'Giảm sâu', productCount: 3, coupons: [], endAt: '2026-11-11T16:59:59.000Z' });
    expect(d.image).toMatch(/^\/public-image\/campaign\/c1\/cover\?v=/);
    expect(prisma.campaignProduct.count).toHaveBeenCalledWith({ where: { campaignId: 'c1', product: { isActive: true, approvalStatus: 'APPROVED' } } });
  });

  it('ảnh hỏng: vẫn trả trang (image null) để khách xem sản phẩm và mã', async () => {
    const { svc } = setup({ campaign: campaign({ image: 'data:image/svg+xml;base64,PHN2Zz4=' }) });
    expect((await svc.getPublic('giua-thu', NOW)).image).toBeNull();
  });

  it('mã gắn kèm: chỉ mã bật, trong hạn, scope PUBLIC/CLAIM, không thuộc lô thẻ in, còn lượt; thứ tự do truy vấn theo sortOrder', async () => {
    const coupons = [
      link(coupon({ code: 'OK1', scope: 'CLAIM' }), 1),
      link(coupon({ code: 'OK2' }), 2),
      link(coupon({ code: 'TAT', isActive: false })),
      link(coupon({ code: 'HANG', scope: 'TIER' })),
      link(coupon({ code: 'IN', batch: 'lo-1' })),
      link(coupon({ code: 'CU', endAt: new Date('2026-11-04T00:00:00Z') })),
      link(coupon({ code: 'CHUA', startAt: new Date('2026-11-06T00:00:00Z') })),
      link(coupon({ code: 'HET', usageLimit: 5, usedCount: 5 })),
      link(coupon({ code: 'CON', usageLimit: 5, usedCount: 4 }), 3),
    ];
    const { svc, prisma } = setup({ campaign: campaign({ coupons }) });
    const d = await svc.getPublic('giua-thu', NOW);
    expect(prisma.campaign.findFirst).toHaveBeenCalledWith(expect.objectContaining({ include: { coupons: { orderBy: [{ sortOrder: 'asc' }, { couponId: 'asc' }], include: { coupon: true } } } }));
    expect(d.coupons.map((c) => c.code)).toEqual(['OK1', 'OK2', 'CON']);
    expect(d.coupons[0]).toEqual({ code: 'OK1', type: 'PERCENT', value: 10, minOrder: 100_000, maxDiscount: 30_000, endAt: '2026-11-30T00:00:00.000Z' });
  });
});

describe('CampaignsService.getProducts', () => {
  it('chiến dịch không còn: 404 và không đọc sản phẩm', async () => {
    const { svc, prisma, catalog } = setup({ campaign: null });
    await expect(svc.getProducts('x', 1, 20, NOW)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.campaignProduct.findMany).not.toHaveBeenCalled();
    expect(catalog.cardsByIds).not.toHaveBeenCalled();
  });

  it('phân trang theo thứ tự đã xếp: trang 2 (2 món/trang) của 5 món lấy món thứ 3 và 4, tổng = số món công khai', async () => {
    const { svc, prisma, catalog } = setup({ productIds: ['a', 'b', 'c', 'd', 'e'], cards: [{ id: 'c' }, { id: 'd' }] });
    const r = await svc.getProducts('giua-thu', 2, 2, NOW);
    expect(prisma.campaignProduct.findMany).toHaveBeenCalledWith({
      where: { campaignId: 'c1', product: { isActive: true, approvalStatus: 'APPROVED' } },
      orderBy: [{ sortOrder: 'asc' }, { productId: 'asc' }],
      select: { productId: true },
    });
    expect(catalog.cardsByIds).toHaveBeenCalledWith(['c', 'd']);
    expect(r).toEqual({ data: [{ id: 'c' }, { id: 'd' }], meta: { page: 2, limit: 2, total: 5 } });
  });

  it('trang vượt cuối: danh sách rỗng, vẫn trả tổng', async () => {
    const { svc } = setup({ productIds: ['a'], cards: [] });
    expect(await svc.getProducts('giua-thu', 3, 20, NOW)).toEqual({ data: [], meta: { page: 3, limit: 20, total: 1 } });
  });
});
