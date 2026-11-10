import { Logger } from '@nestjs/common';
import { flashClient, flashDb, ticks, withinMs, T0, type ItemSeed } from '../../../test/fakes/w97a-flash-harness';
import { FlashSaleService } from '../flash-sale/flash-sale.service';
import { OrderReversalService } from './order-reversal.service';
import { OrderStatusService } from './order-status.service';
import { OrdersService } from './orders.service';

/**
 * Huỷ đơn có dòng Giờ vàng chạy song song (Postgres READ COMMITTED, xem test/fakes/race-db.fake.ts). OrdersService.cancel, OrderStatusService.setStatus (đường của
 * cron tự huỷ đơn quá hạn thanh toán), OrderReversalService và FlashSaleService.restore THẬT chạy trên cơ sở dữ liệu giả có khoá dòng + xét lại WHERE sau khoá:
 * suất Giờ vàng và lượt mua của khách chỉ được hoàn đúng MỘT lần cho mỗi đơn, và việc hoàn chen với đơn khác đặt suất đó không làm lệch sổ.
 * (Giờ vàng không có cron nhả suất khi hết khung: soldCount chỉ giảm khi đơn huỷ/trả, nên không có đường "cron hết khung" nào tranh với huỷ.)
 */
const item = (id: string, variationId: string, quantity: number, flashSaleItemId: string | null = 'fi1') => ({ id, variationId, quantity, backorderedQty: 0, flashSaleItemId });
const order = (over: Record<string, unknown> = {}) => ({
  id: 'o1',
  code: 'TUBU1',
  userId: 'u1',
  type: 'RETAIL',
  status: 'PENDING_PAYMENT',
  paymentMethod: 'BANK_TRANSFER',
  paymentStatus: 'UNPAID',
  total: 120_000,
  couponCode: null,
  checkoutGroup: null,
  placedForCustomer: false,
  pointsUsed: 0,
  pointsUsedConverted: 0,
  autoCancelBlockedAt: null,
  hasRecyclingPickup: false,
  pancakeOrderId: null,
  fulfiller: 'TUBU',
  referrerUserId: null,
  reversalEffectsAt: null,
  items: [item('i1', 'v1', 2)],
  ...over,
});

interface Opts {
  orders: Record<string, unknown>[];
  items?: ItemSeed[];
  purchases?: { itemId: string; userId: string; quantity: number }[];
}

function setup(opts: Opts) {
  const db = flashDb({ items: opts.items ?? [{ quota: 5, soldCount: 2, perUserLimit: 5 }], purchases: opts.purchases ?? [{ itemId: 'fi1', userId: 'u1', quantity: 2 }] });
  const client = flashClient(db);
  db.seed('user', [{ id: 'u1', walletBalance: 0, metadata: null }, { id: 'u2', walletBalance: 0, metadata: null }]);
  db.seed('variation', ['v1', 'v2', 'v3', 'v4'].map((id) => ({ id, stock: 8, reservedStock: 2 })));
  db.seed('order', opts.orders);
  const flash = new FlashSaleService(client as never, {} as never, {} as never, {} as never);
  const reversal = new OrderReversalService(flash, { release: jest.fn().mockResolvedValue(undefined) } as never);
  const loyalty = { pointsExpiresAt: async () => new Date(), reverseOrderPoints: jest.fn().mockResolvedValue(0) };
  const notifications = { notifySafe: jest.fn().mockResolvedValue(true), notify: jest.fn().mockResolvedValue(undefined) };
  const affiliate = { reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined) };
  const analytics = {
    record: async (tx: any, e: { eventName: string }) => {
      await tx.analyticsEvent.create({ data: { eventName: e.eventName } });
    },
  };
  const orders = new OrdersService(client as never, loyalty as never, {} as never, notifications as never, {} as never, affiliate as never, reversal);
  const status = new OrderStatusService(client as never, loyalty as never, affiliate as never, notifications as never, reversal, undefined, analytics as never);
  const sold = (id = 'fi1') => db.row('flashSaleItem', id)!.soldCount as number;
  const bought = (userId: string, itemId = 'fi1') => (db.rows('flashSalePurchase').find((p) => p.userId === userId && p.flashSaleItemId === itemId)?.quantity as number | undefined) ?? 0;
  const stock = (id = 'v1') => db.row('variation', id)!;
  const cancelled = () => db.rows('orderStatusHistory').filter((h) => h.toStatus === 'CANCELLED');
  /** Đường của PendingPaymentExpiryCron: chỉ huỷ khi đơn vẫn PENDING_PAYMENT + UNPAID, như lúc quét. */
  const cron = (id: string) =>
    status.setStatus(id, 'CANCELLED', { actorType: 'SYSTEM', note: 'Tự huỷ: quá hạn thanh toán', onlyIfUnpaid: true, expectedStatus: 'PENDING_PAYMENT', pancakeGate: true, notifyEvent: 'ORDER_PAYMENT_EXPIRED' });
  const later = async <T>(n: number, fn: () => Promise<T>): Promise<T> => {
    await ticks(n);
    return fn();
  };
  return { db, client, flash, orders, status, sold, bought, stock, cancelled, cron, later };
}

const skews = Array.from({ length: 31 }, (_, i) => i - 15);
const lag = (skew: number) => [skew > 0 ? skew : 0, skew < 0 ? -skew : 0] as const;

describe('huỷ đơn có dòng Giờ vàng — race', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterAll(() => {
    jest.restoreAllMocks();
  });

  it.each([2, 3])('khách bấm huỷ đơn %i lần chạy chồng: suất, lượt mua và kho chỉ hoàn một lần, mọi lần bấm đều thấy đơn đã huỷ', async (taps) => {
    const { db, orders, sold, bought, stock, cancelled } = setup({ orders: [order()] });
    const results = await Promise.all(Array.from({ length: taps }, () => orders.cancel('u1', 'TUBU1')));
    expect(results.every((r) => r.status === 'CANCELLED')).toBe(true);
    expect(sold()).toBe(0);
    expect(bought('u1')).toBe(0);
    expect(stock('v1')).toMatchObject({ stock: 10, reservedStock: 0 });
    expect(cancelled()).toHaveLength(1);
    expect(db.stats.lockWaits).toBeGreaterThan(0);
  });

  it('khách bấm huỷ chen với cron tự huỷ đơn quá hạn thanh toán (lệch -15..15 nhịp): đúng một bên lật trạng thái, suất và lượt mua hoàn đúng một lần', async () => {
    let lockWaits = 0;
    for (const skew of skews) {
      const { db, orders, sold, bought, stock, cancelled, cron, later } = setup({ orders: [order()], items: [{ quota: 5, soldCount: 4, perUserLimit: 5 }], purchases: [{ itemId: 'fi1', userId: 'u1', quantity: 2 }, { itemId: 'fi1', userId: 'u2', quantity: 2 }] });
      const [a, b] = lag(skew);
      await Promise.all([later(a, () => orders.cancel('u1', 'TUBU1')), later(b, () => cron('o1'))]);
      expect(db.row('order', 'o1')).toMatchObject({ status: 'CANCELLED' });
      expect(cancelled()).toHaveLength(1);
      expect(sold()).toBe(2);
      expect(bought('u1')).toBe(0);
      expect(bought('u2')).toBe(2);
      expect(stock('v1')).toMatchObject({ stock: 10, reservedStock: 0 });
      lockWaits += db.stats.lockWaits;
    }
    expect(lockWaits).toBeGreaterThan(0);
  });

  it('hai đơn của cùng một khách cùng suất (2 + 1) huỷ cùng lúc: lượt mua về 0, bộ đếm giảm đúng 3, lượt mua của khách khác giữ nguyên', async () => {
    for (const skew of skews) {
      const { orders, sold, bought, stock } = setup({
        orders: [order(), order({ id: 'o2', code: 'TUBU2', items: [item('i2', 'v2', 1)] })],
        items: [{ quota: 10, soldCount: 6, perUserLimit: 5 }],
        purchases: [{ itemId: 'fi1', userId: 'u1', quantity: 3 }, { itemId: 'fi1', userId: 'u2', quantity: 3 }],
      });
      const [a, b] = lag(skew);
      await Promise.all([
        (async () => { await ticks(a); return orders.cancel('u1', 'TUBU1'); })(),
        (async () => { await ticks(b); return orders.cancel('u1', 'TUBU2'); })(),
      ]);
      expect(sold()).toBe(3);
      expect(bought('u1')).toBe(0);
      expect(bought('u2')).toBe(3);
      expect(stock('v1')).toMatchObject({ stock: 10, reservedStock: 0 });
      expect(stock('v2')).toMatchObject({ stock: 9, reservedStock: 1 });
    }
  });

  it('huỷ đơn giữ suất cuối cùng lúc khách khác đặt suất đó (lệch -15..15 nhịp): bên mua mới thắng hay thua đều khớp sổ, bộ đếm bằng tổng lượt mua', async () => {
    let bWins = 0;
    for (const skew of skews) {
      const { orders, flash, client, sold, bought } = setup({
        orders: [order({ items: [item('i1', 'v1', 1)] })],
        items: [{ quota: 1, soldCount: 1, perUserLimit: 5 }],
        purchases: [{ itemId: 'fi1', userId: 'u1', quantity: 1 }],
      });
      const [a, b] = lag(skew);
      const buy = async () => {
        await ticks(b);
        return client.$transaction(async (tx: any) => (await flash.consumeQuotas(tx, 'u2', [{ flashSaleItemId: 'fi1', quantity: 1 }], T0)).every((o) => o === 'OK'));
      };
      const [, won] = await Promise.all([(async () => { await ticks(a); return orders.cancel('u1', 'TUBU1'); })(), buy()]);
      expect(sold()).toBe(won ? 1 : 0);
      expect(bought('u1')).toBe(0);
      expect(bought('u2')).toBe(won ? 1 : 0);
      if (won) bWins += 1;
    }
    expect(bWins).toBeGreaterThan(0);
    expect(bWins).toBeLessThan(skews.length);
  });

  it('huỷ đơn trả lại giới hạn mỗi khách: mua đủ giới hạn, huỷ, rồi mua lại đủ giới hạn được; không huỷ thì lần mua thêm bị OVER_LIMIT', async () => {
    const { orders, flash, client, sold, bought } = setup({
      orders: [order({ items: [item('i1', 'v1', 3)] })],
      items: [{ quota: 10, soldCount: 3, perUserLimit: 3 }],
      purchases: [{ itemId: 'fi1', userId: 'u1', quantity: 3 }],
    });
    const buy3 = () => client.$transaction(async (tx: any) => flash.consumeQuotas(tx, 'u1', [{ flashSaleItemId: 'fi1', quantity: 3 }], T0));
    expect(await buy3()).toEqual(['OVER_LIMIT']);
    expect(bought('u1')).toBe(3);
    await orders.cancel('u1', 'TUBU1');
    expect(bought('u1')).toBe(0);
    expect(await buy3()).toEqual(['OK']);
    expect(bought('u1')).toBe(3);
    expect(sold()).toBe(3);
  });

  it('hai đơn của hai khách huỷ cùng lúc, dòng Giờ vàng xếp ngược nhau ([B,A] và [A,B], biến thể khác nhau nên không xếp hàng trước ở kho): hoàn suất theo thứ tự id nên không vòng chờ khoá, cả hai hoàn đủ', async () => {
    for (const skew of skews) {
      const { orders, sold, bought } = setup({
        orders: [
          order({ items: [item('i1', 'v1', 1, 'fi2'), item('i2', 'v2', 1, 'fi1')] }),
          order({ id: 'o2', code: 'TUBU2', userId: 'u2', items: [item('i3', 'v3', 1, 'fi1'), item('i4', 'v4', 1, 'fi2')] }),
        ],
        items: [{ quota: 5, soldCount: 2, perUserLimit: 5 }, { quota: 5, soldCount: 2, perUserLimit: 5 }],
        purchases: [
          { itemId: 'fi1', userId: 'u1', quantity: 1 },
          { itemId: 'fi2', userId: 'u1', quantity: 1 },
          { itemId: 'fi1', userId: 'u2', quantity: 1 },
          { itemId: 'fi2', userId: 'u2', quantity: 1 },
        ],
      });
      const [a, b] = lag(skew);
      await withinMs(Promise.all([(async () => { await ticks(a); return orders.cancel('u1', 'TUBU1'); })(), (async () => { await ticks(b); return orders.cancel('u2', 'TUBU2'); })()]), 4000, 'huỷ hai đơn dòng ngược');
      expect(sold('fi1')).toBe(0);
      expect(sold('fi2')).toBe(0);
      for (const u of ['u1', 'u2']) for (const f of ['fi1', 'fi2']) expect(bought(u, f)).toBe(0);
    }
  });
});
