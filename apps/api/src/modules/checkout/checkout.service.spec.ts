import { BadRequestException } from '@nestjs/common';
import { CheckoutService } from './checkout.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { CartService } from '../cart/cart.service';
import type { CouponsService } from '../coupons/coupons.service';
import type { PricingService } from '../pricing/pricing.service';
import { LoyaltyService, type LockedPoints } from '../loyalty/loyalty.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PancakeOrderService } from '../integrations/pancake/pancake-order.service';
import type { GomdonOrderService } from '../integrations/gomdon/gomdon-order.service';
import type { AffiliateService } from '../affiliate/affiliate.service';
import type { CoinsService } from '../wallet/coins.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { ComboService } from '../storefront/combo.service';

const ADDRESS = {
  id: 'addr1', userId: 'u1', recipient: 'A', phone: '09', province: 'HN', district: 'BD',
  ward: 'W', street: 'S', provinceCode: '1', districtCode: '2', wardCode: '3',
};
const CART = {
  items: [{ variationId: 'v1', productId: 'prod1', productName: 'P', variationName: 'V', unitPrice: 100, quantity: 1, total: 100 }],
  subtotal: 100, discount: 0, freeship: false, couponCode: null,
};

function build(
  opts: {
    walletBalance?: number;
    coinsBalance?: number;
    total?: number;
    pointsUsed?: number;
    decCount?: number;
    stockCount?: number; // số dòng câu UPDATE giữ chỗ tồn kho sửa được (0 = hết hàng)
    executeRaw?: jest.Mock; // override khi muốn mock chuỗi (race)
    combo?: { computeForStorefront: jest.Mock }; // override ComboService
    validateAndCompute?: jest.Mock; // override coupons.validateAndCompute
    getActiveTouch?: jest.Mock; // override affiliate.getActiveTouch (attribution 3 ngày)
    cartData?: unknown; // override giỏ (test checkout tập con)
    flashSale?: { consumeQuota: jest.Mock; resolveEffective: jest.Mock }; // override FlashSaleService
    gomdon?: unknown;
    pointsBalance?: number;
    /** Điểm Xanh còn có thể bị đảo (LoyaltyService.lockedOrderPoints) — mặc định 0. */
    locked?: number;
  } = {},
) {
  const total = opts.total ?? 100;
  const updateMany = jest.fn().mockResolvedValue({ count: opts.decCount ?? 1 });
  const orderCreate = jest.fn().mockImplementation((args: any) => Promise.resolve({ id: 'o1', ...(args?.data ?? {}) }));
  // Giữ chỗ tồn kho đi bằng SQL thô (catalog/variation-stock.ts) — trả SỐ DÒNG bị sửa.
  const executeRaw = opts.executeRaw ?? jest.fn().mockResolvedValue(opts.stockCount ?? 1);
  const prisma = {
    order: { findUnique: jest.fn().mockResolvedValue(null), findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'o1', items: [] }), create: orderCreate },
    user: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', walletBalance: opts.walletBalance ?? 1000, coinsBalance: opts.coinsBalance ?? 1000, pointsBalance: opts.pointsBalance ?? 1000, tierId: null }),
      findUnique: jest.fn().mockResolvedValue(null),
      updateMany,
    },
    $executeRaw: executeRaw,
    // SELECT … FOR UPDATE khoá dòng users trước khi trừ điểm (xem placeOrder).
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'u1' }]),
    address: { findUnique: jest.fn().mockResolvedValue(ADDRESS) },
    pointsTransaction: { create: jest.fn() },
  } as unknown as PrismaService;
  (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest
    .fn()
    .mockImplementation(async (cb: (tx: unknown) => unknown) => cb(prisma));

  const cart = { getCart: jest.fn().mockResolvedValue(opts.cartData ?? CART), clear: jest.fn(), removeItems: jest.fn() } as unknown as CartService;
  const coupons = {
    redeem: jest.fn(),
    validateAndCompute:
      opts.validateAndCompute ?? jest.fn().mockResolvedValue({ discount: 0, freeship: false }),
  } as unknown as CouponsService;
  const pricing = {
    resolvePointsRedemption: jest.fn().mockResolvedValue({ pointsUsed: opts.pointsUsed ?? 0, discount: 0 }),
    calcShippingFee: jest.fn().mockResolvedValue(0),
    calcPointsEarned: jest.fn().mockResolvedValue(10),
  } as unknown as PricingService;
  const lock: LockedPoints = { locked: opts.locked ?? 0, lockedReturn: 0, lockedUntil: null };
  const loyalty = {
    getTierMultiplier: jest.fn().mockResolvedValue(1),
    lockedOrderPoints: jest.fn().mockResolvedValue(lock),
    // Câu giải thích THẬT (không phụ thuộc state) — lỗi checkout phải dùng đúng câu của redeemReward.
    lockedPointsMessage: (l: LockedPoints) => LoyaltyService.prototype.lockedPointsMessage.call({}, l),
  } as unknown as LoyaltyService;
  const notifications = { notify: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService;
  const pancake = { enqueuePush: jest.fn().mockResolvedValue(undefined) } as unknown as PancakeOrderService;
  const gomdon = (opts.gomdon ?? {
    enqueuePush: jest.fn().mockResolvedValue(undefined),
    isRecyclingEnabled: jest.fn().mockResolvedValue(true),
  }) as unknown as GomdonOrderService;
  const affiliate = {
    createCommissionForOrder: jest.fn().mockResolvedValue(undefined),
    getActiveTouch: opts.getActiveTouch ?? jest.fn().mockResolvedValue(null),
  } as unknown as AffiliateService;
  const coins = { spendCoins: jest.fn().mockResolvedValue(undefined) } as unknown as CoinsService;
  // config default → loyalty.earn_points_on_xu=false (đơn XU không sinh điểm).
  const config = { get: async <T>(_k: string, fb?: T): Promise<T> => fb as T } as unknown as SystemConfigService;
  // combo mặc định: không giảm (override qua opts.combo cho test combo).
  const combo = (opts.combo ?? { computeForStorefront: jest.fn().mockResolvedValue({ total: 0, perLine: {} }) }) as unknown as ComboService;
  // flash-sale mặc định: consumeQuota no-op OK (override qua opts.flashSale cho test flash).
  const flashSale = (opts.flashSale ?? {
    consumeQuota: jest.fn().mockResolvedValue(undefined),
    resolveEffective: jest.fn().mockResolvedValue(new Map()),
  }) as any;

  const svc = new CheckoutService(prisma, cart, coupons, pricing, loyalty, notifications, pancake, gomdon, affiliate, coins, config, combo, flashSale);
  return { svc, prisma, updateMany, orderCreate, executeRaw, total, coins, combo, cart, coupons, flashSale, pancake, gomdon, pricing, loyalty };
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

  it('idempotency: key đã tồn tại, cùng user + cùng payload → trả đơn cũ, không tạo mới', async () => {
    const { svc, prisma, orderCreate } = build();
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({
      id: 'existing',
      userId: 'u1',
      paymentMethod: 'COD',
      // Thứ tự khoá CỐ Ý đảo khác addressSnapshot() (recipient/phone/province/district/ward/
      // street/provinceCode/districtCode/wardCode) — mô phỏng đúng hành vi Postgres `jsonb`
      // thật (không giữ thứ tự chèn, xem comment stableStringify). Test này TỪNG xanh giả vì
      // mock trả thẳng thứ tự đã viết trong code, không đi qua jsonb thật — đảo thứ tự ở đây để
      // lần sau ai lỡ quay lại so `JSON.stringify` thô thì test đỏ ngay, không phải đợi phát
      // hiện trên Postgres thật.
      shippingAddress: {
        ward: 'W', phone: '09', street: 'S', district: 'BD', province: 'HN',
        wardCode: '3', recipient: 'A', districtCode: '2', provinceCode: '1',
      },
    });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never, 'key-123');
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it('idempotency IDOR: key trùng nhưng thuộc user KHÁC → BadRequest, KHÔNG lộ đơn của user khác', async () => {
    const { svc, prisma, orderCreate } = build();
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({
      id: 'existing-of-u2',
      userId: 'u2',
      paymentMethod: 'COD',
      shippingAddress: {},
    });
    await expect(
      svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never, 'key-shared'),
    ).rejects.toThrow('Idempotency-Key không hợp lệ');
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it('idempotency payload đổi (đổi phương thức thanh toán) → BadRequest, KHÔNG âm thầm trả đơn cũ', async () => {
    const { svc, prisma, orderCreate } = build();
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({
      id: 'existing',
      userId: 'u1',
      paymentMethod: 'COD', // đơn cũ đã tạo bằng COD
      shippingAddress: {
        recipient: 'A', phone: '09', province: 'HN', district: 'BD', ward: 'W', street: 'S',
        provinceCode: '1', districtCode: '2', wardCode: '3',
      },
    });
    // Lần gọi lại đổi sang WALLET với CÙNG key (client tưởng lần trước fail).
    await expect(
      svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'WALLET' } as never, 'key-123'),
    ).rejects.toThrow('thông tin khác đã được xử lý');
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it('idempotency payload đổi (đổi địa chỉ giao hàng) → BadRequest, KHÔNG âm thầm trả đơn cũ', async () => {
    const { svc, prisma, orderCreate } = build();
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({
      id: 'existing',
      userId: 'u1',
      paymentMethod: 'COD',
      shippingAddress: {
        recipient: 'A', phone: '09', province: 'HN', district: 'BD', ward: 'W', street: 'S',
        provinceCode: '1', districtCode: '2', wardCode: '3',
      },
    });
    // address.findUnique mặc định trả ADDRESS (addr1, HN/BD) — mock đè để mô phỏng đổi sang địa chỉ khác.
    (prisma.address.findUnique as jest.Mock).mockResolvedValue({
      id: 'addr2', userId: 'u1', recipient: 'A', phone: '09', province: 'HCM', district: 'Q1',
      ward: 'W2', street: 'S2', provinceCode: '9', districtCode: '8', wardCode: '7',
    });
    await expect(
      svc.placeOrder('u1', { addressId: 'addr2', paymentMethod: 'COD' } as never, 'key-123'),
    ).rejects.toThrow('thông tin khác đã được xử lý');
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

  it('attribution 3 ngày: KHÔNG có referralCode nhưng còn touch → referrer + slug từ touch', async () => {
    const getActiveTouch = jest.fn().mockResolvedValue({ referrerUserId: 'ctv9', storefrontSlug: 'shopX', kind: 'ctv' });
    const { svc, orderCreate } = build({ stockCount: 1, getActiveTouch });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never);
    const data = orderCreate.mock.calls[0][0].data;
    expect(data.referrerUserId).toBe('ctv9');
    expect(data.storefrontSlug).toBe('shopX');
  });

  it('attribution 3 ngày: touch kind=brand → KHÔNG lấy storefrontSlug (vẫn lấy referrer)', async () => {
    const getActiveTouch = jest.fn().mockResolvedValue({ referrerUserId: 'ctv9', storefrontSlug: null, kind: 'brand' });
    const { svc, orderCreate } = build({ stockCount: 1, getActiveTouch });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never);
    const data = orderCreate.mock.calls[0][0].data;
    expect(data.referrerUserId).toBe('ctv9');
    expect(data.storefrontSlug).toBeNull();
  });

  // P0 A5-01 (đường CHÍNH, không phải fallback touch 3 ngày): slug gian hàng CTV mở trong Zalo
  // là referralCode viết THƯỜNG (storefront.service.ts sinh slug = referralCode.toLowerCase()),
  // trong khi User.referralCode luôn lưu HOA — resolveReferrer tra khớp phân biệt hoa/thường nên
  // referrer luôn null, CTV không bao giờ được ghi nhận hoa hồng cho khách mua ngay trong Zalo.
  it('P0 A5-01: referralCode viết THƯỜNG (từ slug gian hàng mở trong Zalo) vẫn khớp User.referralCode viết HOA', async () => {
    const getActiveTouch = jest.fn().mockResolvedValue(null);
    const { svc, prisma, orderCreate } = build({ stockCount: 1, getActiveTouch });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'ctv9', referralCode: 'ABCD1234' });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD', referralCode: 'abcd1234' } as never);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { referralCode: 'ABCD1234' } });
    expect(orderCreate.mock.calls[0][0].data.referrerUserId).toBe('ctv9');
  });
});

describe('CheckoutService.placeOrder — combo discount (§7.2)', () => {
  it('combo giảm: trừ vào OrderItem.total + cộng vào order.discount + giảm total', async () => {
    const combo = { computeForStorefront: jest.fn().mockResolvedValue({ total: 10, perLine: { v1: 10 } }) };
    const { svc, orderCreate } = build({ stockCount: 1, combo });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD', storefrontSlug: 'linh-shop' } as never);
    const data = orderCreate.mock.calls[0][0].data;
    // item.total = 100 - 10 = 90 → hoa hồng tính trên 90
    expect(data.items.create[0].total).toBe(90);
    // order.discount gồm combo (coupon 0 + combo 10 + points 0)
    expect(data.discount).toBe(10);
    // total = goods (100-10) + ship(0) = 90
    expect(data.total).toBe(90);
  });

  it('combo nhận đúng storefrontSlug + lines có productId', async () => {
    const combo = { computeForStorefront: jest.fn().mockResolvedValue({ total: 0, perLine: {} }) };
    const { svc } = build({ stockCount: 1, combo });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD', storefrontSlug: 'linh-shop' } as never);
    expect(combo.computeForStorefront).toHaveBeenCalledWith(
      'linh-shop',
      [{ variationId: 'v1', productId: 'prod1', total: 100 }],
    );
  });

  it('không combo (perLine rỗng) → item.total giữ nguyên', async () => {
    const { svc, orderCreate } = build({ stockCount: 1 });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never);
    expect(orderCreate.mock.calls[0][0].data.items.create[0].total).toBe(100);
  });

  it('combo + coupon TUẦN TỰ: coupon tính trên base SAU combo (không giảm chồng) + invariant', async () => {
    // subtotal 100, combo 20 → goodsAfterCombo 80; coupon 30% → validateAndCompute(_, 80) = 24
    const combo = { computeForStorefront: jest.fn().mockResolvedValue({ total: 20, perLine: { v1: 20 } }) };
    const validateAndCompute = jest.fn().mockResolvedValue({ discount: 24, freeship: false });
    (CART as { couponCode: string | null }).couponCode = 'SALE30';
    try {
      const { svc, orderCreate } = build({ stockCount: 1, combo, validateAndCompute });
      await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD', storefrontSlug: 'linh-shop' } as never);
      // coupon được tính trên 80 (sau combo), KHÔNG phải 100
      expect(validateAndCompute).toHaveBeenCalledWith('SALE30', 'u1', 80);
      const data = orderCreate.mock.calls[0][0].data;
      // discount = combo 20 + coupon 24 = 44 (≤ subtotal); total = 100 - 44 = 56
      expect(data.discount).toBe(44);
      expect(data.total).toBe(56);
      expect(data.discount).toBeLessThanOrEqual(data.subtotal);
    } finally {
      (CART as { couponCode: string | null }).couponCode = null;
    }
  });

  it('invariant: tổng giảm KHÔNG vượt subtotal (coupon AMOUNT lớn + combo)', async () => {
    // subtotal 100, combo 20 → 80; coupon AMOUNT 90 nhưng validateAndCompute trả min(90,80)=80
    const combo = { computeForStorefront: jest.fn().mockResolvedValue({ total: 20, perLine: { v1: 20 } }) };
    const validateAndCompute = jest.fn().mockResolvedValue({ discount: 80, freeship: false });
    (CART as { couponCode: string | null }).couponCode = 'BIG';
    try {
      const { svc, orderCreate } = build({ stockCount: 1, combo, validateAndCompute });
      await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD', storefrontSlug: 'linh-shop' } as never);
      const data = orderCreate.mock.calls[0][0].data;
      // combo 20 + coupon 80 = 100 = subtotal; total = 0
      expect(data.discount).toBe(100);
      expect(data.discount).toBeLessThanOrEqual(data.subtotal);
      expect(data.total).toBe(0);
    } finally {
      (CART as { couponCode: string | null }).couponCode = null;
    }
  });
});

describe('CheckoutService.placeOrder — stock atomic (B5)', () => {
  it('stock đủ → trừ đúng số lượng atomic (where gte) + tạo đơn', async () => {
    const { svc, executeRaw, orderCreate } = build({ stockCount: 1 });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never);
    // Tham số câu UPDATE giữ chỗ: (số lượng, số lượng, variationId, số lượng) — điều kiện
    // `stock >= số lượng` nằm TRONG câu lệnh nên hai đơn tranh nhau chỉ một đơn thắng.
    expect(executeRaw.mock.calls[0]!.slice(1)).toEqual([1, 1, 'v1', 1]);
    expect((executeRaw.mock.calls[0]![0] as string[]).join('?')).toContain('reservedStock');
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
    const executeRaw = jest
      .fn()
      .mockResolvedValueOnce(1) // request A thắng
      .mockResolvedValueOnce(0); // request B thua → throw
    const { svc } = build({ executeRaw });
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

/**
 * Điểm Xanh của đơn vừa giao còn có thể bị đảo (trả hàng trong hạn / đang có yêu cầu đổi-trả / đã huỷ-trả
 * chờ trừ) — LoyaltyService.redeemReward đã từ chối tiêu phần đó; checkout trước đây thì không: nhận điểm
 * đơn A → tiêu ngay vào đơn B → trả đơn A (điểm bị trừ lại, số dư có thể âm) nhưng giảm giá ở đơn B vẫn giữ.
 */
describe('CheckoutService — chỉ tiêu Điểm Xanh DÙNG ĐƯỢC (cùng luật lockedOrderPoints của đổi quà)', () => {
  it('quote: kẹp điểm theo số dùng được (số dư − phần khoá) và trả redeemablePoints/lockedPoints cho FE', async () => {
    const { svc, pricing } = build({ pointsBalance: 1000, locked: 600 });
    const q = await svc.quote('u1', { addressId: 'addr1', pointsToUse: 1000 } as never);
    expect(pricing.resolvePointsRedemption).toHaveBeenCalledWith(1000, 400, expect.any(Number));
    expect(q).toMatchObject({ pointsBalance: 1000, lockedPoints: 600, redeemablePoints: 400 });
  });

  it('quote: phần khoá ≥ số dư (điểm đã tiêu trước đó) → redeemablePoints = 0, không âm; không tiêu điểm nào', async () => {
    const { svc, pricing } = build({ pointsBalance: 100, locked: 250 });
    const q = await svc.quote('u1', { addressId: 'addr1', pointsToUse: 100 } as never);
    expect(pricing.resolvePointsRedemption).toHaveBeenCalledWith(100, 0, expect.any(Number));
    expect(q.redeemablePoints).toBe(0);
  });

  it('placeOrder: kẹp theo số dùng được như quote (không tin pointsToUse client gửi)', async () => {
    const { svc, pricing } = build({ pointsBalance: 1000, locked: 600, pointsUsed: 400 });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD', pointsToUse: 1000 } as never);
    expect(pricing.resolvePointsRedemption).toHaveBeenCalledWith(1000, 400, expect.any(Number));
  });

  it('placeOrder: khoá dòng user (FOR UPDATE) rồi tính phần khoá TRONG tx, guard pointsBalance ≥ dùng + khoá', async () => {
    const { svc, prisma, updateMany, loyalty } = build({ pointsBalance: 1000, locked: 600, pointsUsed: 300 });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD', pointsToUse: 300 } as never);
    const queryRaw = prisma.$queryRaw as unknown as jest.Mock;
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect((queryRaw.mock.calls[0][0] as string[]).join('?')).toMatch(/FROM "users"[\s\S]*FOR UPDATE/);
    expect(queryRaw.mock.calls[0][1]).toBe('u1');
    const lockedCalls = (loyalty.lockedOrderPoints as jest.Mock).mock;
    // Lần đọc trong tx nhận CHÍNH tx (ở mock này tx = prisma) và chạy SAU khi đã khoá dòng user.
    const inTxIdx = lockedCalls.calls.findIndex((c) => c[2] === prisma);
    expect(inTxIdx).toBeGreaterThanOrEqual(0);
    expect(lockedCalls.invocationCallOrder[inTxIdx]).toBeGreaterThan(queryRaw.mock.invocationCallOrder[0]!);
    const pointsCall = updateMany.mock.calls.find((c) => c[0].data.pointsBalance);
    expect(pointsCall[0]).toEqual({
      where: { id: 'u1', pointsBalance: { gte: 900 } },
      data: { pointsBalance: { decrement: 300 } },
    });
  });

  it('placeOrder: điểm vừa bị khoá giữa báo giá và đặt đơn (đơn cũ vừa chuyển trả hàng) → lỗi tiếng Việt giải thích, không tạo đơn', async () => {
    const { svc, prisma, loyalty } = build({ pointsBalance: 1000, locked: 0, pointsUsed: 500, decCount: 0 });
    // Ngoài tx (báo giá/compute) chưa khoá gì; trong tx: 800 điểm đơn cũ đang chờ xử lý đổi/trả.
    (loyalty.lockedOrderPoints as jest.Mock)
      .mockResolvedValueOnce({ locked: 0, lockedReturn: 0, lockedUntil: null })
      .mockResolvedValueOnce({ locked: 800, lockedReturn: 800, lockedUntil: null });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ pointsBalance: 1000 });
    const err = await svc
      .placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD', pointsToUse: 500 } as never)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toBe(
      'Đơn này dùng 500 Điểm Xanh nhưng hiện bạn chỉ dùng được 200/1000 điểm: 800 điểm từ đơn đang chờ xử lý đổi/trả sẽ dùng được khi yêu cầu được xử lý xong. Vui lòng tải lại trang thanh toán.',
    );
  });

  it('placeOrder: số dư thật sự không đủ (không liên quan phần khoá) → giữ thông báo cũ', async () => {
    const { svc, prisma } = build({ pointsBalance: 1000, locked: 0, pointsUsed: 500, decCount: 0 });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ pointsBalance: 100 });
    await expect(
      svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD', pointsToUse: 500 } as never),
    ).rejects.toThrow('Số điểm Xanh không đủ (hiện có 100 điểm).');
  });

  it('placeOrder không dùng điểm → KHÔNG khoá dòng user, KHÔNG đọc phần khoá trong tx', async () => {
    const { svc, prisma, loyalty } = build({ pointsBalance: 1000, locked: 600, pointsUsed: 0 });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never);
    expect(prisma.$queryRaw as unknown as jest.Mock).not.toHaveBeenCalled();
    expect((loyalty.lockedOrderPoints as jest.Mock).mock.calls.some((c) => c[2] !== undefined)).toBe(false);
  });

  /**
   * CONCURRENCY: 2 đơn song song, cả hai báo giá lúc số dư còn 100 (khoá 30 → dùng được 70) và mỗi
   * đơn xin 40 điểm. Guard cũ (`pointsBalance >= dùng`) cho cả hai qua: tổng tiêu 80 > 70, 10 điểm
   * của đơn còn có thể bị trả đã bị tiêu. Guard mới (khoá dòng user + `>= dùng + khoá`) chỉ cho 1 đơn.
   */
  it('CONCURRENCY: 2 đơn song song cùng tiêu điểm — tổng điểm tiêu KHÔNG lấn vào phần khoá', async () => {
    const LOCKED = 30;
    const state = { pointsBalance: 100 };
    const { svc, prisma, pricing, loyalty } = build({ locked: LOCKED });
    const tick = () => new Promise((r) => setImmediate(r));
    // Rào chắn: cả 2 compute() đều đọc số dư 100 trước khi đơn nào kịp vào tx.
    let reads = 0;
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    (prisma.user.findUniqueOrThrow as jest.Mock).mockImplementation(async () => {
      const snap = { id: 'u1', walletBalance: 0, coinsBalance: 0, pointsBalance: state.pointsBalance, tierId: null };
      reads += 1;
      if (reads === 2) open();
      await gate;
      return snap;
    });
    (prisma.user.findUnique as jest.Mock).mockImplementation(async () => ({ pointsBalance: state.pointsBalance }));
    (pricing.resolvePointsRedemption as jest.Mock).mockImplementation(async (want: number, usable: number) => {
      const used = Math.max(0, Math.min(want, usable));
      return { pointsUsed: used, discount: used };
    });
    (loyalty.lockedOrderPoints as jest.Mock).mockImplementation(async () => {
      await tick();
      return { locked: LOCKED, lockedReturn: LOCKED, lockedUntil: null };
    });
    (prisma.user.updateMany as unknown as jest.Mock).mockImplementation(async ({ where, data }: any) => {
      await tick();
      if (where.pointsBalance?.gte != null && !(state.pointsBalance >= where.pointsBalance.gte)) return { count: 0 };
      if (data.pointsBalance?.decrement) state.pointsBalance -= data.pointsBalance.decrement;
      return { count: 1 };
    });
    // Khoá dòng users kiểu Postgres: FOR UPDATE giữ tới hết transaction.
    let chain = Promise.resolve();
    let txCalls = 0;
    (prisma as unknown as { $transaction: jest.Mock }).$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      txCalls += 1;
      const releases: (() => void)[] = [];
      const tx = {
        ...prisma,
        $queryRaw: async (strings: TemplateStringsArray) => {
          if (!/FOR UPDATE/.test(strings.join('?'))) throw new Error('unexpected raw');
          let release!: () => void;
          const mine = new Promise<void>((r) => (release = r));
          const prev = chain;
          chain = prev.then(() => mine);
          await prev;
          releases.push(release);
          return [{ id: 'u1' }];
        },
      };
      try {
        return await cb(tx);
      } finally {
        releases.forEach((r) => r());
      }
    });

    const results = await Promise.allSettled([
      svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD', pointsToUse: 40 } as never),
      svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD', pointsToUse: 40 } as never),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(txCalls).toBe(2); // cả 2 lọt kiểm tra ngoài tx → chính guard trong tx chặn kẻ thua
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.reason).toBeInstanceOf(BadRequestException);
    expect((failed[0]!.reason as Error).message).toContain('dùng được 30/60 điểm');
    expect(state.pointsBalance).toBe(60);
    expect(state.pointsBalance).toBeGreaterThanOrEqual(LOCKED);
  });
});

describe('CheckoutService — checkout TẬP CON (chọn từng món)', () => {
  // Giỏ 2 dòng: chọn thanh toán chỉ 1 dòng (i2).
  const TWO_ITEM_CART = {
    items: [
      { id: 'i1', variationId: 'v1', productId: 'p1', productName: 'A', variationName: 'VA', unitPrice: 100, quantity: 1, total: 100 },
      { id: 'i2', variationId: 'v2', productId: 'p2', productName: 'B', variationName: 'VB', unitPrice: 300, quantity: 1, total: 300 },
    ],
    subtotal: 400, discount: 0, freeship: false, couponCode: null,
  };

  it('quote itemIds=[i2] → subtotal chỉ tính dòng đã chọn (300, không phải 400)', async () => {
    const { svc } = build({ cartData: TWO_ITEM_CART });
    const q = await svc.quote('u1', { addressId: 'addr1', itemIds: ['i2'] } as never);
    expect(q.subtotal).toBe(300);
    expect(q.items).toHaveLength(1);
    expect(q.items[0]?.id).toBe('i2');
  });

  it('placeOrder itemIds=[i2] → chỉ xoá món đã mua (removeItems), KHÔNG clear cả giỏ', async () => {
    const { svc, cart } = build({ cartData: TWO_ITEM_CART });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD', itemIds: ['i2'] } as never);
    const cartMock = cart as unknown as { removeItems: jest.Mock; clear: jest.Mock };
    expect(cartMock.removeItems).toHaveBeenCalledWith('u1', ['i2']);
    expect(cartMock.clear).not.toHaveBeenCalled();
  });

  it('subset < minOrder coupon → BỎ coupon (không redeem, order.couponCode=null)', async () => {
    // Coupon áp được trên full cart, nhưng subset 300đ < minOrder → validateAndCompute THROW.
    const validateAndCompute = jest.fn().mockRejectedValue(new Error('Đơn tối thiểu chưa đạt'));
    const { svc, orderCreate, coupons } = build({
      cartData: { ...TWO_ITEM_CART, couponCode: 'GIAM50', discount: 50 },
      validateAndCompute,
    });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD', itemIds: ['i2'] } as never);
    // KHÔNG redeem coupon (không tiêu lượt của khách khi không được giảm).
    expect((coupons as unknown as { redeem: jest.Mock }).redeem).not.toHaveBeenCalled();
    // Đơn không gắn coupon + subtotal = 300 (subset), discount coupon = 0.
    const orderData = orderCreate.mock.calls[0][0].data;
    expect(orderData.couponCode).toBeNull();
    expect(orderData.subtotal).toBe(300);
  });

  it('full cart (không itemIds) → clear cả giỏ như cũ (không regression)', async () => {
    const { svc, cart } = build({ cartData: TWO_ITEM_CART });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never);
    const cartMock = cart as unknown as { removeItems: jest.Mock; clear: jest.Mock };
    expect(cartMock.clear).toHaveBeenCalledWith('u1');
    expect(cartMock.removeItems).not.toHaveBeenCalled();
  });

  it('quote itemIds không khớp món nào (đã bị xoá khỏi giỏ) → BadRequest, KHÔNG trả quote rỗng', async () => {
    const { svc } = build({ cartData: TWO_ITEM_CART });
    await expect(svc.quote('u1', { addressId: 'addr1', itemIds: ['khong-ton-tai'] } as never)).rejects.toThrow(
      'Chưa chọn sản phẩm để thanh toán.',
    );
  });
});

describe('CheckoutService — flash-sale server-authoritative (Task 5)', () => {
  it('compute LOẠI flash khỏi combo input + coupon base (chỉ line non-flash)', async () => {
    // Giỏ: v1 flash 80k + v2 thường 100k. Combo/coupon CHỈ trên non-flash (100k).
    const FLASH_CART = {
      items: [
        { id: 'i1', variationId: 'v1', productId: 'p1', productName: 'F', variationName: 'VF', unitPrice: 80000, quantity: 1, total: 80000, isFlash: true, flashSaleItemId: 'fi1', flashEndAt: new Date(), soldPct: 10 },
        { id: 'i2', variationId: 'v2', productId: 'p2', productName: 'N', variationName: 'VN', unitPrice: 100000, quantity: 1, total: 100000, isFlash: false, flashSaleItemId: null, flashEndAt: null, soldPct: 0 },
      ],
      subtotal: 180000, discount: 0, freeship: false, couponCode: 'SALE',
    };
    const combo = { computeForStorefront: jest.fn().mockResolvedValue({ total: 0, perLine: {} }) };
    const validateAndCompute = jest.fn().mockResolvedValue({ discount: 0, freeship: false });
    const { svc } = build({ cartData: FLASH_CART, combo, validateAndCompute });
    await svc.quote('u1', { addressId: 'addr1', storefrontSlug: 'storeX' } as never);
    // combo nhận ĐÚNG 1 line non-flash (v2), KHÔNG có v1 flash.
    expect(combo.computeForStorefront).toHaveBeenCalledWith('storeX', [
      { variationId: 'v2', productId: 'p2', total: 100000 },
    ]);
    // coupon base = 100000 (loại flash 80k), KHÔNG phải 180000.
    expect(validateAndCompute).toHaveBeenCalledWith('SALE', 'u1', 100000);
  });

  it('placeOrder gọi consumeQuota(tx) cho line flash + đóng dấu flashSaleItemId lên OrderItem', async () => {
    const FLASH_CART = {
      items: [
        { id: 'i1', variationId: 'v1', productId: 'p1', productName: 'F', variationName: 'VF', unitPrice: 80000, quantity: 2, total: 160000, isFlash: true, flashSaleItemId: 'fi1', flashEndAt: new Date(), soldPct: 10 },
      ],
      subtotal: 160000, discount: 0, freeship: false, couponCode: null,
    };
    const { svc, orderCreate, flashSale, prisma } = build({ cartData: FLASH_CART, stockCount: 1 });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never);
    // consumeQuota nhận tx (= prisma stub trong $transaction), itemId, userId, qty, Date.
    expect(flashSale.consumeQuota).toHaveBeenCalledWith(prisma, 'fi1', 'u1', 2, expect.any(Date));
    // OrderItem được đóng dấu flashSaleItemId để reconciliation/hoàn suất về sau.
    const items = orderCreate.mock.calls[0][0].data.items.create;
    expect(items).toContainEqual(expect.objectContaining({ flashSaleItemId: 'fi1' }));
  });

  it('consumeQuota throw (hết suất giữa lúc checkout) → PRICE_CHANGED, KHÔNG tạo đơn', async () => {
    const FLASH_CART = {
      items: [
        { id: 'i1', variationId: 'v1', productId: 'p1', productName: 'F', variationName: 'VF', unitPrice: 80000, quantity: 1, total: 80000, isFlash: true, flashSaleItemId: 'fi1', flashEndAt: new Date(), soldPct: 90 },
      ],
      subtotal: 80000, discount: 0, freeship: false, couponCode: null,
    };
    const flashSale = {
      consumeQuota: jest.fn().mockRejectedValue(new Error('Hết suất ưu đãi.')),
      resolveEffective: jest.fn().mockResolvedValue(new Map()),
    };
    const { svc, orderCreate } = build({ cartData: FLASH_CART, stockCount: 1, flashSale });
    await expect(
      svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never),
    ).rejects.toThrow('PRICE_CHANGED');
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it('consumeQuota throw BadRequestException hết suất → vẫn map PRICE_CHANGED, KHÔNG tạo đơn', async () => {
    const FLASH_CART = {
      items: [
        { id: 'i1', variationId: 'v1', productId: 'p1', productName: 'F', variationName: 'VF', unitPrice: 80000, quantity: 1, total: 80000, isFlash: true, flashSaleItemId: 'fi1', flashEndAt: new Date(), soldPct: 90 },
      ],
      subtotal: 80000, discount: 0, freeship: false, couponCode: null,
    };
    const flashSale = {
      consumeQuota: jest.fn().mockRejectedValue(new BadRequestException('Hết suất ưu đãi.')),
      resolveEffective: jest.fn().mockResolvedValue(new Map()),
    };
    const { svc, orderCreate } = build({ cartData: FLASH_CART, stockCount: 1, flashSale });
    await expect(
      svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never),
    ).rejects.toThrow('PRICE_CHANGED');
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it('consumeQuota throw BadRequestException vượt giới hạn mua → GIỮ NGUYÊN message, KHÔNG map PRICE_CHANGED', async () => {
    const FLASH_CART = {
      items: [
        { id: 'i1', variationId: 'v1', productId: 'p1', productName: 'F', variationName: 'VF', unitPrice: 80000, quantity: 1, total: 80000, isFlash: true, flashSaleItemId: 'fi1', flashEndAt: new Date(), soldPct: 10 },
      ],
      subtotal: 80000, discount: 0, freeship: false, couponCode: null,
    };
    const flashSale = {
      consumeQuota: jest.fn().mockRejectedValue(new BadRequestException('Vượt giới hạn mua ưu đãi.')),
      resolveEffective: jest.fn().mockResolvedValue(new Map()),
    };
    const { svc, orderCreate } = build({ cartData: FLASH_CART, stockCount: 1, flashSale });
    await expect(
      svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never),
    ).rejects.toThrow('Vượt giới hạn mua ưu đãi.');
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it('đơn hàng có hasRecyclingPickup=true → enqueue Gomdon, không enqueue Pancake trực tiếp', async () => {
    const { svc, orderCreate, gomdon, pancake } = build();
    const res = await svc.placeOrder('u1', {
      addressId: 'addr1',
      paymentMethod: 'COD',
      hasRecyclingPickup: true,
      recyclingNote: '1kg vỏ sữa + pin cũ',
    } as never);

    expect(res).toBeDefined();
    expect(orderCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          hasRecyclingPickup: true,
          recyclingNote: '1kg vỏ sữa + pin cũ',
        }),
      }),
    );
    expect((gomdon as unknown as { enqueuePush: jest.Mock }).enqueuePush).toHaveBeenCalledWith('o1');
    expect((pancake as unknown as { enqueuePush: jest.Mock }).enqueuePush).not.toHaveBeenCalled();
  });

  it('đơn hàng không có hasRecyclingPickup (mặc định) → enqueue Pancake, không enqueue Gomdon', async () => {
    const { svc, orderCreate, gomdon, pancake } = build();
    const res = await svc.placeOrder('u1', {
      addressId: 'addr1',
      paymentMethod: 'COD',
    } as never);

    expect(res).toBeDefined();
    expect(orderCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          hasRecyclingPickup: false,
          recyclingNote: null,
        }),
      }),
    );
    expect((pancake as unknown as { enqueuePush: jest.Mock }).enqueuePush).toHaveBeenCalledWith('o1');
    expect((gomdon as unknown as { enqueuePush: jest.Mock }).enqueuePush).not.toHaveBeenCalled();
  });

  it('tính năng thu gom TẮT (chưa cấu hình Gomdon / admin chưa bật) mà client gửi hasRecyclingPickup=true → BadRequest, không tạo đơn', async () => {
    const gomdon = { enqueuePush: jest.fn(), isRecyclingEnabled: jest.fn().mockResolvedValue(false) };
    const { svc, orderCreate } = build({ gomdon });
    await expect(
      svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD', hasRecyclingPickup: true } as never),
    ).rejects.toThrow('chưa mở');
    expect(orderCreate).not.toHaveBeenCalled();
    expect(gomdon.enqueuePush).not.toHaveBeenCalled();
  });

  it('không chọn thu gom → không đọc cờ tính năng (client cũ/không gửi field vẫn đặt được khi tính năng tắt)', async () => {
    const gomdon = { enqueuePush: jest.fn(), isRecyclingEnabled: jest.fn().mockResolvedValue(false) };
    const { svc, orderCreate } = build({ gomdon });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD', hasRecyclingPickup: false } as never);
    expect(orderCreate).toHaveBeenCalled();
    expect(gomdon.isRecyclingEnabled).not.toHaveBeenCalled();
  });

  it('enqueue Gomdon lỗi (Redis) → KHÔNG đẩy thẳng Pancake (tránh vừa có vận đơn Gomdon vừa note "tạo tay"), đơn vẫn tạo', async () => {
    const gomdon = { enqueuePush: jest.fn().mockRejectedValue(new Error('redis')), isRecyclingEnabled: jest.fn().mockResolvedValue(true) };
    const { svc, pancake } = build({ gomdon });
    await expect(
      svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD', hasRecyclingPickup: true } as never),
    ).resolves.toBeDefined();
    expect((pancake as unknown as { enqueuePush: jest.Mock }).enqueuePush).not.toHaveBeenCalled();
  });

  it('idempotency: gửi lại cùng key nhưng bật/tắt thu gom khác lần trước → BadRequest, không trả đơn cũ', async () => {
    const { svc, prisma, orderCreate } = build();
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({
      id: 'existing',
      userId: 'u1',
      paymentMethod: 'COD',
      hasRecyclingPickup: false,
      shippingAddress: {
        recipient: 'A', phone: '09', province: 'HN', district: 'BD', ward: 'W', street: 'S',
        provinceCode: '1', districtCode: '2', wardCode: '3',
      },
    });
    await expect(
      svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD', hasRecyclingPickup: true } as never, 'key-r'),
    ).rejects.toThrow('thông tin khác');
    expect(orderCreate).not.toHaveBeenCalled();
  });
});
