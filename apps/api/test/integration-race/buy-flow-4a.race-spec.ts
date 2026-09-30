import { Test, type TestingModule } from '@nestjs/testing';
import type { ProductApprovalStatus, Variation } from '@prisma/client';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { PurchasedItemsService } from '../../src/modules/orders/purchased-items.service';
import { CartService } from '../../src/modules/cart/cart.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { createOrder, createUser, randCode, warmPool } from './helpers';

/**
 * Dự án 4a trên Postgres THẬT: repurchase v2 (mỗi dòng độc lập, CartService thật với kiểm tồn +
 * approvalStatus + sự kiện add_to_cart) và purchased-items (SQL thô: lọc DELIVERED + đúng user +
 * SP còn bán, phân trang cursor ổn định kể cả khi 2 variation cùng mốc createdAt).
 * Stub: coupon / flash-sale (giỏ không có mã, không giờ vàng), thông báo, hoa hồng.
 */
describe('Buy-flow 4a — repurchase v2 + purchased-items (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let orders: OrdersService;
  let cart: CartService;
  let purchased: PurchasedItemsService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        LoyaltyService,
        OrderReversalService,
        OrdersService,
        CartService,
        AnalyticsEventsService,
        PurchasedItemsService,
        { provide: CouponsService, useValue: { validateAndCompute: jest.fn(), release: jest.fn() } },
        { provide: FlashSaleService, useValue: { resolveEffective: jest.fn().mockResolvedValue(new Map()), restore: jest.fn() } },
        { provide: AffiliateService, useValue: { reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined) } },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    orders = moduleRef.get(OrdersService);
    cart = moduleRef.get(CartService);
    purchased = moduleRef.get(PurchasedItemsService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  /**
   * `id` cố định (tuỳ chọn) để test phân trang tự chọn thứ tự tie-break: các id trong CÙNG một test
   * chỉ khác nhau đúng một chữ thường ở cuối nên thứ tự giống hệt dưới mọi collation của DB.
   */
  async function createVariation(over: {
    stock: number;
    id?: string;
    isActive?: boolean;
    productIsActive?: boolean;
    approvalStatus?: ProductApprovalStatus;
  }): Promise<Variation> {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: {
        pancakeId: `it-p-${tag}`,
        brand: 'IT Brand',
        slug: `it-sp-${tag.toLowerCase()}`,
        name: `SP IT ${tag}`,
        description: 'IT',
        basePrice: 50_000,
        isActive: over.productIsActive ?? true,
        approvalStatus: over.approvalStatus ?? 'APPROVED',
        thumbnail: `https://img.test/${tag}.jpg`,
      },
    });
    return prisma.variation.create({
      data: {
        ...(over.id ? { id: over.id } : {}),
        pancakeId: `it-v-${tag}`,
        productId: product.id,
        sku: `IT-${tag}`,
        name: 'Mặc định',
        attributes: {},
        retailPrice: 50_000,
        stock: over.stock,
        isActive: over.isActive ?? true,
      },
    });
  }

  /** Bộ id có chung tiền tố, chỉ khác chữ cái cuối → cùng thứ tự dưới mọi collation. */
  function idSet() {
    const prefix = `it4a-${randCode(8).toLowerCase()}`;
    return (suffix: string) => `${prefix}-${suffix}`;
  }

  async function addLine(orderId: string, variation: Variation, quantity: number) {
    return prisma.orderItem.create({
      data: {
        orderId,
        variationId: variation.id,
        productName: 'SP IT',
        variationName: variation.name,
        unitPrice: 50_000,
        quantity,
        total: 50_000 * quantity,
      },
    });
  }

  async function pageThrough(userId: string, limit: number) {
    const ids: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 20; guard += 1) {
      const p = await purchased.list(userId, { limit, cursor });
      ids.push(...p.items.map((i) => i.variationId));
      if (!p.nextCursor) return ids;
      cursor = p.nextCursor;
    }
    throw new Error('pageThrough: cursor không kết thúc (vòng lặp vô hạn?)');
  }

  it('(a) repurchase: dòng bị từ chối / hết hàng / giỏ đã giữ hết tồn KHÔNG chặn dòng còn hàng; dòng thiếu tồn được kẹp', async () => {
    const user = await createUser(prisma);
    const ok = await createVariation({ stock: 10 });
    const rejected = await createVariation({ stock: 10, approvalStatus: 'REJECTED' });
    const full = await createVariation({ stock: 1 });
    const empty = await createVariation({ stock: 0 });
    const short = await createVariation({ stock: 2 });
    const order = await createOrder(prisma, { userId: user.id, status: 'DELIVERED' });
    const lOk = await addLine(order.id, ok, 3);
    const lRej = await addLine(order.id, rejected, 1);
    const lFull = await addLine(order.id, full, 1);
    const lEmpty = await addLine(order.id, empty, 1);
    const lShort = await addLine(order.id, short, 3);

    // Giỏ đã giữ trọn tồn của `full` (bản cũ: addItem ném 400 ngay dòng này, bỏ dở cả vòng lặp).
    await cart.addItem(user.id, { variationId: full.id, quantity: 1 });

    const res = await orders.repurchase(user.id, order.code);

    expect(res.results).toHaveLength(5);
    expect(res.results).toEqual(
      expect.arrayContaining([
        { orderItemId: lOk.id, status: 'added', addedQuantity: 3 },
        { orderItemId: lRej.id, status: 'skipped', reason: 'NOT_APPROVED', addedQuantity: 0 },
        { orderItemId: lFull.id, status: 'skipped', reason: 'EXCEEDS_STOCK', addedQuantity: 0 },
        { orderItemId: lEmpty.id, status: 'skipped', reason: 'OUT_OF_STOCK', addedQuantity: 0 },
        { orderItemId: lShort.id, status: 'partial', reason: 'EXCEEDS_STOCK', addedQuantity: 2 },
      ]),
    );
    const lines = await prisma.cartItem.findMany({ where: { cart: { userId: user.id } } });
    const qty = new Map(lines.map((l) => [l.variationId, l.quantity]));
    expect(qty.get(ok.id)).toBe(3);
    expect(qty.get(full.id)).toBe(1);
    expect(qty.get(short.id)).toBe(2);
    expect(qty.has(rejected.id)).toBe(false);
    expect(qty.has(empty.id)).toBe(false);
    // Giỏ ở top-level (bản miniapp cũ đọc thẳng) + results.
    expect(res.items).toHaveLength(3);
    expect(res.itemCount).toBe(6);

    const events = await prisma.analyticsEvent.findMany({ where: { userId: user.id, eventName: 'add_to_cart' } });
    const sources = events.map((e) => (e.props as { addSource?: string }).addSource).sort();
    expect(sources).toEqual(['pdp', 'repurchase', 'repurchase']);
  });

  it('(a2) repurchase: giỏ đã giữ MỘT PHẦN tồn → kẹp phần còn lại (tồn 5, giỏ 3, yêu cầu 3 → thêm 2)', async () => {
    const user = await createUser(prisma);
    const v = await createVariation({ stock: 5 });
    const order = await createOrder(prisma, { userId: user.id, status: 'DELIVERED' });
    const line = await addLine(order.id, v, 3);
    await cart.addItem(user.id, { variationId: v.id, quantity: 3 });

    const res = await orders.repurchase(user.id, order.code);

    expect(res.results).toEqual([{ orderItemId: line.id, status: 'partial', reason: 'EXCEEDS_STOCK', addedQuantity: 2 }]);
    const row = await prisma.cartItem.findFirst({ where: { variationId: v.id, cart: { userId: user.id } } });
    expect(row?.quantity).toBe(5);
  });

  it('(b) purchased-items: chỉ DELIVERED của chính user, loại SP ngừng bán, mới nhất trước, cursor ổn định khi trùng mốc', async () => {
    const me = await createUser(prisma);
    const other = await createUser(prisma);
    const vid = idSet();
    const a = await createVariation({ stock: 5, id: vid('a') });
    const b = await createVariation({ stock: 0, id: vid('b') });
    const d = await createVariation({ stock: 3, id: vid('d') });
    const c = await createVariation({ stock: 5, id: vid('c') });
    const gone = await createVariation({ stock: 5, isActive: false });

    const old = await createOrder(prisma, { userId: me.id, status: 'DELIVERED', createdAt: new Date('2026-08-01T03:00:00.000Z') });
    await addLine(old.id, a, 1);
    await addLine(old.id, d, 1);
    await addLine(old.id, gone, 1);
    const recent = await createOrder(prisma, { userId: me.id, status: 'DELIVERED', createdAt: new Date('2026-09-10T03:00:00.123Z') });
    await addLine(recent.id, a, 1);
    await addLine(recent.id, b, 2);
    const pending = await createOrder(prisma, { userId: me.id, status: 'CONFIRMED' });
    await addLine(pending.id, c, 1);
    const others = await createOrder(prisma, { userId: other.id, status: 'DELIVERED' });
    await addLine(others.id, c, 1);

    const all = await purchased.list(me.id, { limit: 20 });
    // a và b cùng mốc `recent` → phá hoà bằng variationId giảm dần (b > a); d (đơn cũ) cuối.
    const expected = [b.id, a.id, d.id];
    expect(all.items.map((i) => i.variationId)).toEqual(expected);
    const itemA = all.items.find((i) => i.variationId === a.id)!;
    expect(itemA.timesBought).toBe(2);
    expect(itemA.lastPurchasedAt).toBe('2026-09-10T03:00:00.123Z');
    expect(all.items.find((i) => i.variationId === b.id)!.inStock).toBe(false);
    expect(all.nextCursor).toBeNull();

    const p1 = await purchased.list(me.id, { limit: 1 });
    const p2 = await purchased.list(me.id, { limit: 1, cursor: p1.nextCursor! });
    const p3 = await purchased.list(me.id, { limit: 1, cursor: p2.nextCursor! });
    expect([p1, p2, p3].map((p) => p.items[0]!.variationId)).toEqual(expected);
    expect(p3.nextCursor).toBeNull();

    // c chỉ nằm trong đơn chưa giao + đơn của người khác.
    await expect(purchased.list(me.id, { variationId: c.id })).resolves.toEqual({ items: [], nextCursor: null });
    await expect(purchased.list(me.id, { variationId: a.id })).resolves.toMatchObject({ items: [{ variationId: a.id }] });
  });

  it('(c) purchased-items loại: PENDING_REVIEW / REJECTED, SP ngừng bán (variation còn bật), đơn CANCELLED / RETURNED; cùng variation 2 dòng trong 1 đơn = 1 lần mua', async () => {
    const me = await createUser(prisma);
    const vid = idSet();
    const good = await createVariation({ stock: 4, id: vid('a') });
    const pendingReview = await createVariation({ stock: 4, approvalStatus: 'PENDING_REVIEW' });
    const rejected = await createVariation({ stock: 4, approvalStatus: 'REJECTED' });
    // variation ĐANG BẬT nhưng SP cha isActive=false — chỉ lọc theo v.isActive sẽ để lọt.
    const productOff = await createVariation({ stock: 4, productIsActive: false });
    const variationOff = await createVariation({ stock: 4, isActive: false });
    const onlyCancelled = await createVariation({ stock: 4, id: vid('c') });
    const onlyReturned = await createVariation({ stock: 4, id: vid('d') });
    const onlyShipping = await createVariation({ stock: 4, id: vid('e') });
    const onlyPendingPayment = await createVariation({ stock: 4, id: vid('f') });

    const delivered = await createOrder(prisma, { userId: me.id, status: 'DELIVERED', createdAt: new Date('2026-09-01T00:00:00.000Z') });
    // Cùng variation trên 2 dòng của MỘT đơn → COUNT(DISTINCT order) = 1, không phải 2.
    await addLine(delivered.id, good, 1);
    await addLine(delivered.id, good, 2);
    await addLine(delivered.id, pendingReview, 1);
    await addLine(delivered.id, rejected, 1);
    await addLine(delivered.id, productOff, 1);
    await addLine(delivered.id, variationOff, 1);
    for (const [status, v] of [
      ['CANCELLED', onlyCancelled],
      ['RETURNED', onlyReturned],
      ['SHIPPING', onlyShipping],
      ['PENDING_PAYMENT', onlyPendingPayment],
    ] as const) {
      const o = await createOrder(prisma, { userId: me.id, status, createdAt: new Date('2026-09-05T00:00:00.000Z') });
      await addLine(o.id, v, 1);
    }

    const res = await purchased.list(me.id, { limit: 50 });
    expect(res.items.map((i) => i.variationId)).toEqual([good.id]);
    expect(res.items[0]!.timesBought).toBe(1);
    expect(res.nextCursor).toBeNull();

    // Cùng variation mua ở 2 đơn DELIVERED khác nhau → 2 (và dòng trùng trong đơn vẫn chỉ tính 1/đơn).
    const second = await createOrder(prisma, { userId: me.id, status: 'DELIVERED', createdAt: new Date('2026-09-20T00:00:00.000Z') });
    await addLine(second.id, good, 1);
    const again = await purchased.list(me.id, { limit: 50 });
    expect(again.items[0]).toMatchObject({ variationId: good.id, timesBought: 2, lastPurchasedAt: '2026-09-20T00:00:00.000Z' });
  });

  it('(d) cursor: mili-giây .999 / .001 (trang kết thúc ngay trên hàng .001 khi còn hàng sau) và hoà mốc — duyệt hết mọi limit, không lặp, không sót, khớp thứ tự SQL COLLATE "C"', async () => {
    const me = await createUser(prisma);
    const vid = idSet();
    const v = {
      a: await createVariation({ stock: 1, id: vid('a') }),
      b: await createVariation({ stock: 1, id: vid('b') }),
      c: await createVariation({ stock: 1, id: vid('c') }),
      // `c0` > `c` dưới mọi collation (c là tiền tố của c0) → xếp TRƯỚC c khi DESC: trang có thể dừng ngay trên hàng .001 (c0) khi còn c.
      c0: await createVariation({ stock: 1, id: vid('c0') }),
      d: await createVariation({ stock: 1, id: vid('d') }),
      e: await createVariation({ stock: 1, id: vid('e') }),
    };
    // .999 ms (a, b hoà), .001 ms (c0, c hoà), giây tròn liền sau .999 (d, e hoà) — biên làm tròn/cắt ms.
    const o999 = await createOrder(prisma, { userId: me.id, status: 'DELIVERED', createdAt: new Date('2026-09-15T10:00:00.999Z') });
    await addLine(o999.id, v.a, 1);
    await addLine(o999.id, v.b, 1);
    const o001 = await createOrder(prisma, { userId: me.id, status: 'DELIVERED', createdAt: new Date('2026-09-15T10:00:00.001Z') });
    await addLine(o001.id, v.c, 1);
    await addLine(o001.id, v.c0, 1);
    const oNext = await createOrder(prisma, { userId: me.id, status: 'DELIVERED', createdAt: new Date('2026-09-15T10:00:01.000Z') });
    await addLine(oNext.id, v.d, 1);
    await addLine(oNext.id, v.e, 1);

    // Thứ tự kỳ vọng do chính Postgres tính (COLLATE "C") thay vì sort JS.
    const ref = await prisma.$queryRaw<{ variationId: string }[]>`
      SELECT oi."variationId" AS "variationId"
      FROM order_items oi JOIN orders o ON o.id = oi."orderId"
      WHERE o."userId" = ${me.id} AND o.status::text = 'DELIVERED'
      GROUP BY oi."variationId"
      ORDER BY MAX(o."createdAt") DESC, oi."variationId" COLLATE "C" DESC`;
    const expected = ref.map((r) => r.variationId);
    // Kiểm chéo bằng tay: e,d (01.000) -> b,a (00.999) -> c0,c (00.001).
    expect(expected).toEqual([v.e.id, v.d.id, v.b.id, v.a.id, v.c0.id, v.c.id]);

    // limit 1..5: có ít nhất một kích cỡ trang kết thúc trên c0 (.001) khi c còn ở trang sau → cursor .001 được mã hoá/giải mã thật.
    for (const limit of [1, 2, 3, 4, 5, 6]) {
      expect(await pageThrough(me.id, limit)).toEqual(expected);
    }

    const full = await purchased.list(me.id, { limit: 50 });
    expect(full.items.map((i) => i.lastPurchasedAt)).toEqual([
      '2026-09-15T10:00:01.000Z',
      '2026-09-15T10:00:01.000Z',
      '2026-09-15T10:00:00.999Z',
      '2026-09-15T10:00:00.999Z',
      '2026-09-15T10:00:00.001Z',
      '2026-09-15T10:00:00.001Z',
    ]);
  });
});
