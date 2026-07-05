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
    stockCount?: number; // count trả về của variation.updateMany (decrement stock)
    variationUpdateMany?: jest.Mock; // override khi muốn mock chuỗi (race)
    combo?: { computeForStorefront: jest.Mock }; // override ComboService
    validateAndCompute?: jest.Mock; // override coupons.validateAndCompute
    getActiveTouch?: jest.Mock; // override affiliate.getActiveTouch (attribution 3 ngày)
    cartData?: unknown; // override giỏ (test checkout tập con)
    flashSale?: { consumeQuota: jest.Mock; resolveEffective: jest.Mock }; // override FlashSaleService
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
  const loyalty = { getTierMultiplier: jest.fn().mockResolvedValue(1) } as unknown as LoyaltyService;
  const notifications = { notify: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService;
  const pancake = { pushOrder: jest.fn().mockResolvedValue(null) } as unknown as PancakeOrderService;
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

  const svc = new CheckoutService(prisma, cart, coupons, pricing, loyalty, notifications, pancake, affiliate, coins, config, combo, flashSale);
  return { svc, prisma, updateMany, orderCreate, variationUpdateMany, total, coins, combo, cart, coupons, flashSale };
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
});
