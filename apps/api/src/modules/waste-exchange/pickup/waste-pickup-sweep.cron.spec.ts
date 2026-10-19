import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeWasteEvent } from '../core/waste-events';
import { WastePickupHooks } from './waste-pickup-hooks.service';
import { WastePickupSweepCron } from './waste-pickup-sweep.cron';

jest.mock('../core/waste-events', () => ({ writeWasteEvent: jest.fn().mockResolvedValue({ id: 'ev1' }) }));

const rows = [
  { id: 'r1', orderId: 'o1', order: { status: 'CANCELLED' } },
  { id: 'r2', orderId: 'o2', order: { status: 'DELIVERED' } },
  { id: 'r3', orderId: 'o3', order: { status: 'RETURNED' } },
];

function setup(o: { locked?: boolean; outcomes?: Record<string, string>; throwFor?: string } = {}) {
  const findMany = jest.fn().mockResolvedValueOnce(rows).mockResolvedValue([]);
  const tx = { $queryRaw: jest.fn().mockResolvedValue([{ locked: o.locked ?? true }]) };
  const prisma = { wasteRequest: { findMany }, $transaction: jest.fn(async (cb: (t: unknown) => unknown) => cb(tx)) };
  const apply = (orderId: string) => {
    if (o.throwFor === orderId) return Promise.reject(new Error('db'));
    return Promise.resolve(o.outcomes?.[orderId] ?? 'APPLIED');
  };
  const hooks = { applyOrderCancelled: jest.fn(apply), applyOrderDelivered: jest.fn(apply) };
  return { cron: new WastePickupSweepCron(prisma as never, hooks as never), findMany, hooks, tx };
}

describe('WastePickupSweepCron.run (§12.2 bước 3, quét bù)', () => {
  it('quét từ phía yêu cầu: OPEN có orderId, đơn CANCELLED/DELIVERED/RETURNED; không lọc deliveredEffectsAt, không cửa sổ ngày', async () => {
    const { cron, findMany } = setup();
    await cron.run();
    expect(findMany.mock.calls[0]![0]).toEqual({
      where: { status: 'OPEN', orderId: { not: null }, order: { is: { status: { in: ['CANCELLED', 'DELIVERED', 'RETURNED'] } } } },
      select: { id: true, orderId: true, order: { select: { status: true } } },
      orderBy: { id: 'asc' },
      take: 200,
    });
  });

  it('CANCELLED → applyOrderCancelled; DELIVERED và RETURNED → applyOrderDelivered; đếm theo kết quả', async () => {
    const { cron, hooks } = setup();
    await expect(cron.run()).resolves.toEqual({ cancelled: 1, started: 2, anomalies: 0 });
    expect(hooks.applyOrderCancelled).toHaveBeenCalledWith('o1');
    expect(hooks.applyOrderDelivered.mock.calls.map((c) => c[0])).toEqual(['o2', 'o3']);
  });

  it('ANOMALY đếm vào anomalies, SKIPPED và NO_REQUEST không đếm', async () => {
    const { cron } = setup({ outcomes: { o1: 'ANOMALY', o2: 'SKIPPED', o3: 'NO_REQUEST' } });
    await expect(cron.run()).resolves.toEqual({ cancelled: 0, started: 0, anomalies: 1 });
  });

  it('một dòng lỗi không chặn dòng sau', async () => {
    const { cron, hooks } = setup({ throwFor: 'o1' });
    await expect(cron.run()).resolves.toEqual({ cancelled: 0, started: 2, anomalies: 0 });
    expect(hooks.applyOrderDelivered).toHaveBeenCalledTimes(2);
  });

  it('không lấy được try-lock → không quét, trả số 0', async () => {
    const { cron, findMany, tx } = setup({ locked: false });
    await expect(cron.run()).resolves.toEqual({ cancelled: 0, started: 0, anomalies: 0 });
    expect(findMany).not.toHaveBeenCalled();
    expect((tx.$queryRaw.mock.calls[0]![0] as string[]).join('?')).toContain(`pg_try_advisory_xact_lock(hashtext('cron:waste.pickup_sweep'))`);
  });

  it('đang chạy trong tiến trình → lần gọi chồng trả số 0, chỉ quét một lần', async () => {
    const { cron, findMany, tx } = setup();
    const [a, b] = await Promise.all([cron.run(), cron.run()]);
    expect([a, b]).toContainEqual({ cancelled: 0, started: 0, anomalies: 0 });
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('trang đủ 200 dòng → đọc trang sau với id > id cuối; trang thiếu thì dừng', async () => {
    const page1 = Array.from({ length: 200 }, (_, i) => ({ id: `r${String(i).padStart(3, '0')}`, orderId: `o${i}`, order: { status: 'DELIVERED' } }));
    const { cron, findMany } = setup();
    findMany.mockReset().mockResolvedValueOnce(page1).mockResolvedValueOnce([{ id: 'r999', orderId: 'o999', order: { status: 'CANCELLED' } }]).mockResolvedValue([]);
    await expect(cron.run()).resolves.toEqual({ cancelled: 1, started: 200, anomalies: 0 });
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany.mock.calls[1]![0].where).toEqual({
      AND: [{ status: 'OPEN', orderId: { not: null }, order: { is: { status: { in: ['CANCELLED', 'DELIVERED', 'RETURNED'] } } } }, { id: { gt: 'r199' } }],
    });
  });

  it('lịch 5 phút, timeZone CRON_TZ; không dùng lại bộ lọc việc sau giao', () => {
    const src = readFileSync(join(__dirname, 'waste-pickup-sweep.cron.ts'), 'utf-8');
    expect(src).toContain(`@Cron('0 */5 * * * *', { name: 'waste.pickup-sweep', timeZone: CRON_TZ })`);
    expect(src).not.toContain('deliveredEffects');
  });
});

describe('hook hỏng thì quét bù làm nốt, kể cả đơn đã có deliveredEffectsAt (§17.3)', () => {
  it('lần hook đầu lỗi DB; lượt quét sau đưa yêu cầu sang IN_TRANSIT với hạn tính từ deliveredAt thật', async () => {
    const deliveredAt = new Date('2026-10-20T03:00:00.000Z');
    const updateMany = jest.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValue({ count: 1 });
    const prisma: Record<string, unknown> = {
      order: { findUnique: jest.fn().mockResolvedValue({ status: 'DELIVERED', deliveredAt, deliveredEffectsAt: new Date('2026-10-20T03:00:05.000Z') }) },
      wasteRequest: {
        findUnique: jest.fn().mockResolvedValue({ id: 'r1', code: 'TR-ABC23', userId: 'u1', status: 'OPEN' }),
        findMany: jest.fn().mockResolvedValueOnce([{ id: 'r1', orderId: 'o1', order: { status: 'DELIVERED' } }]).mockResolvedValue([]),
        updateMany,
      },
      $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
    };
    prisma.$transaction = jest.fn(async (cb: (tx: unknown) => unknown) => cb(prisma));
    const notifier = { pickupStarted: jest.fn().mockResolvedValue(undefined), pickupCancelled: jest.fn() };
    const hooks = new WastePickupHooks(prisma as never, { snapshot: jest.fn().mockResolvedValue({ pickupWaitDays: 14 }) } as never, notifier as never);
    await expect(hooks.onOrderDelivered('o1')).resolves.toBeUndefined();
    expect(notifier.pickupStarted).not.toHaveBeenCalled();
    await expect(new WastePickupSweepCron(prisma as never, hooks).run()).resolves.toEqual({ cancelled: 0, started: 1, anomalies: 0 });
    expect(updateMany.mock.calls[1]![0].data.expiresAt).toEqual(new Date('2026-11-03T03:00:00.000Z'));
    expect(writeWasteEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'PICKUP_STARTED', actorRole: 'SYSTEM' }));
    expect(notifier.pickupStarted).toHaveBeenCalledTimes(1);
  });
});
