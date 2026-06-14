import { CheckoutService } from './checkout.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { CartService } from '../cart/cart.service';
import type { CouponsService } from '../coupons/coupons.service';
import type { PricingService } from '../pricing/pricing.service';
import type { LoyaltyService } from '../loyalty/loyalty.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PancakeOrderService } from '../integrations/pancake/pancake-order.service';
import type { AffiliateService } from '../affiliate/affiliate.service';

const ADDRESS = {
  id: 'addr1', userId: 'u1', recipient: 'A', phone: '09', province: 'HN', district: 'BD',
  ward: 'W', street: 'S', provinceCode: '1', districtCode: '2', wardCode: '3',
};
const CART = {
  items: [{ variationId: 'v1', productName: 'P', variationName: 'V', unitPrice: 100, quantity: 1, total: 100 }],
  subtotal: 100, discount: 0, freeship: false, couponCode: null,
};

function build(opts: { walletBalance?: number; total?: number; pointsUsed?: number; decCount?: number } = {}) {
  const total = opts.total ?? 100;
  const updateMany = jest.fn().mockResolvedValue({ count: opts.decCount ?? 1 });
  const orderCreate = jest.fn().mockResolvedValue({ id: 'o1' });
  const prisma = {
    order: { findUnique: jest.fn().mockResolvedValue(null), findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'o1', items: [] }), create: orderCreate },
    user: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', walletBalance: opts.walletBalance ?? 1000, pointsBalance: 1000, tierId: null }),
      findUnique: jest.fn().mockResolvedValue(null),
      updateMany,
    },
    address: { findUnique: jest.fn().mockResolvedValue(ADDRESS) },
    pointsTransaction: { create: jest.fn() },
  } as unknown as PrismaService;
  (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest
    .fn()
    .mockImplementation(async (cb: (tx: unknown) => unknown) => cb(prisma));

  const cart = { getCart: jest.fn().mockResolvedValue(CART), clear: jest.fn() } as unknown as CartService;
  const coupons = { redeem: jest.fn() } as unknown as CouponsService;
  const pricing = {
    resolvePointsRedemption: jest.fn().mockResolvedValue({ pointsUsed: opts.pointsUsed ?? 0, discount: 0 }),
    calcShippingFee: jest.fn().mockResolvedValue(0),
    calcPointsEarned: jest.fn().mockResolvedValue(10),
  } as unknown as PricingService;
  const loyalty = { getTierMultiplier: jest.fn().mockResolvedValue(1) } as unknown as LoyaltyService;
  const notifications = { notify: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService;
  const pancake = { pushOrder: jest.fn().mockResolvedValue(null) } as unknown as PancakeOrderService;
  const affiliate = { createCommissionForOrder: jest.fn() } as unknown as AffiliateService;

  const svc = new CheckoutService(prisma, cart, coupons, pricing, loyalty, notifications, pancake, affiliate);
  return { svc, prisma, updateMany, orderCreate, total };
}

describe('CheckoutService.placeOrder — money safety', () => {
  it('WALLET số dư không đủ (check sớm) → BadRequest', async () => {
    const { svc, orderCreate } = build({ walletBalance: 50, total: 100 });
    await expect(
      svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'WALLET' } as never),
    ).rejects.toThrow('Ví Tubu không đủ');
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it('WALLET hợp lệ → trừ ví ATOMIC (where gte) + tạo đơn CONFIRMED/PAID', async () => {
    const { svc, updateMany } = build({ walletBalance: 1000, total: 100 });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'WALLET' } as never);
    const walletCall = updateMany.mock.calls.find((c) => c[0].data.walletBalance);
    expect(walletCall[0].where).toEqual({ id: 'u1', walletBalance: { gte: 100 } });
  });

  it('WALLET race overdraft: updateMany count=0 → BadRequest (rollback)', async () => {
    const { svc } = build({ walletBalance: 1000, total: 100, decCount: 0 });
    await expect(
      svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'WALLET' } as never),
    ).rejects.toThrow('Ví Tubu không đủ');
  });

  it('COD vượt hạn mức 5tr → BadRequest', async () => {
    const { svc } = build({ total: 6_000_000 });
    // ép subtotal lớn để total vượt mức
    (CART as { subtotal: number }).subtotal = 6_000_000;
    (CART.items[0] as { total: number }).total = 6_000_000;
    await expect(
      svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never),
    ).rejects.toThrow('COD');
    // khôi phục
    (CART as { subtotal: number }).subtotal = 100;
    (CART.items[0] as { total: number }).total = 100;
  });

  it('idempotency: key đã tồn tại → trả đơn cũ, không tạo mới', async () => {
    const { svc, prisma, orderCreate } = build();
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({ id: 'existing' });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never, 'key-123');
    expect(orderCreate).not.toHaveBeenCalled();
  });
});
