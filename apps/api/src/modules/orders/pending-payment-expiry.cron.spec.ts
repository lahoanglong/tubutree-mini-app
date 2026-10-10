import 'reflect-metadata';
import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';
import {
  DEFAULT_PENDING_PAYMENT_TTL_HOURS,
  PENDING_PAYMENT_TTL_KEY,
  PendingPaymentExpiryCron,
} from './pending-payment-expiry.cron';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { OrderStatusService } from './order-status.service';

const NOW = new Date('2026-10-10T05:00:00.000Z');
const HOUR = 3_600_000;

function make(opts: { ttl?: unknown; locked?: boolean; orders?: { id: string; code: string }[] } = {}) {
  const tx = { $queryRaw: jest.fn().mockResolvedValue([{ locked: opts.locked ?? true }]) };
  const prisma = {
    order: { findMany: jest.fn().mockResolvedValue(opts.orders ?? []) },
    $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
  };
  const systemConfig = {
    get: jest.fn(async (_key: string, fallback: unknown) => ('ttl' in opts ? opts.ttl : fallback)),
  };
  const orderStatus = {
    setStatus: jest.fn(async (id: string) => ({ id, status: 'CANCELLED' })),
  };
  const cron = new PendingPaymentExpiryCron(
    prisma as unknown as PrismaService,
    systemConfig as unknown as SystemConfigService,
    orderStatus as unknown as OrderStatusService,
  );
  return { cron, prisma, tx, systemConfig, orderStatus };
}

describe('PendingPaymentExpiryCron (C-024)', () => {
  it('@Cron chạy theo giờ Việt Nam', () => {
    const meta = Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, PendingPaymentExpiryCron.prototype.handleCron);
    expect(meta).toMatchObject({ timeZone: 'Asia/Ho_Chi_Minh' });
  });

  it('chỉ quét đơn lẻ/CTV trả trước còn UNPAID ở PENDING_PAYMENT quá TTL (mặc định 24 giờ), không quét đơn đại lý', async () => {
    const { cron, prisma, systemConfig } = make();
    await cron.expireStale(NOW);
    expect(systemConfig.get).toHaveBeenCalledWith(PENDING_PAYMENT_TTL_KEY, DEFAULT_PENDING_PAYMENT_TTL_HOURS);
    const where = prisma.order.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      type: 'RETAIL',
      status: 'PENDING_PAYMENT',
      paymentStatus: 'UNPAID',
      createdAt: { lt: new Date(NOW.getTime() - 24 * HOUR) },
    });
    expect(where.paymentMethod.in).toEqual(expect.arrayContaining(['BANK_TRANSFER', 'ZALOPAY', 'VNPAY']));
    expect(where.paymentMethod.in).not.toContain('COD');
  });

  it('huỷ từng đơn qua đường huỷ chuẩn setStatus(CANCELLED) với guard onlyIfUnpaid, actor SYSTEM', async () => {
    const { cron, orderStatus } = make({ ttl: 6, orders: [{ id: 'o1', code: 'A' }, { id: 'o2', code: 'B' }] });
    const res = await cron.expireStale(NOW);
    expect(orderStatus.setStatus).toHaveBeenCalledTimes(2);
    expect(orderStatus.setStatus).toHaveBeenCalledWith(
      'o1',
      'CANCELLED',
      expect.objectContaining({ actorType: 'SYSTEM', onlyIfUnpaid: true, note: expect.stringContaining('6 giờ') }),
    );
    expect(res).toMatchObject({ scanned: 2, cancelled: 2, failed: 0 });
  });

  it('đơn được trả tiền chen giữa (setStatus trả về đơn không bị huỷ) → không đếm là đã huỷ', async () => {
    const { cron, orderStatus } = make({ orders: [{ id: 'o1', code: 'A' }] });
    orderStatus.setStatus.mockResolvedValueOnce({ id: 'o1', status: 'CONFIRMED' });
    const res = await cron.expireStale(NOW);
    expect(res).toMatchObject({ scanned: 1, cancelled: 0, failed: 0 });
  });

  it('một đơn lỗi không chặn các đơn còn lại', async () => {
    const { cron, orderStatus } = make({ orders: [{ id: 'o1', code: 'A' }, { id: 'o2', code: 'B' }] });
    orderStatus.setStatus.mockRejectedValueOnce(new Error('db blip'));
    const res = await cron.expireStale(NOW);
    expect(orderStatus.setStatus).toHaveBeenCalledTimes(2);
    expect(res).toMatchObject({ cancelled: 1, failed: 1 });
  });

  it.each([
    [0, 1],
    [-5, 1],
    ['abc', DEFAULT_PENDING_PAYMENT_TTL_HOURS],
    [null, DEFAULT_PENDING_PAYMENT_TTL_HOURS],
    [100_000, 24 * 30],
  ])('TTL cấu hình %p → dùng %p giờ (không để cấu hình sai huỷ hàng loạt đơn đang chờ chuyển khoản)', async (ttl, hours) => {
    const { cron, prisma } = make({ ttl });
    await cron.expireStale(NOW);
    expect(prisma.order.findMany.mock.calls[0][0].where.createdAt).toEqual({ lt: new Date(NOW.getTime() - (hours as number) * HOUR) });
  });

  it('instance khác đang giữ khoá advisory → bỏ lượt, không quét', async () => {
    const { cron, prisma, orderStatus } = make({ locked: false, orders: [{ id: 'o1', code: 'A' }] });
    const res = await cron.expireStale(NOW);
    expect(res).toEqual({ skipped: 'LOCKED' });
    expect(prisma.order.findMany).not.toHaveBeenCalled();
    expect(orderStatus.setStatus).not.toHaveBeenCalled();
  });

  it('lượt trước chưa xong trong cùng instance → lượt sau bỏ qua', async () => {
    const { cron, orderStatus } = make({ orders: [{ id: 'o1', code: 'A' }] });
    let finish!: () => void;
    orderStatus.setStatus.mockImplementationOnce(
      () => new Promise((r) => (finish = () => r({ id: 'o1', status: 'CANCELLED' }))) as never,
    );
    const first = cron.expireStale(NOW);
    await new Promise((r) => setImmediate(r));
    await expect(cron.expireStale(NOW)).resolves.toEqual({ skipped: 'RUNNING' });
    finish();
    await expect(first).resolves.toMatchObject({ cancelled: 1 });
    // Sau khi lượt đầu xong, lượt mới chạy bình thường.
    await expect(cron.expireStale(NOW)).resolves.toMatchObject({ scanned: 1 });
  });

  it('handleCron nuốt lỗi (cron không được làm sập process)', async () => {
    const { cron, prisma } = make();
    (prisma.$transaction as jest.Mock).mockRejectedValueOnce(new Error('pool exhausted'));
    await expect(cron.handleCron()).resolves.toBeUndefined();
  });
});
