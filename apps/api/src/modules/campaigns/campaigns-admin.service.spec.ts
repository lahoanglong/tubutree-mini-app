import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CAMPAIGN_ENTITY_SLUG_MAX } from '@tubutree/shared-types';
import { ImageRegistryStale } from '../catalog/image-registry-stale';
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
  isActive: false,
  placement: 'HOME_TOP' as const,
  image: 'https://cdn.example.com/a.jpg',
  startAt: '2026-11-01T00:00:00.000Z',
  endAt: '2026-11-11T16:59:59.000Z',
  ...over,
});

const visibleProduct = (over: Record<string, unknown> = {}) => ({
  id: 'p',
  name: 'Sữa hạt',
  slug: 'sua-hat',
  isActive: true,
  approvalStatus: 'APPROVED',
  variations: [{ isActive: true, stock: 5 }],
  ...over,
});

function setup(
  opts: {
    existing?: unknown;
    slugTaken?: boolean;
    products?: { id: string }[];
    coupons?: unknown[];
    productSlugs?: string[];
    categorySlugs?: string[];
    /** Sản phẩm đã gắn vào chiến dịch (đọc cho kiểm sức khoẻ). */
    linked?: { campaignId: string; product: ReturnType<typeof visibleProduct> }[];
    /** Sản phẩm tra theo slug/id cho kiểm sức khoẻ; mặc định là các slug trong `productSlugs`, đang hiển thị. */
    healthProducts?: ReturnType<typeof visibleProduct>[];
  } = {},
) {
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
    product: {
      findMany: jest.fn().mockImplementation(({ where }: { where: { slug?: { in: string[] }; id?: { in: string[] } } }) => {
        if (where.slug) {
          const known = opts.healthProducts ?? (opts.productSlugs ?? []).map((slug) => visibleProduct({ slug }));
          return Promise.resolve(known.filter((p) => where.slug!.in.includes(p.slug)));
        }
        if (opts.healthProducts && where.id) return Promise.resolve(opts.healthProducts.filter((p) => where.id!.in.includes(p.id)));
        return Promise.resolve(opts.products ?? []);
      }),
      findFirst: jest.fn().mockImplementation(({ where }: { where: { slug: string } }) => Promise.resolve((opts.productSlugs ?? []).includes(where.slug) ? { id: 'p' } : null)),
    },
    campaignProduct: { deleteMany: jest.fn().mockReturnValue('del-p'), createMany: jest.fn().mockReturnValue('add-p'), findMany: jest.fn().mockResolvedValue(opts.linked ?? []) },
    campaignCoupon: { deleteMany: jest.fn().mockReturnValue('del-c'), createMany: jest.fn().mockReturnValue('add-c'), findMany: jest.fn().mockResolvedValue([]) },
    category: {
      findMany: jest.fn().mockImplementation(({ where }: { where: { slug: { in: string[] } } }) => Promise.resolve((opts.categorySlugs ?? []).filter((s) => where.slug.in.includes(s)).map((slug) => ({ slug })))),
      findUnique: jest.fn().mockImplementation(({ where }: { where: { slug: string } }) => Promise.resolve((opts.categorySlugs ?? []).includes(where.slug) ? { id: 'k' } : null)),
    },
    coupon: { findMany: jest.fn().mockResolvedValue(opts.coupons ?? []) },
    $queryRaw: jest.fn().mockReturnValue('lock'),
    $transaction: jest.fn().mockResolvedValue([]),
  };
  const stale = new ImageRegistryStale();
  return { svc: new CampaignsAdminService(prisma as never, stale), prisma, stale };
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

  it('mặc định: CAMPAIGN_PAGE, ALL, thứ tự 0; linkValue của CAMPAIGN_PAGE bị bỏ', async () => {
    const { svc, prisma } = setup();
    await svc.create(input({ linkValue: 'bat-ky' }), NOW);
    expect(prisma.campaign.create.mock.calls[0][0].data).toMatchObject({ linkType: 'CAMPAIGN_PAGE', linkValue: null, audience: 'ALL', sortOrder: 0, isActive: false });
  });

  it('không nói isActive thì tạo ở trạng thái bật (đích trang trong app không có gì để chặn)', async () => {
    const { svc, prisma } = setup();
    await svc.create(input({ isActive: undefined, linkType: 'URL_INTERNAL', linkValue: '/offers' }), NOW);
    expect(prisma.campaign.create.mock.calls[0][0].data).toMatchObject({ isActive: true });
  });

  it('URL_INTERNAL ngoài app → 400', async () => {
    const { svc } = setup();
    await expect(svc.create(input({ linkType: 'URL_INTERNAL', linkValue: '//evil.com' }), NOW)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('CampaignsAdminService: đích banner phải tồn tại', () => {
  it('PRODUCT với slug không có sản phẩm nào: 400, không ghi; sản phẩm chưa bật hay chưa duyệt vẫn đặt trước được cho đợt ra mắt', async () => {
    const { svc, prisma } = setup({ productSlugs: ['sua-hat'] });
    await expect(svc.create(input({ linkType: 'PRODUCT', linkValue: 'sua-hat-sai' }), NOW)).rejects.toThrow(/sản phẩm/);
    expect(prisma.campaign.create).not.toHaveBeenCalled();
    await svc.create(input({ linkType: 'PRODUCT', linkValue: 'sua-hat' }), NOW);
    expect(prisma.product.findFirst.mock.calls[1][0].where).toEqual({ slug: 'sua-hat' });
    expect(prisma.campaign.create).toHaveBeenCalledTimes(1);
  });

  it('slug sản phẩm dài CAMPAIGN_ENTITY_SLUG_MAX ký tự tạo và sửa được, MAX + 1 thì 400', async () => {
    const long = `a${'b'.repeat(CAMPAIGN_ENTITY_SLUG_MAX - 1)}`;
    const { svc, prisma } = setup({ productSlugs: [long] });
    await svc.create(input({ linkType: 'PRODUCT', linkValue: long, isActive: true }), NOW);
    expect(prisma.campaign.create.mock.calls[0][0].data).toMatchObject({ linkType: 'PRODUCT', linkValue: long });
    await svc.update('c1', { linkType: 'PRODUCT', linkValue: long }, NOW);
    expect(prisma.campaign.update.mock.calls[0][0].data).toMatchObject({ linkValue: long });
    await expect(svc.create(input({ linkType: 'PRODUCT', linkValue: `${long}b` }), NOW)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('CATEGORY với slug không có danh mục: 400', async () => {
    const { svc, prisma } = setup({ categorySlugs: ['sua-hat'] });
    await expect(svc.create(input({ linkType: 'CATEGORY', linkValue: 'khong-co' }), NOW)).rejects.toThrow(/danh mục/);
    expect(prisma.campaign.create).not.toHaveBeenCalled();
    await svc.create(input({ linkType: 'CATEGORY', linkValue: 'sua-hat' }), NOW);
    expect(prisma.campaign.create).toHaveBeenCalledTimes(1);
  });

  it('sửa: đổi đích sang slug sai bị chặn; lưu lại đúng đích cũ (kể cả sản phẩm đã ẩn) không bị kiểm lại', async () => {
    const { svc, prisma } = setup({ existing: row({ linkType: 'PRODUCT', linkValue: 'da-an' }) });
    await expect(svc.update('c1', { linkType: 'PRODUCT', linkValue: 'sai' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    await svc.update('c1', { title: 'Mới', linkType: 'PRODUCT', linkValue: 'da-an' }, NOW);
    expect(prisma.campaign.update).toHaveBeenCalledTimes(1);
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
    const { svc, prisma } = setup({ existing: row({ linkType: 'URL_INTERNAL', linkValue: '/offers', isActive: false }) });
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
    expect(prisma.$transaction).toHaveBeenCalledWith(['lock', 'del-p', 'add-p']);
  });

  it('danh sách rỗng gỡ hết, không gọi createMany với mảng rỗng', async () => {
    const { svc, prisma } = setup();
    await expect(svc.setProducts('c1', [])).resolves.toEqual({ count: 0 });
    expect(prisma.campaignProduct.createMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledWith(['lock', 'del-p']);
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

const fkViolation = (field: string) => new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: 'test', meta: { field_name: field } });

describe('P2003 khi mục bị xoá giữa lúc kiểm và ghi', () => {
  it('setProducts: sản phẩm vừa xoá → 400, chiến dịch vừa xoá → 404', async () => {
    const a = setup({ products: [{ id: 'p1' }] });
    a.prisma.$transaction.mockRejectedValue(fkViolation('CampaignProduct_productId_fkey (index)'));
    await expect(a.svc.setProducts('c1', ['p1'])).rejects.toBeInstanceOf(BadRequestException);
    const b = setup({ products: [{ id: 'p1' }] });
    b.prisma.$transaction.mockRejectedValue(fkViolation('CampaignProduct_campaignId_fkey (index)'));
    await expect(b.svc.setProducts('c1', ['p1'])).rejects.toBeInstanceOf(NotFoundException);
  });

  it('setCoupons: mã vừa xoá → 400, chiến dịch vừa xoá → 404; lỗi khác vẫn ném nguyên', async () => {
    const coupons = [{ id: 'k1', code: 'THU10', scope: 'PUBLIC', batch: null }];
    const a = setup({ coupons });
    a.prisma.$transaction.mockRejectedValue(fkViolation('CampaignCoupon_couponId_fkey (index)'));
    await expect(a.svc.setCoupons('c1', ['THU10'])).rejects.toBeInstanceOf(BadRequestException);
    const b = setup({ coupons });
    b.prisma.$transaction.mockRejectedValue(fkViolation('CampaignCoupon_campaignId_fkey (index)'));
    await expect(b.svc.setCoupons('c1', ['THU10'])).rejects.toBeInstanceOf(NotFoundException);
    const c = setup({ coupons });
    c.prisma.$transaction.mockRejectedValue(new Error('boom'));
    await expect(c.svc.setCoupons('c1', ['THU10'])).rejects.toThrow('boom');
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
    expect(prisma.$transaction).toHaveBeenCalledWith(['lock', 'del-c', 'add-c']);
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

describe('CampaignsAdminService: danh sách ảnh của /img', () => {
  it('tạo chiến dịch đánh dấu danh sách ảnh cũ để banner https đổi cỡ được ngay', async () => {
    const { svc, stale } = setup();
    expect(stale.isStale()).toBe(false);
    await svc.create(input({ image: 'https://res.cloudinary.com/tubutree/image/upload/v1/a.jpg' }), NOW);
    expect(stale.isStale()).toBe(true);
  });

  it('sửa ảnh thì đánh dấu; sửa tiêu đề hoặc lưu lại đúng ảnh cũ thì không', async () => {
    const same = setup({ existing: row({ image: 'https://res.cloudinary.com/tubutree/image/upload/v1/a.jpg' }) });
    await same.svc.update('c1', { title: 'Tên mới' }, NOW);
    await same.svc.update('c1', { image: 'https://res.cloudinary.com/tubutree/image/upload/v1/a.jpg' }, NOW);
    expect(same.stale.isStale()).toBe(false);
    const changed = setup({ existing: row({ image: 'https://res.cloudinary.com/tubutree/image/upload/v1/a.jpg' }) });
    await changed.svc.update('c1', { image: 'https://res.cloudinary.com/tubutree/image/upload/v1/b.jpg' }, NOW);
    expect(changed.stale.isStale()).toBe(true);
  });
});

describe('CampaignsAdminService: kiểm sức khoẻ trước khi bật', () => {
  const linkedTo = (campaignId: string, over: Record<string, unknown> = {}) => ({ campaignId, product: visibleProduct(over) });

  it('danh sách trả health mỗi dòng (số lỗi chặn, số cảnh báo) với số truy vấn không đổi theo số dòng', async () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ ...row({ id: `c${i}` }), _count: { products: 0, coupons: 0 } }));
    const few = setup({ linked: [linkedTo('c0')] });
    few.prisma.campaign.findMany.mockResolvedValue(rows(2));
    const out = await few.svc.list(undefined, NOW);
    expect(out.map((r) => r.health)).toEqual([{ blockers: 0, warnings: 0 }, { blockers: 1, warnings: 0 }]);

    const many = setup();
    many.prisma.campaign.findMany.mockResolvedValue(rows(40));
    await many.svc.list(undefined, NOW);
    const count = (p: ReturnType<typeof setup>['prisma']) =>
      [p.campaign, p.campaignProduct, p.campaignCoupon, p.product, p.coupon, p.category].reduce((n, m) => n + (m.findMany as jest.Mock).mock.calls.length, 0);
    expect(count(many.prisma)).toBe(count(few.prisma));
    expect(many.prisma.campaignProduct.findMany).toHaveBeenCalledTimes(1);
  });

  it('bật chiến dịch đang tắt mà còn lỗi chặn: 400 kèm câu đầu tiên, không ghi', async () => {
    const { svc, prisma } = setup({ existing: row({ isActive: false }) });
    await expect(svc.update('c1', { isActive: true }, NOW)).rejects.toThrow(/Trang chiến dịch đang trống/);
    expect(prisma.campaign.update).not.toHaveBeenCalled();
  });

  it('bật được khi hết lỗi chặn; lưu nháp tắt vẫn được dù còn lỗi chặn', async () => {
    const ok = setup({ existing: row({ isActive: false }), linked: [linkedTo('c1')] });
    await ok.svc.update('c1', { isActive: true }, NOW);
    expect(ok.prisma.campaign.update).toHaveBeenCalledTimes(1);
    const draft = setup({ existing: row({ isActive: false }) });
    await draft.svc.update('c1', { title: 'Nháp', isActive: false }, NOW);
    await draft.svc.update('c1', { title: 'Nháp nữa' }, NOW);
    expect(draft.prisma.campaign.update).toHaveBeenCalledTimes(2);
  });

  it('chiến dịch đang bật: sửa tiêu đề không bị chặn vì lỗi cũ, nhưng đổi sang đích sản phẩm ẩn thì bị chặn', async () => {
    const { svc, prisma } = setup({ productSlugs: ['da-an'], healthProducts: [visibleProduct({ slug: 'da-an', isActive: false })] });
    await svc.update('c1', { title: 'Mới' }, NOW);
    expect(prisma.campaign.update).toHaveBeenCalledTimes(1);
    await expect(svc.update('c1', { linkType: 'PRODUCT', linkValue: 'da-an' }, NOW)).rejects.toThrow(/đang ẩn hoặc chưa được duyệt/);
    expect(prisma.campaign.update).toHaveBeenCalledTimes(1);
  });

  it('tạo bật mà đích là sản phẩm ẩn: 400, không tạo; tạo tắt thì được', async () => {
    const hidden = [visibleProduct({ slug: 'da-an', isActive: false })];
    const { svc, prisma } = setup({ productSlugs: ['da-an'], healthProducts: hidden });
    await expect(svc.create(input({ isActive: true, linkType: 'PRODUCT', linkValue: 'da-an' }), NOW)).rejects.toThrow(/đang ẩn/);
    expect(prisma.campaign.create).not.toHaveBeenCalled();
    await svc.create(input({ isActive: false, linkType: 'PRODUCT', linkValue: 'da-an' }), NOW);
    expect(prisma.campaign.create).toHaveBeenCalledTimes(1);
  });

  it('tạo bật trang chiến dịch chưa có sản phẩm/mã: 400 vì trang trống', async () => {
    const { svc, prisma } = setup();
    await expect(svc.create(input({ isActive: true }), NOW)).rejects.toThrow(/Trang chiến dịch đang trống/);
    expect(prisma.campaign.create).not.toHaveBeenCalled();
  });

  describe('check (form chưa lưu)', () => {
    const dto = (over: Record<string, unknown> = {}) => ({
      placement: 'HOME_TOP' as const,
      startAt: '2026-11-01T00:00:00.000Z',
      endAt: '2026-11-11T16:59:59.000Z',
      ...over,
    });

    it('dùng danh sách sản phẩm gửi lên, trả issues kèm số đếm', async () => {
      const { svc, prisma } = setup({ healthProducts: [visibleProduct({ id: 'p1' }), visibleProduct({ id: 'p2', name: 'Trà', inStock: false, variations: [] })] });
      const out = await svc.check(dto({ productIds: ['p1', 'p2'] }), NOW);
      expect(out).toMatchObject({ blockers: 0, warnings: 1 });
      expect(out.issues[0]).toMatchObject({ code: 'PRODUCTS_UNAVAILABLE', level: 'WARN' });
      expect(prisma.campaignProduct.findMany).not.toHaveBeenCalled();
    });

    it('chưa chọn sản phẩm/mã: trang trống là BLOCK', async () => {
      const { svc } = setup();
      const out = await svc.check(dto({ productIds: [], couponCodes: [] }), NOW);
      expect(out).toMatchObject({ blockers: 1, warnings: 0 });
    });

    it('sửa chiến dịch đã lưu mà không gửi danh sách: đọc liên kết đang lưu', async () => {
      const { svc, prisma } = setup({ linked: [linkedTo('c1')] });
      const out = await svc.check(dto({ id: 'c1' }), NOW);
      expect(out).toEqual({ issues: [], blockers: 0, warnings: 0 });
      expect(prisma.campaignProduct.findMany).toHaveBeenCalledTimes(1);
    });

    it('đích sai định dạng: 400 như lúc lưu', async () => {
      const { svc } = setup();
      await expect(svc.check(dto({ linkType: 'PRODUCT', linkValue: 'có dấu' }), NOW)).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});

describe('CampaignsAdminService: danh sách không tính ENDED vào health', () => {
  it('chiến dịch đã kết thúc không bị huy hiệu cảnh báo vì ngày; check (form) vẫn báo ENDED', async () => {
    const ended = row({ id: 'e', endAt: new Date('2026-11-04T00:00:00Z') });
    const { svc, prisma } = setup({ linked: [{ campaignId: 'e', product: visibleProduct() }] });
    prisma.campaign.findMany.mockResolvedValue([{ ...ended, _count: { products: 1, coupons: 0 } }]);
    const [first] = await svc.list(undefined, NOW);
    expect(first?.health).toEqual({ blockers: 0, warnings: 0 });
    const out = await svc.check({ id: 'e', placement: 'HOME_TOP', startAt: '2026-11-01T00:00:00.000Z', endAt: '2026-11-04T00:00:00.000Z' }, NOW);
    expect(out.issues.map((i) => i.code)).toEqual(['ENDED']);
  });
});
