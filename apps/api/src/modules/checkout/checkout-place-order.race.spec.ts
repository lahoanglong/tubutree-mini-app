import { BadRequestException } from '@nestjs/common';
import { RaceDb } from '../../../test/fakes/race-db.fake';
import { pgLikeClient } from '../../../test/fakes/race-db-client';
import { CartService } from '../cart/cart.service';
import { CouponsService } from '../coupons/coupons.service';
import { applyWalletDelta } from '../wallet/wallet-ledger.service';
import { WALLET_SHORT_MESSAGE } from './wallet-notice';
import { CheckoutService } from './checkout.service';
import type { PlaceOrderDto } from './dto/checkout.dto';

// Mã đơn ngẫu nhiên (5 số) có xác suất trùng nhỏ nhưng khác 0 giữa hai request song song; trùng mã làm test chập chờn, và không phải thứ test này kiểm.
let mockCodeSeq = 0;
jest.mock('../../common/order-code', () => ({ generateUniqueOrderCode: async () => `TUBUTEST${++mockCodeSeq}` }));

/**
 * Hai lần /checkout chạm nhau (Postgres READ COMMITTED, xem test/fakes/race-db.fake.ts). CheckoutService.placeOrder THẬT chạy transaction ghi đơn
 * trên cơ sở dữ liệu giả có khoá dòng + xét lại WHERE sau khoá: khoá giỏ (CartService.lockForCheckout), giữ kho, trừ điểm, trừ Ví
 * (applyWalletDelta), dùng mã (CouponsService.redeem), dọn giỏ. Chỉ `compute` (đọc ngoài transaction, quyết định giá/điểm/mã) và việc dựng
 * phản hồi được thay bằng stub: compute đọc giỏ/số dư lúc bắt đầu request nên hai request cùng thấy số liệu cũ, đúng cửa sổ đua cần kiểm.
 */
const PRICE: Record<string, number> = { v1: 60_000, v2: 60_000, v3: 30_000 };
const POINT_VND = 1;
const COUPON_OFF = 10_000;
const TUBU = { kind: 'TUBU', storefrontId: null, name: 'Tubu Tree', ownerUserId: null } as const;

interface UserSeed {
  wallet?: number;
  points?: number;
  converted?: number;
  couponCode?: string;
  lines?: { id: string; variationId: string; quantity?: number }[];
}
interface Options {
  users: Record<string, UserSeed>;
  stock?: Record<string, number>;
  coupons?: Record<string, unknown>[];
  /** false: bỏ ràng buộc unique idempotencyKey khỏi cơ sở dữ liệu giả để chỉ còn khoá giỏ + tra lại theo key chặn đơn trùng. */
  uniqueIdempotencyKey?: boolean;
  pointsLot?: 'STANDARD' | 'CONVERTED';
}

const defaultLines = (u: string) => [{ id: `ci-${u}-1`, variationId: 'v1', quantity: 1 }];

function setup(opts: Options) {
  const db = new RaceDb({
    user: {},
    cart: {},
    cartItem: { relations: { cart: { table: 'cart', fk: 'cartId' } } },
    product: {},
    variation: { relations: { product: { table: 'product', fk: 'productId' } } },
    order: {
      unique: opts.uniqueIdempotencyKey === false ? [{ fields: ['code'] }] : [{ fields: ['idempotencyKey'] }, { fields: ['code'] }],
      defaults: { placedForCustomer: false, subscriptionId: null, createdAt: new Date() },
    },
    walletTransaction: { unique: [{ fields: ['userId', 'type', 'refId'] }] },
    pointsTransaction: {},
    coupon: {},
    couponRedemption: { unique: [{ fields: ['couponId', 'orderId'] }] },
    address: {},
    wasteRequest: {},
    analyticsEvent: {},
  });
  db.seed('product', [{ id: 'p1', isActive: true, approvalStatus: 'APPROVED' }]);
  const stock = opts.stock ?? { v1: 10, v2: 10, v3: 10 };
  db.seed(
    'variation',
    Object.entries(stock).map(([id, n]) => ({ id, productId: 'p1', isActive: true, stock: n, reservedStock: 0 })),
  );
  db.seed('coupon', opts.coupons ?? []);
  for (const [u, seed] of Object.entries(opts.users)) {
    db.seed('user', [{ id: u, walletBalance: seed.wallet ?? 0, pointsBalance: seed.points ?? 0, pointsConvertedBalance: seed.converted ?? 0, tierId: null }]);
    db.seed('cart', [{ id: `cart-${u}`, userId: u, couponCode: seed.couponCode ?? null }]);
    db.seed(
      'cartItem',
      (seed.lines ?? defaultLines(u)).map((l) => ({ id: l.id, cartId: `cart-${u}`, variationId: l.variationId, quantity: l.quantity ?? 1 })),
    );
    db.seed('address', [{ id: `addr-${u}`, userId: u, recipient: 'A', phone: '09', province: 'HN', district: 'BD', ward: 'W', street: 'S', provinceCode: '84_VN01', districtCode: '2', wardCode: '84_VN01_00003' }]);
  }
  // Mỗi handler dưới đây là phần tương đương trong Postgres của đúng câu SQL thô mà mã thật chạy; điều kiện nào nằm trong SQL (FOR UPDATE, `"stock" >=`)
  // thì handler chỉ áp khi chính chuỗi SQL còn chứa nó, nên sửa mã thật bỏ điều kiện thì cơ sở dữ liệu giả cũng bỏ theo.
  db.handlers.push(
    {
      match: /FROM "carts" WHERE "userId"/,
      run: async (c) => {
        const mine = c.rows('cart').filter((r) => r.userId === c.params[0]);
        if (c.locking) for (const r of mine) await c.lockRow('cart', r.id);
        return mine.map((r) => ({ id: r.id }));
      },
    },
    {
      match: /FROM "users" WHERE "id"/,
      run: async (c) => {
        if (c.locking) await c.lockRow('user', c.params[0] as string);
        const u = c.rows('user').find((r) => r.id === c.params[0]);
        return u ? [{ id: u.id, walletBalance: u.walletBalance, pointsBalance: u.pointsBalance }] : [];
      },
    },
    {
      match: /FROM "variations" WHERE "id" IN/,
      run: async (c) => {
        // Mức khoá nằm trong đoạn `Prisma.sql` lồng nên chuỗi SQL mà cơ sở dữ liệu giả thấy chỉ còn dấu `?` (cờ `locking` luôn false);
        // câu này chỉ do lockVariationsInIdOrder phát ra, nên luôn coi là câu khoá và khoá theo thứ tự id như Postgres làm với ORDER BY.
        const ids = [...(c.params as string[])].sort();
        for (const id of ids) await c.lockRow('variation', id);
        return ids.map((id) => ({ id }));
      },
    },
    {
      match: /UPDATE "variations"[\s\S]*"stock" = "stock" - /,
      run: async (c) => {
        const [qty, , variationId] = c.params as [number, number, string];
        await c.lockRow('variation', variationId);
        const row = c.rows('variation').find((r) => r.id === variationId);
        if (!row) return 0;
        if (/"stock" >= /.test(c.sql) && row.stock < qty) return 0;
        await c.client.variation.update({ where: { id: variationId }, data: { stock: { decrement: qty }, reservedStock: { increment: qty } } });
        return 1;
      },
    },
    { match: /pg_advisory_xact_lock/, run: (c) => c.lockKey(c.params.join('|')).then(() => 1) },
  );

  const client = pgLikeClient(db);
  const analytics = {
    record: async (tx: any, e: { eventName: string }) => {
      await tx.analyticsEvent.create({ data: { eventName: e.eventName } });
    },
    recordBestEffort: jest.fn().mockResolvedValue(undefined),
  };
  const affiliate = {
    getActiveTouch: async () => null,
    findEligibleReferrer: async () => null,
    isCommissionEligible: async () => false,
    storefrontVisibility: async () => 'ALL',
    createCommissionForOrder: jest.fn(),
    notifyCommissionCreated: jest.fn(),
  };
  const loyalty = {
    returnWindowDays: async () => 7,
    lockedOrderPoints: async () => ({ locked: 0, lockedReturn: 0, lockedUntil: null }),
    lockedPointsMessage: () => '',
  };
  const cartService = new CartService(client as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  const svc = new CheckoutService(
    client as never,
    cartService,
    new CouponsService(client as never),
    {} as never,
    loyalty as never,
    { notify: jest.fn().mockResolvedValue(undefined) } as never,
    { enqueuePush: jest.fn().mockResolvedValue(undefined) } as never,
    { enqueuePush: jest.fn().mockResolvedValue(undefined) } as never,
    affiliate as never,
    {} as never,
    {} as never,
    analytics as never,
  );

  // compute() thật đọc giỏ/số dư/mã ngoài transaction rồi tính tiền: bản stub đọc cùng những thứ đó lúc bắt đầu request và tính theo bảng giá cố định.
  (jest.spyOn(svc as any, 'compute') as jest.SpyInstance<unknown, any[]>).mockImplementation(async (userId: string, addressId: string, pointsToUse?: number, _slug?: string, itemIds?: string[]) => {
    const rows: any[] = await client.cartItem.findMany({ where: { cart: { userId } } });
    const cartRow = await client.cart.findUnique({ where: { userId } });
    const user = await client.user.findUnique({ where: { id: userId } });
    const address = await client.address.findUnique({ where: { id: addressId } });
    const picked = rows.filter((r) => !itemIds?.length || itemIds.includes(r.id));
    const items = picked.map((r) => {
      const unitPrice = PRICE[r.variationId]!;
      return {
        id: r.id,
        variationId: r.variationId,
        productId: 'p1',
        productName: `Sản phẩm ${r.variationId}`,
        slug: 'san-pham',
        variationName: r.variationId,
        unitPrice,
        quantity: r.quantity,
        total: unitPrice * r.quantity,
        flashSaleItemId: null,
        isFlash: false,
        fulfiller: TUBU,
      };
    });
    const subtotal = items.reduce((s, l) => s + l.total, 0);
    const couponCode = cartRow?.couponCode ?? null;
    const couponDiscount = couponCode ? COUPON_OFF : 0;
    const pointsUsed = Math.min(pointsToUse ?? 0, opts.pointsLot === 'CONVERTED' ? user.pointsConvertedBalance : user.pointsBalance);
    const pointsUsedConverted = opts.pointsLot === 'CONVERTED' ? pointsUsed : 0;
    const pointsDiscount = pointsUsed * POINT_VND;
    const total = subtotal - couponDiscount - pointsDiscount;
    const shipment = {
      key: 'TUBU',
      fulfiller: TUBU,
      lineIds: items.map((l) => l.id),
      subtotal,
      discount: couponDiscount,
      couponDiscount,
      comboDiscount: 0,
      tierDiscount: 0,
      pointsDiscount,
      pointsUsed,
      pointsUsedConverted,
      shippingFee: 0,
      total,
      pointsEarned: 0,
      commissionPct: null,
      linePaid: items.map((l, i) => (i === 0 ? l.total - couponDiscount : l.total)),
      linePoints: items.map((_, i) => (i === 0 ? pointsDiscount : 0)),
    };
    return {
      cart: { items, unavailableItems: [], couponCode, couponRemoved: null, subtotal },
      user,
      address,
      computed: {
        discount: couponDiscount,
        couponApplied: couponDiscount > 0,
        couponNotice: null,
        comboDiscount: 0,
        comboPerLine: {},
        tierDiscount: 0,
        pointsUsed,
        pointsUsedConverted,
        pointsDiscount,
        shippingFee: 0,
        firstOrderShipWaived: 0,
        total,
        pointsEarned: 0,
        shipments: [shipment],
      },
    };
  });
  (jest.spyOn(svc as any, 'findOrderResponse') as jest.SpyInstance<unknown, any[]>).mockImplementation(async (orderId: string) => ({ id: orderId }));

  const dto = (userId: string, over: Partial<PlaceOrderDto> = {}): PlaceOrderDto =>
    ({ addressId: `addr-${userId}`, paymentMethod: 'WALLET', ...over }) as PlaceOrderDto;
  const place = (userId: string, over: Partial<PlaceOrderDto> = {}, key?: string) => svc.placeOrder(userId, dto(userId, over), key) as Promise<{ id: string }>;

  const user = (id: string) => db.row('user', id)!;
  const ledgerOf = (id: string) => db.rows('walletTransaction').filter((r) => r.userId === id);
  const pointsLedgerOf = (id: string) => db.rows('pointsTransaction').filter((r) => r.userId === id);
  const variation = (id: string) => db.row('variation', id)!;
  const cartLines = (id: string) => db.rows('cartItem').filter((r) => r.cartId === `cart-${id}`);
  const cartOf = (id: string) => db.row('cart', `cart-${id}`)!;
  const orders = () => db.rows('order');
  const seeded = { users: opts.users, stock };

  /** Sổ cái khớp số dư và kho không âm — bất biến mà mọi lần đua đều phải giữ. */
  const expectInvariants = () => {
    for (const [u, seed] of Object.entries(opts.users)) {
      expect(user(u).walletBalance).toBeGreaterThanOrEqual(0);
      expect(user(u).pointsBalance).toBeGreaterThanOrEqual(0);
      expect(user(u).pointsConvertedBalance).toBeGreaterThanOrEqual(0);
      expect(user(u).walletBalance).toBe((seed.wallet ?? 0) + ledgerOf(u).reduce((s, r) => s + r.delta, 0));
      const standard = pointsLedgerOf(u).filter((r) => r.lot === 'STANDARD').reduce((s, r) => s + r.delta, 0);
      const converted = pointsLedgerOf(u).filter((r) => r.lot === 'CONVERTED').reduce((s, r) => s + r.delta, 0);
      expect(user(u).pointsBalance).toBe((seed.points ?? 0) + standard);
      expect(user(u).pointsConvertedBalance).toBe((seed.converted ?? 0) + converted);
    }
    for (const [id, n] of Object.entries(seeded.stock)) {
      const v = variation(id);
      expect(v.stock).toBeGreaterThanOrEqual(0);
      expect(v.stock + v.reservedStock).toBe(n);
    }
  };
  return { db, svc, place, user, ledgerOf, pointsLedgerOf, variation, cartLines, cartOf, orders, expectInvariants, analytics };
}

const split = (settled: PromiseSettledResult<unknown>[]) => ({
  ok: settled.map((s, i) => [s, i] as const).filter(([s]) => s.status === 'fulfilled').map(([, i]) => i),
  failed: settled.map((s, i) => [s, i] as const).filter(([s]) => s.status === 'rejected').map(([, i]) => i),
  reason: (i: number) => (settled[i] as PromiseRejectedResult).reason as Error,
});

describe('CheckoutService.placeOrder — race: mã giảm giá', () => {
  it('hai khách cùng đặt với mã dùng-một-lần (usageLimit 1), trả bằng Ví + Điểm Xanh: đúng MỘT đơn; bên thua nhận "hết lượt" và không để lại dấu nào (kho, Ví, điểm, giỏ, mã giữ nguyên)', async () => {
    const { db, place, orders, user, ledgerOf, pointsLedgerOf, variation, cartLines, cartOf, expectInvariants } = setup({
      users: {
        u1: { wallet: 200_000, points: 100, couponCode: 'ONCE' },
        u2: { wallet: 200_000, points: 100, couponCode: 'ONCE' },
      },
      coupons: [{ id: 'c1', code: 'ONCE', scope: 'PUBLIC', perUserLimit: 1, usageLimit: 1, usedCount: 0, newCustomerOnly: false, createdById: null }],
    });
    const settled = await Promise.allSettled([place('u1', { pointsToUse: 10 }), place('u2', { pointsToUse: 10 })]);
    const s = split(settled);
    expect(s.ok).toHaveLength(1);
    expect(s.failed).toHaveLength(1);
    expect(s.reason(s.failed[0]!)).toBeInstanceOf(BadRequestException);
    expect(s.reason(s.failed[0]!).message).toBe('Mã giảm giá đã hết lượt sử dụng.');
    const winner = s.ok[0] === 0 ? 'u1' : 'u2';
    const loser = winner === 'u1' ? 'u2' : 'u1';
    expect(orders()).toHaveLength(1);
    expect(orders()[0]).toMatchObject({ userId: winner, couponCode: 'ONCE', paymentStatus: 'PAID', total: 60_000 - COUPON_OFF - 10 });
    expect(db.rows('couponRedemption').map((r) => [r.userId, r.orderId])).toEqual([[winner, orders()[0]!.id]]);
    expect(db.row('coupon', 'c1')!.usedCount).toBe(1);
    // Bên thua: mọi thứ transaction đã ghi (đơn, kho, điểm, Ví) bị huỷ; giỏ còn nguyên để khách thử lại.
    expect(user(loser)).toMatchObject({ walletBalance: 200_000, pointsBalance: 100 });
    expect(ledgerOf(loser)).toHaveLength(0);
    expect(pointsLedgerOf(loser)).toHaveLength(0);
    expect(cartLines(loser)).toHaveLength(1);
    expect(cartOf(loser).couponCode).toBe('ONCE');
    // Bên thắng: trừ một lần Ví + điểm, giỏ được dọn cùng transaction.
    expect(user(winner)).toMatchObject({ walletBalance: 200_000 - (60_000 - COUPON_OFF - 10), pointsBalance: 90 });
    expect(cartLines(winner)).toHaveLength(0);
    expect(variation('v1')).toMatchObject({ stock: 9, reservedStock: 1 });
    expectInvariants();
    expect(db.stats.lockWaits).toBeGreaterThan(0);
    expect(db.stats.rollbacks).toBeGreaterThan(0);
  });

  it('cùng khách đặt hai nửa giỏ song song với mã perUserLimit 1 (mã còn nằm trong giỏ sau lần đặt tập con): đúng MỘT đơn dùng mã, đơn kia nhận "đã dùng hết lượt" và giữ nguyên dòng giỏ', async () => {
    const { db, place, orders, user, variation, cartLines, expectInvariants } = setup({
      users: {
        u1: {
          wallet: 500_000,
          couponCode: 'ONCE',
          lines: [
            { id: 'ci-a', variationId: 'v1' },
            { id: 'ci-b', variationId: 'v2' },
          ],
        },
      },
      coupons: [{ id: 'c1', code: 'ONCE', scope: 'PUBLIC', perUserLimit: 1, usageLimit: null, usedCount: 0, newCustomerOnly: false, createdById: null }],
    });
    const settled = await Promise.allSettled([place('u1', { itemIds: ['ci-a'] }), place('u1', { itemIds: ['ci-b'] })]);
    const s = split(settled);
    expect(s.ok).toHaveLength(1);
    expect(s.failed).toHaveLength(1);
    expect(s.reason(s.failed[0]!).message).toBe('Bạn đã dùng hết lượt cho mã này.');
    expect(orders()).toHaveLength(1);
    expect(orders()[0]!.couponCode).toBe('ONCE');
    expect(db.rows('couponRedemption')).toHaveLength(1);
    expect(user('u1').walletBalance).toBe(500_000 - (60_000 - COUPON_OFF));
    // Dòng của đơn thua còn trong giỏ, kho của nó đã trả lại.
    const lost = s.failed[0] === 0 ? 'ci-a' : 'ci-b';
    expect(cartLines('u1').map((l) => l.id)).toEqual([lost]);
    expect(variation(lost === 'ci-a' ? 'v1' : 'v2')).toMatchObject({ stock: 10, reservedStock: 0 });
    expectInvariants();
  });
});

describe('CheckoutService.placeOrder — race: Ví', () => {
  it('cùng khách đặt hai nửa giỏ 60.000đ song song với Ví 100.000đ: đúng MỘT đơn, Ví 40.000đ không âm, đúng một dòng ORDER_PAY; bên thua nhận "Số dư Ví Tubu không đủ."', async () => {
    const { db, place, orders, user, ledgerOf, variation, cartLines, expectInvariants } = setup({
      users: {
        u1: {
          wallet: 100_000,
          lines: [
            { id: 'ci-a', variationId: 'v1' },
            { id: 'ci-b', variationId: 'v2' },
          ],
        },
      },
    });
    const settled = await Promise.allSettled([place('u1', { itemIds: ['ci-a'] }), place('u1', { itemIds: ['ci-b'] })]);
    const s = split(settled);
    expect(s.ok).toHaveLength(1);
    expect(s.failed).toHaveLength(1);
    expect(s.reason(s.failed[0]!).message).toBe(WALLET_SHORT_MESSAGE);
    expect(orders()).toHaveLength(1);
    expect(user('u1').walletBalance).toBe(40_000);
    expect(ledgerOf('u1').map((r) => [r.type, r.delta, r.refId])).toEqual([['ORDER_PAY', -60_000, orders()[0]!.id]]);
    // Đơn thua đã giữ kho rồi bị rollback: kho của nó nguyên vẹn, dòng giỏ còn.
    const lost = s.failed[0] === 0 ? 'ci-a' : 'ci-b';
    expect(variation(lost === 'ci-a' ? 'v1' : 'v2')).toMatchObject({ stock: 10, reservedStock: 0 });
    expect(cartLines('u1').map((l) => l.id)).toEqual([lost]);
    expectInvariants();
    expect(db.stats.rollbacks).toBeGreaterThan(0);
  });

  it('Ví 100.000đ: checkout 60.000đ chạy cùng lúc một lệnh trừ tay 60.000đ ở mọi độ lệch thời gian: không bao giờ cả hai cùng qua, Ví không âm, sổ khớp số dư', async () => {
    let touched = 0;
    for (let delay = 0; delay <= 90; delay += 1) {
      const { db, place, orders, user, ledgerOf, expectInvariants } = setup({ users: { u1: { wallet: 100_000 } } });
      const spend = async () => {
        for (let i = 0; i < delay; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
        await db.client.$transaction((tx: any) =>
          applyWalletDelta(tx, { userId: 'u1', delta: -60_000, type: 'ADJUST', refType: 'ADMIN', refId: `adj-${delay}`, insufficientMessage: 'Số dư ví không đủ.' }),
        );
      };
      const settled = await Promise.allSettled([place('u1'), spend()]);
      expect(split(settled).ok).toHaveLength(1);
      expect(user('u1').walletBalance).toBe(40_000);
      expect(ledgerOf('u1')).toHaveLength(1);
      expect(orders().length).toBe(ledgerOf('u1')[0]!.type === 'ORDER_PAY' ? 1 : 0);
      expectInvariants();
      if (db.stats.lockWaits > 0) touched += 1;
    }
    expect(touched).toBeGreaterThan(0); // có độ lệch mà hai bên thật sự chờ nhau ở dòng user
  });
});

describe('CheckoutService.placeOrder — race: kho', () => {
  it('hai khách tranh đơn vị cuối cùng: đúng MỘT đơn, kho 0 không âm; bên thua nhận "không đủ tồn kho" và không trừ Ví', async () => {
    const { db, place, orders, user, variation, expectInvariants } = setup({
      users: { u1: { wallet: 200_000 }, u2: { wallet: 200_000 } },
      stock: { v1: 1, v2: 10, v3: 10 },
    });
    const settled = await Promise.allSettled([place('u1'), place('u2')]);
    const s = split(settled);
    expect(s.ok).toHaveLength(1);
    expect(s.failed).toHaveLength(1);
    expect(s.reason(s.failed[0]!).message).toBe('Sản phẩm "Sản phẩm v1" không đủ tồn kho.');
    expect(orders()).toHaveLength(1);
    expect(variation('v1')).toMatchObject({ stock: 0, reservedStock: 1 });
    const loser = s.failed[0] === 0 ? 'u1' : 'u2';
    expect(user(loser).walletBalance).toBe(200_000);
    expectInvariants();
    expect(db.stats.rollbacks).toBeGreaterThan(0);
  });

  it('hai khách cùng đặt hai dòng, dòng thứ hai chỉ còn một đơn vị: bên thua đã giữ dòng đầu rồi rollback, kho dòng đầu chỉ bị trừ một lần', async () => {
    const { place, orders, variation, expectInvariants } = setup({
      users: {
        u1: { wallet: 500_000, lines: [{ id: 'ci-u1-1', variationId: 'v1' }, { id: 'ci-u1-2', variationId: 'v2' }] },
        u2: { wallet: 500_000, lines: [{ id: 'ci-u2-1', variationId: 'v1' }, { id: 'ci-u2-2', variationId: 'v2' }] },
      },
      stock: { v1: 5, v2: 1, v3: 10 },
    });
    const settled = await Promise.allSettled([place('u1'), place('u2')]);
    const s = split(settled);
    expect(s.ok).toHaveLength(1);
    expect(s.failed).toHaveLength(1);
    expect(s.reason(s.failed[0]!).message).toBe('Sản phẩm "Sản phẩm v2" không đủ tồn kho.');
    expect(orders()).toHaveLength(1);
    expect(variation('v1')).toMatchObject({ stock: 4, reservedStock: 1 });
    expect(variation('v2')).toMatchObject({ stock: 0, reservedStock: 1 });
    expectInvariants();
  });

  // Mỗi tx giữ kho từng dòng theo thứ tự giỏ; giỏ [v1, v2] và [v2, v1] mà không khoá trước theo thứ tự id thì mỗi bên giữ một dòng rồi chờ dòng kia
  // (Postgres báo 40P01 và huỷ một bên; cơ sở dữ liệu giả không phát hiện deadlock nên cả hai treo tới hết thời gian test).
  it('hai khách đặt cùng hai biến thể theo thứ tự dòng ngược nhau, kho đủ: cả hai đơn thành công, không deadlock (khoá biến thể theo thứ tự id)', async () => {
    const { place, orders, variation, expectInvariants } = setup({
      users: {
        u1: { wallet: 500_000, lines: [{ id: 'ci-u1-1', variationId: 'v1' }, { id: 'ci-u1-2', variationId: 'v2' }] },
        u2: { wallet: 500_000, lines: [{ id: 'ci-u2-1', variationId: 'v2' }, { id: 'ci-u2-2', variationId: 'v1' }] },
      },
      stock: { v1: 5, v2: 5, v3: 10 },
    });
    await Promise.all([place('u1'), place('u2')]);
    expect(orders()).toHaveLength(2);
    expect(variation('v1')).toMatchObject({ stock: 3, reservedStock: 2 });
    expect(variation('v2')).toMatchObject({ stock: 3, reservedStock: 2 });
    expectInvariants();
  }, 4_000);
});

describe('CheckoutService.placeOrder — race: Điểm Xanh', () => {
  it.each([
    ['lô thường (STANDARD)', 'STANDARD', /Số điểm Xanh không đủ \(hiện có 40 điểm\)/],
    ['lô quy đổi (CONVERTED)', 'CONVERTED', /Số Điểm Xanh không hết hạn của bạn đã thay đổi/],
  ] as const)('cùng khách đặt hai nửa giỏ song song, mỗi nửa tiêu 60 điểm %s trong 100 điểm: đúng MỘT đơn, số dư 40 không âm, đúng một dòng sổ điểm', async (_label, lot, message) => {
    const { db, place, orders, user, pointsLedgerOf, variation, cartLines, expectInvariants } = setup({
      users: {
        u1: {
          points: lot === 'STANDARD' ? 100 : 0,
          converted: lot === 'CONVERTED' ? 100 : 0,
          lines: [
            { id: 'ci-a', variationId: 'v1' },
            { id: 'ci-b', variationId: 'v2' },
          ],
        },
      },
      pointsLot: lot,
    });
    const settled = await Promise.allSettled([
      place('u1', { itemIds: ['ci-a'], paymentMethod: 'COD', pointsToUse: 60 }),
      place('u1', { itemIds: ['ci-b'], paymentMethod: 'COD', pointsToUse: 60 }),
    ]);
    const s = split(settled);
    expect(s.ok).toHaveLength(1);
    expect(s.failed).toHaveLength(1);
    expect(s.reason(s.failed[0]!)).toBeInstanceOf(BadRequestException);
    expect(s.reason(s.failed[0]!).message).toMatch(message);
    expect(orders()).toHaveLength(1);
    expect(user('u1')).toMatchObject(lot === 'STANDARD' ? { pointsBalance: 40 } : { pointsConvertedBalance: 40 });
    expect(pointsLedgerOf('u1').map((r) => [r.lot, r.delta])).toEqual([[lot, -60]]);
    const lost = s.failed[0] === 0 ? 'ci-a' : 'ci-b';
    expect(variation(lost === 'ci-a' ? 'v1' : 'v2')).toMatchObject({ stock: 10, reservedStock: 0 });
    expect(cartLines('u1').map((l) => l.id)).toEqual([lost]);
    expectInvariants();
    expect(db.stats.rollbacks).toBeGreaterThan(0);
  });

  it('hai khách khác nhau tiêu điểm của riêng mình song song: cả hai đều qua, mỗi người trừ đúng phần của mình (khoá điểm không chặn nhầm người khác)', async () => {
    const { place, orders, user, expectInvariants } = setup({
      users: { u1: { points: 100 }, u2: { points: 100 } },
    });
    await Promise.all([place('u1', { paymentMethod: 'COD', pointsToUse: 60 }), place('u2', { paymentMethod: 'COD', pointsToUse: 60 })]);
    expect(orders()).toHaveLength(2);
    expect(user('u1').pointsBalance).toBe(40);
    expect(user('u2').pointsBalance).toBe(40);
    expectInvariants();
  });
});

describe('CheckoutService.placeOrder — race: Idempotency-Key và đơn trùng', () => {
  it.each([
    ['có ràng buộc unique idempotencyKey', true],
    ['KHÔNG có ràng buộc unique (chỉ còn khoá giỏ + tra lại theo key)', false],
  ])('ba lần đặt cùng Idempotency-Key chạy chồng (%s): đúng MỘT đơn, Ví/kho/mã chỉ tính một lần, cả ba lần trả cùng đơn', async (_label, uniqueIdempotencyKey) => {
    const { db, place, orders, user, ledgerOf, variation, cartLines, expectInvariants } = setup({
      users: { u1: { wallet: 200_000, couponCode: 'ONCE' } },
      coupons: [{ id: 'c1', code: 'ONCE', scope: 'PUBLIC', perUserLimit: 1, usageLimit: 5, usedCount: 0, newCustomerOnly: false, createdById: null }],
      uniqueIdempotencyKey,
    });
    const results = await Promise.all([place('u1', {}, 'key-1'), place('u1', {}, 'key-1'), place('u1', {}, 'key-1')]);
    expect(orders()).toHaveLength(1);
    expect(new Set(results.map((r) => r.id))).toEqual(new Set([orders()[0]!.id]));
    expect(orders()[0]!.idempotencyKey).toBe('key-1');
    expect(user('u1').walletBalance).toBe(200_000 - (60_000 - COUPON_OFF));
    expect(ledgerOf('u1')).toHaveLength(1);
    expect(variation('v1')).toMatchObject({ stock: 9, reservedStock: 1 });
    expect(db.rows('couponRedemption')).toHaveLength(1);
    expect(db.row('coupon', 'c1')!.usedCount).toBe(1);
    expect(cartLines('u1')).toHaveLength(0);
    expectInvariants();
    expect(db.stats.lockWaits).toBeGreaterThan(0);
  });

  it.each([
    ['mỗi lần một Idempotency-Key khác (app tự sinh key mới khi bấm lại)', (i: number) => `key-${i}`],
    ['không gửi Idempotency-Key', () => undefined],
  ])('ba lần đặt chạy chồng, %s: đúng MỘT đơn, Ví/kho chỉ tính một lần, các lần sau nhận lại đơn vừa tạo (khoá giỏ là chốt duy nhất)', async (_label, keyOf) => {
    const { db, place, orders, user, ledgerOf, variation, expectInvariants } = setup({ users: { u1: { wallet: 200_000 } } });
    const results = await Promise.all([0, 1, 2].map((i) => place('u1', {}, keyOf(i))));
    expect(orders()).toHaveLength(1);
    expect(new Set(results.map((r) => r.id))).toEqual(new Set([orders()[0]!.id]));
    expect(user('u1').walletBalance).toBe(200_000 - 60_000);
    expect(ledgerOf('u1')).toHaveLength(1);
    expect(variation('v1')).toMatchObject({ stock: 9, reservedStock: 1 });
    expectInvariants();
    expect(db.stats.lockWaits).toBeGreaterThan(0);
  });

  it('hai tài khoản gửi CÙNG một Idempotency-Key song song (giỏ khác nhau, không chung khoá giỏ): đúng một đơn; tài khoản kia bị từ chối "Idempotency-Key không hợp lệ" và transaction của nó bị huỷ hẳn', async () => {
    const { db, place, orders, user, variation, cartLines, expectInvariants } = setup({
      users: { u1: { wallet: 200_000 }, u2: { wallet: 200_000 } },
    });
    const settled = await Promise.allSettled([place('u1', {}, 'shared-key'), place('u2', {}, 'shared-key')]);
    const s = split(settled);
    expect(s.ok).toHaveLength(1);
    expect(s.failed).toHaveLength(1);
    expect(s.reason(s.failed[0]!)).toBeInstanceOf(BadRequestException);
    expect(s.reason(s.failed[0]!).message).toBe('Idempotency-Key không hợp lệ.');
    expect(orders()).toHaveLength(1);
    const loser = s.failed[0] === 0 ? 'u1' : 'u2';
    expect(user(loser).walletBalance).toBe(200_000);
    expect(cartLines(loser)).toHaveLength(1);
    expect(variation('v1')).toMatchObject({ stock: 9, reservedStock: 1 });
    expectInvariants();
    expect(db.stats.rollbacks).toBeGreaterThan(0);
  });
});
