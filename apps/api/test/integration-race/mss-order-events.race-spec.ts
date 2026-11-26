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
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../src/config/env.validation';
import { orderEditHistoryNote } from '../../src/modules/orders/order-customer-edit';
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
  /** Bí mật ký link khách vãng lai (`JWT_ACCESS_SECRET`) của bộ ghi sự kiện. */
  const ENV = { get: (k: string) => (k === 'JWT_ACCESS_SECRET' ? 'it-secret-mss-order-events' : undefined) } as unknown as ConfigService<Env, true>;

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
    recorder = new MssOrderEventRecorder(flagsOn, health, circuitClient, dispatcher, ENV);
    recorderOff = new MssOrderEventRecorder(flagsOff, health, circuitClient, dispatcher, ENV);
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

  async function consentedOrder(
    over: {
      orderZaloConsent?: boolean | null;
      platform?: string | null;
      placedForCustomer?: boolean;
      giftPhone?: string;
      type?: 'RETAIL' | 'DEALER';
      notifyRecipientZalo?: boolean;
      unverified?: boolean;
      /** Khách vãng lai: users.phone null, số nằm ở orders.guestPhone và địa chỉ giao. */
      guest?: boolean;
      paymentMethod?: string;
    } = {},
  ) {
    const phone = uniquePhone('09');
    const user = await createUser(prisma, {
      phone: over.guest ? null : phone,
      fullName: over.guest ? 'Khách' : 'Nguyễn Thị Lan',
      notifyOrderZalo: true,
      notifyOrderZaloAt: new Date(),
      notifyOrderZaloSource: 'checkout',
      ...(over.unverified ? { phoneVerifiedAt: null } : {}),
      ...(over.guest ? { zaloId: `guest_it_${randCode(8)}` } : {}),
    });
    userIds.push(user.id);
    const order = await createOrder(prisma, {
      userId: user.id,
      type: over.type ?? 'RETAIL',
      platform: over.platform === undefined ? 'miniapp' : over.platform,
      orderZaloConsent: over.orderZaloConsent === undefined ? true : over.orderZaloConsent,
      orderZaloConsentAt: new Date(),
      placedForCustomer: over.placedForCustomer ?? false,
      notifyRecipientZalo: over.notifyRecipientZalo ?? false,
      ...(over.guest ? { guestPhone: phone } : {}),
      ...(over.paymentMethod ? { paymentMethod: over.paymentMethod as never } : {}),
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

  it('(9) CTV đặt hộ, đơn đại lý, platform null, khách không đồng ý: 0 dòng outbox', async () => {
    const cases = [
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

  it('(10) cờ tắt: không ghi lựa chọn đồng ý, không dòng outbox; đơn mang nguồn gate_closed cho Ops', async () => {
    const { user, order } = await consentedOrder({ orderZaloConsent: null });
    await prisma.user.update({ where: { id: user.id }, data: { notifyOrderZalo: false, notifyOrderZaloAt: null, notifyOrderZaloSource: null } });
    await prisma.$transaction((tx) => recorderOff.onOrdersPlaced(tx, [{ id: order.id, userId: user.id, paymentStatus: 'UNPAID', paymentMethod: 'COD' }], true));
    expect(await recordIn(order.id, 'order.created', recorderOff)).toBe('gate_closed');
    expect(await rowsOf(order.id)).toHaveLength(0);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect({
      notifyOrderZalo: u.notifyOrderZalo,
      source: u.notifyOrderZaloSource,
      consent: o.orderZaloConsent,
      orderSource: o.orderZaloConsentSource,
      seq: o.mssEventSeq,
    }).toEqual({
      notifyOrderZalo: false,
      source: null,
      consent: null,
      orderSource: 'gate_closed',
      seq: 0,
    });
    expect(enqueued).toHaveLength(0);
  });

  it('khởi động lạnh: cổng chưa nạp xong (at = 0) thì đơn đầu tiên chờ lần nạp rồi phát created, không bị bỏ qua', async () => {
    const slowFlags = {
      ...(flagsOn as unknown as Record<string, unknown>),
      isEnabled: async () => {
        await new Promise((r) => setTimeout(r, 80));
        return true;
      },
    } as unknown as MssFlagsService;
    const { user, order } = await consentedOrder({ orderZaloConsent: null });
    const cold = new MssOrderEventRecorder(slowFlags, health, { circuit: { isTripped: () => false } } as unknown as MssClient, dispatcher, ENV);
    cold.onModuleInit();
    expect(cold.gate()).toMatchObject({ enabled: false, open: false, at: 0 });
    await prisma.$transaction((tx) => cold.onOrdersPlaced(tx, [{ id: order.id, userId: user.id, paymentStatus: 'UNPAID', paymentMethod: 'COD' }], true));
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect({ consent: o.orderZaloConsent, orderSource: o.orderZaloConsentSource }).toEqual({ consent: true, orderSource: null });
    expect((await rowsOf(order.id)).map((r) => r.eventType)).toEqual(['order.created']);
    expect(enqueued).toHaveLength(1);
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
    const on = new MssOrderEventRecorder(flagsOn, health, hangingClient, realDispatcher, ENV);
    const off = new MssOrderEventRecorder(flagsOff, health, hangingClient, realDispatcher, ENV);
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

  it('review MAJOR 1: trả trước, created đã tới Zalo mà payment_confirmed bị bỏ qua: ZNS "đã nhận tiền" vẫn gửi (không mượn dòng created)', async () => {
    const { user, order } = await consentedOrder();
    await recordIn(order.id, 'order.created');
    const [row] = await rowsOf(order.id);
    await sender.deliver(row!.eventId);
    await sender.applyResult(row!.eventId, {}, 'sent', null, 'callback');
    // Không có dòng order.payment_confirmed (vd cầu dao ngắt lúc trả tiền): tin có payment_note đi ZNS như cũ.
    expect(await hold.holdZns(user.id, 'ORDER_CONFIRMED', { order_code: order.code, payment_note: 'Đã nhận thanh toán' }, 'zns-tpl')).toBe(false);
    // Tin đặt đơn (không payment_note) thì dòng created đã gửi: không ZNS.
    expect(await hold.holdZns(user.id, 'ORDER_CONFIRMED', { order_code: order.code }, 'zns-tpl')).toBe(true);
  });

  it('review MAJOR 2: POST quá giờ bị coi là lỗi (dòng về PENDING) mà MSS đã gửi và báo sent: nhận kết quả, không gửi lại, không ZNS', async () => {
    const { user, order } = await consentedOrder();
    await recordIn(order.id, 'order.shipping');
    const [row] = await rowsOf(order.id);
    expect(await hold.holdZns(user.id, 'ORDER_SHIPPING', { order_code: order.code }, 'zns-tpl')).toBe(true);
    fetchFake.mockImplementationOnce(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await sender.deliver(row!.eventId)).toBe('PENDING');
    expect(await sender.applyResult(row!.eventId, { orderCode: order.code, eventType: 'order.shipping' }, 'sent', null, 'callback')).toBe('applied');
    await makeDue(row!.eventId);
    expect(await sender.deliver(row!.eventId)).toBe('not_claimable');
    await prisma.mssOrderEventOutbox.update({ where: { eventId: row!.eventId }, data: { occurredAt: new Date(Date.now() - 31 * 60_000) } });
    await reconcile.sweepOnce(Date.now() + 120_000);
    expect(fetchFake.mock.calls.filter(([, init]) => String(init.body ?? '').includes(row!.eventId))).toHaveLength(1);
    expect(sendHeldZns.mock.calls.filter((c) => (c as unknown[])[0] === user.id)).toHaveLength(0);
    expect((await rowsOf(order.id))[0]).toMatchObject({ status: 'RESULT_SENT', fallbackAt: null });
  });

  it('review MAJOR 3: khách tắt nhận tin trong lúc dòng chờ thử lại: lượt sau không gửi MSS, CANCELLED consent_withdrawn, ZNS đã hoãn đi đúng 1 lần', async () => {
    const { user, order } = await consentedOrder();
    await recordIn(order.id, 'order.shipping');
    const [row] = await rowsOf(order.id);
    await hold.holdZns(user.id, 'ORDER_SHIPPING', { order_code: order.code }, 'zns-tpl');
    await prisma.user.update({ where: { id: user.id }, data: { notifyOrderZalo: false, notifyOrderZaloSource: 'account_settings' } });
    await makeDue(row!.eventId);
    expect(await sender.deliver(row!.eventId)).toBe('CANCELLED');
    expect(fetchFake).not.toHaveBeenCalled();
    expect((await rowsOf(order.id))[0]).toMatchObject({ status: 'CANCELLED', resultReason: 'consent_withdrawn', fallbackChannel: 'ZNS' });
    expect(sendHeldZns).toHaveBeenCalledTimes(1);
  });

  it('review MINOR 4: đường lui chạy quá hạn sống + 15 phút: chỉ trong app, không gửi ZNS cũ', async () => {
    const { user, order } = await consentedOrder();
    await recordIn(order.id, 'order.shipping');
    const [row] = await rowsOf(order.id);
    await hold.holdZns(user.id, 'ORDER_SHIPPING', { order_code: order.code }, 'zns-tpl');
    await prisma.mssOrderEventOutbox.update({
      where: { eventId: row!.eventId },
      data: { status: 'EXPIRED', resultReason: 'ttl', expiresAt: new Date(Date.now() - 16 * 60_000) },
    });
    expect(await fallback.run(row!.eventId)).toBe('IN_APP_ONLY');
    expect(sendHeldZns).not.toHaveBeenCalled();
  });

  it('review MINOR 5: dòng MSS đã nhận, quá hạn sống 2 giờ chưa có kết quả: chốt không rõ, không gọi MSS, không ZNS', async () => {
    const { user, order } = await consentedOrder();
    await recordIn(order.id, 'order.shipping');
    const [row] = await rowsOf(order.id);
    await hold.holdZns(user.id, 'ORDER_SHIPPING', { order_code: order.code }, 'zns-tpl');
    await sender.deliver(row!.eventId);
    fetchFake.mockClear();
    await prisma.mssOrderEventOutbox.update({ where: { eventId: row!.eventId }, data: { expiresAt: new Date(Date.now() - 2 * 3_600_000 - 60_000) } });
    expect(await reconcile.settleStuckOnce()).toBeGreaterThanOrEqual(1);
    expect(fetchFake).not.toHaveBeenCalled();
    expect((await rowsOf(order.id))[0]).toMatchObject({ status: 'RESULT_UNKNOWN', resultReason: 'stuck', fallbackChannel: 'IN_APP_ONLY' });
    expect(sendHeldZns).not.toHaveBeenCalled();
  });

  it('review MINOR 11: gửi ZNS đường lui lỗi một lần: nhả phần việc, lượt quét sau gửi đúng 1 lần', async () => {
    const { user, order } = await consentedOrder();
    await recordIn(order.id, 'order.shipping');
    const [row] = await rowsOf(order.id);
    await hold.holdZns(user.id, 'ORDER_SHIPPING', { order_code: order.code }, 'zns-tpl');
    await prisma.mssOrderEventOutbox.update({ where: { eventId: row!.eventId }, data: { status: 'DEAD', resultReason: 'http_413' } });
    sendHeldZns.mockImplementationOnce(async () => {
      throw new Error('Redis không phản hồi');
    });
    expect(await fallback.run(row!.eventId)).toBeNull();
    expect((await rowsOf(order.id))[0]).toMatchObject({ fallbackAt: null, fallbackChannel: null });
    const mine = () => sendHeldZns.mock.calls.filter((c) => (c as unknown[])[0] === user.id).length;
    await reconcile.sweepOnce();
    expect(mine()).toBe(2);
    expect((await rowsOf(order.id))[0]!.fallbackChannel).toBe('ZNS');
    expect(await fallback.run(row!.eventId)).toBeNull();
    expect(mine()).toBe(2);
  });
  describe('(11) PO A1 + A2: dòng người nhận (tin giao hàng không kèm giá) và số người mua chưa xác minh', () => {
    const flagsNoRecipient = { ...flagsOn, isEnabled: async (f: string) => f !== 'orderRecipient' } as unknown as MssFlagsService;
    const healthNoRecipientCap = { assertCapability: async (f: string) => f !== 'orderRecipient' } as unknown as MssHealthService;
    const circuitClient = { circuit: { isTripped: () => false } } as unknown as MssClient;
    let recorderFlagOff: MssOrderEventRecorder;
    let recorderNoCap: MssOrderEventRecorder;
    const bodyOf = (row: { body: string }) => JSON.parse(row.body) as { order: Record<string, unknown>; recipient: Record<string, unknown>; consent: Record<string, unknown> };
    const byRole = async (orderId: string, eventType: string) => {
      const rows = (await rowsOf(orderId)).filter((r) => r.eventType === eventType);
      return { buyer: rows.filter((r) => r.recipientRole === 'buyer'), recipient: rows.filter((r) => r.recipientRole === 'recipient') };
    };

    beforeAll(async () => {
      recorderFlagOff = new MssOrderEventRecorder(flagsNoRecipient, health, circuitClient, dispatcher, ENV);
      recorderNoCap = new MssOrderEventRecorder(flagsOn, healthNoRecipientCap, circuitClient, dispatcher, ENV);
      await Promise.all([recorderFlagOff.refreshGate(), recorderNoCap.refreshGate()]);
      expect(recorder.gate().recipient).toBe(true);
      expect(recorderFlagOff.gate()).toMatchObject({ open: true, recipient: false });
      expect(recorderNoCap.gate()).toMatchObject({ open: true, recipient: false });
    });

    it('đơn tặng, khách không bật công tắc: người mua nhận đủ tin như cũ, không dòng người nhận', async () => {
      const { order } = await consentedOrder({ giftPhone: uniquePhone('08') });
      for (const t of ['order.created', 'order.shipping', 'order.delivered'] as const) expect(await recordIn(order.id, t)).toBeNull();
      const rows = await rowsOf(order.id);
      expect(rows.map((r) => [r.eventType, r.recipientRole])).toEqual([
        ['order.created', 'buyer'],
        ['order.shipping', 'buyer'],
        ['order.delivered', 'buyer'],
      ]);
    });

    it('bật công tắc, cờ + năng lực MSS: shipping và delivered có thêm dòng người nhận không kèm giá; created/paid chỉ người mua', async () => {
      const giftPhone = uniquePhone('08');
      const { user, order } = await consentedOrder({ giftPhone, notifyRecipientZalo: true, paymentMethod: 'BANK_TRANSFER' });
      for (const t of ['order.created', 'order.payment_confirmed', 'order.shipping', 'order.delivered'] as const) expect(await recordIn(order.id, t)).toBeNull();
      for (const t of ['order.created', 'order.payment_confirmed']) expect((await byRole(order.id, t)).recipient).toHaveLength(0);
      for (const t of ['order.shipping', 'order.delivered']) {
        const { buyer, recipient } = await byRole(order.id, t);
        expect([buyer.length, recipient.length]).toEqual([1, 1]);
        expect(recipient[0]!.sequence).toBeGreaterThan(buyer[0]!.sequence);
        const b = bodyOf(buyer[0]!);
        expect(b.recipient).toEqual({ phone: user.phone, phone_source: 'account_verified', name: 'Lan' });
        expect(b.order.total_vnd).toBe(100_000);
        const r = bodyOf(recipient[0]!);
        expect(r.recipient).toEqual({ phone: giftPhone, phone_source: 'checkout_contact', role: 'recipient' });
        expect(r.order.total_vnd).toBe(0);
        expect(r.order).not.toHaveProperty('first_item_name');
        expect(r.order).not.toHaveProperty('tracking_url');
        expect(r.consent).toMatchObject({ order_updates_zalo: true, source: 'checkout' });
        expect(recipient[0]!.body).not.toMatch(/100000|Fuwa|https?:|Lan/);
      }
      // Ghi lại cùng sự kiện (worker chạy lại, trạng thái lặp): không thêm dòng nào của cả hai vai.
      expect(await recordIn(order.id, 'order.shipping')).toBe('duplicate');
      expect(await rowsOf(order.id)).toHaveLength(6);
    });

    it('bật công tắc mà MSS chưa công bố order_events.recipient_role, hoặc cờ người nhận tắt: chỉ dòng người mua', async () => {
      for (const r of [recorderNoCap, recorderFlagOff]) {
        const { order } = await consentedOrder({ giftPhone: uniquePhone('08'), notifyRecipientZalo: true });
        expect(await recordIn(order.id, 'order.shipping', r)).toBeNull();
        expect((await rowsOf(order.id)).map((x) => x.recipientRole)).toEqual(['buyer']);
      }
    });

    it('số nhận hàng trùng số người mua (khác cách viết) hoặc sửa về số người mua sau khi đã giao: không dòng người nhận', async () => {
      const { user, order } = await consentedOrder({ notifyRecipientZalo: true });
      await prisma.order.update({ where: { id: order.id }, data: { shippingAddress: { phone: `+84${user.phone!.slice(1)}` } } });
      expect(await recordIn(order.id, 'order.shipping')).toBeNull();
      expect((await rowsOf(order.id)).map((x) => x.recipientRole)).toEqual(['buyer']);

      const gift = await consentedOrder({ giftPhone: uniquePhone('08'), notifyRecipientZalo: true });
      expect(await recordIn(gift.order.id, 'order.shipping')).toBeNull();
      await prisma.order.update({ where: { id: gift.order.id }, data: { shippingAddress: { phone: gift.user.phone } } });
      expect(await recordIn(gift.order.id, 'order.delivered')).toBeNull();
      expect((await rowsOf(gift.order.id)).map((x) => [x.eventType, x.recipientRole])).toEqual([
        ['order.shipping', 'buyer'],
        ['order.shipping', 'recipient'],
        ['order.delivered', 'buyer'],
      ]);
    });

    it('PO A2: số tài khoản chưa xác minh: người mua nhận tin với phone_source checkout_contact', async () => {
      const { user, order } = await consentedOrder({ unverified: true });
      expect(await recordIn(order.id, 'order.created')).toBeNull();
      const [row] = await rowsOf(order.id);
      expect(bodyOf(row!).recipient).toEqual({ phone: user.phone, phone_source: 'checkout_contact', name: 'Lan' });
    });

    it('PO A2: đơn khách vãng lai: người mua nhận tin ở orders.guestPhone, không có tên gọi; tin giao hàng không có link trang tài khoản', async () => {
      const { order } = await consentedOrder({ guest: true });
      expect(await recordIn(order.id, 'order.created')).toBeNull();
      const [row] = await rowsOf(order.id);
      expect(bodyOf(row!).recipient).toEqual({ phone: order.guestPhone, phone_source: 'checkout_contact' });
      expect(await recordIn(order.id, 'order.shipping')).toBeNull();
      const { buyer } = await byRole(order.id, 'order.shipping');
      expect(bodyOf(buyer[0]!).order).not.toHaveProperty('tracking_url');

      const member = await consentedOrder();
      expect(await recordIn(member.order.id, 'order.shipping')).toBeNull();
      expect(bodyOf((await rowsOf(member.order.id))[0]!).order.tracking_url).toBe(`https://tubutree.com/tai-khoan/don-hang/${member.order.code}`);
    });

    it('không có số nào nhắn được: no_phone, không dòng', async () => {
      const { order } = await consentedOrder({ guest: true });
      await prisma.order.update({ where: { id: order.id }, data: { guestPhone: null, shippingAddress: { phone: '12345' } } });
      expect(await recordIn(order.id, 'order.created')).toBe('no_phone');
      expect(await rowsOf(order.id)).toHaveLength(0);
    });

    it('ZNS chỉ gắn dòng người mua; MSS bỏ qua dòng người nhận thì không gửi ZNS nào cho người nhận', async () => {
      const { user, order } = await consentedOrder({ giftPhone: uniquePhone('08'), notifyRecipientZalo: true });
      await recordIn(order.id, 'order.shipping');
      expect(await hold.holdZns(user.id, 'ORDER_SHIPPING', { order_code: order.code }, 'zns-tpl')).toBe(true);
      const { buyer, recipient } = await byRole(order.id, 'order.shipping');
      expect(buyer[0]!.znsHeldTemplate).toBe('ORDER_SHIPPING');
      expect(recipient[0]!.znsHeldTemplate).toBeNull();

      expect(await sender.deliver(recipient[0]!.eventId)).toBe('DELIVERED');
      expect(await sender.applyResult(recipient[0]!.eventId, { orderCode: order.code, eventType: 'order.shipping' }, 'skipped', 'not_friend', 'callback')).toBe('applied');
      await fallback.run(recipient[0]!.eventId);
      expect(sendHeldZns).not.toHaveBeenCalled();
      const after = await byRole(order.id, 'order.shipping');
      expect(after.recipient[0]).toMatchObject({ status: 'RESULT_SKIPPED', fallbackChannel: 'IN_APP_ONLY' });
      // Dòng người mua vẫn giữ ZNS chờ của chính nó, chưa bị đường lui của dòng người nhận đụng tới.
      expect(after.buyer[0]).toMatchObject({ status: 'PENDING', fallbackAt: null, znsHeldTemplate: 'ORDER_SHIPPING' });
    });

    it('số người nhận đã từ chối tin (skipped:opted_out): không tắt lựa chọn của người mua, tin sau của người mua vẫn ghi', async () => {
      const { user, order } = await consentedOrder({ giftPhone: uniquePhone('08'), notifyRecipientZalo: true });
      await recordIn(order.id, 'order.shipping');
      const { recipient } = await byRole(order.id, 'order.shipping');
      expect(await sender.deliver(recipient[0]!.eventId)).toBe('DELIVERED');
      expect(await sender.applyResult(recipient[0]!.eventId, { orderCode: order.code, eventType: 'order.shipping' }, 'skipped', 'opted_out', 'callback')).toBe('applied');
      const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect({ on: u.notifyOrderZalo, source: u.notifyOrderZaloSource }).toEqual({ on: true, source: 'checkout' });
      expect(await recordIn(order.id, 'order.delivered')).toBeNull();
      expect((await byRole(order.id, 'order.delivered')).buyer).toHaveLength(1);
    });

    it('admin tắt cờ người nhận khi dòng người nhận còn chờ: lượt gửi huỷ dòng đó (disabled), dòng người mua vẫn gửi', async () => {
      const { order } = await consentedOrder({ giftPhone: uniquePhone('08'), notifyRecipientZalo: true });
      await recordIn(order.id, 'order.shipping');
      const { buyer, recipient } = await byRole(order.id, 'order.shipping');
      const senderNoRecipient = new MssOrderEventSender(prisma, client, flagsNoRecipient, dispatcher, fallback);
      replies = [{ status: 202, body: { status: 'queued', duplicate: false } }];
      expect(await senderNoRecipient.deliver(recipient[0]!.eventId)).toBe('CANCELLED');
      expect(calls).toHaveLength(0);
      expect(await senderNoRecipient.deliver(buyer[0]!.eventId)).toBe('DELIVERED');
      expect(calls).toHaveLength(1);
      const after = await byRole(order.id, 'order.shipping');
      expect(after.recipient[0]).toMatchObject({ status: 'CANCELLED', resultReason: 'disabled' });
    });

    it('huỷ hết hạn thanh toán: chỉ tin đã tới người mua mới tính "đã báo" (tin người nhận đã gửi không tính)', async () => {
      const { order } = await consentedOrder({ giftPhone: uniquePhone('08'), notifyRecipientZalo: true });
      await recordIn(order.id, 'order.shipping');
      await prisma.mssOrderEventOutbox.updateMany({ where: { orderId: order.id, recipientRole: 'recipient' }, data: { status: 'RESULT_SENT', resultAt: new Date() } });
      await prisma.mssOrderEventOutbox.updateMany({ where: { orderId: order.id, recipientRole: 'buyer' }, data: { status: 'RESULT_FAILED', resultAt: new Date() } });
      expect(await prisma.$transaction((tx) => recorder.record(tx, order.id, 'order.cancelled', { cancelReason: 'PAYMENT_TIMEOUT' }))).toBe('payment_timeout_unnotified');
    });
  });

  describe('(14) w37-01: bill + link xem đơn (năng lực order_events.bill_v1)', () => {
    const flagsNoBill = { ...flagsOn, isEnabled: async (f: string) => f !== 'orderBill' } as unknown as MssFlagsService;
    const healthNoBillCap = { assertCapability: async (f: string) => f !== 'orderBill' } as unknown as MssHealthService;
    const circuitClient = { circuit: { isTripped: () => false } } as unknown as MssClient;
    let recorderNoBill: MssOrderEventRecorder;
    let recorderNoBillCap: MssOrderEventRecorder;
    const BILL_KEYS = ['detail_url', 'items', 'items_more', 'subtotal_vnd', 'discount_vnd', 'shipping_fee_vnd'];
    const bodyOf = (row: { body: string }) => JSON.parse(row.body) as { order: Record<string, unknown>; recipient: Record<string, unknown> };

    beforeAll(async () => {
      recorderNoBill = new MssOrderEventRecorder(flagsNoBill, health, circuitClient, dispatcher, ENV);
      recorderNoBillCap = new MssOrderEventRecorder(flagsOn, healthNoBillCap, circuitClient, dispatcher, ENV);
      await Promise.all([recorderNoBill.refreshGate(), recorderNoBillCap.refreshGate()]);
      expect(recorder.gate().bill).toBe(true);
      expect(recorderNoBill.gate()).toMatchObject({ open: true, bill: false });
      expect(recorderNoBillCap.gate()).toMatchObject({ open: true, bill: false });
    });

    /** Đơn 16 món (tên tiếng Việt dài), tiền khớp tổng: 16 × 100.000 − 50.000 + 20.000. */
    async function sixteenItems(over: Parameters<typeof consentedOrder>[0] = {}) {
      const { user, order } = await consentedOrder(over);
      await prisma.orderItem.createMany({
        data: Array.from({ length: 15 }, (_, i) => ({
          orderId: order.id,
          variationId,
          productName: `Nước giặt sinh học hương sả chanh dịu nhẹ số ${i + 2} Fuwa3e`,
          variationName: i % 2 ? 'Can 3,8L' : '',
          unitPrice: 100_000,
          quantity: 1,
          total: 100_000,
          isGift: i === 14,
        })),
      });
      const updated = await prisma.order.update({ where: { id: order.id }, data: { subtotal: 1_600_000, discount: 50_000, shippingFee: 20_000, total: 1_570_000 } });
      return { user, order: updated };
    }

    it('cờ + năng lực bật: created/payment_confirmed của người mua có 15 món đầu (theo OrderItem.id), items_more 1, tiền, link; thân ≤ 6.144 B; dòng người nhận không có gì của bill', async () => {
      const giftPhone = uniquePhone('08');
      const { order } = await sixteenItems({ giftPhone, notifyRecipientZalo: true, paymentMethod: 'BANK_TRANSFER' });
      for (const t of ['order.created', 'order.payment_confirmed', 'order.shipping', 'order.delivered'] as const) expect(await recordIn(order.id, t)).toBeNull();
      const firstFifteen = (await prisma.orderItem.findMany({ where: { orderId: order.id }, orderBy: { id: 'asc' }, select: { productName: true } })).slice(0, 15);
      const rows = await rowsOf(order.id);
      for (const row of rows) {
        const o = bodyOf(row).order;
        expect(Buffer.byteLength(row.body, 'utf8')).toBeLessThanOrEqual(6_144);
        const billed = row.recipientRole === 'buyer' && (row.eventType === 'order.created' || row.eventType === 'order.payment_confirmed');
        if (!billed) {
          for (const k of BILL_KEYS) expect(o).not.toHaveProperty(k);
          continue;
        }
        expect(o).toMatchObject({
          item_count: 16,
          items_more: 1,
          subtotal_vnd: 1_600_000,
          discount_vnd: 50_000,
          shipping_fee_vnd: 20_000,
          total_vnd: 1_570_000,
          detail_url: `https://tubutree.com/tai-khoan/don-hang/${order.code}`,
        });
        const items = o.items as { name: string; variant?: string; gift?: boolean }[];
        expect(items.map((i) => i.name)).toEqual(firstFifteen.map((i) => i.productName));
        expect(items.filter((i) => i.gift)).toHaveLength(items.some((i) => i.name.includes('số 16')) ? 1 : 0);
      }
      const recipient = rows.filter((r) => r.recipientRole === 'recipient');
      expect(recipient.map((r) => r.eventType)).toEqual(['order.shipping', 'order.delivered']);
      for (const r of recipient) {
        expect(bodyOf(r).order.total_vnd).toBe(0);
        expect(r.body).not.toMatch(/tubutree\.com|Fuwa|1570000|100000|"items"|detail_url|subtotal_vnd/);
      }
    });

    it('cờ bill tắt hoặc MSS chưa công bố bill_v1: thân người mua không có khoá bill nào (như w36)', async () => {
      for (const r of [recorderNoBill, recorderNoBillCap]) {
        const { order } = await sixteenItems();
        expect(await recordIn(order.id, 'order.created', r)).toBeNull();
        const [row] = await rowsOf(order.id);
        for (const k of BILL_KEYS) expect(bodyOf(row!).order).not.toHaveProperty(k);
      }
    });

    it('khách vãng lai web (có khoá đơn, chủ còn là khách): cổng bill mở thì tracking_url là /don/<mã>#k= đã ký; cổng bill đóng thì không link (như w36)', async () => {
      const { order } = await consentedOrder({ guest: true });
      await prisma.order.update({ where: { id: order.id }, data: { guestTokenHash: 'd'.repeat(64), platform: 'web' } });
      expect(await recordIn(order.id, 'order.shipping')).toBeNull();
      const url = bodyOf((await rowsOf(order.id))[0]!).order.tracking_url as string;
      expect(url).toMatch(new RegExp(`^https://tubutree\\.com/don/${order.code}#k=[A-Za-z0-9_-]{43}$`));
      expect(url).not.toContain(order.guestPhone!.slice(3));

      const off = await consentedOrder({ guest: true });
      await prisma.order.update({ where: { id: off.order.id }, data: { guestTokenHash: 'e'.repeat(64), platform: 'web' } });
      expect(await recordIn(off.order.id, 'order.shipping', recorderNoBill)).toBeNull();
      const [row] = await rowsOf(off.order.id);
      expect(bodyOf(row!).order).not.toHaveProperty('tracking_url');
      expect(row!.body).not.toContain('#k=');
    });
  });

  describe('(15) MINOR 2 w39-04: tài khoản không có số, số người mua là SĐT giao hàng mà khách tự sửa được', () => {
    const BILL_KEYS = ['detail_url', 'items', 'items_more', 'subtotal_vnd', 'discount_vnd', 'shipping_fee_vnd'];
    const bodyOf = (row: { body: string }) => JSON.parse(row.body) as { order: Record<string, unknown>; recipient: Record<string, unknown> };
    const buyerRow = async (orderId: string, eventType: string) =>
      (await prisma.mssOrderEventOutbox.findMany({ where: { orderId, eventType, recipientRole: 'buyer' } }))[0];

    /** Đơn chuyển khoản của tài khoản không có số: số người mua đọc từ SĐT giao hàng A. */
    async function noPhoneOrder() {
      const { user, order } = await consentedOrder({ paymentMethod: 'BANK_TRANSFER' });
      await prisma.user.update({ where: { id: user.id }, data: { phone: null, phoneVerifiedAt: null } });
      const A = (order.shippingAddress as { phone: string }).phone;
      return { order, A };
    }

    /** Lần khách tự sửa SĐT người nhận A → B (cùng dòng lịch sử mà OrderCustomerEditService ghi), ở giờ `at`. */
    async function editPhone(order: { id: string; status: string; userId: string; shippingAddress: unknown }, at: Date) {
      const B = uniquePhone('08');
      await prisma.order.update({ where: { id: order.id }, data: { shippingAddress: { ...(order.shippingAddress as object), phone: B } } });
      await prisma.orderStatusHistory.create({
        data: { orderId: order.id, fromStatus: order.status, toStatus: order.status, actorType: 'CUSTOMER', actorId: order.userId, note: orderEditHistoryNote(['SĐT']), createdAt: at },
      });
      return B;
    }

    it('có dòng created tới A, khách sửa sang B: thanh toán/giao/huỷ đều về A, tin thanh toán có bill; B không nhận gì', async () => {
      const { order, A } = await noPhoneOrder();
      expect(await recordIn(order.id, 'order.created')).toBeNull();
      const B = await editPhone(order, new Date(Date.now() + 5_000));
      for (const t of ['order.payment_confirmed', 'order.shipping', 'order.delivered'] as const) expect(await recordIn(order.id, t)).toBeNull();
      for (const t of ['order.created', 'order.payment_confirmed', 'order.shipping', 'order.delivered']) {
        expect([t, bodyOf((await buyerRow(order.id, t))!).recipient.phone]).toEqual([t, A]);
      }
      expect(bodyOf((await buyerRow(order.id, 'order.payment_confirmed'))!).order.items).toHaveLength(1);
      const all = await rowsOf(order.id);
      expect(all.every((r) => r.recipientRole === 'buyer')).toBe(true);
      expect(all.map((r) => r.body).join('')).not.toContain(B);
    });

    it('chưa có dòng nào của người mua, SĐT đã sửa: tin thanh toán vẫn ghi (về số hiện tại) nhưng không có bill', async () => {
      const { order } = await noPhoneOrder();
      const B = await editPhone(order, new Date(Date.now() - 60_000));
      expect(await recordIn(order.id, 'order.payment_confirmed')).toBeNull();
      const paid = bodyOf((await buyerRow(order.id, 'order.payment_confirmed'))!);
      expect(paid.recipient.phone).toBe(B);
      for (const k of BILL_KEYS) expect(paid.order).not.toHaveProperty(k);
    });

    it('khách bật Zalo sau khi đã sửa SĐT (dòng created ghi sau lần sửa): created và tin thanh toán đều không có bill', async () => {
      const { order } = await noPhoneOrder();
      const B = await editPhone(order, new Date(Date.now() - 60_000));
      expect(await recordIn(order.id, 'order.created')).toBeNull();
      expect(await recordIn(order.id, 'order.payment_confirmed')).toBeNull();
      for (const t of ['order.created', 'order.payment_confirmed']) {
        const body = bodyOf((await buyerRow(order.id, t))!);
        expect([t, body.recipient.phone]).toEqual([t, B]);
        for (const k of BILL_KEYS) expect(body.order).not.toHaveProperty(k);
      }
    });
  });
});
