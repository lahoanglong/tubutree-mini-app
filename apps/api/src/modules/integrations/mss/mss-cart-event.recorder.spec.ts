import { Logger } from '@nestjs/common';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { MssHealthService } from './mss-health.service';
import { MssCartEventRecorder, type CartAbandonRemindedInput } from './mss-cart-event.recorder';
import { MSS_CART_MAX_AGE_MS } from './mss-cart-event-types';

/** Postgres thật (khoá advisory, đếm 7 ngày giữa hai lượt chồng nhau) ở test/integration-race/mss-cart-events.race-spec.ts. */

const NOW = new Date('2026-11-25T05:00:00Z');

const okUser = {
  phone: '0907345678',
  phoneVerifiedAt: new Date('2026-10-01T00:00:00Z'),
  isBlocked: false,
  notifyPromo: true,
  notifyPromoAt: new Date('2026-11-01T00:00:00Z'),
  notifyOrderZalo: true,
  notifyOrderZaloAt: new Date('2026-11-02T00:00:00Z'),
  notifyOrderZaloSource: 'checkout',
};

const input = (over: Partial<CartAbandonRemindedInput> = {}): CartAbandonRemindedInput => ({
  userId: 'u1',
  cartId: 'cm0000000000000000000000a',
  abandonedAt: new Date(NOW.getTime() - 8 * 3_600_000),
  remindedAt: NOW,
  lines: [
    { name: 'Nước rửa chén hữu cơ', quantity: 2 },
    { name: 'Nước giặt', quantity: 1 },
  ],
  ...over,
});

function setup(opts: { capability?: boolean; user?: unknown; template?: { channel: string; zaloTemplateId: string | null } | null; live?: number; created?: number } = {}) {
  const tx = {
    $executeRaw: jest.fn(async () => 1),
    mssCartEvent: {
      count: jest.fn(async () => opts.live ?? 0),
      createMany: jest.fn(async () => ({ count: opts.created ?? 1 })),
    },
  };
  const prisma = {
    user: { findUnique: jest.fn(async () => (opts.user === undefined ? okUser : opts.user)) },
    notificationTemplate: { findUnique: jest.fn(async () => (opts.template === undefined ? { channel: 'INAPP', zaloTemplateId: null } : opts.template)) },
    order: { findFirst: jest.fn(async () => ({ platform: 'miniapp' })) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const assertCapability = jest.fn(async () => opts.capability ?? true);
  const recorder = new MssCartEventRecorder(prisma as unknown as PrismaService, { assertCapability } as unknown as MssHealthService);
  return { recorder, prisma, tx, assertCapability };
}

describe('MssCartEventRecorder.onCartAbandonReminded', () => {
  beforeEach(() => {
    for (const level of ['log', 'warn', 'error'] as const) jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('đủ điều kiện: khoá theo khách, đếm 7 ngày, chèn một dòng PENDING với thân hợp đồng', async () => {
    const { recorder, tx, assertCapability } = setup();
    await expect(recorder.onCartAbandonReminded(input(), NOW)).resolves.toBe('recorded');
    expect(assertCapability).toHaveBeenCalledWith('cartAbandonedZalo');
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.mssCartEvent.count).toHaveBeenCalledWith({
      where: {
        userId: 'u1',
        type: 'cart.abandoned',
        createdAt: { gte: new Date(NOW.getTime() - 7 * 864e5) },
        OR: [{ status: { in: ['PENDING', 'SENDING'] } }, { status: 'ACCEPTED', OR: [{ resultStatus: { in: ['queued', 'sent', 'unknown'] } }, { resultStatus: null }] }],
      },
    });
    const row = (tx.mssCartEvent.createMany.mock.calls[0] as unknown as [{ data: Record<string, unknown>[] }])[0].data[0]!;
    expect(row).toMatchObject({
      type: 'cart.abandoned',
      userId: 'u1',
      cartId: 'cm0000000000000000000000a',
      cartRef: `c_cm0000000000000000000000a_${Math.floor(input().abandonedAt.getTime() / 1000)}`,
      cartUpdatedAt: input().abandonedAt,
      cartRemindedAt: NOW,
      occurredAt: NOW,
      expiresAt: new Date(input().abandonedAt.getTime() + 40 * 3_600_000),
    });
    const body = JSON.parse(row.body as string);
    expect(body).toMatchObject({
      type: 'cart.abandoned',
      sender: 'tubutree',
      cart: { item_count: 3, first_item_name: 'Nước rửa chén hữu cơ' },
      customer: { phone: '0907345678', phone_source: 'account_verified' },
      consent: { zalo_reminders: true, source: 'miniapp' },
    });
  });

  it('cờ tắt hoặc MSS chưa công bố cart.abandoned_zalo: gate_closed, không đọc khách', async () => {
    const { recorder, prisma } = setup({ capability: false });
    await expect(recorder.onCartAbandonReminded(input(), NOW)).resolves.toBe('gate_closed');
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('giỏ bỏ quá 36 giờ: too_old', async () => {
    const { recorder } = setup();
    await expect(recorder.onCartAbandonReminded(input({ abandonedAt: new Date(NOW.getTime() - MSS_CART_MAX_AGE_MS - 1) }), NOW)).resolves.toBe('too_old');
    await expect(recorder.onCartAbandonReminded(input({ abandonedAt: new Date(NOW.getTime() - MSS_CART_MAX_AGE_MS) }), NOW)).resolves.toBe('recorded');
  });

  it('giỏ không còn món: empty', async () => {
    const { recorder } = setup();
    await expect(recorder.onCartAbandonReminded(input({ lines: [] }), NOW)).resolves.toBe('empty');
  });

  it.each([
    ['chưa đồng ý tin Zalo', { ...okUser, notifyOrderZalo: false }, 'no_consent'],
    ['tắt khuyến mãi', { ...okUser, notifyPromo: false }, 'no_consent'],
    ['MSS báo từ chối', { ...okUser, notifyOrderZaloSource: 'mss_opt_out' }, 'opted_out'],
    ['bị khoá', { ...okUser, isBlocked: true }, 'blocked'],
    ['SĐT không đọc được', { ...okUser, phone: '12345' }, 'no_phone'],
    ['không thấy khách', null, 'not_found'],
  ])('%s → %s, không ghi dòng', async (_l, user, out) => {
    const { recorder, tx } = setup({ user });
    await expect(recorder.onCartAbandonReminded(input(), NOW)).resolves.toBe(out);
    expect(tx.mssCartEvent.createMany).not.toHaveBeenCalled();
  });

  it('SĐT chưa xác minh mà đọc được: phone_source checkout_contact', async () => {
    const { recorder, tx } = setup({ user: { ...okUser, phoneVerifiedAt: null } });
    await expect(recorder.onCartAbandonReminded(input(), NOW)).resolves.toBe('recorded');
    const row = (tx.mssCartEvent.createMany.mock.calls[0] as unknown as [{ data: { body: string }[] }])[0].data[0]!;
    expect(JSON.parse(row.body).customer.phone_source).toBe('checkout_contact');
  });

  it('admin đổi mẫu CART_ABANDONED sang ZNS có mã: zns_channel (một kênh ngoài app)', async () => {
    const { recorder, tx } = setup({ template: { channel: 'ZNS', zaloTemplateId: '123' } });
    await expect(recorder.onCartAbandonReminded(input(), NOW)).resolves.toBe('zns_channel');
    expect(tx.mssCartEvent.createMany).not.toHaveBeenCalled();
  });

  it('đã có lần nhắc còn sống trong 7 ngày: deduped, không chèn', async () => {
    const { recorder, tx } = setup({ live: 1 });
    await expect(recorder.onCartAbandonReminded(input(), NOW)).resolves.toBe('deduped');
    expect(tx.mssCartEvent.createMany).not.toHaveBeenCalled();
  });

  it('trùng (cartRef, type): duplicate', async () => {
    const { recorder } = setup({ created: 0 });
    await expect(recorder.onCartAbandonReminded(input(), NOW)).resolves.toBe('duplicate');
  });

  it('lỗi DB: trả error, không ném', async () => {
    const { recorder, prisma } = setup();
    prisma.user.findUnique.mockRejectedValueOnce(new Error('db down'));
    await expect(recorder.onCartAbandonReminded(input(), NOW)).resolves.toBe('error');
  });
});
