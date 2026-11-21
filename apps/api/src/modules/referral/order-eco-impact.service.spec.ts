import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import { OrderEcoImpactService } from './order-eco-impact.service';

const DELIVERED = { id: 'o1', code: 'TUBU1', status: 'DELIVERED', paymentStatus: 'UNPAID', type: 'RETAIL', placedForCustomer: false, pointsEarned: 120 };
const CUSTOMER = { referralCode: 'REF123', role: 'CUSTOMER', isBlocked: false, metadata: null, phone: '0900000001', zaloId: 'zalo_1' };

function setup(opts: { viral?: boolean; order?: Record<string, unknown> | null; user?: Record<string, unknown>; monthCount?: number; badges?: boolean } = {}) {
  const values: Record<string, unknown> = {
    'growth.referral_viral_enabled': opts.viral ?? true,
    'growth.referral_first_order_points': 100,
    'growth.referral_first_order_min': 199_000,
    'growth.referral_monthly_cap': 10,
    'eco.product_badges_enabled': opts.badges ?? false,
    'catalog.refill_pairs_override': [],
    'catalog.refill_pairs_block': [],
  };
  const config = { get: jest.fn(async (k: string, fb?: unknown) => (k in values ? values[k] : fb)) } as unknown as SystemConfigService;
  const orderFind = jest.fn().mockResolvedValue(opts.order === undefined ? DELIVERED : opts.order);
  const prisma = {
    order: { findFirst: orderFind },
    user: { findUnique: jest.fn().mockResolvedValue({ ...CUSTOMER, ...opts.user }) },
    orderItem: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'i1', variationId: 'v-refill', quantity: 2 },
        { id: 'i2', variationId: 'v-bottle', quantity: 1 },
      ]),
    },
    returnRequestItem: { findMany: jest.fn().mockResolvedValue([]) },
    returnRequest: { findMany: jest.fn().mockResolvedValue([{ pointsReversed: 20 }]) },
    variation: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'v-refill', productId: 'p-refill' },
        { id: 'v-bottle', productId: 'p-bottle' },
      ]),
    },
    product: {
      // Lần 1: danh mục công khai cho bảng cặp; lần 2: tên/slug theo id.
      findMany: jest.fn(async (args: { where: { id?: unknown } }) =>
        args.where.id
          ? [
              { id: 'p-refill', slug: 'refill-nuoc-rua-chen-fuwa3e-10l', name: 'Refill Nước rửa chén Fuwa3e 10L' },
              { id: 'p-bottle', slug: 'nuoc-rua-chen-fuwa3e-3-8l', name: 'Nước rửa chén Fuwa3e 3,8L' },
            ]
          : [
              { id: 'p-refill', slug: 'refill-nuoc-rua-chen-fuwa3e-10l', name: 'Refill Nước rửa chén Fuwa3e 10L', brand: 'Fuwa3e', isCombo: false },
              { id: 'p-bottle', slug: 'nuoc-rua-chen-fuwa3e-3-8l', name: 'Nước rửa chén Fuwa3e 3,8L', brand: 'Fuwa3e', isCombo: false },
            ],
      ),
    },
    productEcoFact: { findMany: jest.fn().mockResolvedValue([]) },
    pointsTransaction: {
      findMany: jest.fn().mockResolvedValue(Array.from({ length: opts.monthCount ?? 0 }, (_, i) => ({ reason: `REFERRAL_FIRST_ORDER_REFERRER:f${i}` }))),
      count: jest.fn().mockResolvedValue(0),
    },
  };
  return { svc: new OrderEcoImpactService(prisma as unknown as PrismaService, config), prisma, orderFind };
}

describe('OrderEcoImpactService.forOrder', () => {
  it('đơn đã giao có 2 gói Refill 10L (chai ghép 3,8L): 5 chai bớt, điểm trừ phần thu lại, link mời kèm thưởng đơn đầu', async () => {
    const { svc, orderFind } = setup();
    const r = await svc.forOrder('u1', 'TUBU1');
    expect(orderFind).toHaveBeenCalledWith(expect.objectContaining({ where: { code: 'TUBU1', userId: 'u1' } }));
    expect(r).toEqual({
      orderCode: 'TUBU1',
      bottlesSaved: 5,
      plasticGrams: 0,
      refillPacks: 2,
      points: 100,
      pointsCredited: true,
      referralCode: 'REF123',
      inviteReward: { points: 100, minOrderAmount: 199_000 },
    });
  });

  it('cờ growth.referral_viral_enabled tắt: 404, không đọc đơn', async () => {
    const { svc, orderFind } = setup({ viral: false });
    await expect(svc.forOrder('u1', 'TUBU1')).rejects.toBeInstanceOf(NotFoundException);
    expect(orderFind).not.toHaveBeenCalled();
  });

  it('đơn không phải của khách: 404', async () => {
    const { svc } = setup({ order: null });
    await expect(svc.forOrder('u2', 'TUBU1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('COD chưa giao: số 0 (app không vẽ thẻ), không đọc dòng đơn', async () => {
    const { svc, prisma } = setup({ order: { ...DELIVERED, status: 'CONFIRMED', paymentStatus: 'UNPAID' } });
    const r = await svc.forOrder('u1', 'TUBU1');
    expect(r.bottlesSaved).toBe(0);
    expect(r.inviteReward).toBeNull();
    expect(prisma.orderItem.findMany).not.toHaveBeenCalled();
  });

  it('đã chuyển khoản, đang giao: thẻ hiện, điểm chưa vào ví', async () => {
    const { svc } = setup({ order: { ...DELIVERED, status: 'SHIPPING', paymentStatus: 'PAID' } });
    const r = await svc.forOrder('u1', 'TUBU1');
    expect(r.bottlesSaved).toBe(5);
    expect(r.pointsCredited).toBe(false);
  });

  it('CTV hay khách đã chạm trần tháng: vẫn có thẻ và link mời, không hứa thưởng', async () => {
    expect((await setup({ user: { role: 'AFFILIATE' } }).svc.forOrder('u1', 'TUBU1')).inviteReward).toBeNull();
    expect((await setup({ monthCount: 10 }).svc.forOrder('u1', 'TUBU1')).inviteReward).toBeNull();
  });

  it('gói Refill đang chờ trả hết: không còn chai bớt, số 0', async () => {
    const { svc, prisma } = setup();
    prisma.returnRequestItem.findMany.mockResolvedValue([{ orderItemId: 'i1', quantity: 2 }]);
    const r = await svc.forOrder('u1', 'TUBU1');
    expect(r.bottlesSaved).toBe(0);
    expect(r.points).toBe(0);
  });
});
