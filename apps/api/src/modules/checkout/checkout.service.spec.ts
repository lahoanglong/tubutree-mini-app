import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CheckoutService } from './checkout.service';
import { FlashQuotaLineError } from '../flash-sale/flash-sale.service';
import { LOCK_BUSY_MESSAGE } from '../../common/lock-busy';
import type { PrismaService } from '../../prisma/prisma.service';
import type { CartService } from '../cart/cart.service';
import { CouponProductScopeError, type CouponsService } from '../coupons/coupons.service';
import { COUPON_PRODUCT_FLASH_REASON } from '../coupons/coupon-notice';
// P0 A3-05 (quyền lợi hạng): các test "tier perks" bên dưới dựng PricingService THẬT (không mock)
// để khẳng định khách THẬT SỰ nhận đúng số tiền hứa, không chỉ "hàm được gọi đúng tham số" — nên cần
// import giá trị (class), không chỉ type.
import { PricingService } from '../pricing/pricing.service';
import { LoyaltyService, type LockedPoints } from '../loyalty/loyalty.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PancakeOrderService } from '../integrations/pancake/pancake-order.service';
import type { GomdonOrderService } from '../integrations/gomdon/gomdon-order.service';
import type { AffiliateService } from '../affiliate/affiliate.service';
import type { ComboService } from '../storefront/combo.service';
import type { AnalyticsEventsService } from '../analytics/analytics-events.service';
import { applyWalletDelta } from '../wallet/wallet-ledger.service';

// Sổ cái thật chạy trên Postgres ở test/integration-race/wallet-ledger*.race-spec.ts.
jest.mock('../wallet/wallet-ledger.service', () => ({
  applyWalletDelta: jest.fn().mockResolvedValue({ applied: true, balanceAfter: 0, entryId: 'wtx' }),
}));
const ledger = applyWalletDelta as jest.MockedFunction<typeof applyWalletDelta>;

/** Cửa sổ đổi/trả mà stub `returnWindowDays` trả: khác mặc định 7 để test thấy đúng giá trị này được truyền đi (PF-6a). */
const WINDOW_DAYS = 9;

const ADDRESS = {
  id: 'addr1', userId: 'u1', recipient: 'A', phone: '09', province: 'HN', district: 'BD',
  ward: 'W', street: 'S', provinceCode: '84_VN01', districtCode: '2', wardCode: '84_VN01_00003',
};
const TUBU_LINE = { kind: 'TUBU', storefrontId: null, name: 'Tubu Tree', ownerUserId: null };
const SF_BRAND = { id: 'sf-linh', slug: 'linh-shop', type: 'BRAND', ownerUserId: 'owner-linh' };
const SF_CTV = { id: 'sf-lan', slug: 'abcd1234', type: 'CTV', ownerUserId: 'ctv-lan' };
const CART = {
  items: [{ variationId: 'v1', productId: 'prod1', productName: 'P', variationName: 'V', unitPrice: 100, quantity: 1, total: 100 }],
  subtotal: 100, discount: 0, freeship: false, couponCode: null,
};

function build(
  opts: {
    walletBalance?: number;
    total?: number;
    pointsUsed?: number;
    decCount?: number;
    stockCount?: number; // số dòng câu UPDATE giữ chỗ tồn kho sửa được (0 = hết hàng)
    executeRaw?: jest.Mock; // override khi muốn mock chuỗi (race)
    combo?: { computeForStorefront: jest.Mock }; // override ComboService
    validateAndCompute?: jest.Mock; // override coupons.validateAndCompute
    getActiveTouch?: jest.Mock; // override affiliate.getActiveTouch (attribution 3 ngày)
    findEligibleReferrer?: jest.Mock; // override affiliate.findEligibleReferrer (mã CTV/đại lý → id, còn lại null)
    createCommissionForOrder?: jest.Mock; // override affiliate.createCommissionForOrder
    cartData?: unknown; // override giỏ (test checkout tập con)
    flashSale?: { consumeQuotas: jest.Mock; resolveEffective: jest.Mock }; // override FlashSaleService
    gomdon?: unknown;
    pointsBalance?: number;
    /** PD-3: số dư lô CONVERTED (xu cũ quy đổi). */
    pointsConvertedBalance?: number;
    /** PD-3: phần lô CONVERTED mà pricing chia cho đơn (mặc định 0). */
    pointsUsedConverted?: number;
    /** Điểm Xanh còn có thể bị đảo (LoyaltyService.lockedOrderPoints) — mặc định 0. */
    locked?: number;
    /** P0 A3-05: hạng của user đặt đơn (mặc định null = chưa có hạng, giữ hành vi cũ). */
    tierId?: string | null;
    /** P0 A3-05: row MembershipTier trả về khi checkout tra `discountPct` theo tierId — mặc định null. */
    tier?: { discountPct: number } | null;
    /** P0 A3-05: dùng PricingService THẬT thay vì mock cứng — cho test end-to-end freeship/giảm % hạng. */
    pricing?: PricingService;
    geo?: { checkWard: jest.Mock };
    systemConfig?: { get: jest.Mock };
    /** Gian hàng đã xuất bản mà checkout tra theo storefrontSlug (slug/subdomain/tên miền). */
    storefront?: { id: string; slug: string; subdomain?: string; type: string; ownerUserId: string } | null;
    /** Cấu hình giao của gian hàng đối tác (phí giao, ngưỡng miễn phí, phí sàn). */
    merchantStores?: Array<{ id: string; shippingFee: number | null; freeShipFrom: number | null; commissionPct: number | null }>;
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
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', walletBalance: opts.walletBalance ?? 1000, pointsBalance: opts.pointsBalance ?? 1000, pointsConvertedBalance: opts.pointsConvertedBalance ?? 0, tierId: opts.tierId ?? null }),
      findUnique: jest.fn().mockResolvedValue(null),
      updateMany,
    },
    // P0 A3-05: checkout.compute() tra MembershipTier.discountPct theo user.tierId để áp giảm giá
    // hạng tự động — mặc định null (không hạng/không giảm), test tier perks override qua opts.tier.
    membershipTier: { findUnique: jest.fn().mockResolvedValue(opts.tier ?? null) },
    $executeRaw: executeRaw,
    // SELECT … FOR UPDATE khoá dòng users trước khi trừ điểm (xem placeOrder); KEY SHARE gian hàng đối tác trước khi ghi đơn tự
    // giao: mặc định mọi gian hàng vẫn là đối tác.
    $queryRaw: jest.fn().mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.join('?').includes('"storefronts"')
        ? (values[0] as { values: unknown[] }).values.map(() => ({ type: 'MERCHANT', isPartner: true }))
        : [{ id: 'u1' }],
    ),
    address: { findUnique: jest.fn().mockResolvedValue(ADDRESS) },
    storefront: {
      findFirst: jest.fn().mockImplementation(({ where }: { where: { OR: Array<Record<string, string>> } }) => {
        const sf = opts.storefront;
        const hit = sf && where.OR.some((c) => Object.values(c).some((v) => v === sf.slug || v === sf.subdomain));
        return Promise.resolve(hit ? { id: sf.id, slug: sf.slug, type: sf.type, ownerUserId: sf.ownerUserId } : null);
      }),
      findMany: jest.fn().mockResolvedValue(opts.merchantStores ?? []),
    },
    pointsTransaction: { create: jest.fn().mockResolvedValue({ id: 'ptx' }) },
    // Kiểm lại SP còn bán trong tx (cart/sellable.ts) — mặc định mọi variation đều còn bán.
    variation: {
      findMany: jest.fn().mockImplementation(({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(where.id.in.map((id) => ({ id }))),
      ),
    },
  } as unknown as PrismaService;
  (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest
    .fn()
    .mockImplementation(async (cb: (tx: unknown) => unknown) => cb(prisma));

  const cartData = (opts.cartData ?? CART) as { items: Array<Record<string, unknown>> };
  const cart = {
    // Đọc lúc gọi (không chụp lúc build): vài test sửa CART tại chỗ sau khi dựng service.
    getCart: jest.fn().mockImplementation(async () => ({
      unavailableItems: [],
      ...cartData,
      items: cartData.items.map((it) => ({ fulfiller: TUBU_LINE, ...it })),
    })),
    // Khoá giỏ trong tx đọc lại đúng các dòng giỏ hiện tại (không ai đổi giỏ giữa chừng).
    lockForCheckout: jest.fn().mockImplementation(async () =>
      cartData.items.map((it) => ({ id: it.id, variationId: it.variationId, quantity: it.quantity })),
    ),
    clearOrdered: jest.fn(),
    removeItems: jest.fn(),
  } as unknown as CartService;
  const coupons = {
    redeem: jest.fn(),
    validateAndCompute:
      opts.validateAndCompute ?? jest.fn().mockResolvedValue({ discount: 0, freeship: false }),
  } as unknown as CouponsService;
  const pricing =
    opts.pricing ??
    ({
      // opts.pointsUsed = phần lô STANDARD (giữ nghĩa cũ), opts.pointsUsedConverted = phần lô CONVERTED.
      resolvePointsRedemptionByLot: jest.fn().mockResolvedValue({
        pointsUsed: (opts.pointsUsed ?? 0) + (opts.pointsUsedConverted ?? 0),
        pointsUsedStandard: opts.pointsUsed ?? 0,
        pointsUsedConverted: opts.pointsUsedConverted ?? 0,
        discount: 0,
      }),
      calcShippingFee: jest.fn().mockResolvedValue(0),
      calcPointsEarned: jest.fn().mockResolvedValue(10),
      // P0 A3-05: mock cứng vẫn cần triển khai calcTierDiscount thật (không phải jest.fn() rỗng) —
      // compute() GỌI hàm này cho MỌI đơn (kể cả tierId=null/discountPct=0), nên thiếu nó sẽ làm
      // vỡ toàn bộ các test cũ trong file này với lỗi "calcTierDiscount is not a function". Với
      // opts.tier mặc định null → discountPct 0 → luôn trả 0, giữ hành vi/số liệu các test cũ y hệt.
      calcTierDiscount: jest.fn().mockImplementation((goodsValue: number, pct: number) =>
        pct > 0 && goodsValue > 0 ? Math.floor(goodsValue * pct) : 0,
      ),
    } as unknown as PricingService);
  const lock: LockedPoints = { locked: opts.locked ?? 0, lockedReturn: 0, lockedUntil: null };
  const loyalty = {
    getTierMultiplier: jest.fn().mockResolvedValue(1),
    lockedOrderPoints: jest.fn().mockResolvedValue(lock),
    returnWindowDays: jest.fn().mockResolvedValue(WINDOW_DAYS),
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
    createCommissionForOrder: opts.createCommissionForOrder ?? jest.fn().mockResolvedValue(undefined),
    getActiveTouch: opts.getActiveTouch ?? jest.fn().mockResolvedValue(null),
    findEligibleReferrer: opts.findEligibleReferrer ?? jest.fn().mockResolvedValue(null),
    notifyCommissionCreated: jest.fn().mockResolvedValue(undefined),
  } as unknown as AffiliateService;
  // combo mặc định: không giảm (override qua opts.combo cho test combo).
  const combo = (opts.combo ?? { computeForStorefront: jest.fn().mockResolvedValue({ total: 0, perLine: {} }) }) as unknown as ComboService;
  // flash-sale mặc định: mọi dòng flash trừ suất OK (override qua opts.flashSale cho test flash).
  const flashSale = (opts.flashSale ?? {
    consumeQuotas: jest.fn().mockImplementation(async (_tx: unknown, _u: string, lines: unknown[]) => lines.map(() => 'OK')),
    resolveEffective: jest.fn().mockResolvedValue(new Map()),
  }) as any;
  // analytics: record/recordBestEffort no-op — không assert trong test cũ (Task 4 chỉ thêm
  // dependency mới, chưa viết test riêng cho sự kiện; atomicity + sự kiện thật kiểm ở Task 15
  // với Postgres thật). Cần mock để constructor gọi được (analytics.record bên trong tx).
  const analytics = {
    record: jest.fn().mockResolvedValue(undefined),
    recordBestEffort: jest.fn().mockResolvedValue(undefined),
  } as unknown as AnalyticsEventsService;

  const svc = new CheckoutService(prisma, cart, coupons, pricing, loyalty, notifications, pancake, gomdon, affiliate, combo, flashSale, analytics, opts.geo as never, opts.systemConfig as never);
  return { svc, prisma, updateMany, orderCreate, executeRaw, total, combo, cart, coupons, flashSale, pancake, gomdon, pricing, loyalty, analytics, affiliate, notifications };
}

describe('CheckoutService.placeOrder — money safety', () => {
  it('WALLET số dư không đủ (check sớm) → BadRequest', async () => {
    const { svc, orderCreate } = build({ walletBalance: 50, total: 100 });
    await expect(
      svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'WALLET' } as never),
    ).rejects.toThrow('Ví Tubu không đủ');
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it('WALLET hợp lệ → trừ ví qua sổ cái (1 dòng ORDER_PAY theo đơn) trong tx tạo đơn', async () => {
    const { svc, prisma } = build({ walletBalance: 1000, total: 100 });
    ledger.mockClear();
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'WALLET' } as never);
    expect(ledger).toHaveBeenCalledTimes(1);
    expect(ledger).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ userId: 'u1', delta: -100, type: 'ORDER_PAY', refType: 'ORDER', refId: 'o1' }),
    );
  });

  it('WALLET race overdraft: sổ cái báo không đủ → BadRequest (rollback)', async () => {
    const { svc } = build({ walletBalance: 1000, total: 100 });
    ledger.mockRejectedValueOnce(new BadRequestException('Số dư Ví Tubu không đủ.'));
    await expect(
      svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'WALLET' } as never),
    ).rejects.toThrow('Ví Tubu không đủ');
  });

  it('PD-3 (T18): XU lọt qua DTO (gọi service trực tiếp) → BadRequest, không tạo đơn, không ghi điểm/ví', async () => {
    const { svc, orderCreate, updateMany } = build({ total: 100 });
    ledger.mockClear();
    await expect(
      svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'XU' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(orderCreate).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(ledger).not.toHaveBeenCalled();
  });

  it('mã đơn có dạng TUBU<yyyymmdd><5 số> và đã được kiểm không trùng', async () => {
    const { svc, orderCreate, prisma } = build({ walletBalance: 1000, total: 100 });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'WALLET' } as never);
    const code = orderCreate.mock.calls[0][0].data.code as string;
    expect(code).toMatch(/^TUBU\d{8}\d{5}$/);
    expect(prisma.order.findUnique).toHaveBeenCalledWith({ where: { code } });
  });

  it('đơn WALLET/COD VẪN sinh điểm bình thường (pointsEarned từ pricing)', async () => {
    const { svc, orderCreate } = build({ walletBalance: 1000, total: 100 });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'WALLET' } as never);
    expect(orderCreate.mock.calls[0][0].data.pointsEarned).toBe(10); // calcPointsEarned mock = 10
  });

  it('COD vượt hạn mức 5tr → BadRequest PAYMENT_METHOD_NOT_ALLOWED, báo giá khoá COD với cùng lý do', async () => {
    const big = { ...CART, subtotal: 6_000_000, items: [{ ...CART.items[0]!, total: 6_000_000 }] };
    const { svc, orderCreate } = build({ cartData: big });
    const q = await svc.quote('u1', { addressId: 'addr1' } as never);
    expect(q.blockedPaymentMethods.COD).toMatch(/^Thanh toán khi nhận hàng \(COD\) chỉ nhận đơn tối đa 5\.000\.000đ/);
    const err = await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never).catch((e: BadRequestException) => e);
    expect((err as BadRequestException).getResponse()).toEqual(
      expect.objectContaining({ code: 'PAYMENT_METHOD_NOT_ALLOWED', message: q.blockedPaymentMethods.COD }),
    );
    expect(orderCreate).not.toHaveBeenCalled();
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
        wardCode: '84_VN01_00003', recipient: 'A', districtCode: '2', provinceCode: '84_VN01',
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
        provinceCode: '84_VN01', districtCode: '2', wardCode: '84_VN01_00003',
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
        provinceCode: '84_VN01', districtCode: '2', wardCode: '84_VN01_00003',
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

describe('CheckoutService.placeOrder — giỏ đổi khi chờ khoá giỏ (R2-MONEY-2)', () => {
  const CART_I1 = {
    items: [{ id: 'i1', variationId: 'v1', productId: 'p1', productName: 'A', variationName: 'VA', unitPrice: 100, quantity: 1, total: 100 }],
    subtotal: 100, discount: 0, freeship: false, couponCode: null,
  };

  it('số lượng dòng vừa đổi ở tab khác → CART_CHANGED, không tạo đơn, không trừ ví', async () => {
    const { svc, cart, orderCreate } = build({ cartData: CART_I1 });
    (cart.lockForCheckout as jest.Mock).mockResolvedValueOnce([{ id: 'i1', variationId: 'v1', quantity: 3 }]);
    ledger.mockClear();
    const err = await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'WALLET' } as never, 'k1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(((err as BadRequestException).getResponse() as { code?: string }).code).toBe('CART_CHANGED');
    expect(orderCreate).not.toHaveBeenCalled();
    expect(ledger).not.toHaveBeenCalled();
  });

  it('dòng đã biến mất (lần bấm trước vừa đặt xong) và không có đơn mới khớp → CART_CHANGED', async () => {
    const { svc, cart, prisma, orderCreate } = build({ cartData: CART_I1 });
    (cart.lockForCheckout as jest.Mock).mockResolvedValueOnce([]);
    (prisma.order as unknown as { findFirst: jest.Mock }).findFirst = jest.fn().mockResolvedValue(null);
    const err = await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never, 'k2').catch((e: unknown) => e);
    expect(((err as BadRequestException).getResponse() as { code?: string }).code).toBe('CART_CHANGED');
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it('dòng đã biến mất và có đơn vừa đặt cùng địa chỉ + cách trả → trả lại đơn đó', async () => {
    const { svc, cart, prisma, orderCreate } = build({ cartData: CART_I1 });
    (cart.lockForCheckout as jest.Mock).mockResolvedValueOnce([]);
    const { id: _id, userId: _u, ...snapshot } = ADDRESS;
    (prisma.order as unknown as { findFirst: jest.Mock }).findFirst = jest.fn().mockResolvedValue({
      id: 'o-prev', code: 'TUBU1', checkoutGroup: null, paymentMethod: 'COD', total: 100, shippingAddress: snapshot, hasRecyclingPickup: false,
    });
    (prisma.order.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: 'o-prev', items: [] });
    const res = await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never, 'k3');
    expect(res.id).toBe('o-prev');
    expect(orderCreate).not.toHaveBeenCalled();
  });
});

describe('CheckoutService.placeOrder — storefrontSlug attribution (Lớp 2)', () => {
  it('lưu storefrontSlug vào order khi đặt từ gian hàng', async () => {
    const { svc, orderCreate } = build({ stockCount: 1, storefront: SF_BRAND });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD', storefrontSlug: 'linh-shop' } as never);
    expect(orderCreate.mock.calls[0][0].data.storefrontSlug).toBe('linh-shop');
    expect(orderCreate.mock.calls[0][0].data.storefrontId).toBe('sf-linh');
  });

  it('SELLER-5: định danh không khớp gian hàng đang xuất bản nào → không ghi công (slug + storefrontId null)', async () => {
    const { svc, orderCreate } = build({ stockCount: 1, storefront: SF_BRAND });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD', storefrontSlug: 'shop-gia-mao' } as never);
    expect(orderCreate.mock.calls[0][0].data.storefrontSlug).toBeNull();
    expect(orderCreate.mock.calls[0][0].data.storefrontId).toBeNull();
  });

  it('SELLER-5: mua qua subdomain → đơn lưu slug CHUẨN và id gian hàng, không lưu chuỗi khách gửi', async () => {
    const { svc, orderCreate } = build({ stockCount: 1, storefront: { ...SF_BRAND, subdomain: 'linh' } });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD', storefrontSlug: 'LINH' } as never);
    expect(orderCreate.mock.calls[0][0].data.storefrontSlug).toBe('linh-shop');
    expect(orderCreate.mock.calls[0][0].data.storefrontId).toBe('sf-linh');
  });

  it('SELLER-4: gian hàng CTV, mã giới thiệu phiên không khớp ai → chủ gian hàng là người giới thiệu (trước touch cũ)', async () => {
    const getActiveTouch = jest.fn().mockResolvedValue({ referrerUserId: 'ctv-khac', storefrontSlug: null, kind: 'ctv' });
    const { svc, orderCreate } = build({ stockCount: 1, getActiveTouch, storefront: { ...SF_CTV, subdomain: 'lan' } });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD', storefrontSlug: 'lan', referralCode: 'LAN' } as never);
    expect(orderCreate.mock.calls[0][0].data.referrerUserId).toBe('ctv-lan');
    expect(orderCreate.mock.calls[0][0].data.storefrontSlug).toBe('abcd1234');
    expect(getActiveTouch).not.toHaveBeenCalled();
  });

  it('SELLER-4: chủ gian hàng CTV tự mua trong gian hàng mình → không tự giới thiệu chính mình', async () => {
    const getActiveTouch = jest.fn().mockResolvedValue(null);
    const { svc, orderCreate } = build({ stockCount: 1, getActiveTouch, storefront: { ...SF_CTV, ownerUserId: 'u1' } });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD', storefrontSlug: 'abcd1234' } as never);
    expect(orderCreate.mock.calls[0][0].data.referrerUserId).toBeNull();
  });

  it('storefrontSlug null khi không truyền', async () => {
    const { svc, orderCreate } = build({ stockCount: 1 });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never);
    expect(orderCreate.mock.calls[0][0].data.storefrontSlug).toBeNull();
  });

  it('attribution 3 ngày: KHÔNG có referralCode nhưng còn touch → referrer + slug từ touch', async () => {
    const getActiveTouch = jest.fn().mockResolvedValue({ referrerUserId: 'ctv9', storefrontSlug: 'shopX', kind: 'ctv' });
    const { svc, orderCreate } = build({ stockCount: 1, getActiveTouch, storefront: { ...SF_CTV, id: 'sf-x', slug: 'shopx', ownerUserId: 'ctv9' } });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never);
    const data = orderCreate.mock.calls[0][0].data;
    expect(data.referrerUserId).toBe('ctv9');
    expect(data.storefrontSlug).toBe('shopx');
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
  // Hoa hoá mã nằm ở AffiliateService.findEligibleReferrer (affiliate.service.spec), dùng chung với recordTouch.
  it('P0 A5-01: referralCode viết THƯỜNG (từ slug gian hàng mở trong Zalo) vẫn khớp User.referralCode viết HOA', async () => {
    const getActiveTouch = jest.fn().mockResolvedValue(null);
    const findEligibleReferrer = jest.fn().mockResolvedValue('ctv9');
    const { svc, orderCreate } = build({ stockCount: 1, getActiveTouch, findEligibleReferrer });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD', referralCode: 'abcd1234' } as never);
    expect(findEligibleReferrer).toHaveBeenCalledWith('abcd1234', 'u1');
    expect(orderCreate.mock.calls[0][0].data.referrerUserId).toBe('ctv9');
  });
});

// C-002: hoa hồng từng được tạo SAU commit với `.catch(log)` — lỗi DB/process chết giữa chừng làm
// CTV mất hoa hồng vĩnh viễn mà không ai biết.
describe('CheckoutService.placeOrder — hoa hồng CTV tạo trong tx của đơn (C-002)', () => {
  const touch = () => jest.fn().mockResolvedValue({ referrerUserId: 'ctv9', storefrontSlug: null, kind: 'ctv' });

  it('có người giới thiệu → createCommissionForOrder(orderId, tx) chạy trong tx, trước các bước sau commit', async () => {
    const { svc, prisma, affiliate, cart, pancake } = build({ stockCount: 1, getActiveTouch: touch() });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never);
    const create = affiliate.createCommissionForOrder as jest.Mock;
    expect(create).toHaveBeenCalledTimes(1);
    // $transaction mock truyền chính `prisma` làm tx.
    expect(create).toHaveBeenCalledWith('o1', prisma);
    expect(create.mock.invocationCallOrder[0]!).toBeLessThan((cart.clearOrdered as jest.Mock).mock.invocationCallOrder[0]!);
    expect(create.mock.invocationCallOrder[0]!).toBeLessThan((pancake.enqueuePush as jest.Mock).mock.invocationCallOrder[0]!);
  });

  it('tạo hoa hồng lỗi → placeOrder lỗi (đơn rollback), không nuốt lỗi, không đẩy Pancake/báo khách', async () => {
    const createCommissionForOrder = jest.fn().mockRejectedValue(new Error('db blip'));
    const { svc, pancake, notifications } = build({ stockCount: 1, getActiveTouch: touch(), createCommissionForOrder });
    await expect(svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never)).rejects.toThrow('db blip');
    expect(pancake.enqueuePush).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('không có người giới thiệu → không gọi tạo hoa hồng', async () => {
    const { svc, affiliate } = build({ stockCount: 1 });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never);
    expect(affiliate.createCommissionForOrder).not.toHaveBeenCalled();
  });

  // C-029: báo CTV có đơn mới SAU commit (hoa hồng nằm trong tx của đơn nên không báo từ trong tx).
  it('có người giới thiệu → báo CTV sau commit, sau khi hoa hồng đã tạo', async () => {
    const { svc, affiliate } = build({ stockCount: 1, getActiveTouch: touch() });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never);
    const notify = affiliate.notifyCommissionCreated as jest.Mock;
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('o1');
    const create = affiliate.createCommissionForOrder as jest.Mock;
    expect(create.mock.invocationCallOrder[0]!).toBeLessThan(notify.mock.invocationCallOrder[0]!);
  });

  it('không có người giới thiệu → không báo CTV', async () => {
    const { svc, affiliate } = build({ stockCount: 1 });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never);
    expect(affiliate.notifyCommissionCreated).not.toHaveBeenCalled();
  });

  it('báo CTV lỗi không làm hỏng đơn đã đặt', async () => {
    const { svc, affiliate } = build({ stockCount: 1, getActiveTouch: touch() });
    (affiliate.notifyCommissionCreated as jest.Mock).mockRejectedValue(new Error('zns down'));
    await expect(svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never)).resolves.toBeDefined();
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
    const { svc } = build({ stockCount: 1, combo, storefront: SF_BRAND });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD', storefrontSlug: 'linh-shop' } as never);
    expect(combo.computeForStorefront).toHaveBeenCalledWith(
      'linh-shop',
      [{ variationId: 'v1', productId: 'prod1', total: 100 }],
      'u1',
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
      expect(validateAndCompute).toHaveBeenCalledWith('SALE30', 'u1', 80, [{ productId: 'prod1', total: 80 }]);
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
      const { svc, prisma } = build({ stockCount: 1, validateAndCompute: jest.fn().mockResolvedValue({ discount: 10000, freeship: false }) });
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
    expect(pricing.resolvePointsRedemptionByLot).toHaveBeenCalledWith(1000, 400, 0, expect.any(Number));
    expect(q).toMatchObject({ pointsBalance: 1000, lockedPoints: 600, redeemablePoints: 400 });
  });

  it('quote: phần khoá ≥ số dư (điểm đã tiêu trước đó) → redeemablePoints = 0, không âm; không tiêu điểm nào', async () => {
    const { svc, pricing } = build({ pointsBalance: 100, locked: 250 });
    const q = await svc.quote('u1', { addressId: 'addr1', pointsToUse: 100 } as never);
    expect(pricing.resolvePointsRedemptionByLot).toHaveBeenCalledWith(100, 0, 0, expect.any(Number));
    expect(q.redeemablePoints).toBe(0);
  });

  it('placeOrder: kẹp theo số dùng được như quote (không tin pointsToUse client gửi)', async () => {
    const { svc, pricing } = build({ pointsBalance: 1000, locked: 600, pointsUsed: 400 });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD', pointsToUse: 1000 } as never);
    expect(pricing.resolvePointsRedemptionByLot).toHaveBeenCalledWith(1000, 400, 0, expect.any(Number));
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

  it('PF-6a (b): placeOrder đọc cửa sổ đổi/trả NGOÀI tx (trước $transaction) và truyền cho lockedOrderPoints trong tx', async () => {
    const { svc, prisma, loyalty } = build({ pointsBalance: 1000, locked: 100, pointsUsed: 300 });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD', pointsToUse: 300 } as never);

    const returnWindowDays = loyalty.returnWindowDays as jest.Mock;
    const transaction = (prisma as unknown as { $transaction: jest.Mock }).$transaction;
    expect(returnWindowDays).toHaveBeenCalledTimes(1);
    expect(returnWindowDays.mock.invocationCallOrder[0]).toBeLessThan(transaction.mock.invocationCallOrder[0]!);
    const locked = (loyalty.lockedOrderPoints as jest.Mock).mock;
    const inTx = locked.calls.filter((c) => c[2] === prisma);
    expect(inTx).toHaveLength(1);
    expect(inTx[0]![3]).toBe(WINDOW_DAYS);
    // Lần đọc ngoài tx (báo giá trong compute) không truyền gì: không có tx nào đang giữ kết nối, hành vi giữ nguyên.
    expect(locked.calls.filter((c) => c[2] === undefined).every((c) => c[3] === undefined)).toBe(true);
  });

  it('PF-6a (b): placeOrder không tiêu điểm thường (chỉ lô quy đổi) → không đọc cửa sổ đổi/trả và không đọc phần khoá trong tx', async () => {
    const { svc, prisma, loyalty } = build({ pointsBalance: 1000, pointsConvertedBalance: 500, pointsUsedConverted: 200 });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD', pointsToUse: 200 } as never);

    expect(loyalty.returnWindowDays as jest.Mock).not.toHaveBeenCalled();
    expect((loyalty.lockedOrderPoints as jest.Mock).mock.calls.some((c) => c[2] === prisma)).toBe(false);
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
      const snap = { id: 'u1', walletBalance: 0, pointsBalance: state.pointsBalance, pointsConvertedBalance: 0, tierId: null };
      reads += 1;
      if (reads === 2) open();
      await gate;
      return snap;
    });
    (prisma.user.findUnique as jest.Mock).mockImplementation(async () => ({ pointsBalance: state.pointsBalance }));
    (pricing.resolvePointsRedemptionByLot as jest.Mock).mockImplementation(async (want: number, usable: number) => {
      const used = Math.max(0, Math.min(want, usable));
      return { pointsUsed: used, pointsUsedStandard: used, pointsUsedConverted: 0, discount: used };
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
    const { svc, cart, prisma } = build({ cartData: TWO_ITEM_CART });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD', itemIds: ['i2'] } as never);
    const cartMock = cart as unknown as { removeItems: jest.Mock; clearOrdered: jest.Mock };
    expect(cartMock.removeItems).toHaveBeenCalledWith('u1', ['i2'], prisma);
    expect(cartMock.clearOrdered).not.toHaveBeenCalled();
  });

  it('subset < minOrder coupon → BỎ coupon (không redeem, order.couponCode=null)', async () => {
    // Coupon áp được trên full cart, nhưng subset 300đ < minOrder → validateAndCompute THROW.
    const validateAndCompute = jest.fn().mockRejectedValue(new BadRequestException('Đơn tối thiểu chưa đạt'));
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

  it('full cart (không itemIds) → dọn đúng các dòng đã đọc (món đã mua + dòng ngừng bán) và bỏ mã, giữ dòng vào giỏ sau đó', async () => {
    const stale = { id: 'i3', variationId: 'v3', productId: 'p3', productName: 'C', variationName: 'VC', unitPrice: 50, quantity: 1, total: 50 };
    const { svc, cart, prisma } = build({ cartData: { ...TWO_ITEM_CART, unavailableItems: [stale] } });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never);
    const cartMock = cart as unknown as { removeItems: jest.Mock; clearOrdered: jest.Mock };
    expect(cartMock.clearOrdered).toHaveBeenCalledWith('u1', ['i1', 'i2', 'i3'], prisma);
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
    const { svc } = build({ cartData: FLASH_CART, combo, validateAndCompute, storefront: { ...SF_BRAND, slug: 'storex' } });
    await svc.quote('u1', { addressId: 'addr1', storefrontSlug: 'storeX' } as never);
    // combo nhận ĐÚNG 1 line non-flash (v2), KHÔNG có v1 flash.
    expect(combo.computeForStorefront).toHaveBeenCalledWith(
      'storex',
      [{ variationId: 'v2', productId: 'p2', total: 100000 }],
      'u1',
    );
    // coupon base = 100000 (loại flash 80k), KHÔNG phải 180000.
    expect(validateAndCompute).toHaveBeenCalledWith('SALE', 'u1', 100000, [{ productId: 'p2', total: 100000 }]);
  });

  const flashLine = (id: string, fid: string, quantity = 1) => ({
    id, variationId: `v-${id}`, productId: `p-${id}`, productName: `SP ${id}`, variationName: 'V', unitPrice: 80000, quantity,
    total: 80000 * quantity, isFlash: true, flashSaleItemId: fid, flashEndAt: new Date(), soldPct: 10,
  });
  const flashCart = (...items: ReturnType<typeof flashLine>[]) => ({
    items, subtotal: items.reduce((t, l) => t + l.total, 0), discount: 0, freeship: false, couponCode: null,
  });
  const flashWith = (consumeQuotas: jest.Mock) => ({ consumeQuotas, resolveEffective: jest.fn().mockResolvedValue(new Map()) });

  it('placeOrder gọi consumeQuotas(tx) MỘT lần cho mọi line flash + đóng dấu flashSaleItemId lên OrderItem', async () => {
    const { svc, orderCreate, flashSale, prisma } = build({ cartData: flashCart(flashLine('i1', 'fi1', 2)), stockCount: 1 });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never);
    expect(flashSale.consumeQuotas).toHaveBeenCalledTimes(1);
    expect(flashSale.consumeQuotas).toHaveBeenCalledWith(prisma, 'u1', [{ flashSaleItemId: 'fi1', quantity: 2 }], expect.any(Date));
    // OrderItem được đóng dấu flashSaleItemId để reconciliation/hoàn suất về sau.
    const items = orderCreate.mock.calls[0][0].data.items.create;
    expect(items).toContainEqual(expect.objectContaining({ flashSaleItemId: 'fi1' }));
  });

  it('hết suất giữa lúc checkout (SOLD_OUT) → PRICE_CHANGED, KHÔNG tạo đơn', async () => {
    const flashSale = flashWith(jest.fn().mockResolvedValue(['SOLD_OUT']));
    const { svc, orderCreate } = build({ cartData: flashCart(flashLine('i1', 'fi1')), stockCount: 1, flashSale });
    await expect(svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never)).rejects.toThrow('PRICE_CHANGED');
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it('vượt giới hạn mua (OVER_LIMIT) → GIỮ NGUYÊN message, KHÔNG map PRICE_CHANGED', async () => {
    const flashSale = flashWith(jest.fn().mockResolvedValue(['OVER_LIMIT']));
    const { svc, orderCreate } = build({ cartData: flashCart(flashLine('i1', 'fi1')), stockCount: 1, flashSale });
    await expect(svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never)).rejects.toThrow('Vượt giới hạn mua ưu đãi.');
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it('lỗi hạ tầng khác khi trừ suất → log rồi PRICE_CHANGED như trước', async () => {
    const flashSale = flashWith(jest.fn().mockRejectedValue(new FlashQuotaLineError(0, new Error('connection reset'))));
    const { svc, orderCreate } = build({ cartData: flashCart(flashLine('i1', 'fi1')), stockCount: 1, flashSale });
    await expect(svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never)).rejects.toThrow('PRICE_CHANGED');
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it.each([
    ['40P01 (câu raw)', new FlashQuotaLineError(0, new Error('Raw query failed. Code: `40P01`. Message: `ERROR: deadlock detected`'))],
    ['55P03 lock_timeout', new FlashQuotaLineError(0, new Error('Code: `55P03`. Message: `canceling statement due to lock timeout`'))],
    ['57014 statement_timeout', new FlashQuotaLineError(0, new Error('Code: `57014`. Message: `canceling statement due to statement timeout`'))],
    ['P2034', new Prisma.PrismaClientKnownRequestError('Transaction failed due to a write conflict or a deadlock', { code: 'P2034', clientVersion: 'x' })],
  ])('thua tranh khoá khi trừ suất (%s) → 503 "đang bận" để thử lại, KHÔNG báo PRICE_CHANGED', async (_what, err) => {
    const flashSale = flashWith(jest.fn().mockRejectedValue(err));
    const { svc, orderCreate } = build({ cartData: flashCart(flashLine('i1', 'fi1')), stockCount: 1, flashSale });
    const res = await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never).catch((e: unknown) => e);
    expect(res).toBeInstanceOf(ServiceUnavailableException);
    expect((res as Error).message).toBe(LOCK_BUSY_MESSAGE);
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it('nhiều dòng hỏng → báo lỗi của dòng hỏng ĐẦU TIÊN theo thứ tự giỏ', async () => {
    const cart = flashCart(flashLine('i1', 'fi2'), flashLine('i2', 'fi1'));
    const soldFirst = build({ cartData: cart, stockCount: 1, flashSale: flashWith(jest.fn().mockResolvedValue(['SOLD_OUT', 'OVER_LIMIT'])) });
    await expect(soldFirst.svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never)).rejects.toThrow('PRICE_CHANGED');
    const overFirst = build({ cartData: cart, stockCount: 1, flashSale: flashWith(jest.fn().mockResolvedValue(['OK', 'OVER_LIMIT'])) });
    await expect(overFirst.svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never)).rejects.toThrow('Vượt giới hạn mua ưu đãi.');
  });

  it('dòng 2 thiếu hàng nhưng dòng 1 hết suất → lỗi của dòng 1 (như làm từng dòng); chỉ trừ suất các dòng trước dòng thiếu', async () => {
    const consumeQuotas = jest.fn().mockResolvedValue(['SOLD_OUT']);
    const executeRaw = jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0).mockResolvedValue(1);
    const { svc } = build({ cartData: flashCart(flashLine('i1', 'fi1'), flashLine('i2', 'fi2')), executeRaw, flashSale: flashWith(consumeQuotas) });
    await expect(svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never)).rejects.toThrow('PRICE_CHANGED');
    expect(consumeQuotas).toHaveBeenCalledWith(expect.anything(), 'u1', [{ flashSaleItemId: 'fi1', quantity: 1 }], expect.any(Date));
  });

  it('dòng 1 thiếu hàng → lỗi tồn kho của dòng 1, không trừ suất', async () => {
    const consumeQuotas = jest.fn().mockResolvedValue([]);
    const executeRaw = jest.fn().mockResolvedValueOnce(0).mockResolvedValue(1);
    const { svc } = build({ cartData: flashCart(flashLine('i1', 'fi1'), flashLine('i2', 'fi2')), executeRaw, flashSale: flashWith(consumeQuotas) });
    await expect(svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never)).rejects.toThrow('Sản phẩm "SP i1" không đủ tồn kho.');
    expect(consumeQuotas).not.toHaveBeenCalled();
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
        provinceCode: '84_VN01', districtCode: '2', wardCode: '84_VN01_00003',
      },
    });
    await expect(
      svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD', hasRecyclingPickup: true } as never, 'key-r'),
    ).rejects.toThrow('thông tin khác');
    expect(orderCreate).not.toHaveBeenCalled();
  });
});

/**
 * P0 A3-05 (docs/audit-2026-09/03-retention-loops.md, MASTER-SUMMARY P0 table): hạng thành viên
 * hiển thị cho khách (seed.ts TIERS) hứa "Cổ Thụ: Freeship + giảm 5% mọi đơn" nhưng
 * `pricing.service.ts` không hề đọc `MembershipTier.discountPct` — mọi hạng nhận giá GIỐNG HỆT
 * nhau. Freeship theo hạng (`shipping.tier_freeship_overrides`) hoá ra ĐÃ được nối đúng từ trước
 * (xem pricing.service.spec.ts) — các test freeship dưới đây là REGRESSION GUARD xác nhận điều đó
 * vẫn đúng sau khi thêm giảm % hạng, không phải một fix mới. Phần THỰC SỰ thiếu và được thêm ở đây
 * là giảm % tự động theo `discountPct`.
 *
 * Dùng PricingService THẬT (không mock) để khẳng định số tiền cuối cùng đúng bằng tay tính, không
 * chỉ "đúng hàm được gọi" — đây là code tính tiền đơn thật.
 */
describe('CheckoutService — quyền lợi hạng thành viên tự động (P0 A3-05)', () => {
  const TIER_PRICING_CONFIG = {
    'shipping.free_threshold': 200000,
    'shipping.flat_fee_below_threshold': 19000,
    'shipping.tier_freeship_overrides': { LOC_BIEC: 99000, DAI_THU: 0, CO_THU: 0 },
    'loyalty.vnd_per_point': 10000,
    'loyalty.vnd_per_point_redeem': 1000,
    'loyalty.max_redeem_pct': 0.2,
  };
  function realPricing(): PricingService {
    const values = TIER_PRICING_CONFIG as Record<string, unknown>;
    const config = { get: async <T>(k: string, fb?: T): Promise<T> => (k in values ? (values[k] as T) : (fb as T)) };
    return new PricingService(config as never);
  }

  const SMALL_CART = {
    items: [{ variationId: 'v1', productId: 'p1', productName: 'P', variationName: 'V', unitPrice: 100000, quantity: 1, total: 100000 }],
    subtotal: 100000, discount: 0, freeship: false, couponCode: null,
  };
  const MED_CART = {
    items: [{ variationId: 'v1', productId: 'p1', productName: 'P', variationName: 'V', unitPrice: 300000, quantity: 1, total: 300000 }],
    subtotal: 300000, discount: 0, freeship: false, couponCode: null,
  };

  it('regression: KHÔNG có hạng (tierId null) → pricing giữ NGUYÊN như trước fix (ship 19k, không giảm)', async () => {
    const { svc, orderCreate } = build({ cartData: SMALL_CART, tierId: null, pricing: realPricing() });
    const q = await svc.quote('u1', { addressId: 'addr1' } as never);
    expect(q.shippingFee).toBe(19000); // đơn 100k < ngưỡng freeship chung 200k, không hạng nào che
    expect(q.total).toBe(119000);
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never);
    const data = orderCreate.mock.calls[0][0].data;
    expect(data.shippingFee).toBe(19000);
    expect(data.discount).toBe(0);
    expect(data.total).toBe(119000);
  });

  it('Lộc Biếc (freeship ≥99k, discountPct=0): freeship áp nhưng KHÔNG giảm % (đúng như seed hứa)', async () => {
    const { svc, orderCreate } = build({
      cartData: SMALL_CART, // subtotal 100k ≥ ngưỡng riêng 99k của Lộc Biếc
      tierId: 'LOC_BIEC',
      tier: { discountPct: 0 },
      pricing: realPricing(),
    });
    const q = await svc.quote('u1', { addressId: 'addr1' } as never);
    expect(q.shippingFee).toBe(0);
    expect(q.total).toBe(100000); // không giảm % — Lộc Biếc chỉ hứa freeship, không hứa giảm giá
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never);
    expect(orderCreate.mock.calls[0][0].data.discount).toBe(0);
  });

  it('Cổ Thụ (freeship toàn shop + giảm 5% mọi đơn): quote() VÀ placeOrder() đều trả shippingFee=0 và giảm đúng 5%', async () => {
    const { svc, orderCreate } = build({
      cartData: MED_CART, // subtotal 300.000đ, không coupon/điểm/combo
      tierId: 'CO_THU',
      tier: { discountPct: 0.05 },
      pricing: realPricing(),
    });
    const q = await svc.quote('u1', { addressId: 'addr1' } as never);
    expect(q.shippingFee).toBe(0); // freeship toàn shop, kể cả đơn nhỏ
    // 300.000 × 5% = 15.000 → total = 300.000 - 15.000 + ship(0) = 285.000
    expect(q.total).toBe(285000);

    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never);
    const data = orderCreate.mock.calls[0][0].data;
    expect(data.shippingFee).toBe(0);
    expect(data.discount).toBe(15000);
    expect(data.total).toBe(285000);
    // Điểm tích vẫn tính trên giá trị hàng SAU giảm hạng (đồng bộ coupon/combo/điểm hiện có).
    expect(data.subtotal).toBe(300000);
  });

  it('STACKING toàn phần: combo + coupon + giảm hạng (Cổ Thụ 5%) + điểm Xanh cùng lúc → tổng đúng theo thứ tự combo → coupon → hạng → điểm, không âm, không giảm chồng 2 lần cùng 1 đồng', async () => {
    // subtotal 500.000 → combo (shop tài trợ) giảm 50.000 → 450.000
    //   → coupon (Tubu tài trợ, tính trên base SAU combo) giảm 45.000 → 405.000
    //   → giảm hạng Cổ Thụ 5% trên phần CÒN LẠI sau coupon (không phải trên subtotal gốc): 405.000×5%=20.250 → 384.750
    //   → điểm Xanh (khách TỰ CHỌN dùng, luôn tính SAU CÙNG trên phần nhỏ nhất còn lại): trần 20%×384.750=76.950
    //     → tối đa 76 điểm (1.000đ/điểm); user có 1000 điểm, xin dùng 1000 → chỉ dùng được 76 → giảm 76.000
    // goodsAfterAll = 384.750 - 76.000 = 308.750; freeship (Cổ Thụ) nên total = 308.750
    const STACK_CART = {
      items: [{ variationId: 'v1', productId: 'p1', productName: 'P', variationName: 'V', unitPrice: 500000, quantity: 1, total: 500000 }],
      subtotal: 500000, discount: 0, freeship: false, couponCode: 'SALE10',
    };
    const combo = { computeForStorefront: jest.fn().mockResolvedValue({ total: 50000, perLine: { v1: 50000 } }) };
    const validateAndCompute = jest.fn().mockResolvedValue({ discount: 45000, freeship: false });
    const { svc, orderCreate } = build({
      cartData: STACK_CART,
      combo,
      validateAndCompute,
      tierId: 'CO_THU',
      tier: { discountPct: 0.05 },
      pricing: realPricing(),
      pointsBalance: 1000,
    });

    await svc.placeOrder(
      'u1',
      { addressId: 'addr1', paymentMethod: 'COD', storefrontSlug: 'linh-shop', pointsToUse: 1000 } as never,
    );
    const data = orderCreate.mock.calls[0][0].data;

    expect(validateAndCompute).toHaveBeenCalledWith('SALE10', 'u1', 450000, [{ productId: 'p1', total: 450000 }]); // coupon vẫn thấy base ĐÚNG NHƯ TRƯỚC (không bị hạng thu nhỏ trước)
    expect(data.pointsUsed).toBe(76);
    expect(data.shippingFee).toBe(0);
    // discount field gộp cả 4 nguồn: combo 50.000 + coupon 45.000 + điểm 76.000 + hạng 20.250 = 191.250
    expect(data.discount).toBe(191250);
    expect(data.total).toBe(308750);
    // Bất biến an toàn tiền: không âm, không vượt subtotal, và discount+total khớp đúng subtotal
    // (không có flash trong test này nên không lệch phần flash).
    expect(data.total).toBeGreaterThan(0);
    expect(data.discount).toBeLessThan(data.subtotal);
    expect(data.discount + data.total).toBe(data.subtotal);
    // R2-BUYERMINI-8: lưu từng phần để chi tiết đơn tách "Mã giảm giá" và "Điểm Xanh" bằng số tiền thật.
    expect(data).toMatchObject({ comboDiscount: 50000, couponDiscount: 45000, tierDiscount: 20250, pointsDiscount: 76000 });
    expect(data.comboDiscount + data.couponDiscount + data.tierDiscount + data.pointsDiscount).toBe(data.discount);
  });
});

describe('CheckoutService — SP ngừng bán (C-007, Q-14)', () => {
  const GONE = { id: 'ci-gone', variationId: 'v-gone', productId: 'p-gone', productName: 'SP đã gỡ', variationName: 'V', quantity: 1 };

  it('mua ngay đúng dòng đã ngừng bán → 400 code PRODUCT_DISCONTINUED, không tạo đơn', async () => {
    const { svc, orderCreate } = build({ cartData: { ...CART, unavailableItems: [GONE] } });
    await expect(
      svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD', itemIds: ['ci-gone'] } as never),
    ).rejects.toMatchObject({ response: { code: 'PRODUCT_DISCONTINUED' } });
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it('giỏ chỉ còn dòng ngừng bán → báo ngừng bán (không phải "chưa chọn sản phẩm")', async () => {
    const { svc } = build({ cartData: { ...CART, items: [], subtotal: 0, unavailableItems: [GONE] } });
    await expect(svc.quote('u1', { addressId: 'addr1' } as never)).rejects.toMatchObject({
      response: { code: 'PRODUCT_DISCONTINUED', message: expect.stringContaining('SP đã gỡ') },
    });
  });

  it('SP bị gỡ sau khi tính giá: kiểm lại trong tx thấy thiếu → rollback trước khi giữ kho/tạo đơn', async () => {
    const { svc, prisma, orderCreate, executeRaw } = build();
    (prisma.variation.findMany as jest.Mock).mockResolvedValueOnce([]);
    await expect(
      svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never),
    ).rejects.toMatchObject({ response: { code: 'PRODUCT_DISCONTINUED' } });
    expect(executeRaw).not.toHaveBeenCalled();
    expect(orderCreate).not.toHaveBeenCalled();
  });
});

/**
 * PD-3 (spec 2.3, 6.1): điểm quy đổi từ xu (lô CONVERTED) tiêu qua `pointsToUse`, không trần 20%.
 * Trừ lô nào ghi dòng sổ đúng lô đó; đơn ghi `pointsUsedConverted` để huỷ/trả hoàn đúng lô.
 */
describe('CheckoutService — PD-3 tiêu Điểm Xanh hai lô, bỏ XU, đơn 0đ', () => {
  const PD3_CONFIG = {
    'shipping.free_threshold': 200000,
    'shipping.flat_fee_below_threshold': 19000,
    'loyalty.vnd_per_point': 10000,
    'loyalty.vnd_per_point_redeem': 1000,
    'loyalty.max_redeem_pct': 0.2,
  };
  function realPricing(): PricingService {
    const values = PD3_CONFIG as Record<string, unknown>;
    const config = { get: async <T>(k: string, fb?: T): Promise<T> => (k in values ? (values[k] as T) : (fb as T)) };
    return new PricingService(config as never);
  }
  const CART_500K = {
    items: [{ variationId: 'v1', productId: 'p1', productName: 'P', variationName: 'V', unitPrice: 500000, quantity: 1, total: 500000 }],
    subtotal: 500000, discount: 0, freeship: false, couponCode: null,
  };
  const CART_150K = {
    items: [{ variationId: 'v1', productId: 'p1', productName: 'P', variationName: 'V', unitPrice: 150000, quantity: 1, total: 150000 }],
    subtotal: 150000, discount: 0, freeship: false, couponCode: null,
  };

  it('T8 quote: đơn 500.000đ, STANDARD 1.000, CONVERTED 1.000, dùng 1.000 → s 100, c 400, total = phí ship', async () => {
    const { svc } = build({ cartData: CART_500K, pointsBalance: 1000, pointsConvertedBalance: 1000, pricing: realPricing() });
    const q = await svc.quote('u1', { addressId: 'addr1', pointsToUse: 1000 } as never);
    expect(q).toMatchObject({
      pointsUsed: 500,
      pointsUsedConverted: 400,
      pointsDiscount: 500000,
      total: 0, // 500k ≥ ngưỡng freeship 200k
      pointsBalance: 1000,
      pointsConvertedBalance: 1000,
      redeemablePoints: 1000,
      redeemableConvertedPoints: 1000,
    });
  });

  it('T8/T9 placeOrder: trừ STANDARD s (guard s + khoá) và CONVERTED c (guard pointsConvertedBalance ≥ c), hai dòng sổ đúng lô, đơn ghi pointsUsedConverted', async () => {
    const { svc, prisma, updateMany, orderCreate } = build({
      cartData: CART_150K, pointsBalance: 1000, pointsConvertedBalance: 1000, locked: 50, pricing: realPricing(),
    });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD', pointsToUse: 1000 } as never);
    // redeemBase 150.000 → s = 30 (trần 20%), c = 120; total = 0 + ship 19.000.
    const data = orderCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({ pointsUsed: 150, pointsUsedConverted: 120, total: 19000, discount: 150000 });
    expect(updateMany.mock.calls.map((c) => c[0])).toEqual([
      { where: { id: 'u1', pointsBalance: { gte: 30 + 50 } }, data: { pointsBalance: { decrement: 30 } } },
      { where: { id: 'u1', pointsConvertedBalance: { gte: 120 } }, data: { pointsConvertedBalance: { decrement: 120 } } },
    ]);
    const entries = (prisma.pointsTransaction.create as jest.Mock).mock.calls.map((c) => c[0].data);
    expect(entries).toEqual([
      expect.objectContaining({ delta: -30, lot: 'STANDARD', reason: expect.stringMatching(/^ORDER_REDEEM:TUBU/), refType: 'ORDER', refId: 'o1' }),
      expect.objectContaining({ delta: -120, lot: 'CONVERTED', reason: expect.stringMatching(/^ORDER_REDEEM_CONVERTED:TUBU/), refType: 'ORDER', refId: 'o1', expiresAt: null }),
    ]);
  });

  it('T9: khách chỉ có lô CONVERTED → giảm được 100% giá trị hàng, không đụng lô STANDARD', async () => {
    const { svc, updateMany, orderCreate } = build({
      cartData: CART_150K, pointsBalance: 0, pointsConvertedBalance: 500, pricing: realPricing(),
    });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD', pointsToUse: 500 } as never);
    expect(orderCreate.mock.calls[0][0].data).toMatchObject({ pointsUsed: 150, pointsUsedConverted: 150, total: 19000 });
    expect(updateMany.mock.calls.map((c) => c[0].data)).toEqual([{ pointsConvertedBalance: { decrement: 150 } }]);
  });

  it('T9: STANDARD đang khoá (lockedOrderPoints) không được tiêu; phần còn lại lấy từ CONVERTED', async () => {
    const { svc, orderCreate } = build({
      cartData: CART_150K, pointsBalance: 100, locked: 100, pointsConvertedBalance: 500, pricing: realPricing(),
    });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD', pointsToUse: 40 } as never);
    expect(orderCreate.mock.calls[0][0].data).toMatchObject({ pointsUsed: 40, pointsUsedConverted: 40 });
  });

  it('lô CONVERTED bị tiêu mất giữa báo giá và đặt đơn → 400 "tải lại trang thanh toán", không ghi dòng CONVERTED', async () => {
    const { svc, prisma, updateMany } = build({ pointsUsed: 0, pointsUsedConverted: 50 });
    updateMany.mockResolvedValue({ count: 0 });
    const err = await svc
      .placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD', pointsToUse: 50 } as never)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toMatch(/tải lại trang thanh toán/);
    expect(prisma.pointsTransaction.create).not.toHaveBeenCalled();
  });

  it('chỉ dùng lô CONVERTED vẫn khoá dòng user trước khi trừ', async () => {
    const { svc, prisma } = build({ pointsUsed: 0, pointsUsedConverted: 10 });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD', pointsToUse: 10 } as never);
    expect((prisma.$queryRaw as unknown as jest.Mock).mock.calls).toHaveLength(1);
  });

  describe('T18: đơn tổng 0đ (điểm phủ hết hàng + freeship) → ép COD, CONFIRMED, không thu tiền', () => {
    it.each(['BANK_TRANSFER', 'ZALOPAY', 'WALLET', 'COD'])('%s → COD CONFIRMED UNPAID, không trừ ví, không treo PENDING_PAYMENT', async (method) => {
      const { svc, orderCreate } = build({ cartData: CART_500K, pointsBalance: 0, pointsConvertedBalance: 1000, pricing: realPricing() });
      ledger.mockClear();
      await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: method, pointsToUse: 1000 } as never);
      expect(orderCreate.mock.calls[0][0].data).toMatchObject({
        total: 0, paymentMethod: 'COD', status: 'CONFIRMED', paymentStatus: 'UNPAID', paidAt: null,
      });
      expect(ledger).not.toHaveBeenCalled();
    });

    it('review C2: FE đã báo khách thấy đơn 0đ (quotedZeroTotal) mà lúc đặt tổng > 0 → 400 tải lại, KHÔNG tạo đơn COD khách không chọn', async () => {
      // FE ẩn chọn phương thức và gửi COD vì báo giá 0đ; lô quy đổi vừa bị tiêu bớt nên hiện chỉ giảm được 10.000đ.
      const { svc, orderCreate } = build({ cartData: CART_150K, pointsBalance: 0, pointsConvertedBalance: 10, pricing: realPricing() });
      const err = await svc
        .placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD', pointsToUse: 150, quotedZeroTotal: true } as never)
        .catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as Error).message).toMatch(/tải lại trang thanh toán/);
      expect(orderCreate).not.toHaveBeenCalled();
    });

    it('review C2: quotedZeroTotal mà tổng vẫn 0đ → tạo đơn COD bình thường', async () => {
      const { svc, orderCreate } = build({ cartData: CART_500K, pointsBalance: 0, pointsConvertedBalance: 1000, pricing: realPricing() });
      await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD', pointsToUse: 1000, quotedZeroTotal: true } as never);
      expect(orderCreate.mock.calls[0][0].data).toMatchObject({ total: 0, paymentMethod: 'COD', status: 'CONFIRMED' });
    });

    it('review C2: khách CHỌN COD cho đơn > 0đ (không có cờ) → vẫn tạo đơn COD như cũ', async () => {
      const { svc, orderCreate } = build({ cartData: CART_150K, pointsBalance: 0, pointsConvertedBalance: 10, pricing: realPricing() });
      await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD', pointsToUse: 10 } as never);
      expect(orderCreate.mock.calls[0][0].data).toMatchObject({ paymentMethod: 'COD', status: 'CONFIRMED' });
      expect(orderCreate.mock.calls[0][0].data.total).toBeGreaterThan(0);
    });

    it('đơn > 0đ giữ phương thức khách chọn (BANK_TRANSFER → PENDING_PAYMENT)', async () => {
      const { svc, orderCreate } = build({ cartData: CART_150K, pointsBalance: 0, pointsConvertedBalance: 10, pricing: realPricing() });
      await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'BANK_TRANSFER', pointsToUse: 10 } as never);
      expect(orderCreate.mock.calls[0][0].data).toMatchObject({ paymentMethod: 'BANK_TRANSFER', status: 'PENDING_PAYMENT' });
    });

    it('gửi lại cùng Idempotency-Key sau khi đơn 0đ đã bị ép COD → trả đơn cũ, không báo "thông tin khác"', async () => {
      const { svc, prisma, orderCreate } = build();
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: 'existing', userId: 'u1', paymentMethod: 'COD', total: 0,
        shippingAddress: {
          recipient: 'A', phone: '09', province: 'HN', district: 'BD', ward: 'W', street: 'S',
          provinceCode: '84_VN01', districtCode: '2', wardCode: '84_VN01_00003',
        },
      });
      await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'BANK_TRANSFER' } as never, 'key-0d');
      expect(orderCreate).not.toHaveBeenCalled();
      expect(prisma.order.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: 'existing' }, include: { items: true } });
    });
  });
});

describe('CheckoutService — chặn đơn sai giá / sai tổng / sai địa giới', () => {
  it('PANCAKE-13: tổng tính lại CAO HƠN tổng khách đã thấy → 400 TOTAL_CHANGED, không tạo đơn, không trừ ví', async () => {
    const { svc, orderCreate } = build({ walletBalance: 1000 });
    ledger.mockClear();
    const err = await svc
      .placeOrder('u1', { addressId: 'addr1', paymentMethod: 'WALLET', expectedTotal: 90 } as never)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toMatchObject({
      code: 'TOTAL_CHANGED',
      message: expect.stringContaining('Tổng tiền đơn vừa thay đổi từ 90đ thành 100đ'),
    });
    expect(orderCreate).not.toHaveBeenCalled();
    expect(ledger).not.toHaveBeenCalled();
  });

  describe('R4-CHECKOUT-4: câu TOTAL_CHANGED nói đúng nguyên nhân thay vì luôn "do giá hoặc phí giao"', () => {
    const totalChanged = async (b: ReturnType<typeof build>, expectedTotal: number) => {
      const err = await b.svc
        .placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD', expectedTotal } as never)
        .catch((e: BadRequestException) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      const res = (err as BadRequestException).getResponse() as { code: string; message: string };
      expect(res.code).toBe('TOTAL_CHANGED');
      expect(b.orderCreate).not.toHaveBeenCalled();
      return res.message;
    };

    it('mã giảm giá bị gỡ khỏi giỏ ngay lúc đặt (admin tắt mã) → nêu mã và lý do, không đổ cho giá/phí giao', async () => {
      const b = build({ cartData: { ...CART, couponRemoved: { code: 'GIAM50', reason: 'Mã giảm giá đã ngừng áp dụng.' } } });
      expect(await totalChanged(b, 60)).toBe(
        'Tổng tiền đơn vừa thay đổi từ 60đ thành 100đ vì mã GIAM50 không còn được áp dụng. Lý do: Mã giảm giá đã ngừng áp dụng. Vui lòng xem lại trước khi đặt.',
      );
    });

    it('mã còn trong giỏ nhưng lúc đặt không áp được → kèm lời báo của mã', async () => {
      const b = build({
        cartData: { ...CART, couponCode: 'XANH10' },
        validateAndCompute: jest.fn().mockRejectedValue(new BadRequestException('Đơn tối thiểu 150.000đ để dùng mã này.')),
      });
      expect(await totalChanged(b, 60)).toBe(
        'Tổng tiền đơn vừa thay đổi từ 60đ thành 100đ. Mã chưa được áp dụng cho đơn này: Đơn tối thiểu 150.000đ để dùng mã này. Vui lòng xem lại trước khi đặt.',
      );
    });

    it('không liên quan mã → câu trung tính nêu cả ưu đãi, không khẳng định riêng giá hoặc phí giao', async () => {
      expect(await totalChanged(build(), 60)).toBe(
        'Tổng tiền đơn vừa thay đổi từ 60đ thành 100đ do giá, phí giao hoặc ưu đãi vừa thay đổi. Vui lòng xem lại trước khi đặt.',
      );
    });
  });

  it('R4-CHECKOUT-3: mã gắn sản phẩm mà sản phẩm đó chỉ có ở giá giờ vàng → lời báo nói đang giờ vàng, không nói giỏ chưa có sản phẩm đó', async () => {
    const cartData = {
      ...CART,
      couponCode: 'PSGRAN',
      items: [
        { ...CART.items[0]!, isFlash: true, flashSaleItemId: 'fi1' },
        { variationId: 'v2', productId: 'prod2', productName: 'Q', variationName: 'V', unitPrice: 50, quantity: 1, total: 50 },
      ],
      subtotal: 150,
    };
    const { svc } = build({ cartData, validateAndCompute: jest.fn().mockRejectedValue(new CouponProductScopeError(['prod1'])) });
    const q = await svc.quote('u1', { addressId: 'addr1' } as never);
    expect(q.couponApplied).toBe(false);
    expect(q.couponNotice).toContain(COUPON_PRODUCT_FLASH_REASON);
    expect(q.couponNotice).not.toContain('chưa có sản phẩm đó');
  });

  it('PANCAKE-13: tổng bằng hoặc thấp hơn số đã thấy, hoặc client cũ không gửi → đặt bình thường', async () => {
    for (const expectedTotal of [100, 150, undefined]) {
      const { svc, orderCreate } = build();
      await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD', expectedTotal } as never);
      expect(orderCreate).toHaveBeenCalledTimes(1);
    }
  });

  it('PANCAKE-12: dòng giỏ có đơn giá 0đ → không báo giá, không đặt được', async () => {
    const cartData = {
      ...CART,
      items: [{ ...CART.items[0], productName: 'Nước rửa chén 5L', unitPrice: 0, total: 0 }],
      subtotal: 0,
    };
    const { svc, orderCreate } = build({ cartData });
    await expect(svc.quote('u1', { addressId: 'addr1' })).rejects.toThrow('"Nước rửa chén 5L" đang được cập nhật giá');
    await expect(svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never)).rejects.toThrow(BadRequestException);
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it('PANCAKE-16: địa chỉ mã cũ "00" → báo giá và đặt đơn đều 400 ADDRESS_OUTDATED', async () => {
    const { svc, prisma, orderCreate } = build();
    (prisma.address.findUnique as jest.Mock).mockResolvedValue({ ...ADDRESS, provinceCode: '00', districtCode: '00', wardCode: '00' });
    const err = await svc.quote('u1', { addressId: 'addr1' }).catch((e: unknown) => e);
    expect((err as BadRequestException).getResponse()).toMatchObject({ code: 'ADDRESS_OUTDATED' });
    await expect(svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never)).rejects.toThrow('địa giới mới');
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it('PANCAKE-16: phường không thuộc tỉnh theo danh mục Pancake → 400; danh mục chưa tải được → vẫn đặt', async () => {
    const bad = build({ geo: { checkWard: jest.fn().mockResolvedValue('invalid') } });
    await expect(bad.svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never)).rejects.toThrow(
      'Phường/xã không thuộc tỉnh/thành',
    );
    expect(bad.orderCreate).not.toHaveBeenCalled();

    const down = build({ geo: { checkWard: jest.fn().mockResolvedValue('unknown') } });
    await down.svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never);
    expect(down.orderCreate).toHaveBeenCalledTimes(1);
  });
});

describe('CheckoutService — MONEY-3: mã không đạt điều kiện trên phần hàng được tính thì KHÔNG tiêu lượt', () => {
  // Giỏ: 1 hàng thường 89k + 2 hàng flash 39k. Mã UAT50K minOrder 150k: đạt trên cả giỏ (167k) nhưng
  // không đạt trên phần không flash (89k) → giỏ giữ mã với giảm 0đ.
  const FLASH_MIX = {
    items: [
      { id: 'i1', variationId: 'v1', productId: 'p1', productName: 'N', variationName: 'VN', unitPrice: 89000, quantity: 1, total: 89000, isFlash: false, flashSaleItemId: null },
      { id: 'i2', variationId: 'v2', productId: 'p2', productName: 'F', variationName: 'VF', unitPrice: 39000, quantity: 2, total: 78000, isFlash: true, flashSaleItemId: 'fi2' },
    ],
    subtotal: 167000, discount: 0, freeship: false, couponCode: 'UAT50K',
  };
  const notMet = () => jest.fn().mockRejectedValue(new BadRequestException('Đơn tối thiểu 150.000đ để dùng mã này.'));

  it('đặt TOÀN giỏ: không redeem, đơn không gắn mã, không giảm', async () => {
    const { svc, orderCreate, coupons } = build({ cartData: FLASH_MIX, validateAndCompute: notMet() });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never);
    expect((coupons as unknown as { redeem: jest.Mock }).redeem).not.toHaveBeenCalled();
    const data = orderCreate.mock.calls[0][0].data;
    expect(data.couponCode).toBeNull();
    expect(data.discount).toBe(0);
  });

  it('quote: giảm 0 + couponNotice giải thích vì sao mã chưa áp', async () => {
    const { svc } = build({ cartData: FLASH_MIX, validateAndCompute: notMet() });
    const q = await svc.quote('u1', { addressId: 'addr1' } as never);
    expect(q.discount).toBe(0);
    expect(q.couponApplied).toBe(false);
    expect(q.couponNotice).toContain('150.000đ');
    expect(q.couponNotice).toContain('giờ vàng');
  });

  it('lỗi hạ tầng khi kiểm mã (không phải BadRequest) → báo lỗi, không âm thầm đặt đơn bỏ mã', async () => {
    const { svc, orderCreate } = build({ cartData: FLASH_MIX, validateAndCompute: jest.fn().mockRejectedValue(new Error('db timeout')) });
    await expect(svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never)).rejects.toThrow('db timeout');
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it('R2-BUYERMINI-3: mã áp được trên giỏ có hàng giờ vàng → couponNotice nói mã chỉ giảm trên phần hàng còn lại', async () => {
    const { svc } = build({ cartData: FLASH_MIX, validateAndCompute: jest.fn().mockResolvedValue({ discount: 8900, freeship: false }) });
    const q = await svc.quote('u1', { addressId: 'addr1' } as never);
    expect(q.couponApplied).toBe(true);
    expect(q.couponNotice).toBe('Hàng giờ vàng không được giảm thêm theo mã: mã chỉ tính trên 89.000đ hàng còn lại.');
  });

  it('mã áp được → couponApplied true, couponNotice null', async () => {
    const { svc } = build({
      cartData: { ...FLASH_MIX, items: [FLASH_MIX.items[0]], subtotal: 89000 },
      validateAndCompute: jest.fn().mockResolvedValue({ discount: 20000, freeship: false }),
    });
    const q = await svc.quote('u1', { addressId: 'addr1' } as never);
    expect(q.discount).toBe(20000);
    expect(q.couponApplied).toBe(true);
    expect(q.couponNotice).toBeNull();
  });

  // Mã không có đơn tối thiểu (BIRTHDAY/WINBACK, mã admin không đặt minOrder) vẫn "hợp lệ" trên phần
  // hàng được tính bằng 0đ → giảm 0đ. Không được tính là đã áp, nếu không mã một lần bị đốt cho đơn 0đ giảm.
  const ALL_FLASH = { ...FLASH_MIX, items: [FLASH_MIX.items[1]], subtotal: 78000 };
  const zeroDiscount = () => jest.fn().mockResolvedValue({ discount: 0, freeship: false });

  it('giỏ toàn hàng giờ vàng + mã không có đơn tối thiểu → giảm 0đ: không redeem, đơn không gắn mã', async () => {
    const { svc, orderCreate, coupons } = build({ cartData: ALL_FLASH, validateAndCompute: zeroDiscount() });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never);
    expect((coupons as unknown as { redeem: jest.Mock }).redeem).not.toHaveBeenCalled();
    const data = orderCreate.mock.calls[0][0].data;
    expect(data.couponCode).toBeNull();
    expect(data.discount).toBe(0);
  });

  it('quote: mã hợp lệ nhưng giảm 0đ → couponApplied false + couponNotice nói rõ', async () => {
    const { svc } = build({ cartData: ALL_FLASH, validateAndCompute: zeroDiscount() });
    const q = await svc.quote('u1', { addressId: 'addr1' } as never);
    expect(q.discount).toBe(0);
    expect(q.couponApplied).toBe(false);
    expect(q.couponNotice).toMatch(/^Mã chưa được áp dụng cho đơn này/);
    expect(q.couponNotice).toContain('giờ vàng');
  });

  it('mã miễn phí vận chuyển (giảm hàng 0đ nhưng miễn được phí giao 19.000đ) → vẫn tính là đã áp', async () => {
    const { svc, pricing } = build({ cartData: ALL_FLASH, validateAndCompute: jest.fn().mockResolvedValue({ discount: 0, freeship: true }) });
    (pricing.calcShippingFee as jest.Mock).mockResolvedValue(19_000);
    const q = await svc.quote('u1', { addressId: 'addr1' } as never);
    expect(q.couponApplied).toBe(true);
    expect(q.couponNotice).toBeNull();
  });
});

describe('CheckoutService — thông báo khi đặt đơn (BUYERMINI-8)', () => {
  beforeAll(() => jest.useFakeTimers({ now: new Date('2026-10-13T03:00:00Z'), doNotFake: ['nextTick', 'setImmediate'] }));
  afterAll(() => jest.useRealTimers());

  it.each(['BANK_TRANSFER', 'ZALOPAY'])('đơn %s chưa trả → "chờ thanh toán" kèm số tiền và hạn (TTL từ SystemConfig), KHÔNG "đã xác nhận"', async (paymentMethod) => {
    const systemConfig = { get: jest.fn().mockResolvedValue(24) };
    const { svc, notifications } = build({ total: 114_000, systemConfig });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod } as never);
    expect(systemConfig.get).toHaveBeenCalledWith('orders.pending_payment_ttl_hours', 24);
    expect(notifications.notify).toHaveBeenCalledWith('u1', 'ORDER_AWAITING_PAYMENT', {
      order_code: expect.any(String),
      amount: expect.stringMatching(/đ$/),
      deadline: '10:00 14/10/2026',
    });
    expect(notifications.notify).not.toHaveBeenCalledWith('u1', 'ORDER_CONFIRMED', expect.anything());
  });

  it.each(['COD', 'WALLET'])('đơn %s → "đã xác nhận" như cũ', async (paymentMethod) => {
    const { svc, notifications } = build({ walletBalance: 1_000_000 });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod } as never);
    expect(notifications.notify).toHaveBeenCalledWith('u1', 'ORDER_CONFIRMED', { order_code: expect.any(String) });
  });
});

// D4 (docs/2026-10-14-merchant-fulfilment-design.md mục 3): một lần đặt có hàng Tubu và hàng đối tác tự giao thành một đơn
// cho mỗi nơi giao.
describe('CheckoutService — tách đơn theo nơi giao (D4)', () => {
  const SHOP_A = { kind: 'MERCHANT', storefrontId: 'sf-a', name: 'Shop A', ownerUserId: 'u-a' };
  const TUBU_ITEM = { id: 'i1', variationId: 'v1', productId: 'p1', productName: 'Nước rửa chén', variationName: '5L', unitPrice: 100_000, quantity: 1, total: 100_000 };
  const SHOP_ITEM = { id: 'i2', variationId: 'vm', productId: 'pm', productName: 'Mật ong', variationName: '500ml', unitPrice: 200_000, quantity: 1, total: 200_000, fulfiller: SHOP_A };
  const MIXED = { items: [SHOP_ITEM, TUBU_ITEM], subtotal: 300_000, discount: 0, freeship: false, couponCode: 'GIAM30' };
  const ONLY_SHOP = { items: [SHOP_ITEM], subtotal: 200_000, discount: 0, freeship: false, couponCode: null };

  function buildSplit(over: Parameters<typeof build>[0] = {}) {
    const b = build({
      cartData: MIXED,
      validateAndCompute: jest.fn().mockResolvedValue({ discount: 30_000, freeship: false }),
      ...over,
    });
    b.orderCreate.mockImplementation((args: any) => Promise.resolve({ id: `id-${args.data.code}`, ...args.data }));
    (b.pricing.calcShippingFee as jest.Mock).mockResolvedValue(20_000);
    return b;
  }

  it('hàng Tubu + hàng đối tác → 2 đơn: Tubu trước, cùng checkoutGroup, phí giao từng kiện, giảm giá chia theo tỉ lệ', async () => {
    const { svc, orderCreate, coupons } = buildSplit();
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never, 'idem-1');
    expect(orderCreate).toHaveBeenCalledTimes(2);
    const [tubu, shop] = orderCreate.mock.calls.map((c) => c[0].data);
    expect(tubu.fulfiller).toBe('TUBU');
    expect(tubu.fulfillerStorefrontId).toBeNull();
    expect(tubu.merchantCommissionPct).toBeNull();
    expect(shop.fulfiller).toBe('MERCHANT');
    expect(shop.fulfillerStorefrontId).toBe('sf-a');
    expect(shop.merchantCommissionPct).toBe(0.15);
    expect(tubu.checkoutGroup).toBe(tubu.code);
    expect(shop.checkoutGroup).toBe(tubu.code);
    expect(shop.code).not.toBe(tubu.code);
    expect(tubu.items.create.map((i: { variationId: string }) => i.variationId)).toEqual(['v1']);
    expect(shop.items.create.map((i: { variationId: string }) => i.variationId)).toEqual(['vm']);
    expect(tubu.shippingFee).toBe(20_000);
    expect(shop.shippingFee).toBe(30_000);
    // Mã giảm 30.000đ trên 300.000đ hàng: 1/3 vào kiện Tubu, 2/3 vào kiện shop; tổng hai đơn đúng từng đồng.
    expect(tubu.discount).toBe(10_000);
    expect(shop.discount).toBe(20_000);
    expect(tubu.total + shop.total).toBe(300_000 - 30_000 + 20_000 + 30_000);
    expect(tubu.idempotencyKey).toBe('idem-1');
    expect(shop.idempotencyKey).toBeNull();
    expect(tubu.couponCode).toBe('GIAM30');
    expect(shop.couponCode).toBeNull();
    expect(coupons.redeem).toHaveBeenCalledTimes(1);
    expect((coupons.redeem as jest.Mock).mock.calls[0][2]).toBe(`id-${tubu.code}`);
  });

  it('KEY SHARE gian hàng đối tác sau khi giữ kho, trước khi chèn đơn; cờ đã tắt dưới khoá → 409, không tạo đơn', async () => {
    const { svc, prisma, orderCreate } = buildSplit();
    const queryRaw = prisma.$queryRaw as unknown as jest.Mock;
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never);
    const lockIdx = queryRaw.mock.calls.findIndex((c) => (c[0] as string[]).join('?').includes('"storefronts"'));
    expect((queryRaw.mock.calls[lockIdx]![0] as string[]).join('?')).toMatch(/FOR KEY SHARE/);
    expect((queryRaw.mock.calls[lockIdx]![1] as { values: unknown[] }).values).toEqual(['sf-a']);
    const lockAt = queryRaw.mock.invocationCallOrder[lockIdx]!;
    expect(lockAt).toBeGreaterThan(Math.max(...(prisma.$executeRaw as unknown as jest.Mock).mock.invocationCallOrder));
    expect(lockAt).toBeLessThan(orderCreate.mock.invocationCallOrder[0]!);

    const off = buildSplit();
    (off.prisma.$queryRaw as unknown as jest.Mock).mockImplementation(async (strings: TemplateStringsArray) =>
      strings.join('?').includes('"storefronts"') ? [{ type: 'CTV', isPartner: false }] : [{ id: 'u1' }],
    );
    const err = await off.svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).message).toBe('Gian hàng vừa thay đổi, vui lòng đặt lại.');
    expect(off.orderCreate).not.toHaveBeenCalled();
  });

  it('chỉ đơn Tubu đi Pancake; đơn đối tác báo chủ gian hàng MERCHANT_ORDER_NEW', async () => {
    const { svc, pancake, notifications } = buildSplit();
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never);
    expect(pancake.enqueuePush).toHaveBeenCalledTimes(1);
    const notify = notifications.notify as jest.Mock;
    expect(notify).toHaveBeenCalledWith('u-a', 'MERCHANT_ORDER_NEW', expect.objectContaining({ total: expect.any(String) }));
    expect(notify.mock.calls.filter((c) => c[1] === 'ORDER_CONFIRMED')).toHaveLength(2);
  });

  it('chuyển khoản/ZaloPay bị chặn khi có hàng đối tác tự giao → PAYMENT_METHOD_NOT_ALLOWED, không tạo đơn', async () => {
    const { svc, orderCreate } = buildSplit();
    const err = await svc
      .placeOrder('u1', { addressId: 'addr1', paymentMethod: 'BANK_TRANSFER' } as never)
      .catch((e: BadRequestException) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toEqual(expect.objectContaining({ code: 'PAYMENT_METHOD_NOT_ALLOWED' }));
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it('quote trả từng kiện và lý do chặn phương thức để FE khoá nút', async () => {
    const { svc } = buildSplit();
    const q = await svc.quote('u1', { addressId: 'addr1' } as never);
    expect(q.shipments.map((s) => [s.fulfiller.kind, s.itemIds, s.shippingFee])).toEqual([
      ['TUBU', ['i1'], 20_000],
      ['MERCHANT', ['i2'], 30_000],
    ]);
    expect(Object.keys(q.blockedPaymentMethods).sort()).toEqual(['BANK_TRANSFER', 'ZALOPAY']);
    expect(q.total).toBe(q.shipments.reduce((s, x) => s + x.total, 0));
  });

  it('giỏ chỉ hàng Tubu: một đơn, không checkoutGroup, không chặn phương thức nào', async () => {
    const { svc } = build();
    const q = await svc.quote('u1', { addressId: 'addr1' } as never);
    expect(q.shipments).toHaveLength(1);
    expect(q.blockedPaymentMethods).toEqual({});
  });

  describe('R4-CHECKOUT-2: hạn mức COD theo từng đơn sau khi tách; báo giá là nguồn duy nhất của lựa chọn bị khoá', () => {
    const big = (item: Record<string, unknown>, unitPrice: number, quantity: number) => ({ ...item, unitPrice, quantity, total: unitPrice * quantity });
    // 2.600.000đ hàng Tubu + 3.000.000đ hàng đối tác = 5.600.000đ; mỗi đơn đều dưới 5.000.000đ.
    const MIXED_BIG = {
      items: [big(TUBU_ITEM, 260_000, 10), big(SHOP_ITEM, 150_000, 20)],
      subtotal: 5_600_000, discount: 0, freeship: false, couponCode: null,
    };
    // Phần đối tác 5.200.000đ: riêng đơn đó vượt mức.
    const SHOP_OVER = {
      items: [big(TUBU_ITEM, 100_000, 1), big(SHOP_ITEM, 260_000, 20)],
      subtotal: 5_300_000, discount: 0, freeship: false, couponCode: null,
    };

    it('giỏ tổng 5.600.000đ, từng đơn dưới mức → báo giá không khoá COD, đặt COD tạo đủ hai đơn', async () => {
      const { svc, orderCreate } = buildSplit({ cartData: MIXED_BIG, walletBalance: 0 });
      const q = await svc.quote('u1', { addressId: 'addr1' } as never);
      expect(q.total).toBeGreaterThan(5_000_000);
      expect(q.blockedPaymentMethods.COD).toBeUndefined();
      await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD', expectedTotal: q.total } as never);
      expect(orderCreate).toHaveBeenCalledTimes(2);
      expect(orderCreate.mock.calls.map((c) => c[0].data.paymentMethod)).toEqual(['COD', 'COD']);
    });

    it('một đơn con vượt mức → báo giá khoá COD kèm lý do; đặt COD bị từ chối đúng câu đó, mã PAYMENT_METHOD_NOT_ALLOWED', async () => {
      const { svc, orderCreate } = buildSplit({ cartData: SHOP_OVER });
      const q = await svc.quote('u1', { addressId: 'addr1' } as never);
      expect(Object.keys(q.blockedPaymentMethods).sort()).toEqual(['BANK_TRANSFER', 'COD', 'ZALOPAY']);
      expect(q.blockedPaymentMethods.COD).toContain('đơn do Shop A giao là 5.230.000đ');
      const err = await svc
        .placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD', expectedTotal: q.total } as never)
        .catch((e: BadRequestException) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).getResponse()).toEqual(
        expect.objectContaining({ code: 'PAYMENT_METHOD_NOT_ALLOWED', message: q.blockedPaymentMethods.COD }),
      );
      expect(orderCreate).not.toHaveBeenCalled();
    });

    it('mọi phương thức khoá trong báo giá đều bị đặt hàng từ chối, phương thức không khoá thì đặt được', async () => {
      for (const cartData of [MIXED_BIG, SHOP_OVER, ONLY_SHOP]) {
        const { svc } = buildSplit({ cartData, walletBalance: 100_000_000 });
        const q = await svc.quote('u1', { addressId: 'addr1' } as never);
        for (const method of ['COD', 'BANK_TRANSFER', 'ZALOPAY', 'WALLET']) {
          const res = await svc
            .placeOrder('u1', { addressId: 'addr1', paymentMethod: method, expectedTotal: q.total } as never)
            .then(() => null, (e: BadRequestException) => (e.getResponse() as { message: string }).message);
          expect([method, res]).toEqual([method, q.blockedPaymentMethods[method] ?? null]);
        }
      }
    });
  });

  it('phí giao theo cấu hình của shop; miễn phí khi đạt ngưỡng của shop; mã freeship Tubu không miễn phí giao của đối tác', async () => {
    const { svc, orderCreate } = buildSplit({
      cartData: ONLY_SHOP,
      validateAndCompute: jest.fn().mockResolvedValue({ discount: 0, freeship: true }),
      merchantStores: [{ id: 'sf-a', shippingFee: 25_000, freeShipFrom: null, commissionPct: 0.1 }],
    });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never);
    expect(orderCreate.mock.calls[0][0].data.shippingFee).toBe(25_000);
    expect(orderCreate.mock.calls[0][0].data.merchantCommissionPct).toBe(0.1);
    expect(orderCreate.mock.calls[0][0].data.checkoutGroup).toBeNull();

    const b2 = buildSplit({
      cartData: ONLY_SHOP,
      merchantStores: [{ id: 'sf-a', shippingFee: 25_000, freeShipFrom: 150_000, commissionPct: null }],
    });
    await b2.svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never);
    expect(b2.orderCreate.mock.calls[0][0].data.shippingFee).toBe(0);
  });

  it('mã freeship trên giỏ chỉ có hàng gian hàng tự giao → không miễn được gì: không tính là đã áp, không tiêu lượt, báo rõ', async () => {
    const { svc, orderCreate, coupons } = buildSplit({
      cartData: { ...ONLY_SHOP, couponCode: 'FREESHIP' },
      validateAndCompute: jest.fn().mockResolvedValue({ discount: 0, freeship: true }),
    });
    const q = await svc.quote('u1', { addressId: 'addr1' } as never);
    expect(q.couponApplied).toBe(false);
    expect(q.couponNotice).toMatch(/^Mã chưa được áp dụng cho đơn này/);
    expect(q.couponNotice).toContain('Tubu Tree giao');
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never);
    expect(coupons.redeem).not.toHaveBeenCalled();
    expect(orderCreate.mock.calls[0][0].data.couponCode).toBeNull();
  });

  it('mã freeship khi kiện Tubu đã được miễn phí giao (đạt ngưỡng) → không tiêu lượt', async () => {
    const { svc, coupons, pricing } = buildSplit({
      cartData: { ...MIXED, couponCode: 'FREESHIP' },
      validateAndCompute: jest.fn().mockResolvedValue({ discount: 0, freeship: true }),
    });
    (pricing.calcShippingFee as jest.Mock).mockResolvedValue(0);
    const q = await svc.quote('u1', { addressId: 'addr1' } as never);
    expect(q.couponApplied).toBe(false);
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never);
    expect(coupons.redeem).not.toHaveBeenCalled();
  });

  it('mã freeship khi kiện Tubu có phí giao → miễn phí giao kiện Tubu, tính là đã áp, phí gian hàng giữ nguyên', async () => {
    const { svc, orderCreate, coupons } = buildSplit({
      cartData: { ...MIXED, couponCode: 'FREESHIP' },
      validateAndCompute: jest.fn().mockResolvedValue({ discount: 0, freeship: true }),
    });
    const q = await svc.quote('u1', { addressId: 'addr1' } as never);
    expect(q.couponApplied).toBe(true);
    expect(q.couponNotice).toBeNull();
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never);
    const [tubu, shop] = orderCreate.mock.calls.map((c) => c[0].data);
    expect(tubu.shippingFee).toBe(0);
    expect(shop.shippingFee).toBe(30_000);
    expect(tubu.couponCode).toBe('FREESHIP');
    expect(coupons.redeem).toHaveBeenCalledTimes(1);
  });

  it('thu gom tái chế mà đơn không có hàng Tubu → 400, không tạo đơn', async () => {
    const { svc, orderCreate } = buildSplit({ cartData: ONLY_SHOP });
    await expect(
      svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD', hasRecyclingPickup: true } as never),
    ).rejects.toThrow('chỉ đi cùng hàng do Tubu Tree giao');
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it('thu gom tái chế chỉ gắn vào đơn Tubu của lần đặt bị tách', async () => {
    const { svc, orderCreate, gomdon } = buildSplit();
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD', hasRecyclingPickup: true } as never);
    const [tubu, shop] = orderCreate.mock.calls.map((c) => c[0].data);
    expect(tubu.hasRecyclingPickup).toBe(true);
    expect(shop.hasRecyclingPickup).toBe(false);
    expect(gomdon.enqueuePush).toHaveBeenCalledTimes(1);
  });

  it('dòng không có đường giao (hàng Tubu thiếu mã Pancake) → 400 nêu tên sản phẩm, không tạo đơn', async () => {
    const lost = { ...TUBU_ITEM, fulfiller: { kind: 'UNAVAILABLE', storefrontId: null, name: '', ownerUserId: null } };
    const { svc, orderCreate } = buildSplit({ cartData: { ...MIXED, items: [lost] } });
    await expect(svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never)).rejects.toThrow(
      'Nước rửa chén',
    );
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it('WALLET: trừ ví riêng từng đơn, tổng trừ = tổng hai đơn', async () => {
    const { svc, orderCreate } = buildSplit({ walletBalance: 10_000_000 });
    ledger.mockClear();
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'WALLET' } as never);
    const totals = orderCreate.mock.calls.map((c) => c[0].data.total as number);
    expect(ledger).toHaveBeenCalledTimes(2);
    expect(ledger.mock.calls.map((c) => -(c[1] as { delta: number }).delta)).toEqual(totals);
  });
});

// R3-MERCHANT-1: phản hồi đặt hàng và báo giá cho khách không kèm phí sàn đối tác, khoá nội bộ hay ID chủ gian hàng.
describe('CheckoutService — không lộ trường nội bộ cho khách (R3-MERCHANT-1)', () => {
  const SHOP_A = { kind: 'MERCHANT', storefrontId: 'sf-a', name: 'Shop A', ownerUserId: 'u-a' };
  const SHOP_ITEM = { id: 'i2', variationId: 'vm', productId: 'pm', productName: 'Xà phòng', variationName: '100g', unitPrice: 50_000, quantity: 1, total: 50_000, fulfiller: SHOP_A };
  const ONLY_SHOP = { items: [SHOP_ITEM], subtotal: 50_000, discount: 0, freeship: false, couponCode: null };
  const RAW_ORDER = {
    id: 'o1',
    code: 'TT1',
    total: 80_000,
    status: 'PENDING_PAYMENT',
    checkoutGroup: null,
    userId: 'u1',
    items: [{ id: 'oi1', variationId: 'vm' }],
    merchantCommissionPct: 0.15,
    commission: 0,
    endCustomerKey: '0912345678',
    idempotencyKey: 'idem-1',
    pancakeOrderId: 'pk-1',
    pancakePushStatus: 'SYNCED',
    pancakeSyncError: 'lỗi',
    pancakePushAttempts: 2,
    gomdonAttempt: 1,
    reviewInvitedAt: null,
    gomdonStatusAt: null,
    autoCancelBlockedAt: null,
    recipientSearch: 'khach it 1 duong it',
  };
  const HIDDEN = [
    'merchantCommissionPct', 'commission', 'endCustomerKey', 'idempotencyKey', 'pancakeOrderId', 'pancakePushStatus',
    'pancakeSyncError', 'pancakePushAttempts', 'gomdonAttempt', 'reviewInvitedAt', 'gomdonStatusAt', 'autoCancelBlockedAt',
    'recipientSearch',
  ];

  it('placeOrder trả đơn đã lọc cột nội bộ, vẫn giữ mã đơn và tổng tiền', async () => {
    const { svc, prisma } = build({ cartData: ONLY_SHOP });
    (prisma.order.findUniqueOrThrow as jest.Mock).mockResolvedValue({ ...RAW_ORDER });
    const res = (await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never)) as unknown as Record<string, unknown>;
    expect(res).toMatchObject({ code: 'TT1', total: 80_000 });
    for (const key of HIDDEN) expect(res).not.toHaveProperty(key);
  });

  it('lần đặt bị tách theo nơi giao: đơn trả về cũng đã lọc, kèm splitOrders', async () => {
    const { svc, prisma } = build({ cartData: ONLY_SHOP });
    (prisma.order.findUniqueOrThrow as jest.Mock).mockResolvedValue({ ...RAW_ORDER, checkoutGroup: 'TT1' });
    (prisma.order as unknown as { findMany: jest.Mock }).findMany = jest.fn().mockResolvedValue([]);
    const res = (await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never)) as unknown as Record<string, unknown>;
    expect(res).toHaveProperty('splitOrders');
    for (const key of HIDDEN) expect(res).not.toHaveProperty(key);
  });

  it('báo giá: items[].fulfiller không kèm ownerUserId của chủ gian hàng', async () => {
    const { svc } = build({ cartData: ONLY_SHOP });
    const q = await svc.quote('u1', { addressId: 'addr1' } as never);
    expect(q.items[0]!.fulfiller).toEqual({ kind: 'MERCHANT', storefrontId: 'sf-a', name: 'Shop A' });
    expect(JSON.stringify(q)).not.toContain('u-a');
  });
});

describe('CheckoutService.placeOrder — chạm đầu của khách trên order_placed (props)', () => {
  const placedEvent = (analytics: AnalyticsEventsService) =>
    (analytics.record as jest.Mock).mock.calls.map((c) => c[1]).find((e) => e.eventName === 'order_placed');

  it('mang nguồn và chiến dịch chạm đầu của khách đặt đơn', async () => {
    const { svc, prisma, analytics } = build();
    (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue({
      id: 'u1', walletBalance: 1000, pointsBalance: 1000, pointsConvertedBalance: 0, tierId: null,
      firstTouchSource: 'card-2610', firstTouchCampaign: 'hop-hang',
    });
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never);
    const e = placedEvent(analytics);
    expect(e.props).toMatchObject({ firstTouchSource: 'card-2610', firstTouchCampaign: 'hop-hang' });
    // Phong bì (entrySource/campaign) là nguồn của PHIÊN ở sự kiện client; đơn không có phiên nên không được điền vào đó.
    expect(e.entrySource).toBeUndefined();
    expect(e.campaign).toBeUndefined();
  });

  it('khách chưa có nguồn (tài khoản cũ) → null, đơn vẫn đặt được', async () => {
    const { svc, analytics } = build();
    await svc.placeOrder('u1', { addressId: 'addr1', paymentMethod: 'COD' } as never);
    expect(placedEvent(analytics).props).toMatchObject({ firstTouchSource: null, firstTouchCampaign: null });
  });
});
