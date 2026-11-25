import { Logger } from '@nestjs/common';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { MssHealthService } from './mss-health.service';
import { MssRequestError, type MssClient } from './mss.client';
import { MssCartEventSender, type MssCartClaimedRow } from './mss-cart-event.sender';

/** Postgres thật (SKIP LOCKED giữa hai lượt, dò khách đã mua, dọn 30 ngày) ở test/integration-race/mss-cart-events.race-spec.ts. */

const NOW = new Date('2026-11-25T05:00:00Z');
const REMINDED = new Date('2026-11-25T04:00:00Z');
const BODY = JSON.stringify({ customer: { phone: '0907345678' } });

const okUser = {
  phone: '0907345678',
  phoneVerifiedAt: new Date('2026-10-01T00:00:00Z'),
  isBlocked: false,
  notifyPromo: true,
  notifyPromoAt: null,
  notifyOrderZalo: true,
  notifyOrderZaloAt: null,
  notifyOrderZaloSource: 'checkout',
};

const row = (over: Partial<MssCartClaimedRow> = {}): MssCartClaimedRow => ({
  id: 'r1',
  eventId: '01JZX3K9Q2ABCDEFGHJKMNPQRS',
  type: 'cart.abandoned',
  userId: 'u1',
  cartId: 'c1',
  cartUpdatedAt: new Date('2026-11-24T20:00:00Z'),
  cartRemindedAt: REMINDED,
  body: BODY,
  attempts: 1,
  expiresAt: new Date('2026-11-26T12:00:00Z'),
  ...over,
});

function setup(opts: { capability?: boolean; cart?: unknown; order?: unknown; user?: unknown; claimed?: MssCartClaimedRow[] } = {}) {
  const updateMany = jest.fn(async (_args: unknown) => ({ count: 1 }));
  const prisma = {
    mssCartEvent: { updateMany, createMany: jest.fn(async () => ({ count: 0 })) },
    $executeRaw: jest.fn(async () => 0),
    $queryRaw: jest.fn(async () => [] as unknown[]),
    cart: { findUnique: jest.fn(async () => (opts.cart === undefined ? { updatedAt: REMINDED, items: [{ id: 'ci1' }] } : opts.cart)) },
    order: { findFirst: jest.fn(async () => opts.order ?? null) },
    user: { findUnique: jest.fn(async () => (opts.user === undefined ? okUser : opts.user)) },
  };
  const request = jest.fn();
  const assertCapability = jest.fn(async () => opts.capability ?? true);
  const sender = new MssCartEventSender(prisma as unknown as PrismaService, { request } as unknown as MssClient, { assertCapability } as unknown as MssHealthService);
  if (opts.claimed) jest.spyOn(sender, 'claim').mockResolvedValue(opts.claimed);
  jest.spyOn(sender, 'detectRecoveries').mockResolvedValue(0);
  /** Dữ liệu của lần chuyển trạng thái cuối cho dòng `id`. */
  const lastData = (id = 'r1') => {
    const calls = updateMany.mock.calls.map((c) => c[0] as { where: { id: unknown }; data: Record<string, unknown> });
    return [...calls].reverse().find((c) => c.where.id === id)?.data;
  };
  return { sender, prisma, request, updateMany, lastData, assertCapability };
}

describe('MssCartEventSender.deliver: ánh xạ phản hồi MSS', () => {
  beforeEach(() => {
    for (const level of ['log', 'warn', 'error', 'debug'] as const) jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('202 queued: ACCEPTED + resultStatus queued; gửi đúng thân, event_id làm Idempotency-Key', async () => {
    const { sender, request, lastData } = setup();
    request.mockResolvedValue({ status: 202, data: { event_id: 'x', status: 'queued', duplicate: false } });
    await expect(sender.deliver(row(), NOW)).resolves.toBe('ACCEPTED');
    expect(request).toHaveBeenCalledWith('POST', '/cart-events', { body: BODY, eventId: row().eventId, idempotencyKey: row().eventId, op: 'POST /cart-events' });
    expect(lastData()).toMatchObject({ status: 'ACCEPTED', resultStatus: 'queued', resultReason: null, lastHttpStatus: 202 });
  });

  it('200 skipped kèm lý do (recent_reminder, duplicate_cart): ACCEPTED + resultStatus skipped + reason', async () => {
    const { sender, request, lastData } = setup();
    request.mockResolvedValue({ status: 200, data: { status: 'skipped', reason: 'recent_reminder', duplicate: false } });
    await expect(sender.deliver(row(), NOW)).resolves.toBe('ACCEPTED');
    expect(lastData()).toMatchObject({ status: 'ACCEPTED', resultStatus: 'skipped', resultReason: 'recent_reminder' });
  });

  it('503 disabled: SKIPPED mss_off và dừng cả lượt', async () => {
    const { sender, request, lastData } = setup();
    request.mockRejectedValue(new MssRequestError('unavailable', 'off', { status: 503, code: 'disabled' }));
    await expect(sender.deliver(row(), NOW)).resolves.toBe('back_off');
    expect(lastData()).toMatchObject({ status: 'SKIPPED', resultReason: 'mss_off' });
  });

  it.each([
    ['503 queue_full', new MssRequestError('unavailable', 'full', { status: 503, code: 'queue_full', retryAfterSec: 300 })],
    ['503 sender_unavailable', new MssRequestError('unavailable', 'no sender', { status: 503, code: 'sender_unavailable', retryAfterSec: 300 })],
    ['429', new MssRequestError('rate_limited', 'slow down', { status: 429, retryAfterSec: 60 })],
    ['cầu dao ngắt', new MssRequestError('circuit_open', 'open')],
  ])('%s: về PENDING (không sớm hơn Retry-After) và dừng cả lượt', async (_l, err) => {
    const { sender, request, lastData } = setup();
    request.mockRejectedValue(err);
    await expect(sender.deliver(row(), NOW)).resolves.toBe('back_off');
    const data = lastData()!;
    expect(data.status).toBe('PENDING');
    const wait = (data.nextAttemptAt as Date).getTime() - NOW.getTime();
    expect(wait).toBeGreaterThanOrEqual((err.details.retryAfterSec ?? 0) * 1000);
  });

  it.each([
    ['422 consent_required', new MssRequestError('client_error', 'bad', { status: 422, code: 'consent_required' }), 'consent_required'],
    ['422 unexpected_field', new MssRequestError('client_error', 'bad', { status: 422, code: 'unexpected_field' }), 'unexpected_field'],
    ['409 event_id_reused', new MssRequestError('client_error', 'reused', { status: 409, code: 'event_id_reused' }), 'event_id_reused'],
    ['413', new MssRequestError('client_error', 'big', { status: 413, code: 'payload_too_large' }), 'payload_too_large'],
    ['401', new MssRequestError('unauthorized', 'sig', { status: 401 }), 'unauthorized'],
  ])('%s: REJECTED, không thử lại', async (_l, err, reason) => {
    const { sender, request, lastData } = setup();
    request.mockRejectedValue(err);
    await expect(sender.deliver(row(), NOW)).resolves.toBe('REJECTED');
    expect(lastData()).toMatchObject({ status: 'REJECTED', resultReason: reason });
  });

  it('lỗi tạm (timeout, 5xx): thử lại theo lịch; hết lượt thì DEAD', async () => {
    const { sender, request, lastData } = setup();
    request.mockRejectedValue(new MssRequestError('timeout', 'slow'));
    await expect(sender.deliver(row({ attempts: 1 }), NOW)).resolves.toBe('PENDING');
    expect(lastData()).toMatchObject({ status: 'PENDING' });
    request.mockRejectedValue(new MssRequestError('server_error', 'boom', { status: 500 }));
    await expect(sender.deliver(row({ attempts: 6 }), NOW)).resolves.toBe('DEAD');
    expect(lastData()).toMatchObject({ status: 'DEAD', resultReason: 'retries_exhausted' });
  });

  it('lần thử lại kế tiếp rơi sau hạn gửi: EXPIRED ttl', async () => {
    const { sender, request, lastData } = setup();
    request.mockRejectedValue(new MssRequestError('timeout', 'slow'));
    await expect(sender.deliver(row({ attempts: 3, expiresAt: new Date(NOW.getTime() + 60_000) }), NOW)).resolves.toBe('EXPIRED');
    expect(lastData()).toMatchObject({ status: 'EXPIRED', resultReason: 'ttl' });
  });

  it('đã quá hạn lúc nhận: EXPIRED, không gọi MSS', async () => {
    const { sender, request } = setup();
    await expect(sender.deliver(row({ expiresAt: NOW }), NOW)).resolves.toBe('EXPIRED');
    expect(request).not.toHaveBeenCalled();
  });
});

describe('MssCartEventSender.deliver: kiểm lại trước khi gửi cart.abandoned', () => {
  beforeEach(() => {
    for (const level of ['log', 'warn', 'error'] as const) jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['giỏ đổi sau lần nhắc trong app', { cart: { updatedAt: new Date(REMINDED.getTime() + 1), items: [{ id: 'ci1' }] } }, 'cart_changed'],
    ['giỏ đã trống', { cart: { updatedAt: REMINDED, items: [] } }, 'cart_changed'],
    ['giỏ không còn', { cart: null }, 'cart_changed'],
    ['khách đã đặt đơn sau lúc bỏ giỏ', { order: { id: 'o1' } }, 'recovered'],
    ['khách tắt khuyến mãi', { user: { ...okUser, notifyPromo: false } }, 'consent_changed'],
    ['MSS báo khách từ chối', { user: { ...okUser, notifyOrderZaloSource: 'mss_opt_out' } }, 'consent_changed'],
    ['khách đổi SĐT', { user: { ...okUser, phone: '0912345678' } }, 'consent_changed'],
  ])('%s: SKIPPED %s, không gọi MSS', async (_l, opts, reason) => {
    const { sender, request, lastData } = setup(opts);
    await expect(sender.deliver(row(), NOW)).resolves.toBe('SKIPPED');
    expect(lastData()).toMatchObject({ status: 'SKIPPED', resultReason: reason });
    expect(request).not.toHaveBeenCalled();
  });

  it('cart.recovered không kiểm giỏ hay đồng ý', async () => {
    const { sender, request, prisma } = setup({ user: null, cart: null });
    request.mockResolvedValue({ status: 200, data: { status: 'cancelled', cancelled: 1 } });
    await expect(sender.deliver(row({ type: 'cart.recovered', body: '{}' }), NOW)).resolves.toBe('ACCEPTED');
    expect(prisma.cart.findUnique).not.toHaveBeenCalled();
  });
});

describe('MssCartEventSender.runOnce', () => {
  beforeEach(() => {
    for (const level of ['log', 'warn', 'error'] as const) jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('cờ tắt hoặc thiếu năng lực: vẫn cho hết hạn và dọn 30 ngày, không nhận dòng nào', async () => {
    const { sender, prisma, request } = setup({ capability: false });
    const claim = jest.spyOn(sender, 'claim');
    await sender.runOnce(NOW);
    expect(prisma.mssCartEvent.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'EXPIRED', resultReason: 'ttl', claimedAt: null } }));
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(claim).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('MSS bảo chờ ở dòng đầu: các dòng còn lại trả về hàng chờ, không gửi, không tính lượt thử', async () => {
    const rows = [row({ id: 'r1' }), row({ id: 'r2' }), row({ id: 'r3' })];
    const { sender, request, updateMany } = setup({ claimed: rows });
    request.mockRejectedValue(new MssRequestError('rate_limited', 'slow', { status: 429, retryAfterSec: 30 }));
    const stats = await sender.runOnce(NOW);
    expect(request).toHaveBeenCalledTimes(1);
    expect(stats.retried).toBe(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['r2', 'r3'] }, status: 'SENDING' },
      data: { status: 'PENDING', claimedAt: null, attempts: { decrement: 1 } },
    });
  });

  it('đếm kết quả từng dòng', async () => {
    const { sender, request } = setup({ claimed: [row({ id: 'r1' }), row({ id: 'r2' })] });
    request
      .mockResolvedValueOnce({ status: 202, data: { status: 'queued' } })
      .mockRejectedValueOnce(new MssRequestError('client_error', 'bad', { status: 422, code: 'invalid_phone' }));
    await expect(sender.runOnce(NOW)).resolves.toMatchObject({ accepted: 1, rejected: 1 });
  });
});
