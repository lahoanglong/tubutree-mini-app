import { BadRequestException } from '@nestjs/common';
import { BrandService } from './brand.service';
import type { SystemConfigService } from '../system-config/system-config.service';

const brandConfig = { get: async <T>(_k: string, fb?: T): Promise<T> => fb as T } as unknown as SystemConfigService;

function makePrisma() {
  return {
    brand: { findFirst: jest.fn() },
    brandPromotion: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    coupon: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    product: { findMany: jest.fn().mockResolvedValue([]) },
    dealerReward: { findMany: jest.fn().mockResolvedValue([]) },
  } as any;
}

describe('BrandService khuyến mãi gắn mã giảm giá (C-006)', () => {
  const NOW = new Date('2026-10-10T03:00:00Z');
  const DAY = 864e5;
  const coupon = (o: Record<string, unknown> = {}) => ({
    id: 'c1', code: 'TUBU20', scope: 'PUBLIC', startAt: new Date(NOW.getTime() - DAY), endAt: new Date(NOW.getTime() + 5 * DAY),
    usageLimit: null, usedCount: 0, ...o,
  });
  const dto = { title: 'Sale', startAt: '2026-10-10', endAt: '2026-10-20' };
  const setup = (c: unknown) => {
    const prisma = makePrisma();
    prisma.coupon.findFirst.mockResolvedValue(c);
    prisma.brandPromotion.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'p1', ...data }));
    prisma.brandPromotion.update.mockImplementation(({ data }: any) => Promise.resolve({ id: 'p1', ...data }));
    return { prisma, svc: new BrandService(prisma, brandConfig) };
  };

  it('createPromotion: mã không tồn tại -> 400, không ghi DB', async () => {
    const { prisma, svc } = setup(null);
    await expect(svc.createPromotion('b1', { ...dto, couponCode: 'MASAI' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.createPromotion('b1', { ...dto, couponCode: 'MASAI' }, NOW)).rejects.toThrow(/Mã giảm giá/);
    expect(prisma.brandPromotion.create).not.toHaveBeenCalled();
  });

  it('createPromotion: mã hết hạn / hết lượt / chỉ dành riêng một nhóm khách -> 400', async () => {
    for (const bad of [
      coupon({ endAt: new Date(NOW.getTime() - 1000) }),
      coupon({ usageLimit: 10, usedCount: 10 }),
      coupon({ scope: 'USER_GROUP' }),
      coupon({ scope: 'BIRTHDAY' }),
    ]) {
      const { prisma, svc } = setup(bad);
      await expect(svc.createPromotion('b1', { ...dto, couponCode: 'TUBU20' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.brandPromotion.create).not.toHaveBeenCalled();
    }
  });

  it('createPromotion: mã hợp lệ -> lưu đúng mã chuẩn của bảng Coupon (không lưu chuỗi người nhập)', async () => {
    const { prisma, svc } = setup(coupon({ code: 'TUBU20' }));
    const out = await svc.createPromotion('b1', { ...dto, couponCode: '  tubu20 ' }, NOW);
    expect(out.couponCode).toBe('TUBU20');
    expect(prisma.coupon.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { code: { in: ['tubu20', 'TUBU20'] } } }));
  });

  it('createPromotion: mã có hiệu lực từ ngày mai (chiến dịch lên lịch trước) vẫn được gắn', async () => {
    const { svc } = setup(coupon({ startAt: new Date(NOW.getTime() + DAY) }));
    await expect(svc.createPromotion('b1', { ...dto, couponCode: 'TUBU20' }, NOW)).resolves.toMatchObject({ couponCode: 'TUBU20' });
  });

  it('createPromotion: không có mã / mã rỗng -> không tra bảng Coupon, couponCode=null', async () => {
    for (const couponCode of [undefined, '', '   ']) {
      const { prisma, svc } = setup(null);
      const out = await svc.createPromotion('b1', { ...dto, couponCode }, NOW);
      expect(out.couponCode).toBeNull();
      expect(prisma.coupon.findFirst).not.toHaveBeenCalled();
    }
  });

  it('updatePromotion: đổi sang mã sai -> 400; giữ nguyên mã cũ khi chỉ sửa tiêu đề -> vẫn lưu được', async () => {
    const { prisma, svc } = setup(null);
    prisma.brandPromotion.findUnique.mockResolvedValue({ id: 'p1', brandId: 'b1', couponCode: 'OLD10' });
    await expect(svc.updatePromotion('p1', { couponCode: 'MASAI' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.brandPromotion.update).not.toHaveBeenCalled();

    prisma.coupon.findFirst.mockClear();
    await svc.updatePromotion('p1', { title: 'Mới', couponCode: 'OLD10' }, NOW);
    expect(prisma.coupon.findFirst).not.toHaveBeenCalled();
    expect(prisma.brandPromotion.update).toHaveBeenCalledTimes(1);
  });

  it('updatePromotion: couponCode rỗng -> gỡ mã (null)', async () => {
    const { prisma, svc } = setup(null);
    prisma.brandPromotion.findUnique.mockResolvedValue({ id: 'p1', brandId: 'b1', couponCode: 'OLD10' });
    await svc.updatePromotion('p1', { couponCode: '' }, NOW);
    expect(prisma.brandPromotion.update.mock.calls[0][0].data.couponCode).toBeNull();
  });

  it('updatePromotion: đổi sang mã hợp lệ -> lưu mã chuẩn', async () => {
    const { prisma, svc } = setup(coupon({ code: 'NEW30' }));
    prisma.brandPromotion.findUnique.mockResolvedValue({ id: 'p1', brandId: 'b1', couponCode: 'OLD10' });
    await svc.updatePromotion('p1', { couponCode: 'new30' }, NOW);
    expect(prisma.brandPromotion.update.mock.calls[0][0].data.couponCode).toBe('NEW30');
  });

  it('createOwnedPromotion / updateOwnedPromotion cũng bị kiểm mã (đường chủ nhãn tự quản)', async () => {
    const { prisma, svc } = setup(null);
    prisma.brand.findFirst.mockResolvedValue({ id: 'b1', ownerUserId: 'u1' });
    prisma.brandPromotion.findUnique.mockResolvedValue({ id: 'p1', brandId: 'b1', couponCode: null });
    await expect(svc.createOwnedPromotion('u1', { ...dto, couponCode: 'MASAI' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.updateOwnedPromotion('u1', 'p1', { couponCode: 'MASAI' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.brandPromotion.create).not.toHaveBeenCalled();
    expect(prisma.brandPromotion.update).not.toHaveBeenCalled();
  });

  describe('getPublicBySlug: trang nhãn không đưa mã khách chép sẽ bị từ chối', () => {
    const brand = { id: 'b1', slug: 'sachi', name: 'Sachi', certifications: [], storyImages: [], isVerified: false, followerCount: 0 };
    const promo = (id: string, couponCode: string | null) => ({
      id, title: id, subtitle: null, themeColor: null, couponCode, startAt: new Date('2026-10-01'), endAt: new Date('2026-10-30'),
    });

    it('mã còn dùng được -> giữ; mã không tồn tại / hết hạn / hết lượt / riêng tư / chưa hiệu lực -> couponCode=null, khuyến mãi vẫn hiện', async () => {
      const prisma = makePrisma();
      prisma.brand.findFirst.mockResolvedValue(brand);
      prisma.brandPromotion.findMany.mockResolvedValue([
        promo('ok', 'TUBU20'), promo('ghost', 'MASAI'), promo('old', 'HETHAN'), promo('full', 'HETLUOT'),
        promo('priv', 'RIENGTU'), promo('future', 'SAPTOI'), promo('none', null), promo('lower', 'tubu20'),
      ]);
      prisma.coupon.findMany.mockResolvedValue([
        coupon({ code: 'TUBU20' }),
        coupon({ code: 'HETHAN', endAt: new Date(NOW.getTime() - 1000) }),
        coupon({ code: 'HETLUOT', usageLimit: 5, usedCount: 5 }),
        coupon({ code: 'RIENGTU', scope: 'USER_GROUP' }),
        coupon({ code: 'SAPTOI', startAt: new Date(NOW.getTime() + DAY) }),
      ]);
      const out = await new BrandService(prisma, brandConfig).getPublicBySlug('sachi', NOW);
      const byId = Object.fromEntries(out.promotions.map((p) => [p.id, p.couponCode]));
      expect(byId).toEqual({ ok: 'TUBU20', ghost: null, old: null, full: null, priv: null, future: null, none: null, lower: 'TUBU20' });
      expect(out.promotions).toHaveLength(8);
    });

    it('không có mã nào gắn trong khuyến mãi -> không tốn thêm truy vấn Coupon', async () => {
      const prisma = makePrisma();
      prisma.brand.findFirst.mockResolvedValue(brand);
      prisma.brandPromotion.findMany.mockResolvedValue([promo('a', null)]);
      await new BrandService(prisma, brandConfig).getPublicBySlug('sachi', NOW);
      expect(prisma.coupon.findMany).not.toHaveBeenCalled();
    });
  });
});
