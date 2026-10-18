import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { BrandService } from './brand.service';
import type { SystemConfigService } from '../system-config/system-config.service';

const brandConfig = { get: async <T>(_k: string, fb?: T): Promise<T> => fb as T } as unknown as SystemConfigService;
import { BrandSalesQueryDto } from './dto/brand.dto';

function makePrisma() {
  return {
    brand: { findFirst: jest.fn() },
    variation: { findMany: jest.fn().mockResolvedValue([]) },
    orderItem: {
      groupBy: jest.fn().mockResolvedValue([]),
      aggregate: jest.fn().mockResolvedValue({ _sum: { total: null } }),
    },
    order: { count: jest.fn().mockResolvedValue(0) },
    $queryRaw: jest.fn().mockResolvedValue([]),
  } as any;
}

// 2026-10-10 10:00 giờ VN
const NOW = new Date('2026-10-10T03:00:00Z');
const VN = 7 * 3600e3;

describe('BrandService.getOwnedSales (C-034, Q-18): doanh thu nhãn chỉ-đọc, ẩn PII khách', () => {
  const setup = () => {
    const prisma = makePrisma();
    prisma.brand.findFirst.mockResolvedValue({ id: 'b1', ownerUserId: 'owner1' });
    prisma.variation.findMany.mockResolvedValue([
      { id: 'v1', product: { id: 'p1', name: 'Nước rửa chén', slug: 'nrc' } },
      { id: 'v2', product: { id: 'p1', name: 'Nước rửa chén', slug: 'nrc' } },
      { id: 'v3', product: { id: 'p2', name: 'Xà bông', slug: 'xb' } },
    ]);
    return { prisma, svc: new BrandService(prisma, brandConfig) };
  };

  it('user không sở hữu nhãn nào -> 404, không chạm bảng đơn hàng', async () => {
    const prisma = makePrisma();
    prisma.brand.findFirst.mockResolvedValue(null);
    await expect(new BrandService(prisma, brandConfig).getOwnedSales('stranger', '30d', NOW)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.brand.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { ownerUserId: 'stranger' } }));
    expect(prisma.variation.findMany).not.toHaveBeenCalled();
    expect(prisma.orderItem.groupBy).not.toHaveBeenCalled();
    expect(prisma.order.count).not.toHaveBeenCalled();
  });

  it('chỉ tính dòng hàng thuộc biến thể của SP của ĐÚNG nhãn người đó sở hữu', async () => {
    const { prisma, svc } = setup();
    await svc.getOwnedSales('owner1', '30d', NOW);
    expect(prisma.variation.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { product: { brandId: 'b1' } } }));
    const ids = ['v1', 'v2', 'v3'];
    expect(prisma.orderItem.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      by: ['variationId'],
      where: expect.objectContaining({ variationId: { in: ids } }),
    }));
    expect(prisma.order.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ items: { some: { variationId: { in: ids } } } }),
    }));
  });

  it('loại đơn chờ thanh toán / huỷ / trả / đã hoàn tiền / thanh toán lỗi khỏi doanh thu', async () => {
    const { prisma, svc } = setup();
    await svc.getOwnedSales('owner1', '30d', NOW);
    const where = prisma.orderItem.groupBy.mock.calls[0][0].where.order;
    expect(where.status).toEqual({ notIn: ['PENDING_PAYMENT', 'CANCELLED', 'RETURNED'] });
    expect(where.paymentStatus).toEqual({ notIn: ['REFUNDED', 'FAILED'] });
  });

  it('gộp theo sản phẩm, sắp theo doanh thu giảm dần; tổng khớp từng dòng', async () => {
    const { prisma, svc } = setup();
    prisma.orderItem.groupBy.mockResolvedValue([
      { variationId: 'v1', _sum: { quantity: 2, total: 100_000 } },
      { variationId: 'v2', _sum: { quantity: 1, total: 80_000 } },
      { variationId: 'v3', _sum: { quantity: 5, total: 150_000 } },
    ]);
    prisma.order.count.mockResolvedValueOnce(4).mockResolvedValueOnce(2);
    prisma.orderItem.aggregate.mockResolvedValue({ _sum: { total: 130_000 } });
    const out = await svc.getOwnedSales('owner1', '30d', NOW);
    expect(out.revenue).toBe(330_000);
    expect(out.unitsSold).toBe(8);
    expect(out.orderCount).toBe(4);
    expect(out.delivered).toEqual({ orderCount: 2, revenue: 130_000 });
    expect(out.topProducts).toEqual([
      { productId: 'p1', name: 'Nước rửa chén', slug: 'nrc', quantity: 3, revenue: 180_000 },
      { productId: 'p2', name: 'Xà bông', slug: 'xb', quantity: 5, revenue: 150_000 },
    ]);
  });

  it('trừ đơn vị/doanh thu đã trả một phần (APPROVED, fullReturn=false) bằng MỘT truy vấn gộp trong DB, không N+1', async () => {
    const { prisma, svc } = setup();
    prisma.orderItem.groupBy.mockResolvedValue([{ variationId: 'v1', _sum: { quantity: 3, total: 300_000 } }]);
    prisma.orderItem.aggregate.mockResolvedValue({ _sum: { total: 300_000 } });
    prisma.$queryRaw.mockResolvedValue([{ variationId: 'v1', quantity: 3, total: 300_000, status: 'DELIVERED', returned: 2n }]);
    const out = await svc.getOwnedSales('owner1', '30d', NOW);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const sql = prisma.$queryRaw.mock.calls[0][0];
    expect(sql.values).toContain('b1');
    expect(sql.sql).toContain(`rr."status" = 'APPROVED' AND rr."fullReturn" = false`);
    expect(out).toMatchObject({ unitsSold: 1, revenue: 100_000, delivered: { revenue: 100_000 } });
    expect(out.topProducts[0]).toMatchObject({ quantity: 1, revenue: 100_000 });
  });

  it('chỉ trả tối đa 10 sản phẩm bán chạy', async () => {
    const { prisma, svc } = setup();
    const vars = Array.from({ length: 14 }, (_, i) => ({ id: `v${i}`, product: { id: `p${i}`, name: `SP ${i}`, slug: `sp-${i}` } }));
    prisma.variation.findMany.mockResolvedValue(vars);
    prisma.orderItem.groupBy.mockResolvedValue(vars.map((v, i) => ({ variationId: v.id, _sum: { quantity: 1, total: (i + 1) * 1000 } })));
    const out = await svc.getOwnedSales('owner1', '30d', NOW);
    expect(out.topProducts).toHaveLength(10);
    expect(out.topProducts[0]!.productId).toBe('p13');
    expect(out.revenue).toBe(105_000);
  });

  it('KHÔNG lộ thông tin khách: không có tên/SĐT/địa chỉ/userId và không truy vấn các trường đó', async () => {
    const { prisma, svc } = setup();
    prisma.orderItem.groupBy.mockResolvedValue([{ variationId: 'v1', _sum: { quantity: 1, total: 50_000 } }]);
    prisma.order.count.mockResolvedValue(1);
    const out = await svc.getOwnedSales('owner1', '30d', NOW);
    const json = JSON.stringify(out);
    for (const banned of ['phone', 'fullName', 'recipient', 'shippingAddress', 'street', 'userId', 'email', 'code']) {
      expect(json).not.toContain(banned);
    }
    // Không có truy vấn nào đọc bản ghi đơn (chỉ đếm / cộng dồn; đơn chỉ được đọc khi có trả một phần và chỉ chọn trường số) nên không kéo PII về.
    expect(prisma.order).not.toHaveProperty('findMany');
    for (const call of [...prisma.orderItem.groupBy.mock.calls, ...prisma.orderItem.aggregate.mock.calls]) {
      expect(call[0].select).toBeUndefined();
      expect(call[0].include).toBeUndefined();
    }
  });

  it('nhãn chưa có SP nào -> số 0, không truy vấn đơn hàng', async () => {
    const { prisma, svc } = setup();
    prisma.variation.findMany.mockResolvedValue([]);
    const out = await svc.getOwnedSales('owner1', '30d', NOW);
    expect(out).toMatchObject({ orderCount: 0, revenue: 0, unitsSold: 0, topProducts: [], delivered: { orderCount: 0, revenue: 0 } });
    expect(prisma.orderItem.groupBy).not.toHaveBeenCalled();
  });

  describe('kỳ báo cáo (giờ Việt Nam)', () => {
    const range = async (period: any) => {
      const { prisma, svc } = setup();
      const out = await svc.getOwnedSales('owner1', period, NOW);
      const w = prisma.orderItem.groupBy.mock.calls[0][0].where.order.createdAt;
      return { out, w };
    };

    it('mặc định 30 ngày gần nhất', async () => {
      const { prisma, svc } = setup();
      const out = await svc.getOwnedSales('owner1', undefined, NOW);
      expect(out.period).toBe('30d');
      const w = prisma.orderItem.groupBy.mock.calls[0][0].where.order.createdAt;
      expect(w.gte).toEqual(new Date(NOW.getTime() - 30 * 864e5));
      expect(w.lte).toEqual(NOW);
    });

    it('7d và 90d', async () => {
      expect((await range('7d')).w.gte).toEqual(new Date(NOW.getTime() - 7 * 864e5));
      expect((await range('90d')).w.gte).toEqual(new Date(NOW.getTime() - 90 * 864e5));
    });

    it('month: từ 00:00 ngày 1 tháng này theo giờ VN tới hiện tại', async () => {
      const { w, out } = await range('month');
      expect(w.gte).toEqual(new Date(Date.UTC(2026, 9, 1) - VN));
      expect(w.lte).toEqual(NOW);
      expect(out.from).toBe(new Date(Date.UTC(2026, 9, 1) - VN).toISOString());
    });

    it('prev_month: trọn tháng trước theo giờ VN (kết thúc 1ms trước 00:00 ngày 1 tháng này)', async () => {
      const { w } = await range('prev_month');
      expect(w.gte).toEqual(new Date(Date.UTC(2026, 8, 1) - VN));
      expect(w.lte).toEqual(new Date(Date.UTC(2026, 9, 1) - VN - 1));
    });

    it('đầu năm: prev_month của tháng 1 là tháng 12 năm trước', async () => {
      const { prisma, svc } = setup();
      await svc.getOwnedSales('owner1', 'prev_month', new Date('2027-01-15T03:00:00Z'));
      const w = prisma.orderItem.groupBy.mock.calls[0][0].where.order.createdAt;
      expect(w.gte).toEqual(new Date(Date.UTC(2026, 11, 1) - VN));
      expect(w.lte).toEqual(new Date(Date.UTC(2027, 0, 1) - VN - 1));
    });

    it('rạng sáng 01 giờ VN vẫn thuộc tháng mới (UTC còn là ngày cuối tháng trước)', async () => {
      const { prisma, svc } = setup();
      // 2026-10-31T18:30Z = 01:30 ngày 01/11 giờ VN
      await svc.getOwnedSales('owner1', 'month', new Date('2026-10-31T18:30:00Z'));
      expect(prisma.orderItem.groupBy.mock.calls[0][0].where.order.createdAt.gte).toEqual(new Date(Date.UTC(2026, 10, 1) - VN));
    });
  });
});

describe('BrandSalesQueryDto', () => {
  const errs = async (plain: Record<string, unknown>) =>
    (await validate(plainToInstance(BrandSalesQueryDto, plain), { whitelist: true, forbidNonWhitelisted: true })).flatMap((e) => Object.keys(e.constraints ?? {}));

  it('chấp nhận kỳ hợp lệ hoặc bỏ trống; từ chối giá trị lạ và tham số thừa', async () => {
    for (const period of ['7d', '30d', '90d', 'month', 'prev_month']) expect(await errs({ period })).toEqual([]);
    expect(await errs({})).toEqual([]);
    expect(await errs({ period: 'all' })).toContain('isIn');
    expect(await errs({ period: '30d', brandId: 'other-brand' })).toContain('whitelistValidation');
  });
});
