import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CampaignsAdminService } from './campaigns-admin.service';

const NOW = new Date('2026-11-05T05:00:00Z');
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  slug: 'giua-thu',
  title: 'Giữa Thu',
  subtitle: null,
  placement: 'HOME_TOP',
  image: PNG,
  linkType: 'CAMPAIGN_PAGE',
  linkValue: null,
  audience: 'ALL',
  startAt: new Date('2026-11-01T00:00:00Z'),
  endAt: new Date('2026-11-11T16:59:59Z'),
  sortOrder: 0,
  isActive: true,
  createdAt: new Date('2026-10-30T00:00:00Z'),
  updatedAt: new Date('2026-10-30T00:00:00Z'),
  ...over,
});

const input = (over: Record<string, unknown> = {}) => ({
  title: 'Chiến dịch Giữa Thu',
  placement: 'HOME_TOP' as const,
  image: 'https://cdn.example.com/a.jpg',
  startAt: '2026-11-01T00:00:00.000Z',
  endAt: '2026-11-11T16:59:59.000Z',
  ...over,
});

function setup(opts: { existing?: unknown; slugTaken?: boolean; products?: { id: string }[]; coupons?: unknown[] } = {}) {
  const prisma = {
    campaign: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockImplementation(({ where }: { where: { slug?: string; id?: string } }) => {
        if (where.slug !== undefined) return Promise.resolve(opts.slugTaken ? row({ id: 'other' }) : null);
        return Promise.resolve(opts.existing === undefined ? row() : opts.existing);
      }),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve(row({ id: 'new', ...data, products: [], coupons: [] }))),
      update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve(row({ ...data, products: [], coupons: [] }))),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    campaignProduct: { deleteMany: jest.fn().mockReturnValue('del-p'), createMany: jest.fn().mockReturnValue('add-p') },
    campaignCoupon: { deleteMany: jest.fn().mockReturnValue('del-c'), createMany: jest.fn().mockReturnValue('add-c') },
    product: { findMany: jest.fn().mockResolvedValue(opts.products ?? []) },
    coupon: { findMany: jest.fn().mockResolvedValue(opts.coupons ?? []) },
    $transaction: jest.fn().mockResolvedValue([]),
  };
  return { svc: new CampaignsAdminService(prisma as never), prisma };
}

describe('CampaignsAdminService.list', () => {
  it('lọc theo vị trí, đếm sản phẩm và mã, và tính trạng thái ở bốn ca', async () => {
    const { svc, prisma } = setup();
    prisma.campaign.findMany.mockResolvedValue([
      { ...row({ id: 'a' }), _count: { products: 3, coupons: 1 } },
      { ...row({ id: 'b', isActive: false }), _count: { products: 0, coupons: 0 } },
      { ...row({ id: 'c', startAt: new Date('2026-11-06T00:00:00Z') }), _count: { products: 0, coupons: 0 } },
      { ...row({ id: 'd', endAt: NOW }), _count: { products: 0, coupons: 0 } },
    ]);
    const rows = await svc.list('OFFERS_TOP', NOW);
    expect(prisma.campaign.findMany.mock.calls[0][0].where).toEqual({ placement: 'OFFERS_TOP' });
    expect(rows.map((r) => [r.id, r.status])).toEqual([['a', 'live'], ['b', 'off'], ['c', 'scheduled'], ['d', 'ended']]);
    expect(rows[0]).toMatchObject({ productCount: 3, couponCount: 1 });
  });

  it('ảnh base64 ra thành tham chiếu /public-image, không nhúng cả ảnh vào danh sách', async () => {
    const { svc, prisma } = setup();
    prisma.campaign.findMany.mockResolvedValue([{ ...row(), _count: { products: 0, coupons: 0 } }]);
    const [first] = await svc.list(undefined, NOW);
    expect(first?.image).toMatch(/^\/public-image\/campaign\/c1\/cover\?v=/);
    expect(prisma.campaign.findMany.mock.calls[0][0].where).toEqual({});
  });
});

describe('CampaignsAdminService.get', () => {
  it('trả ảnh nguyên bản, sản phẩm {id,name,slug} và mã theo thứ tự', async () => {
    const { svc, prisma } = setup();
    prisma.campaign.findUnique.mockResolvedValue({
      ...row(),
      products: [{ product: { id: 'p1', name: 'Trà', slug: 'tra' } }],
      coupons: [{ coupon: { code: 'THU10' } }],
    });
    const out = await svc.get('c1', NOW);
    expect(out.image).toBe(PNG);
    expect(out.products).toEqual([{ id: 'p1', name: 'Trà', slug: 'tra' }]);
    expect(out.couponCodes).toEqual(['THU10']);
    expect(out.status).toBe('live');
  });

  it('không có → 404', async () => {
    const { svc } = setup({ existing: null });
    await expect(svc.get('x', NOW)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('CampaignsAdminService.create', () => {
  it('sinh slug không dấu từ tiêu đề', async () => {
    const { svc, prisma } = setup();
    await svc.create(input(), NOW);
    expect(prisma.campaign.create.mock.calls[0][0].data.slug).toBe('chien-dich-giua-thu');
  });

  it('dùng slug admin nhập; trùng slug → 409 và không tạo', async () => {
    const { svc, prisma } = setup({ slugTaken: true });
    await expect(svc.create(input({ slug: 'giua-thu' }), NOW)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.campaign.create).not.toHaveBeenCalled();
  });

  it('hai người tạo cùng lúc: va unique lúc ghi cũng ra 409', async () => {
    const { svc, prisma } = setup();
    prisma.campaign.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }));
    await expect(svc.create(input(), NOW)).rejects.toBeInstanceOf(ConflictException);
  });

  it('endAt <= startAt → 400 và không chạm DB', async () => {
    const { svc, prisma } = setup();
    await expect(svc.create(input({ endAt: '2026-11-01T00:00:00.000Z' }), NOW)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.campaign.findUnique).not.toHaveBeenCalled();
    expect(prisma.campaign.create).not.toHaveBeenCalled();
  });

  it('mặc định: CAMPAIGN_PAGE, ALL, thứ tự 0, bật; linkValue của CAMPAIGN_PAGE bị bỏ', async () => {
    const { svc, prisma } = setup();
    await svc.create(input({ linkValue: 'bat-ky' }), NOW);
    expect(prisma.campaign.create.mock.calls[0][0].data).toMatchObject({ linkType: 'CAMPAIGN_PAGE', linkValue: null, audience: 'ALL', sortOrder: 0, isActive: true });
  });

  it('URL_INTERNAL ngoài app → 400', async () => {
    const { svc } = setup();
    await expect(svc.create(input({ linkType: 'URL_INTERNAL', linkValue: '//evil.com' }), NOW)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('CampaignsAdminService.update', () => {
  it('tắt/bật chỉ gửi đúng trường isActive', async () => {
    const { svc, prisma } = setup();
    await svc.update('c1', { isActive: false }, NOW);
    expect(prisma.campaign.update.mock.calls[0][0].data).toEqual({ isActive: false });
  });

  it('đổi một mốc: kiểm cửa sổ trên giá trị đã gộp với bản đang lưu', async () => {
    const { svc, prisma } = setup();
    await expect(svc.update('c1', { endAt: '2026-10-31T00:00:00.000Z' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.campaign.update).not.toHaveBeenCalled();
  });

  it('subtitle rỗng hoặc null xoá phụ đề', async () => {
    const { svc, prisma } = setup();
    await svc.update('c1', { subtitle: null }, NOW);
    await svc.update('c1', { subtitle: '' }, NOW);
    expect(prisma.campaign.update.mock.calls.map((c) => c[0].data.subtitle)).toEqual([null, null]);
  });

  it('đổi sang CAMPAIGN_PAGE xoá linkValue đang lưu', async () => {
    const { svc, prisma } = setup({ existing: row({ linkType: 'URL_INTERNAL', linkValue: '/offers' }) });
    await svc.update('c1', { linkType: 'CAMPAIGN_PAGE' }, NOW);
    expect(prisma.campaign.update.mock.calls[0][0].data).toMatchObject({ linkType: 'CAMPAIGN_PAGE', linkValue: null });
  });

  it('chỉ đổi linkValue vẫn kiểm theo linkType đang lưu', async () => {
    const { svc } = setup({ existing: row({ linkType: 'URL_INTERNAL', linkValue: '/offers' }) });
    await expect(svc.update('c1', { linkValue: 'https://x' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('không có → 404', async () => {
    const { svc } = setup({ existing: null });
    await expect(svc.update('x', { isActive: true }, NOW)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('CampaignsAdminService.remove', () => {
  it('xoá được; không có → 404', async () => {
    const { svc, prisma } = setup();
    await expect(svc.remove('c1')).resolves.toEqual({ ok: true });
    prisma.campaign.deleteMany.mockResolvedValue({ count: 0 });
    await expect(svc.remove('c1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('CampaignsAdminService.setProducts', () => {
  it('thay hết trong một giao dịch, sortOrder = chỉ số, bỏ id trùng', async () => {
    const { svc, prisma } = setup({ products: [{ id: 'p1' }, { id: 'p2' }] });
    await expect(svc.setProducts('c1', ['p2', 'p1', 'p2'])).resolves.toEqual({ count: 2 });
    expect(prisma.campaignProduct.createMany.mock.calls[0][0].data).toEqual([
      { campaignId: 'c1', productId: 'p2', sortOrder: 0 },
      { campaignId: 'c1', productId: 'p1', sortOrder: 1 },
    ]);
    expect(prisma.$transaction).toHaveBeenCalledWith(['del-p', 'add-p']);
  });

  it('danh sách rỗng gỡ hết, không gọi createMany với mảng rỗng', async () => {
    const { svc, prisma } = setup();
    await expect(svc.setProducts('c1', [])).resolves.toEqual({ count: 0 });
    expect(prisma.campaignProduct.createMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledWith(['del-p']);
  });

  it('quá 200 → 400, không chạm DB', async () => {
    const { svc, prisma } = setup();
    await expect(svc.setProducts('c1', Array.from({ length: 201 }, (_, i) => `p${i}`))).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('id lạ → 400 nêu id đó, chiến dịch không có → 404', async () => {
    const { svc } = setup({ products: [{ id: 'p1' }] });
    await expect(svc.setProducts('c1', ['p1', 'zzz'])).rejects.toThrow(/zzz/);
    const none = setup({ existing: null });
    await expect(none.svc.setProducts('x', ['p1'])).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('CampaignsAdminService.setCoupons', () => {
  const coupon = (over: Record<string, unknown> = {}) => ({ id: 'k1', code: 'THU10', scope: 'PUBLIC', batch: null, ...over });

  it('chuẩn hoá mã (hoa, bỏ khoảng trắng), thay hết, sortOrder = chỉ số', async () => {
    const { svc, prisma } = setup({ coupons: [coupon(), coupon({ id: 'k2', code: 'CLAIMX', scope: 'CLAIM' })] });
    await expect(svc.setCoupons('c1', [' thu10 ', 'claimx', 'THU10'])).resolves.toEqual({ count: 2 });
    expect(prisma.coupon.findMany.mock.calls[0][0].where).toEqual({ code: { in: ['THU10', 'CLAIMX'] } });
    expect(prisma.campaignCoupon.createMany.mock.calls[0][0].data).toEqual([
      { campaignId: 'c1', couponId: 'k1', sortOrder: 0 },
      { campaignId: 'c1', couponId: 'k2', sortOrder: 1 },
    ]);
  });

  it('mã thuộc lô thẻ in bị từ chối, nêu tên mã', async () => {
    const { svc } = setup({ coupons: [coupon({ code: 'TH-ABC', batch: 'TH' })] });
    await expect(svc.setCoupons('c1', ['TH-ABC'])).rejects.toThrow(/TH-ABC/);
  });

  it('mã scope TIER bị từ chối, nêu tên mã', async () => {
    const { svc, prisma } = setup({ coupons: [coupon({ code: 'VANG', scope: 'TIER' })] });
    await expect(svc.setCoupons('c1', ['VANG'])).rejects.toThrow(/VANG/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('mã không tồn tại → 400 nêu mã; quá 10 mã → 400', async () => {
    const { svc } = setup({ coupons: [] });
    await expect(svc.setCoupons('c1', ['KHONGCO'])).rejects.toThrow(/KHONGCO/);
    await expect(svc.setCoupons('c1', Array.from({ length: 11 }, (_, i) => `M${i}`))).rejects.toBeInstanceOf(BadRequestException);
  });
});
