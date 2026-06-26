import { CheckoutService } from './checkout.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { CartService } from '../cart/cart.service';
import type { CouponsService } from '../coupons/coupons.service';
import type { PricingService } from '../pricing/pricing.service';
import type { LoyaltyService } from '../loyalty/loyalty.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PancakeOrderService } from '../integrations/pancake/pancake-order.service';
import type { AffiliateService } from '../affiliate/affiliate.service';
import type { CoinsService } from '../wallet/coins.service';
import type { SystemConfigService } from '../system-config/system-config.service';

const ADDRESS = {
  id: 'addr1', userId: 'u1', recipient: 'A', phone: '09', province: 'HN', district: 'BD',
  ward: 'W', street: 'S', provinceCode: '1', districtCode: '2', wardCode: '3',
};
const CART = {
  items: [{ variationId: 'v1', productName: 'P', variationName: 'V', unitPrice: 100, quantity: 1, total: 100 }],
  subtotal: 100, discount: 0, freeship: false, couponCode: null,
};

function build(
  opts: {
    walletBalance?: number;
    coinsBalance?: number;
    total?: number;
    pointsUsed?: number;
    decCount?: number;
    stockCount?: number; // count trả về của variation.updateMany (decrement stock)
    variationUpdateMany?: jest.Mock; // override khi muốn mock chuỗi (race)
  } = {},
) {
  const total = opts.total ?? 100;
  const updateMany = jest.fn().mockResolvedValue({ count: opts.decCount ?? 1 });
  const orderCreate = jest.fn().mockResolvedValue({ id: 'o1' });
  const variationUpdateMany =
    opts.variationUpdateMany ?? jest.fn().mockResolvedValue({ count: opts.stockCount ?? 1 });
  const prisma = {
    order: { findUnique: jest.fn().mockResolvedValue(null), findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'o1', items: [] }), create: orderCreate },
    user: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', walletBalance: opts.walletBalance ?? 1000, coinsBalance: opts.coinsBalance ?? 1000, pointsBalance: 1000, tierId: null }),
      findUnique: jest.fn().mockResolvedValue(null),
      updateMany,
    },
    variation: { updateMany: variationUpdateMany },
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
  const coins = { spendCoins: jest.fn().mockResolvedValue(undefined) } as unknown as CoinsService;
  // config default → loyalty.earn_points_on_xu=false (đơn XU không sinh điểm).
  const config = { get: async <T>(_k: string, fb?: T): Promise<T> => fb as T } as unknown as SystemConfigService;

  const svc = new CheckoutService(prisma, cart, coupons, pricing, loyalty, notifications, pancake, affiliate, coins, config);
  return { svc, prisma, updateMany, orderCreate, variationUpdateMany, total, coins };
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

  it('XU số dư không đủ (check sớm) → BadRequest, không tạo đơn', async () => {
    const { svc, orderCreate } = build({ coinsBalance: 50, total: 100 });
    await expect(
      svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'XU' } as never),
    ).rejects.toThrow('TubuXu không đủ');
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it('XU hợp lệ → spendCoins(total) trong tx với reason ORDER_PAY + tạo đơn PAID', async () => {
    const { svc, coins, prisma } = build({ coinsBalance: 1000, total: 100 });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'XU' } as never);
    expect(coins.spendCoins).toHaveBeenCalledWith(
      'u1', 100, expect.stringMatching(/^ORDER_PAY:/), 'ORDER', 'o1', prisma,
    );
  });

  it('đơn XU KHÔNG sinh điểm Xanh (pointsEarned=0) — chống vòng khuếch đại ×1.2', async () => {
    const { svc, orderCreate } = build({ coinsBalance: 1000, total: 100 });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'XU' } as never);
    expect(orderCreate.mock.calls[0][0].data.pointsEarned).toBe(0);
  });

  it('đơn WALLET/COD VẪN sinh điểm bình thường (pointsEarned từ pricing)', async () => {
    const { svc, orderCreate } = build({ walletBalance: 1000, total: 100 });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'WALLET' } as never);
    expect(orderCreate.mock.calls[0][0].data.pointsEarned).toBe(10); // calcPointsEarned mock = 10
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

describe('CheckoutService.placeOrder — storefrontSlug attribution (Lớp 2)', () => {
  it('lưu storefrontSlug vào order khi đặt từ gian hàng', async () => {
    const { svc, orderCreate } = build({ stockCount: 1 });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD', storefrontSlug: 'linh-shop' } as never);
    expect(orderCreate.mock.calls[0][0].data.storefrontSlug).toBe('linh-shop');
  });

  it('storefrontSlug null khi không truyền', async () => {
    const { svc, orderCreate } = build({ stockCount: 1 });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never);
    expect(orderCreate.mock.calls[0][0].data.storefrontSlug).toBeNull();
  });
});

describe('CheckoutService.placeOrder — stock atomic (B5)', () => {
  it('stock đủ → trừ đúng số lượng atomic (where gte) + tạo đơn', async () => {
    const { svc, variationUpdateMany, orderCreate } = build({ stockCount: 1 });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never);
    expect(variationUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'v1', stock: { gte: 1 } },
        data: { stock: { decrement: 1 } },
      }),
    );
    expect(orderCreate).toHaveBeenCalled();
  });

  it('stock không đủ → BadRequestException, KHÔNG tạo order (rollback)', async () => {
    const { svc, orderCreate } = build({ stockCount: 0 });
    await expect(
      svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never),
    ).rejects.toThrow('không đủ tồn kho');
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it('B4: placeOrder với couponCode → coupons.redeem được gọi với tx (tham số 4)', async () => {
    // Đẩy couponCode vào CART rồi khôi phục để không ảnh hưởng test khác.
    (CART as { couponCode: string | null }).couponCode = 'SALE10';
    try {
      const { svc, prisma } = build({ stockCount: 1 });
      // Lấy reference tới coupons mock từ instance (đã inject trong build).
      const coupons = (svc as unknown as { coupons: { redeem: jest.Mock } }).coupons;
      await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never);
      expect(coupons.redeem).toHaveBeenCalledWith('SALE10', 'u1', 'o1', prisma);
    } finally {
      (CART as { couponCode: string | null }).couponCode = null;
    }
  });

  it('race 2 placeOrder đồng thời chỉ 1 thắng (lần 1 count=1, lần 2 count=0)', async () => {
    const variationUpdateMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 1 }) // request A thắng
      .mockResolvedValueOnce({ count: 0 }); // request B thua → throw
    const { svc } = build({ variationUpdateMany });
    // Lần 1 OK
    await expect(
      svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never),
    ).resolves.toBeDefined();
    // Lần 2 fail vì stock đã hết
    await expect(
      svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never),
    ).rejects.toThrow('không đủ tồn kho');
  });
});
