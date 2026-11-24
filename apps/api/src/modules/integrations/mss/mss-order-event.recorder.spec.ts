import { Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { MssFlagsService } from './mss-flags';
import type { MssHealthService } from './mss-health.service';
import type { MssClient } from './mss.client';
import type { MssOrderEventDispatcher } from './mss-order-event.dispatch';
import { MSS_COLD_GATE_WAIT_MS, MssOrderEventRecorder } from './mss-order-event.recorder';

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
  const isEnabled = jest.fn(enabled);
  const flags = { isEnabled, snapshot: jest.fn(async () => ({ orderEventsRolloutPct: 100 })) } as unknown as MssFlagsService;
  const assertCapability = jest.fn(async () => true);
  const health = { assertCapability } as unknown as MssHealthService;
  const client = { circuit: { isTripped: () => false } } as unknown as MssClient;
  const dispatcher = { enqueue: jest.fn() } as unknown as MssOrderEventDispatcher;
  const recorder = new MssOrderEventRecorder(flags, health, client, dispatcher);
  const record = jest.spyOn(recorder, 'record').mockResolvedValue(null);
  const tx = {
    order: { updateMany: jest.fn(async () => ({ count: PLACED.length })) },
    user: { update: jest.fn(async () => ({})), findUnique: jest.fn(async () => null) },
  };
  return { recorder, record, tx, txc: tx as unknown as Prisma.TransactionClient, isEnabled, assertCapability };
}

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
    expect(isEnabled).toHaveBeenCalledTimes(1);
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
    expect(isEnabled).toHaveBeenCalledTimes(1);
  });

  it('nạp cổng hỏi assertCapability cả khi cờ coi như tắt: đó là chỗ báo Ops khi admin bật cờ mà thiếu biến MSS_*', async () => {
    const { recorder, assertCapability } = setup(async () => false);
    await expect(recorder.refreshGate()).resolves.toMatchObject({ enabled: false, open: false });
    expect(assertCapability).toHaveBeenCalledWith('orderEvents');
  });
});
