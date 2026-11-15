import type { Queue } from 'bullmq';
import { GomdonWasteReconcileService } from './gomdon-waste-reconcile.service';
import type { PrismaService } from '../../../prisma/prisma.service';

const mockEnqueue = jest.fn();
jest.mock('./gomdon-queue', () => ({ enqueueGomdonWastePush: (...a: unknown[]) => mockEnqueue(...a) }));

function build(rows: { id: string; code: string }[] = []) {
  const findMany = jest.fn().mockResolvedValue(rows);
  const prisma = { wasteRequest: { findMany } };
  const queue = { name: 'q' };
  const svc = new GomdonWasteReconcileService(prisma as unknown as PrismaService, queue as unknown as Queue);
  return { svc, findMany, queue };
}

beforeEach(() => {
  mockEnqueue.mockReset().mockResolvedValue(undefined);
  jest.useFakeTimers().setSystemTime(new Date('2026-11-15T10:00:00.000Z'));
});
afterEach(() => jest.useRealTimers());

describe('GomdonWasteReconcileService.redrivePushes', () => {
  it('chỉ lấy phiếu HOME_PICKUP còn OPEN, chưa có vận đơn nào, chưa từng claim, tạo quá 15 phút, cũ nhất trước, tối đa 50', async () => {
    const { svc, findMany } = build();
    await svc.redrivePushes();
    expect(findMany).toHaveBeenCalledWith({
      where: {
        method: 'HOME_PICKUP',
        status: 'OPEN',
        gomdonOrderId: null,
        gomdonPartnerCode: null,
        gomdonStatus: null,
        createdAt: { lt: new Date('2026-11-15T09:45:00.000Z') },
      },
      select: { id: true, code: true },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
  });

  it('xếp lại job tạo vận đơn theo mã phiếu cho từng phiếu và trả số phiếu', async () => {
    const { svc, queue } = build([{ id: 'r1', code: 'TR-AAAAA' }, { id: 'r2', code: 'TR-BBBBB' }]);
    await expect(svc.redrivePushes()).resolves.toBe(2);
    expect(mockEnqueue).toHaveBeenNthCalledWith(1, queue, 'r1', 'TR-AAAAA');
    expect(mockEnqueue).toHaveBeenNthCalledWith(2, queue, 'r2', 'TR-BBBBB');
  });

  it('một phiếu xếp job lỗi (Redis) không chặn phiếu sau', async () => {
    const { svc } = build([{ id: 'r1', code: 'TR-AAAAA' }, { id: 'r2', code: 'TR-BBBBB' }]);
    mockEnqueue.mockRejectedValueOnce(new Error('redis down'));
    await expect(svc.redrivePushes()).resolves.toBe(2);
    expect(mockEnqueue).toHaveBeenCalledTimes(2);
  });
});

describe('GomdonWasteReconcileService.escalateStuckCreating', () => {
  it('lấy phiếu kẹt CREATING quá 30 phút mà vẫn chưa có mã vận đơn nào', async () => {
    const { svc, findMany } = build([{ id: 'r1', code: 'TR-AAAAA' }]);
    await expect(svc.escalateStuckCreating()).resolves.toBe(1);
    expect(findMany.mock.calls[0]![0].where).toEqual({
      method: 'HOME_PICKUP',
      gomdonStatus: 'CREATING',
      gomdonOrderId: null,
      gomdonPartnerCode: null,
      updatedAt: { lt: new Date('2026-11-15T09:30:00.000Z') },
    });
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
  });
});

describe('GomdonWasteReconcileService.reconcile', () => {
  it('bước đầu lỗi không chặn bước sau, lỗi được nuốt (cron không ném unhandledRejection)', async () => {
    const { svc, findMany } = build();
    findMany.mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce([]);
    await expect(svc.reconcile()).resolves.toBeUndefined();
    expect(findMany).toHaveBeenCalledTimes(2);
  });
});
