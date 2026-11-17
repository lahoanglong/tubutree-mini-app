import { PrismaService } from '../../src/prisma/prisma.service';
import { readMssEnv } from '../../src/modules/integrations/mss/mss-config';
import { MssClient } from '../../src/modules/integrations/mss/mss.client';
import type { MssFlagsService } from '../../src/modules/integrations/mss/mss-flags';
import type { MssHealthService } from '../../src/modules/integrations/mss/mss-health.service';
import { MssOrderEventDispatcher } from '../../src/modules/integrations/mss/mss-order-event.dispatch';
import { MssOrderEventFallback } from '../../src/modules/integrations/mss/mss-order-event.fallback';
import { MssOrderEventRecorder } from '../../src/modules/integrations/mss/mss-order-event.recorder';
import { MssOrderEventSender } from '../../src/modules/integrations/mss/mss-order-event.sender';
import { MssOrderEventReconcileService } from '../../src/modules/integrations/mss/mss-order-events.reconcile';
import { MssZnsHoldService } from '../../src/modules/integrations/mss/mss-zns-hold';
import type { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { createOrder, createUser, deleteItData, randCode, uniquePhone, warmPool } from './helpers';

/**
 * Luồng sự kiện đơn gửi MSS trên Postgres THẬT (wave tubu-mss-order-events mục 8): outbox ghi trong transaction nghiệp vụ, worker/cron
 * nhận dòng bằng UPDATE có điều kiện, callback idempotent, luật một kênh ngoài app (ZNS hoặc MSS, không cả hai). MSS giả qua fetch tiêm
 * vào MssClient thật (ký HMAC thật); không gọi mạng.
 */
describe('MSS order events (real Postgres)', () => {
  let prisma: PrismaService;
  const userIds: string[] = [];
  const productIds: string[] = [];
  let variationId: string;

  const env = readMssEnv({
    MSS_BASE_URL: 'https://mss.example.test',
    MSS_KEY_ID: 'k1',
    MSS_OUTBOUND_SECRET: 'o'.repeat(43),
    MSS_INBOUND_SECRET: 'i'.repeat(43),
  } as NodeJS.ProcessEnv);

  const flagsOn = {
    isEnabled: async () => true,
    configured: () => true,
    snapshot: async () => ({ orderEventsRolloutPct: 100 }),
  } as unknown as MssFlagsService;
  const flagsOff = {
    isEnabled: async () => false,
    configured: () => true,
    snapshot: async () => ({ orderEventsRolloutPct: 100 }),
  } as unknown as MssFlagsService;
  const health = { assertCapability: async () => true } as unknown as MssHealthService;

  type FetchReply = { status: number; body?: unknown; delayMs?: number };
  let replies: FetchReply[] = [];
  const calls: { url: string; body: string; headers: Record<string, string> }[] = [];
  const fetchFake = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, body: String(init.body ?? ''), headers: { ...(init.headers as Record<string, string>) } });
    const r = replies.length > 1 ? replies.shift()! : (replies[0] ?? { status: 202, body: { status: 'queued', duplicate: false } });
    if (r.delayMs) await new Promise((res) => setTimeout(res, r.delayMs));
    return new Response(r.body === undefined ? '' : JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  });

  const enqueued: string[] = [];
  const dispatcher = { enqueue: (eventId: string) => enqueued.push(eventId) } as unknown as MssOrderEventDispatcher;
  const sendHeldZns = jest.fn(async () => undefined);
  const notifications = { sendHeldZns } as unknown as NotificationsService;

  let client: MssClient;
  let recorder: MssOrderEventRecorder;
  let recorderOff: MssOrderEventRecorder;
  let fallback: MssOrderEventFallback;
  let sender: MssOrderEventSender;
  let hold: MssZnsHoldService;
  let reconcile: MssOrderEventReconcileService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    const tag = randCode(6);
    const product = await prisma.product.create({
      data: {
        brand: 'IT',
        slug: `itmss-${tag}`,
        name: `Hàng MSS ${tag}`,
        description: 'IT',
        basePrice: 100_000,
        variations: { create: { sku: `ITMSS-${tag}`, name: 'Hũ', attributes: {}, retailPrice: 100_000, stock: 50 } },
      },
      include: { variations: true },
    });
    productIds.push(product.id);
    variationId = product.variations[0]!.id;

    client = new MssClient(() => env, fetchFake as never);
    const circuitClient = { circuit: { isTripped: () => false } } as unknown as MssClient;
    recorder = new MssOrderEventRecorder(flagsOn, health, circuitClient, dispatcher);
    recorderOff = new MssOrderEventRecorder(flagsOff, health, circuitClient, dispatcher);
    await recorder.refreshGate();
    await recorderOff.refreshGate();
    fallback = new MssOrderEventFallback(prisma, notifications);
    sender = new MssOrderEventSender(prisma, client, flagsOn, dispatcher, fallback);
    hold = new MssZnsHoldService(prisma, flagsOn);
    reconcile = new MssOrderEventReconcileService(prisma, flagsOn, sender, fallback);
  });

  beforeEach(() => {
    replies = [];
    calls.length = 0;
    enqueued.length = 0;
    fetchFake.mockClear();
    sendHeldZns.mockClear();
  });

  afterAll(async () => {
    await deleteItData(prisma, { userIds, productIds });
    await prisma.$disconnect();
  });

  async function consentedOrder(over: { orderZaloConsent?: boolean | null; platform?: string | null; placedForCustomer?: boolean; giftPhone?: string; type?: 'RETAIL' | 'DEALER' } = {}) {
    const phone = uniquePhone('09');
    const user = await createUser(prisma, { phone, fullName: 'Nguyễn Thị Lan', notifyOrderZalo: true, notifyOrderZaloAt: new Date(), notifyOrderZaloSource: 'checkout' });
    userIds.push(user.id);
    const order = await createOrder(prisma, {
      userId: user.id,
      type: over.type ?? 'RETAIL',
      platform: over.platform === undefined ? 'miniapp' : over.platform,
      orderZaloConsent: over.orderZaloConsent === undefined ? true : over.orderZaloConsent,
      orderZaloConsentAt: new Date(),
      placedForCustomer: over.placedForCustomer ?? false,
      shippingAddress: { recipient: 'Lan', phone: over.giftPhone ?? phone, street: '1 IT', ward: 'P', district: '', province: 'Ha Noi', provinceCode: '84_VN01', districtCode: '', wardCode: '00001' },
    });
    await prisma.orderItem.create({ data: { orderId: order.id, variationId, productName: 'Nước giặt Fuwa3e 2L', variationName: 'Hũ', unitPrice: 100_000, quantity: 1, total: 100_000 } });
    return { user, order };
  }

  const recordIn = (orderId: string, type: Parameters<MssOrderEventRecorder['record']>[2], r = recorder) =>
    prisma.$transaction((tx) => r.record(tx, orderId, type));
  const rowsOf = (orderId: string) => prisma.mssOrderEventOutbox.findMany({ where: { orderId }, orderBy: { sequence: 'asc' } });
  const makeDue = (eventId: string) =>
    prisma.mssOrderEventOutbox.update({ where: { eventId }, data: { nextAttemptAt: new Date(Date.now() - 3_600_000) } });

  it('(1) API chết sau commit, trước khi xếp job: cron quét bù gửi đúng 1 lần dù chạy chồng', async () => {
    const { order } = await consentedOrder();
    expect(await recordIn(order.id, 'order.created')).toBeNull();
    const [row] = await rowsOf(order.id);
    await makeDue(row!.eventId);
    const later = Date.now() + 120_000;
    await Promise.all([reconcile.sweepOnce(later), reconcile.sweepOnce(later), reconcile.sweepOnce(later)]);
    await reconcile.sweepOnce(later);
    expect(calls.filter((c) => c.body.includes(row!.eventId))).toHaveLength(1);
    expect((await rowsOf(order.id))[0]!.status).toBe('DELIVERED');
  });

  it('(2) hai lần đổi trạng thái đồng thời cùng đơn: hai sequence khác nhau, không mất sự kiện', async () => {
    const { order } = await consentedOrder();
    const results = await Promise.all([recordIn(order.id, 'order.shipping'), recordIn(order.id, 'order.delivered')]);
    expect(results).toEqual([null, null]);
    const rows = await rowsOf(order.id);
    expect(rows.map((r) => r.sequence).sort()).toEqual([1, 2]);
    expect(new Set(rows.map((r) => r.eventType))).toEqual(new Set(['order.shipping', 'order.delivered']));
  });

  it('(3) cùng (orderId, eventType) ghi song song: đúng 1 dòng, không transaction nào hỏng', async () => {
    const { order } = await consentedOrder();
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => recordIn(order.id, 'order.shipping')));
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(await rowsOf(order.id)).toHaveLength(1);
  });

  it('(4) thử lại giữ nguyên thân từng byte, chữ ký đổi theo timestamp', async () => {
    const { order } = await consentedOrder();
    await recordIn(order.id, 'order.shipping');
    const [row] = await rowsOf(order.id);
    replies = [{ status: 503, body: { error: 'sender_unavailable' } }, { status: 202, body: { status: 'queued', duplicate: false } }];
    expect(await sender.deliver(row!.eventId)).toBe('PENDING');
    await makeDue(row!.eventId);
    const realNow = Date.now;
    const shifted = jest.spyOn(Date, 'now').mockImplementation(() => realNow() + 7_000);
    try {
      expect(await sender.deliver(row!.eventId)).toBe('DELIVERED');
    } finally {
      shifted.mockRestore();
    }
    expect(calls).toHaveLength(2);
    expect(calls[0]!.body).toBe(row!.body);
    expect(calls[1]!.body).toBe(calls[0]!.body);
    const sig = (h: Record<string, string>) => Object.entries(h).find(([k]) => /signature/i.test(k))?.[1];
    const ts = (h: Record<string, string>) => Object.entries(h).find(([k]) => /timestamp/i.test(k))?.[1];
    expect(ts(calls[0]!.headers)).not.toBe(ts(calls[1]!.headers));
    expect(sig(calls[0]!.headers)).not.toBe(sig(calls[1]!.headers));
    const after = (await rowsOf(order.id))[0]!;
    expect(after.attempts).toBe(2);
    expect(after.body).toBe(row!.body);
  });

  it('(5) callback lặp 5 lần song song: đúng 1 lần đổi trạng thái', async () => {
    const { order } = await consentedOrder();
    await recordIn(order.id, 'order.shipping');
    const [row] = await rowsOf(order.id);
    expect(await sender.deliver(row!.eventId)).toBe('DELIVERED');
    const outcomes = await Promise.all(
      Array.from({ length: 5 }, () => sender.applyResult(row!.eventId, { orderCode: order.code, eventType: 'order.shipping' }, 'sent', null, 'callback')),
    );
    expect(outcomes.filter((o) => o === 'applied')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'noop')).toHaveLength(4);
    expect((await rowsOf(order.id))[0]!.status).toBe('RESULT_SENT');
  });

  it('(7) MSS 503 suốt: sự kiện EXPIRED sau 30 phút không nhận, đường lui ZNS chạy đúng 1 lần', async () => {
    const { user, order } = await consentedOrder();
    await recordIn(order.id, 'order.created');
    const [row] = await rowsOf(order.id);
    expect(await hold.holdZns(user.id, 'ORDER_CONFIRMED', { order_code: order.code }, 'zns-tpl')).toBe(true);
    replies = [{ status: 503, body: { error: 'sender_unavailable' } }];
    expect(await sender.deliver(row!.eventId)).toBe('PENDING');
    await prisma.mssOrderEventOutbox.update({ where: { eventId: row!.eventId }, data: { occurredAt: new Date(Date.now() - 31 * 60_000), nextAttemptAt: new Date(Date.now() - 1000) } });
    expect(await sender.deliver(row!.eventId)).toBe('EXPIRED');
    await Promise.all([fallback.run(row!.eventId), fallback.run(row!.eventId), reconcile.sweepOnce(Date.now() + 120_000)]);
    expect(sendHeldZns).toHaveBeenCalledTimes(1);
    expect(sendHeldZns).toHaveBeenCalledWith(user.id, 'ORDER_CONFIRMED', { order_code: order.code }, 'zns-tpl', `mss:${row!.eventId}`);
    const after = (await rowsOf(order.id))[0]!;
    expect(after).toMatchObject({ status: 'EXPIRED', resultReason: 'mss_unavailable', fallbackChannel: 'ZNS' });
  });

  it('(8) không lúc nào ZNS và MSS cùng gửi: hoãn ZNS chạy đua với kết quả cuối', async () => {
    for (const [result, reason, expectZns] of [
      ['sent', null, 0],
      ['skipped', 'no_zalo', 1],
      ['skipped', 'superseded', 0],
      ['unknown', null, 0],
    ] as const) {
      for (let i = 0; i < 6; i++) {
        sendHeldZns.mockClear();
        const { user, order } = await consentedOrder();
        await recordIn(order.id, 'order.created');
        const [row] = await rowsOf(order.id);
        expect(await sender.deliver(row!.eventId)).toBe('DELIVERED');
        const [held] = await Promise.all([
          hold.holdZns(user.id, 'ORDER_CONFIRMED', { order_code: order.code }, 'zns-tpl'),
          sender.applyResult(row!.eventId, {}, result, reason, 'callback'),
        ]);
        const znsByNotify = held ? 0 : 1;
        expect({ result, reason, zns: znsByNotify + sendHeldZns.mock.calls.length }).toEqual({ result, reason, zns: expectZns });
        // notify gọi lại lần nữa cho cùng sự kiện không gửi thêm ZNS.
        expect(await hold.holdZns(user.id, 'ORDER_CONFIRMED', { order_code: order.code }, 'zns-tpl')).toBe(true);
      }
    }
  });

  it('(9) đơn tặng, CTV đặt hộ, đơn đại lý, platform null, khách không đồng ý: 0 dòng outbox', async () => {
    const cases = [
      [{ giftPhone: '0911111111' }, 'gift_recipient'],
      [{ placedForCustomer: true }, 'placed_for_customer'],
      [{ type: 'DEALER' as const }, 'dealer_order'],
      [{ platform: null }, 'platform_null'],
      [{ orderZaloConsent: null }, 'no_consent'],
      [{ orderZaloConsent: false }, 'no_consent'],
    ] as const;
    for (const [over, why] of cases) {
      const { order } = await consentedOrder(over);
      expect(await recordIn(order.id, 'order.created')).toBe(why);
      expect(await rowsOf(order.id)).toHaveLength(0);
    }
    const { order: cod } = await consentedOrder();
    expect(await recordIn(cod.id, 'order.payment_confirmed')).toBe('cod_payment');
    const { order: unpaid } = await consentedOrder();
    expect(await prisma.$transaction((tx) => recorder.record(tx, unpaid.id, 'order.cancelled', { cancelReason: 'PAYMENT_TIMEOUT' }))).toBe('payment_timeout_unnotified');
  });

  it('(10) cờ tắt: không ghi lựa chọn đồng ý, không dòng outbox', async () => {
    const { user, order } = await consentedOrder({ orderZaloConsent: null });
    await prisma.user.update({ where: { id: user.id }, data: { notifyOrderZalo: false, notifyOrderZaloAt: null, notifyOrderZaloSource: null } });
    await prisma.$transaction((tx) => recorderOff.onOrdersPlaced(tx, [{ id: order.id, userId: user.id, paymentStatus: 'UNPAID', paymentMethod: 'COD' }], true));
    expect(await recordIn(order.id, 'order.created', recorderOff)).toBe('gate_closed');
    expect(await rowsOf(order.id)).toHaveLength(0);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect({ notifyOrderZalo: u.notifyOrderZalo, source: u.notifyOrderZaloSource, consent: o.orderZaloConsent, seq: o.mssEventSeq }).toEqual({
      notifyOrderZalo: false,
      source: null,
      consent: null,
      seq: 0,
    });
    expect(enqueued).toHaveLength(0);
  });

  it('cờ bật: ô đồng ý ở checkout được nhớ cho khách và chụp vào đơn, phát created', async () => {
    const { user, order } = await consentedOrder({ orderZaloConsent: null });
    await prisma.user.update({ where: { id: user.id }, data: { notifyOrderZalo: false } });
    await prisma.$transaction((tx) => recorder.onOrdersPlaced(tx, [{ id: order.id, userId: user.id, paymentStatus: 'UNPAID', paymentMethod: 'COD' }], true));
    const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect({ on: u.notifyOrderZalo, source: u.notifyOrderZaloSource, version: u.notifyOrderZaloTextVersion }).toEqual({
      on: true,
      source: 'checkout',
      version: 'order-zalo-v1-2026-11-17',
    });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).orderZaloConsent).toBe(true);
    expect((await rowsOf(order.id)).map((r) => r.eventType)).toEqual(['order.created']);
    expect(enqueued).toHaveLength(1);
  });

  it('(11) hai worker cùng một dòng: đúng 1 lần gửi MSS', async () => {
    const { order } = await consentedOrder();
    await recordIn(order.id, 'order.delivered');
    const [row] = await rowsOf(order.id);
    replies = [{ status: 202, body: { status: 'queued', duplicate: false }, delayMs: 150 }];
    const outcomes = await Promise.all([sender.deliver(row!.eventId), sender.deliver(row!.eventId), sender.deliver(row!.eventId)]);
    expect(fetchFake).toHaveBeenCalledTimes(1);
    expect(outcomes.filter((o) => o === 'DELIVERED')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'not_claimable')).toHaveLength(2);
  });

  it('409 thân khác: DEAD, chỉ trong app (không ZNS); 422: DEAD và đường lui ZNS', async () => {
    const a = await consentedOrder();
    await recordIn(a.order.id, 'order.created');
    const [rowA] = await rowsOf(a.order.id);
    await hold.holdZns(a.user.id, 'ORDER_CONFIRMED', { order_code: a.order.code }, 'zns-tpl');
    replies = [{ status: 409, body: { error: 'event_id_reused' } }];
    expect(await sender.deliver(rowA!.eventId)).toBe('DEAD');
    expect(sendHeldZns).not.toHaveBeenCalled();
    const b = await consentedOrder();
    await recordIn(b.order.id, 'order.created');
    const [rowB] = await rowsOf(b.order.id);
    await hold.holdZns(b.user.id, 'ORDER_CONFIRMED', { order_code: b.order.code }, 'zns-tpl');
    replies = [{ status: 422, body: { error: 'consent_required' } }];
    expect(await sender.deliver(rowB!.eventId)).toBe('DEAD');
    expect(sendHeldZns).toHaveBeenCalledTimes(1);
    expect((await rowsOf(b.order.id))[0]!.resultReason).toBe('consent_required');
  });

  it('skipped:opted_out tắt lựa chọn đã nhớ của khách (nguồn mss_opt_out)', async () => {
    const { user, order } = await consentedOrder();
    await recordIn(order.id, 'order.shipping');
    const [row] = await rowsOf(order.id);
    await sender.deliver(row!.eventId);
    expect(await sender.applyResult(row!.eventId, { orderCode: order.code, eventType: 'order.shipping' }, 'skipped', 'opted_out', 'callback')).toBe('applied');
    const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect({ on: u.notifyOrderZalo, source: u.notifyOrderZaloSource }).toEqual({ on: false, source: 'mss_opt_out' });
    expect(await recordIn(order.id, 'order.delivered')).toBe('no_consent');
  });

  it('(13) đặt hàng với cờ bật và MSS treo không chậm hơn cờ tắt quá 50 ms', async () => {
    const hangingQueue = { add: () => new Promise(() => undefined) };
    const realDispatcher = new MssOrderEventDispatcher(hangingQueue as never);
    const hangingClient = new MssClient(() => env, (() => new Promise(() => undefined)) as never);
    const on = new MssOrderEventRecorder(flagsOn, health, hangingClient, realDispatcher);
    const off = new MssOrderEventRecorder(flagsOff, health, hangingClient, realDispatcher);
    await on.refreshGate();
    await off.refreshGate();
    const place = async (r: MssOrderEventRecorder) => {
      const { user, order } = await consentedOrder({ orderZaloConsent: null });
      const started = performance.now();
      await prisma.$transaction(async (tx) => {
        await tx.order.update({ where: { id: order.id }, data: { note: 'đặt' } });
        await r.onOrdersPlaced(tx, [{ id: order.id, userId: user.id, paymentStatus: 'UNPAID', paymentMethod: 'COD' }], true);
      });
      return performance.now() - started;
    };
    const median = (xs: number[]) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)]!;
    const offTimes: number[] = [];
    const onTimes: number[] = [];
    for (let i = 0; i < 9; i++) {
      offTimes.push(await place(off));
      onTimes.push(await place(on));
    }
    expect(median(onTimes) - median(offTimes)).toBeLessThan(50);
    expect(await prisma.mssOrderEventOutbox.count({ where: { order: { userId: { in: userIds } }, status: 'PENDING' } })).toBeGreaterThan(0);
  });

  it('đối soát: DELIVERED quá 15 phút hỏi GET và chốt kết quả; MSS không có sự kiện thì trả về PENDING', async () => {
    const { order } = await consentedOrder();
    await recordIn(order.id, 'order.shipping');
    const [row] = await rowsOf(order.id);
    await sender.deliver(row!.eventId);
    await prisma.mssOrderEventOutbox.update({ where: { eventId: row!.eventId }, data: { deliveredAt: new Date(Date.now() - 20 * 60_000) } });
    replies = [{ status: 200, body: { event_id: row!.eventId, status: 'sent', reason: null } }];
    expect(await sender.reconcileOne({ eventId: row!.eventId, orderCode: order.code, eventType: 'order.shipping', expiresAt: row!.expiresAt })).toBe('applied');
    expect(calls.at(-1)!.url).toBe(`https://mss.example.test/api/ext/tubu/v1/order-events/${row!.eventId}`);

    const second = await consentedOrder();
    await recordIn(second.order.id, 'order.shipping');
    const [row2] = await rowsOf(second.order.id);
    replies = [{ status: 202, body: { status: 'queued' } }];
    await sender.deliver(row2!.eventId);
    replies = [{ status: 404, body: { error: 'not_found' } }];
    expect(await sender.reconcileOne({ eventId: row2!.eventId, orderCode: second.order.code, eventType: 'order.shipping', expiresAt: row2!.expiresAt })).toBe('requeued');
    expect((await rowsOf(second.order.id))[0]!.status).toBe('PENDING');
  });

  it('lỗi mạng: deliver không ném, dòng về PENDING với lịch thử lại và job mới', async () => {
    const { order } = await consentedOrder();
    await recordIn(order.id, 'order.shipping');
    const [row] = await rowsOf(order.id);
    fetchFake.mockImplementationOnce(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await sender.deliver(row!.eventId)).toBe('PENDING');
    const after = (await rowsOf(order.id))[0]!;
    expect(after.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 20_000);
    expect(after.lastError).toMatch(/network/);
    expect(enqueued).toContain(row!.eventId);
  });
});
