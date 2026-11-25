import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import type { Env } from '../../../config/env.validation';
import { verifyGuestLookupKey } from '../../checkout/guest/guest-track-link';
import type { MssFlagsService } from './mss-flags';
import type { MssHealthService } from './mss-health.service';
import type { MssClient } from './mss.client';
import type { MssOrderEventDispatcher } from './mss-order-event.dispatch';
import { buildMssEventBody } from './mss-order-event-body';
import { MSS_COLD_GATE_WAIT_MS, MSS_ORDER_LINK_ORIGIN, MssOrderEventRecorder } from './mss-order-event.recorder';

/**
 * Cổng của bộ ghi sự kiện đơn MSS (wave tubu-w34-03): đơn đặt ngay sau khi API khởi động không bị bỏ qua vì cổng chưa nạp, và đơn đặt
 * lúc cổng đóng để lại dấu `gate_closed` cho Ops thay vì `orderZaloConsent = null` trơn. Postgres thật ở mss-order-events.race-spec.
 */

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const PLACED = [
  { id: 'o1', userId: 'u1', paymentStatus: 'UNPAID', paymentMethod: 'BANK_TRANSFER' },
  { id: 'o2', userId: 'u1', paymentStatus: 'UNPAID', paymentMethod: 'BANK_TRANSFER' },
];

function setup(enabled: () => Promise<boolean>) {
  const isEnabled = jest.fn((_flag?: string) => enabled());
  const flags = { isEnabled, snapshot: jest.fn(async () => ({ orderEventsRolloutPct: 100 })) } as unknown as MssFlagsService;
  const assertCapability = jest.fn(async (_flag?: string) => true);
  const health = { assertCapability } as unknown as MssHealthService;
  const client = { circuit: { isTripped: () => false } } as unknown as MssClient;
  const dispatcher = { enqueue: jest.fn() } as unknown as MssOrderEventDispatcher;
  const recorder = new MssOrderEventRecorder(flags, health, client, dispatcher, ENV);
  const record = jest.spyOn(recorder, 'record').mockResolvedValue(null);
  const tx = {
    order: { updateMany: jest.fn(async () => ({ count: PLACED.length })) },
    user: { update: jest.fn(async () => ({})), findUnique: jest.fn(async () => null) },
  };
  return { recorder, record, tx, txc: tx as unknown as Prisma.TransactionClient, isEnabled, assertCapability };
}

const SECRET = 'unit-secret-mss-order-link-0123456789';
const ENV = { get: (k: string) => (k === 'JWT_ACCESS_SECRET' ? SECRET : undefined) } as unknown as ConfigService<Env, true>;

/** Số lần nạp cổng: mỗi lần nạp hỏi cờ `orderEvents` đúng một lần (cờ người nhận hỏi kèm trong cùng lần nạp). */
const loads = (isEnabled: jest.Mock) => isEnabled.mock.calls.filter((c) => c[0] === 'orderEvents').length;

describe('MssOrderEventRecorder: cổng lúc đặt hàng', () => {
  beforeEach(() => {
    for (const level of ['log', 'warn', 'error', 'debug'] as const) jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('cổng đóng (cờ tắt hoặc thiếu biến): đơn được đánh dấu nguồn gate_closed, orderZaloConsent để trống, không ghi lựa chọn của khách, không sự kiện', async () => {
    const { recorder, record, tx, txc } = setup(async () => false);
    await recorder.refreshGate();
    await recorder.onOrdersPlaced(txc, PLACED, true);
    expect(tx.order.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.order.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['o1', 'o2'] } }, data: { orderZaloConsentSource: 'gate_closed' } });
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.user.findUnique).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('cổng mở: chụp đồng ý vào đơn như cũ, không có nguồn gate_closed', async () => {
    const { recorder, record, tx, txc } = setup(async () => true);
    await recorder.refreshGate();
    await recorder.onOrdersPlaced(txc, PLACED, true);
    expect(tx.order.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.order.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['o1', 'o2'] } }, data: { orderZaloConsent: true, orderZaloConsentAt: expect.any(Date) } });
    expect(record.mock.calls.map((c) => c[2])).toEqual(['order.created', 'order.created']);
  });

  it('không có đơn: không ghi gì, không nạp cổng', async () => {
    const { recorder, tx, txc, isEnabled } = setup(async () => true);
    await recorder.onOrdersPlaced(txc, [], true);
    expect(tx.order.updateMany).not.toHaveBeenCalled();
    expect(isEnabled).not.toHaveBeenCalled();
  });

  it('khởi động lạnh: lần nạp ở onModuleInit chưa xong thì đơn đầu tiên chờ chính lần nạp đó rồi mới quyết, không bị bỏ qua', async () => {
    const flag = deferred<boolean>();
    const { recorder, record, tx, txc, isEnabled } = setup(() => flag.promise);
    recorder.onModuleInit();
    let settled = false;
    const placing = recorder.onOrdersPlaced(txc, PLACED, true).then(() => (settled = true));
    await new Promise((r) => setImmediate(r));
    expect(settled).toBe(false);
    flag.resolve(true);
    await placing;
    expect(loads(isEnabled)).toBe(1);
    expect(tx.order.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['o1', 'o2'] } }, data: { orderZaloConsent: true, orderZaloConsentAt: expect.any(Date) } });
    expect(record).toHaveBeenCalledTimes(2);
  });

  it('khởi động lạnh mà nạp cổng treo: chờ tối đa MSS_COLD_GATE_WAIT_MS rồi coi cổng đóng (gate_closed), transaction không treo theo', async () => {
    jest.useFakeTimers();
    const { recorder, record, tx, txc } = setup(() => new Promise<boolean>(() => undefined));
    let settled = false;
    const placing = recorder.onOrdersPlaced(txc, PLACED, true).then(() => (settled = true));
    await jest.advanceTimersByTimeAsync(MSS_COLD_GATE_WAIT_MS - 1);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await placing;
    expect(tx.order.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['o1', 'o2'] } }, data: { orderZaloConsentSource: 'gate_closed' } });
    expect(record).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('nạp cổng treo: chỉ đợt đầu chờ; transaction sau không chờ thêm 1,5 giây nào (không cạn pool lúc MSS chậm sau deploy)', async () => {
    jest.useFakeTimers();
    const { recorder, tx, txc, isEnabled } = setup(() => new Promise<boolean>(() => undefined));
    const first = recorder.onOrdersPlaced(txc, PLACED, true);
    await jest.advanceTimersByTimeAsync(MSS_COLD_GATE_WAIT_MS);
    await first;
    let settled = false;
    const second = recorder.onPaid(txc, 'o1').then(() => (settled = true));
    const third = recorder.onOrdersPlaced(txc, PLACED, true);
    await jest.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
    await Promise.all([second, third]);
    expect(tx.order.updateMany).toHaveBeenCalledTimes(2);
    expect(loads(isEnabled)).toBe(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('onPaid và onStatusChanged lúc khởi động lạnh cũng chờ lần nạp đầu', async () => {
    const flag = deferred<boolean>();
    const { recorder, record, txc } = setup(() => flag.promise);
    const paid = recorder.onPaid(txc, 'o1');
    const shipped = recorder.onStatusChanged(txc, 'o2', 'SHIPPING', { from: 'PACKED' });
    flag.resolve(true);
    await Promise.all([paid, shipped]);
    expect(record.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      ['o1', 'order.payment_confirmed'],
      ['o2', 'order.shipping'],
    ]);
  });

  it('cổng đã nạp: không nạp lại trong 15 giây, quyết định không chờ I/O', async () => {
    const { recorder, txc, isEnabled } = setup(async () => true);
    await recorder.refreshGate();
    await recorder.onOrdersPlaced(txc, PLACED, true);
    await recorder.onPaid(txc, 'o1');
    expect(loads(isEnabled)).toBe(1);
  });

  it('cổng người nhận (PO A1): chỉ mở khi cổng order_events mở, cờ mss.order_recipient_enabled bật và MSS công bố order_events.recipient_role', async () => {
    const gateOf = async (flags: Record<string, boolean>, caps: Record<string, boolean>) => {
      const { recorder, isEnabled, assertCapability } = setup(async () => true);
      isEnabled.mockImplementation(async (f?: string) => flags[f ?? ''] === true);
      assertCapability.mockImplementation(async (f?: string) => caps[f ?? ''] === true);
      return recorder.refreshGate();
    };
    const all = { orderEvents: true, orderRecipient: true };
    await expect(gateOf(all, all)).resolves.toMatchObject({ open: true, recipient: true });
    await expect(gateOf(all, { orderEvents: true })).resolves.toMatchObject({ open: true, recipient: false });
    await expect(gateOf({ orderEvents: true }, all)).resolves.toMatchObject({ open: true, recipient: false });
    await expect(gateOf(all, { orderRecipient: true })).resolves.toMatchObject({ open: false, recipient: false });
    await expect(gateOf({ orderRecipient: true }, all)).resolves.toMatchObject({ enabled: false, recipient: false });
  });

  it('nạp cổng hỏi assertCapability cả khi cờ coi như tắt: đó là chỗ báo Ops khi admin bật cờ mà thiếu biến MSS_*', async () => {
    const { recorder, assertCapability } = setup(async () => false);
    await expect(recorder.refreshGate()).resolves.toMatchObject({ enabled: false, open: false, bill: false });
    expect(assertCapability).toHaveBeenCalledWith('orderEvents');
    expect(assertCapability).toHaveBeenCalledWith('orderRecipient');
    expect(assertCapability).toHaveBeenCalledWith('orderBill');
  });

  it('cổng bill (w37-01): chỉ mở khi cổng order_events mở, cờ mss.order_bill_enabled bật và MSS công bố order_events.bill_v1', async () => {
    const gateOf = async (flags: Record<string, boolean>, caps: Record<string, boolean>) => {
      const { recorder, isEnabled, assertCapability } = setup(async () => true);
      isEnabled.mockImplementation(async (f?: string) => flags[f ?? ''] === true);
      assertCapability.mockImplementation(async (f?: string) => caps[f ?? ''] === true);
      return recorder.refreshGate();
    };
    const all = { orderEvents: true, orderBill: true };
    await expect(gateOf(all, all)).resolves.toMatchObject({ open: true, bill: true, recipient: false });
    await expect(gateOf(all, { orderEvents: true })).resolves.toMatchObject({ open: true, bill: false });
    await expect(gateOf({ orderEvents: true }, all)).resolves.toMatchObject({ open: true, bill: false });
    await expect(gateOf(all, { orderBill: true })).resolves.toMatchObject({ open: false, bill: false });
    await expect(gateOf({ orderBill: true }, all)).resolves.toMatchObject({ enabled: false, bill: false });
  });
});

/**
 * Thân dòng outbox mà `record` ghi (w37-01), trên một tx giả đủ cho đường ghi: bill chỉ ở dòng người mua của created/payment_confirmed, cổng
 * bill tắt thì thân giống từng byte cách gọi trước w37, link của khách vãng lai là link đã ký. Postgres thật ở mss-order-events.race-spec.
 */
describe('MssOrderEventRecorder.record: link xem đơn và bill (w37-01)', () => {
  type Row = { eventType: string; recipientRole: string; body: string; sequence: number; eventId: string };
  const HASH = 'c'.repeat(64);
  const ITEMS = [
    { productName: 'Nước giặt sinh học Fuwa3e 2L', variationName: 'Can 2L', quantity: 2, unitPrice: 120_000, total: 240_000, isGift: false },
    { productName: 'Túi vải', variationName: '', quantity: 1, unitPrice: 0, total: 0, isGift: true },
  ];

  function orderRow(over: Record<string, unknown> = {}, user: Record<string, unknown> = {}) {
    return {
      id: 'o1',
      code: 'TB7K4M',
      type: 'RETAIL',
      userId: 'u1',
      platform: 'web',
      paymentMethod: 'BANK_TRANSFER',
      total: 245_000,
      subtotal: 240_000,
      discount: 15_000,
      shippingFee: 20_000,
      placedForCustomer: false,
      orderZaloConsent: true,
      orderZaloConsentAt: new Date('2026-11-25T02:00:00Z'),
      shippingPartner: 'GHN',
      shippingCode: 'GHN8X2K9',
      checkoutGroup: null,
      shippingAddress: { phone: '0987654321' },
      notifyRecipientZalo: true,
      guestPhone: null,
      guestTokenHash: null,
      createdAt: new Date('2026-11-25T02:00:00Z'),
      items: ITEMS,
      ...over,
      user: {
        phone: '0901234567',
        zaloId: 'zalo_123',
        mergedIntoId: null,
        phoneVerifiedAt: new Date('2026-01-01T00:00:00Z'),
        fullName: 'Nguyễn Thị Lan',
        notifyOrderZalo: true,
        notifyOrderZaloSource: 'checkout',
        ...user,
      },
    };
  }

  async function run(gate: { bill: boolean; recipient?: boolean }, order: ReturnType<typeof orderRow>, types: string[]) {
    const flags = {
      isEnabled: jest.fn(async (f: string) => f === 'orderEvents' || (f === 'orderBill' && gate.bill) || (f === 'orderRecipient' && gate.recipient !== false)),
      snapshot: jest.fn(async () => ({ orderEventsRolloutPct: 100 })),
    } as unknown as MssFlagsService;
    const health = { assertCapability: jest.fn(async () => true) } as unknown as MssHealthService;
    const client = { circuit: { isTripped: () => false } } as unknown as MssClient;
    const dispatcher = { enqueue: jest.fn() } as unknown as MssOrderEventDispatcher;
    const recorder = new MssOrderEventRecorder(flags, health, client, dispatcher, ENV);
    await recorder.refreshGate();
    const rows: Row[] = [];
    let seq = 0;
    const tx = {
      order: { findUnique: jest.fn(async () => order), count: jest.fn(async () => 1) },
      mssOrderEventOutbox: {
        findUnique: jest.fn(async () => null),
        count: jest.fn(async () => 1),
        createMany: jest.fn(async ({ data }: { data: Row[] }) => {
          rows.push(...data);
          return { count: data.length };
        }),
      },
      $queryRaw: jest.fn(async () => [{ seq: ++seq }]),
    } as unknown as Prisma.TransactionClient;
    for (const t of types) await recorder.record(tx, 'o1', t as never);
    return rows.map((r) => ({ ...r, json: JSON.parse(r.body) as { occurred_at: string; order: Record<string, unknown>; recipient: Record<string, unknown> } }));
  }

  const BILL_KEYS = ['detail_url', 'items', 'items_more', 'subtotal_vnd', 'discount_vnd', 'shipping_fee_vnd'];
  const ALL = ['order.created', 'order.payment_confirmed', 'order.shipping', 'order.delivered', 'order.cancelled'];

  beforeEach(() => {
    for (const level of ['log', 'warn', 'error', 'debug'] as const) jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('cổng bill tắt: thân từng loại giống từng byte cách gọi bộ dựng trước w37 (link tài khoản, không bill)', async () => {
    const order = orderRow();
    const rows = await run({ bill: false }, order, ALL);
    const buyer = rows.filter((r) => r.recipientRole === 'buyer');
    expect(buyer.map((r) => r.eventType)).toEqual(ALL);
    for (const r of buyer) {
      const legacy = buildMssEventBody({
        eventId: r.eventId,
        eventType: r.eventType as never,
        occurredAt: new Date(r.json.occurred_at),
        sequence: r.sequence,
        order: {
          code: order.code,
          total: order.total,
          paymentMethod: order.paymentMethod,
          platform: 'web',
          itemNames: ITEMS.map((i) => i.productName),
          shippingPartner: order.shippingPartner,
          shippingCode: order.shippingCode,
          checkoutGroup: null,
          groupSize: null,
        },
        cancelReason: 'OTHER',
        refundExpected: false,
        recipient: { phone: '0901234567', phoneSource: 'account_verified', name: 'Lan' },
        consent: { capturedAt: order.orderZaloConsentAt, source: 'checkout' },
        linkOrigin: MSS_ORDER_LINK_ORIGIN,
      });
      expect(r.body).toBe(legacy.json);
    }
  });

  it('cổng bill bật: chỉ dòng người mua của created/payment_confirmed có bill; dòng người nhận không có khoá bill, link, tên món, tên gọi, giá', async () => {
    const rows = await run({ bill: true }, orderRow(), ALL);
    for (const r of rows) {
      const billed = r.recipientRole === 'buyer' && (r.eventType === 'order.created' || r.eventType === 'order.payment_confirmed');
      for (const k of ['detail_url', 'items', 'subtotal_vnd', 'discount_vnd', 'shipping_fee_vnd']) expect(k in r.json.order).toBe(billed);
      expect(r.json.order).not.toHaveProperty('items_more');
    }
    const created = rows.find((r) => r.eventType === 'order.created')!.json.order;
    expect(created).toMatchObject({
      detail_url: 'https://tubutree.com/tai-khoan/don-hang/TB7K4M',
      subtotal_vnd: 240_000,
      discount_vnd: 15_000,
      shipping_fee_vnd: 20_000,
      items: [
        { name: 'Nước giặt sinh học Fuwa3e 2L', variant: 'Can 2L', qty: 2, unit_vnd: 120_000, line_vnd: 240_000 },
        { name: 'Túi vải', qty: 1, unit_vnd: 0, line_vnd: 0, gift: true },
      ],
    });
    const recipient = rows.filter((r) => r.recipientRole === 'recipient');
    expect(recipient.map((r) => r.eventType)).toEqual(['order.shipping', 'order.delivered']);
    for (const r of recipient) {
      for (const k of [...BILL_KEYS, 'tracking_url', 'first_item_name']) expect(r.json.order).not.toHaveProperty(k);
      expect(r.json.order.total_vnd).toBe(0);
      expect(r.json.recipient).not.toHaveProperty('name');
      expect(r.body).not.toMatch(/240000|245000|Fuwa|https?:|Lan/);
    }
  });

  it('tiền lệch tổng đơn: ghi cảnh báo mss_bill_money_mismatch, không khoá tiền, món vẫn đi', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn');
    const rows = await run({ bill: true }, orderRow({ discount: 14_000 }), ['order.created']);
    expect(rows[0]!.json.order).not.toHaveProperty('subtotal_vnd');
    expect(rows[0]!.json.order.items).toHaveLength(2);
    expect(warn.mock.calls.some((c) => String(c[0]).startsWith('mss_bill_money_mismatch order=TB7K4M'))).toBe(true);
  });

  it('khách vãng lai web còn sống, cổng bill mở: tracking_url của tin giao hàng và detail_url là link /don đã ký 60 ngày, mở đúng đơn', async () => {
    const guest = orderRow({ guestTokenHash: HASH, guestPhone: '0912345678' }, { phone: null, zaloId: 'guest_w_abcdef', phoneVerifiedAt: null, fullName: 'Khách' });
    const rows = await run({ bill: true }, guest, ['order.created', 'order.shipping']);
    const shipping = rows.find((r) => r.eventType === 'order.shipping' && r.recipientRole === 'buyer')!.json.order;
    const url = shipping.tracking_url as string;
    expect(url).toMatch(/^https:\/\/tubutree\.com\/don\/TB7K4M#k=[A-Za-z0-9_-]{43}$/);
    const key = url.split('#k=')[1]!;
    expect(verifyGuestLookupKey(key, 'TB7K4M', HASH, SECRET, Date.now() + 59 * 86_400_000)).toBe(true);
    expect(verifyGuestLookupKey(key, 'TB7K4M', HASH, SECRET, Date.now() + 61 * 86_400_000)).toBe(false);
    expect(rows.find((r) => r.eventType === 'order.created')!.json.order.detail_url).toMatch(/^https:\/\/tubutree\.com\/don\/TB7K4M#k=/);
    for (const r of rows) for (const k of ['tracking_url', 'detail_url']) expect(String(r.json.order[k] ?? '')).not.toContain('12345678');
  });

  it('khách vãng lai web, cổng bill đóng: không link nào (giống w36), tắt cờ bill là thu hồi link khoá 60 ngày', async () => {
    const guest = orderRow({ guestTokenHash: HASH, guestPhone: '0912345678' }, { phone: null, zaloId: 'guest_w_abcdef', phoneVerifiedAt: null, fullName: 'Khách' });
    const rows = await run({ bill: false }, guest, ['order.created', 'order.shipping']);
    for (const r of rows) {
      expect(r.json.order).not.toHaveProperty('tracking_url');
      expect(r.json.order).not.toHaveProperty('detail_url');
      expect(r.body).not.toContain('#k=');
    }
  });

  it('khách vãng lai Mini (zaloId guest_ không có khoá đơn web): không link nào như trước w37, bill vẫn có món', async () => {
    const mini = orderRow({ platform: 'miniapp', guestPhone: '0912345678' }, { phone: null, zaloId: 'guest_m_abcdef', phoneVerifiedAt: null, fullName: 'Khách' });
    const rows = await run({ bill: true }, mini, ['order.created', 'order.shipping']);
    for (const r of rows) {
      expect(r.json.order).not.toHaveProperty('tracking_url');
      expect(r.json.order).not.toHaveProperty('detail_url');
    }
    expect(rows.find((r) => r.eventType === 'order.created')!.json.order.items).toHaveLength(2);
  });
});
