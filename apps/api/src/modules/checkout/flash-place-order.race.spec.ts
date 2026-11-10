import { BadRequestException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { flashClient, flashDb, ticks, HOUR, T0, type ItemSeed, type SaleSeed } from '../../../test/fakes/w97a-flash-harness';
import { CartService } from '../cart/cart.service';
import { LOCK_BUSY_MESSAGE } from '../../common/lock-busy';
import { FlashQuotaLineError, FlashSaleService } from '../flash-sale/flash-sale.service';
import { CheckoutService } from './checkout.service';
import type { PlaceOrderDto } from './dto/checkout.dto';

let codeSeq = 0;
jest.mock('../../common/order-code', () => ({ generateUniqueOrderCode: async () => `TUBUFLASH${++codeSeq}` }));

/**
 * Đặt đơn có dòng Giờ vàng chạm nhau (Postgres READ COMMITTED, xem test/fakes/race-db.fake.ts). CheckoutService.placeOrder THẬT chạy transaction ghi đơn
 * (khoá giỏ, giữ kho, FlashSaleService.consumeQuotas, dọn giỏ) trên cơ sở dữ liệu giả; chỉ `compute` (đọc ngoài transaction, quyết định giá) là stub: nó đọc
 * đợt Giờ vàng đang chạy lúc bắt đầu request nên các request cùng thấy giá Giờ vàng cũ, đúng cửa sổ đua cần kiểm.
 */
const STANDING = 100_000;
const FLASH_PRICE = 60_000;
const TUBU = { kind: 'TUBU', storefrontId: null, name: 'Tubu Tree', ownerUserId: null } as const;

interface Opts {
  users: Record<string, { lines?: { id: string; variationId: string; quantity: number }[] }>;
  sale?: SaleSeed;
  items?: ItemSeed[];
  purchases?: { itemId: string; userId: string; quantity: number }[];
  stock?: number;
  /** Tồn của từng biến thể (ghi đè `stock`). */
  stocks?: Record<string, number>;
  /** Chạy sau khi compute đã đọc giá và trước khi giao dịch ghi đơn: chỗ để đợt Giờ vàng kết thúc/bị tắt chen vào. */
  afterCompute?: (userId: string) => void | Promise<void>;
}

function setup(opts: Opts) {
  const db = flashDb({ sale: opts.sale, items: opts.items ?? [{ quota: 1, perUserLimit: 5 }], purchases: opts.purchases });
  const client = flashClient(db);
  db.seed('product', [{ id: 'p1', isActive: true, approvalStatus: 'APPROVED' }]);
  db.seed('variation', ['v1', 'v2'].map((id) => ({ id, productId: 'p1', isActive: true, stock: opts.stocks?.[id] ?? opts.stock ?? 10, reservedStock: 0 })));
  for (const [u, seed] of Object.entries(opts.users)) {
    db.seed('user', [{ id: u, walletBalance: 0, pointsBalance: 0, pointsConvertedBalance: 0 }]);
    db.seed('cart', [{ id: `cart-${u}`, userId: u, couponCode: null }]);
    db.seed(
      'cartItem',
      (seed.lines ?? [{ id: `ci-${u}`, variationId: 'v1', quantity: 1 }]).map((l) => ({ ...l, cartId: `cart-${u}` })),
    );
    db.seed('address', [{ id: `addr-${u}`, userId: u, recipient: 'A', phone: '09', province: 'HN', district: 'BD', ward: 'W', street: 'S', provinceCode: '84_VN01', districtCode: '2', wardCode: '84_VN01_00003' }]);
  }
  const flash = new FlashSaleService(client as never, {} as never, {} as never, {} as never);
  const cart = new CartService(client as never, {} as never, {} as never, flash, {} as never, {} as never);
  const analytics = {
    record: async (tx: any, e: { eventName: string }) => {
      await tx.analyticsEvent.create({ data: { eventName: e.eventName } });
    },
    recordBestEffort: jest.fn().mockResolvedValue(undefined),
  };
  const svc = new CheckoutService(
    client as never,
    cart,
    {} as never,
    {} as never,
    {} as never,
    { notify: jest.fn().mockResolvedValue(undefined) } as never,
    { enqueuePush: jest.fn().mockResolvedValue(undefined) } as never,
    { enqueuePush: jest.fn().mockResolvedValue(undefined) } as never,
    {
      getActiveTouch: async () => null,
      findEligibleReferrer: async () => null,
      isCommissionEligible: async () => false,
      storefrontVisibility: async () => 'ALL',
    } as never,
    {} as never,
    flash,
    analytics as never,
  );

  /** Giá giỏ tại lúc compute: dòng nào có đợt Giờ vàng đang chạy (theo giờ máy) và còn suất thì tính giá Giờ vàng, dòng khác giá thường. */
  (jest.spyOn(svc as any, 'compute') as jest.SpyInstance<unknown, any[]>).mockImplementation(async (userId: string, addressId: string) => {
    const rows: any[] = await client.cartItem.findMany({ where: { cart: { userId } } });
    const user = await client.user.findUnique({ where: { id: userId } });
    const address = await client.address.findUnique({ where: { id: addressId } });
    const now = Date.now();
    const sales: any[] = await client.flashSale.findMany({});
    const live = new Map<string, any>();
    for (const it of (await client.flashSaleItem.findMany({})) as any[]) {
      const sale = sales.find((s) => s.id === it.flashSaleId);
      if (sale?.isActive && sale.startAt.getTime() <= now && sale.endAt.getTime() > now && it.soldCount < it.quota) live.set(it.variationId, it);
    }
    const items = rows.map((r) => {
      const flash = live.get(r.variationId);
      const unitPrice = flash ? FLASH_PRICE : STANDING;
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
        flashSaleItemId: flash?.id ?? null,
        isFlash: !!flash,
        fulfiller: TUBU,
      };
    });
    const subtotal = items.reduce((s, l) => s + l.total, 0);
    const shipment = {
      key: 'TUBU',
      fulfiller: TUBU,
      lineIds: items.map((l) => l.id),
      subtotal,
      discount: 0,
      couponDiscount: 0,
      comboDiscount: 0,
      tierDiscount: 0,
      pointsDiscount: 0,
      pointsUsed: 0,
      pointsUsedConverted: 0,
      shippingFee: 0,
      total: subtotal,
      pointsEarned: 0,
      commissionPct: null,
      linePaid: items.map((l) => l.total),
      linePoints: items.map(() => 0),
    };
    await opts.afterCompute?.(userId);
    return {
      cart: { items, unavailableItems: [], couponCode: null, couponRemoved: null, subtotal },
      user,
      address,
      computed: {
        discount: 0,
        couponApplied: false,
        couponNotice: null,
        comboDiscount: 0,
        comboPerLine: {},
        tierDiscount: 0,
        pointsUsed: 0,
        pointsUsedConverted: 0,
        pointsDiscount: 0,
        shippingFee: 0,
        firstOrderShipWaived: 0,
        total: subtotal,
        pointsEarned: 0,
        shipments: [shipment],
      },
    };
  });
  (jest.spyOn(svc as any, 'findOrderResponse') as jest.SpyInstance<unknown, any[]>).mockImplementation(async (orderId: string) => ({ id: orderId }));

  const place = async (userId: string, skew = 0, key?: string) => {
    await ticks(skew);
    return svc.placeOrder(userId, { addressId: `addr-${userId}`, paymentMethod: 'COD' } as PlaceOrderDto, key) as Promise<{ id: string }>;
  };
  const item = (id = 'fi1') => db.row('flashSaleItem', id)!;
  const stockOf = (id = 'v1') => db.row('variation', id)!;
  const cartLines = (u: string) => db.rows('cartItem').filter((r) => r.cartId === `cart-${u}`);
  const orders = () => db.rows('order');
  const bought = (u: string, itemId = 'fi1') => (db.rows('flashSalePurchase').find((p) => p.userId === u && p.flashSaleItemId === itemId)?.quantity as number | undefined) ?? 0;
  return { db, place, item, stockOf, cartLines, orders, bought, flash };
}

const messageOf = (r: PromiseRejectedResult): string => (r.reason as Error).message;

// CheckoutService ghi log lỗi mỗi lần một dòng hết suất (đúng hành vi, chỉ ồn): tắt log để đầu ra test đọc được.
beforeAll(() => {
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterAll(() => {
  jest.restoreAllMocks();
});
const skews = Array.from({ length: 31 }, (_, i) => i - 15);
const lag = (skew: number) => [skew > 0 ? skew : 0, skew < 0 ? -skew : 0] as const;

describe('CheckoutService.placeOrder — Giờ vàng, race', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: T0, doNotFake: ['setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'nextTick', 'queueMicrotask'] });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('hai khách cùng đặt suất Giờ vàng cuối (lệch -15..15 nhịp): đúng một đơn giá Giờ vàng, bên thua nhận PRICE_CHANGED và không để lại dấu nào (kho, giỏ, suất)', async () => {
    let lockWaits = 0;
    for (const skew of skews) {
      const { db, place, item, stockOf, cartLines, orders, bought } = setup({ users: { u1: {}, u2: {} }, items: [{ quota: 1 }] });
      const [a, b] = lag(skew);
      const settled = await Promise.allSettled([place('u1', a), place('u2', b)]);
      const ok = settled.flatMap((s, i) => (s.status === 'fulfilled' ? [i] : []));
      const failed = settled.flatMap((s, i) => (s.status === 'rejected' ? [i] : []));
      expect(ok).toHaveLength(1);
      expect(failed).toHaveLength(1);
      const reason = (settled[failed[0]!] as PromiseRejectedResult).reason;
      expect(reason).toBeInstanceOf(BadRequestException);
      expect(messageOf(settled[failed[0]!] as PromiseRejectedResult)).toBe('PRICE_CHANGED');
      const [winner, loser] = ok[0] === 0 ? ['u1', 'u2'] : ['u2', 'u1'];
      expect(orders()).toHaveLength(1);
      expect(orders()[0]).toMatchObject({ userId: winner, status: 'CONFIRMED', total: FLASH_PRICE });
      expect(orders()[0]!.items.create).toEqual([expect.objectContaining({ unitPrice: FLASH_PRICE, quantity: 1, flashSaleItemId: 'fi1' })]);
      expect(item().soldCount).toBe(1);
      expect(bought(winner!)).toBe(1);
      expect(bought(loser!)).toBe(0);
      expect(cartLines(winner!)).toHaveLength(0);
      expect(cartLines(loser!)).toHaveLength(1);
      expect(stockOf()).toMatchObject({ stock: 9, reservedStock: 1 });
      expect(db.rows('flashSalePurchase')).toHaveLength(1);
      lockWaits += db.stats.lockWaits;
    }
    expect(lockWaits).toBeGreaterThan(0);
  });

  it('khách đặt vượt giới hạn mỗi khách (đã mua 2/3, giỏ 2): FLASH_LIMIT kèm giới hạn 3 và câu tiếng Việt; cả đơn rollback, không trừ kho, không trừ suất, giỏ còn nguyên', async () => {
    const { place, item, stockOf, cartLines, orders, bought } = setup({
      users: { u1: { lines: [{ id: 'ci-u1', variationId: 'v1', quantity: 2 }] } },
      items: [{ quota: 10, perUserLimit: 3, soldCount: 2 }],
      purchases: [{ itemId: 'fi1', userId: 'u1', quantity: 2 }],
    });
    const [s] = await Promise.allSettled([place('u1')]);
    expect(s!.status).toBe('rejected');
    const err = (s as PromiseRejectedResult).reason as BadRequestException;
    expect(err.getResponse()).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      code: 'FLASH_LIMIT',
      limit: 3,
      message: 'Giá Giờ vàng chỉ áp cho 3 sản phẩm mỗi khách. Bạn giảm số lượng rồi đặt lại nhé.',
    });
    expect(orders()).toHaveLength(0);
    expect(item().soldCount).toBe(2);
    expect(bought('u1')).toBe(2);
    expect(stockOf()).toMatchObject({ stock: 10, reservedStock: 0 });
    expect(cartLines('u1')).toHaveLength(1);
  });

  it('khách bấm Đặt hàng hai lần chạy chồng (khác Idempotency-Key) trên giỏ có dòng Giờ vàng: suất và kho chỉ trừ một lần, một đơn', async () => {
    for (const skew of skews) {
      const { place, item, stockOf, orders, bought } = setup({
        users: { u1: { lines: [{ id: 'ci-u1', variationId: 'v1', quantity: 2 }] } },
        items: [{ quota: 10, perUserLimit: 5 }],
      });
      const [a, b] = lag(skew);
      const settled = await Promise.allSettled([place('u1', a, 'key-a'), place('u1', b, 'key-b')]);
      expect(orders()).toHaveLength(1);
      expect(settled.filter((s) => s.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
      expect(item().soldCount).toBe(2);
      expect(bought('u1')).toBe(2);
      expect(stockOf()).toMatchObject({ stock: 8, reservedStock: 2 });
    }
  });

  it('giỏ hai món Giờ vàng, khách khác lấy mất suất cuối của món sau trong lúc đơn này đã giữ món đầu: cả đơn rollback (suất, kho của món đầu trả lại), PRICE_CHANGED, giỏ nguyên', async () => {
    const { place, item, stockOf, orders, cartLines } = setup({
      users: {
        u1: {
          lines: [
            { id: 'ci-1', variationId: 'v1', quantity: 1 },
            { id: 'ci-2', variationId: 'v2', quantity: 1 },
          ],
        },
        u2: { lines: [{ id: 'ci-u2', variationId: 'v2', quantity: 1 }] },
      },
      items: [{ quota: 5 }, { quota: 1 }],
      // u1 đã thấy giá Giờ vàng của cả hai món rồi dừng một lúc: u2 đặt xong suất cuối của v2 trong lúc đó.
      afterCompute: (userId) => (userId === 'u1' ? ticks(300) : undefined),
    });
    const settled = await Promise.allSettled([place('u1'), place('u2')]);
    expect(settled.map((s) => s.status)).toEqual(['rejected', 'fulfilled']);
    expect(messageOf(settled[0] as PromiseRejectedResult)).toBe('PRICE_CHANGED');
    expect(orders().map((o) => o.userId)).toEqual(['u2']);
    expect(item('fi1').soldCount).toBe(0);
    expect(item('fi2').soldCount).toBe(1);
    expect(stockOf('v1')).toMatchObject({ stock: 10, reservedStock: 0 });
    expect(stockOf('v2')).toMatchObject({ stock: 9, reservedStock: 1 });
    expect(cartLines('u1')).toHaveLength(2);
  });

  it('giỏ có món hết kho ở dòng đầu và món Giờ vàng vừa hết suất ở dòng sau: báo hết kho của dòng đầu (không PRICE_CHANGED của dòng sau), rollback sạch', async () => {
    const state = { armed: true };
    const { db, place, item, stockOf, orders, cartLines } = setup({
      users: {
        u1: {
          lines: [
            { id: 'ci-1', variationId: 'v1', quantity: 1 },
            { id: 'ci-2', variationId: 'v2', quantity: 1 },
          ],
        },
      },
      stocks: { v1: 0 },
      items: [{ variationId: 'v2', quota: 1 }],
      afterCompute: async () => {
        if (state.armed) {
          state.armed = false;
          await db.client.flashSaleItem.update({ where: { id: 'fi1' }, data: { soldCount: 1 } });
        }
      },
    });
    const [s] = await Promise.allSettled([place('u1')]);
    expect(s!.status).toBe('rejected');
    expect((s as PromiseRejectedResult).reason).toBeInstanceOf(BadRequestException);
    expect(messageOf(s as PromiseRejectedResult)).toBe('Sản phẩm "Sản phẩm v1" không đủ tồn kho.');
    expect(orders()).toHaveLength(0);
    expect(item().soldCount).toBe(1);
    expect(stockOf('v1')).toMatchObject({ stock: 0, reservedStock: 0 });
    expect(stockOf('v2')).toMatchObject({ stock: 10, reservedStock: 0 });
    expect(cartLines('u1')).toHaveLength(2);
  });

  it('thua tranh khoá lúc trừ suất (deadlock/quá hạn chờ): 503 kèm câu tiếng Việt để khách thử lại, không PRICE_CHANGED; lỗi hạ tầng khác vẫn PRICE_CHANGED; cả hai rollback sạch', async () => {
    const { flash, place, item, stockOf, orders, cartLines } = setup({ users: { u1: {} }, items: [{ quota: 5 }] });
    const consume = jest.spyOn(flash, 'consumeQuotas');
    consume.mockRejectedValueOnce(new FlashQuotaLineError(0, Object.assign(new Error('deadlock detected'), { code: 'P2034' })));
    const [busy] = await Promise.allSettled([place('u1')]);
    expect((busy as PromiseRejectedResult).reason).toBeInstanceOf(ServiceUnavailableException);
    expect(messageOf(busy as PromiseRejectedResult)).toBe(LOCK_BUSY_MESSAGE);
    consume.mockRejectedValueOnce(new FlashQuotaLineError(0, new Error('connection reset')));
    const [infra] = await Promise.allSettled([place('u1')]);
    expect((infra as PromiseRejectedResult).reason).toBeInstanceOf(BadRequestException);
    expect(messageOf(infra as PromiseRejectedResult)).toBe('PRICE_CHANGED');
    expect(orders()).toHaveLength(0);
    expect(item().soldCount).toBe(0);
    expect(stockOf()).toMatchObject({ stock: 10, reservedStock: 0 });
    expect(cartLines('u1')).toHaveLength(1);
  });
});

describe('CheckoutService.placeOrder — Giờ vàng kết thúc giữa lúc tính giá và lúc ghi đơn', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: T0, doNotFake: ['setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'nextTick', 'queueMicrotask'] });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const endAt = new Date(T0.getTime() + HOUR);

  it.each([
    ['đồng hồ vượt mốc kết thúc', () => jest.setSystemTime(new Date(endAt.getTime() + 1))],
    ['đúng mốc kết thúc', () => jest.setSystemTime(endAt)],
  ])('%s: PRICE_CHANGED, không đơn nào mang giá Giờ vàng, kho, suất và giỏ nguyên; lần đặt lại sau khi giá làm mới là đơn giá thường không gắn suất', async (_label, jump) => {
    const state = { armed: true };
    const { place, item, stockOf, orders, cartLines } = setup({
      users: { u1: {} },
      sale: { endAt },
      items: [{ quota: 5 }],
      afterCompute: () => {
        if (state.armed) {
          state.armed = false;
          jump();
        }
      },
    });
    const [first] = await Promise.allSettled([place('u1')]);
    expect(first!.status).toBe('rejected');
    expect(messageOf(first as PromiseRejectedResult)).toBe('PRICE_CHANGED');
    expect(orders()).toHaveLength(0);
    expect(item().soldCount).toBe(0);
    expect(stockOf()).toMatchObject({ stock: 10, reservedStock: 0 });
    expect(cartLines('u1')).toHaveLength(1);

    const retry = await place('u1');
    expect(retry.id).toBeDefined();
    expect(orders()).toHaveLength(1);
    expect(orders()[0]).toMatchObject({ total: STANDING });
    expect(orders()[0]!.items.create).toEqual([expect.objectContaining({ unitPrice: STANDING, flashSaleItemId: null })]);
    expect(item().soldCount).toBe(0);
  });

  it('quản trị tắt đợt (isActive = false) giữa lúc tính giá và lúc ghi đơn: PRICE_CHANGED, không bán giá Giờ vàng của đợt đã tắt', async () => {
    const state: { armed: boolean; off?: () => Promise<unknown> } = { armed: true };
    const { db, place, item, orders } = setup({
      users: { u1: {} },
      items: [{ quota: 5 }],
      afterCompute: async () => {
        if (state.armed) {
          state.armed = false;
          await db.client.flashSale.update({ where: { id: 's1' }, data: { isActive: false } });
        }
      },
    });
    const [s] = await Promise.allSettled([place('u1')]);
    expect(messageOf(s as PromiseRejectedResult)).toBe('PRICE_CHANGED');
    expect(orders()).toHaveLength(0);
    expect(item().soldCount).toBe(0);
  });
});
