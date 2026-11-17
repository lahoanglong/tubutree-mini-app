import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import type { EcoFactsReader } from './eco-facts.reader';
import { computePassport, type PassportInput } from './eco-passport.compute';
import { EcoPassportService } from './eco-passport.service';

const NOW = new Date('2026-11-18T05:00:00Z');
const at = (iso: string) => new Date(iso);

const EMPTY: PassportInput = { items: [], firstDeliveredAt: null, facts: [], waste: [], trees: [] };

describe('computePassport', () => {
  it('khách mới: số 0, 6 tháng giờ VN cũ trước, không mốc nào', () => {
    const p = computePassport(EMPTY, NOW);
    expect(p).toMatchObject({ firstOrderAt: null, plasticAvoidedGrams: 0, refillPacks: 0, co2Grams: null, trees: { pledged: 0, planted: 0 } });
    expect(p.monthly.map((m) => m.month)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
    expect(p.stamps.every((s) => !s.reached)).toBe(true);
  });

  it('nhựa = gam × số món còn giữ; sự thật của phân loại chỉ áp cho phân loại đó; món đã trả hết không tính', () => {
    const p = computePassport(
      {
        ...EMPTY,
        firstDeliveredAt: at('2026-10-01T03:00:00Z'),
        facts: [
          { productId: 'p1', variationId: null, kind: 'PLASTIC_AVOIDED', valueGrams: 100, co2Grams: null },
          { productId: 'p1', variationId: 'v10l', kind: 'PLASTIC_AVOIDED', valueGrams: 600, co2Grams: null },
          { productId: 'p1', variationId: 'v10l', kind: 'REFILL_PACK', valueGrams: null, co2Grams: null },
        ],
        items: [
          { orderId: 'o1', productId: 'p1', variationId: 'v10l', netQty: 2, at: at('2026-10-01T03:00:00Z') },
          { orderId: 'o1', productId: 'p1', variationId: 'v500', netQty: 3, at: at('2026-10-01T03:00:00Z') },
          { orderId: 'o2', productId: 'p1', variationId: 'v10l', netQty: 0, at: at('2026-11-02T03:00:00Z') },
          { orderId: 'o3', productId: 'p2', variationId: 'v9', netQty: 5, at: at('2026-11-03T03:00:00Z') },
        ],
      },
      NOW,
    );
    expect(p.plasticAvoidedGrams).toBe(600 * 2 + 100 * 3);
    expect(p.refillPacks).toBe(2);
    expect(p.co2Grams).toBeNull();
    expect(p.stamps.find((s) => s.id === 'plastic_1kg')?.reached).toBe(true);
    expect(p.stamps.find((s) => s.id === 'first_order')?.reached).toBe(true);
    // Một đơn xanh đếm một việc, đơn không có món xanh hay món đã trả hết không đếm.
    expect(p.monthly.find((m) => m.month === '2026-10')?.actions).toBe(1);
    expect(p.monthly.find((m) => m.month === '2026-11')?.actions).toBe(0);
  });

  it('CO₂ chỉ có số khi sự thật có số CO₂; tháng theo giờ VN', () => {
    const p = computePassport(
      {
        ...EMPTY,
        facts: [{ productId: 'p1', variationId: null, kind: 'REFILL_PACK', valueGrams: null, co2Grams: 250 }],
        // 31/10 18:00 UTC là 01/11 giờ VN.
        items: [{ orderId: 'o1', productId: 'p1', variationId: 'v1', netQty: 2, at: at('2026-10-31T18:00:00Z') }],
      },
      NOW,
    );
    expect(p.co2Grams).toBe(500);
    expect(p.monthly.find((m) => m.month === '2026-11')?.actions).toBe(1);
  });

  it('Đổi rác: gam = số nhận × gam mỗi món; món chưa có gam chỉ đếm; cây cam kết và đã trồng', () => {
    const p = computePassport(
      {
        ...EMPTY,
        waste: [
          { at: at('2026-09-10T03:00:00Z'), lines: [{ receivedQty: 4, gramsPerUnit: 25 }, { receivedQty: 3, gramsPerUnit: null }] },
          { at: at('2026-09-20T03:00:00Z'), lines: [{ receivedQty: null, gramsPerUnit: 25 }] },
          { at: at('2026-01-20T03:00:00Z'), lines: [] },
        ],
        trees: [
          { at: at('2026-11-01T03:00:00Z'), planted: true },
          { at: at('2026-11-05T03:00:00Z'), planted: false },
        ],
      },
      NOW,
    );
    expect(p.wasteReturned).toEqual({ requests: 3, grams: 100, unitsWithoutWeight: 3 });
    expect(p.trees).toEqual({ pledged: 2, planted: 1 });
    expect(p.monthly.find((m) => m.month === '2026-09')?.actions).toBe(2);
    expect(p.monthly.find((m) => m.month === '2026-11')?.actions).toBe(2);
    expect(p.stamps.filter((s) => s.reached).map((s) => s.id)).toEqual(['waste_3', 'tree_1']);
  });
});

function makePrisma() {
  return {
    orderItem: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'oi1', variationId: 'v1', quantity: 3, order: { id: 'o1', deliveredAt: new Date('2026-10-02T03:00:00Z'), createdAt: new Date('2026-10-01T03:00:00Z') } },
      ]),
    },
    order: { findFirst: jest.fn().mockResolvedValue({ deliveredAt: new Date('2026-10-02T03:00:00Z'), createdAt: new Date('2026-10-01T03:00:00Z') }) },
    wasteRequest: { findMany: jest.fn().mockResolvedValue([]) },
    plantedTree: { findMany: jest.fn().mockResolvedValue([]) },
    returnRequestItem: { findMany: jest.fn().mockResolvedValue([{ orderItemId: 'oi1', quantity: 1 }]) },
    variation: { findMany: jest.fn().mockResolvedValue([{ id: 'v1', productId: 'p1' }]) },
    productEcoFact: { findMany: jest.fn().mockResolvedValue([{ productId: 'p1', variationId: null, kind: 'PLASTIC_AVOIDED', valueGrams: 100, co2Grams: null }]) },
  };
}

const reader = (on: boolean) => ({ passportOn: jest.fn().mockResolvedValue(on) }) as unknown as EcoFactsReader;

describe('EcoPassportService', () => {
  it('cờ eco.passport_enabled tắt: 404, không đọc bảng nào', async () => {
    const prisma = makePrisma();
    const svc = new EcoPassportService(prisma as unknown as PrismaService, reader(false));
    await expect(svc.passport('u1', NOW)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.orderItem.findMany).not.toHaveBeenCalled();
  });

  it('mọi truy vấn lọc theo khách của phiên; chỉ đơn đã giao, Đổi rác xong, sự thật đã duyệt; trừ món đang/đã trả', async () => {
    const prisma = makePrisma();
    const svc = new EcoPassportService(prisma as unknown as PrismaService, reader(true));
    const p = await svc.passport('u1', NOW);
    const own = { userId: 'u1', status: 'DELIVERED', type: 'RETAIL', placedForCustomer: false };
    expect(prisma.orderItem.findMany.mock.calls[0][0].where).toEqual({ order: own });
    expect(prisma.order.findFirst.mock.calls[0][0].where).toEqual(own);
    expect(prisma.wasteRequest.findMany.mock.calls[0][0].where).toEqual({ userId: 'u1', status: 'COMPLETED' });
    expect(prisma.plantedTree.findMany.mock.calls[0][0].where).toEqual({ userId: 'u1' });
    expect(prisma.returnRequestItem.findMany.mock.calls[0][0].where).toEqual({ orderItemId: { in: ['oi1'] }, returnRequest: { userId: 'u1', status: { not: 'REJECTED' } } });
    expect(prisma.productEcoFact.findMany.mock.calls[0][0].where).toEqual({ status: 'APPROVED', productId: { in: ['p1'] } });
    expect(p.plasticAvoidedGrams).toBe(200);
    expect(p.firstOrderAt).toBe('2026-10-02T03:00:00.000Z');
  });

  it('đệm 5 phút theo khách: khách khác không dùng chung, hết hạn thì tính lại', async () => {
    const prisma = makePrisma();
    const svc = new EcoPassportService(prisma as unknown as PrismaService, reader(true));
    await svc.passport('u1', NOW);
    await svc.passport('u1', new Date(NOW.getTime() + 60_000));
    expect(prisma.orderItem.findMany).toHaveBeenCalledTimes(1);
    await svc.passport('u2', NOW);
    expect(prisma.orderItem.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.orderItem.findMany.mock.calls[1][0].where.order.userId).toBe('u2');
    await svc.passport('u1', new Date(NOW.getTime() + 5 * 60_000 + 1));
    expect(prisma.orderItem.findMany).toHaveBeenCalledTimes(3);
  });

  it('khách chưa mua gì: không truy vấn trả hàng, phân loại hay sự thật', async () => {
    const prisma = makePrisma();
    prisma.orderItem.findMany.mockResolvedValue([]);
    prisma.order.findFirst.mockResolvedValue(null);
    prisma.variation.findMany.mockResolvedValue([]);
    const svc = new EcoPassportService(prisma as unknown as PrismaService, reader(true));
    const p = await svc.passport('u1', NOW);
    expect(prisma.returnRequestItem.findMany).not.toHaveBeenCalled();
    expect(prisma.productEcoFact.findMany).not.toHaveBeenCalled();
    expect(p.firstOrderAt).toBeNull();
  });
});
