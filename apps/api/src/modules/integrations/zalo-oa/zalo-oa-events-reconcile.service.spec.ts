import { Logger } from '@nestjs/common';
import { ZaloOaEventsReconcileService } from './zalo-oa-events-reconcile.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { Queue } from 'bullmq';

const NOW = new Date('2026-10-28T10:00:00Z');
const MIN = 60_000;

function setup(opts: { rows?: { id: string }[]; locked?: boolean; addImpl?: jest.Mock } = {}) {
  const findMany = jest.fn().mockResolvedValue(opts.rows ?? []);
  const tx = { $queryRaw: jest.fn().mockResolvedValue([{ locked: opts.locked ?? true }]) };
  const prisma = {
    oaInboundMessage: { findMany },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as PrismaService;
  const add = opts.addImpl ?? jest.fn().mockResolvedValue(undefined);
  const queue = { name: 'zalo-oa-events', getJob: jest.fn().mockResolvedValue(null), add } as unknown as Queue;
  return { svc: new ZaloOaEventsReconcileService(prisma, queue), findMany, add, queue, tx };
}

describe('ZaloOaEventsReconcileService.redriveEvents', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it('chỉ tìm tin RECEIVED quá 5 phút và không quá 24 giờ, cũ nhất trước', async () => {
    const { svc, findMany } = setup();
    await svc.redriveEvents(NOW);
    const arg = findMany.mock.calls[0][0];
    expect(arg.where.status).toBe('RECEIVED');
    expect(arg.where.createdAt.lt).toEqual(new Date(NOW.getTime() - 5 * MIN));
    expect(arg.where.createdAt.gte).toEqual(new Date(NOW.getTime() - 24 * 60 * MIN));
    expect(arg.orderBy).toEqual({ createdAt: 'asc' });
    expect(arg.take).toBe(ZaloOaEventsReconcileService.BATCH_SIZE);
  });

  it('tin RECEIVED quá 5 phút → xếp lại đúng một lần, jobId = id tin, cùng tên job với webhook', async () => {
    const { svc, add } = setup({ rows: [{ id: 'e1' }] });
    expect(await svc.redriveEvents(NOW)).toEqual({ enqueued: 1 });
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith('process', { eventId: 'e1' }, { jobId: 'e1' });
  });

  it('job cũ cùng jobId đã completed → gỡ rồi add lại (không bị BullMQ nuốt)', async () => {
    const { svc, queue, add } = setup({ rows: [{ id: 'e1' }] });
    const remove = jest.fn();
    (queue.getJob as jest.Mock).mockResolvedValue({ getState: async () => 'completed', remove });
    await svc.redriveEvents(NOW);
    expect(remove).toHaveBeenCalled();
    expect(add).toHaveBeenCalledTimes(1);
  });

  it('không có tin kẹt → không enqueue', async () => {
    const { svc, add } = setup();
    expect(await svc.redriveEvents(NOW)).toEqual({ enqueued: 0 });
    expect(add).not.toHaveBeenCalled();
  });

  it('một tin enqueue lỗi → các tin còn lại vẫn được xếp, không ném ra ngoài', async () => {
    const add = jest.fn().mockRejectedValueOnce(new Error('redis down')).mockResolvedValue(undefined);
    const { svc } = setup({ rows: [{ id: 'e1' }, { id: 'e2' }], addImpl: add });
    expect(await svc.redriveEvents(NOW)).toEqual({ enqueued: 1 });
    expect(add).toHaveBeenCalledTimes(2);
  });

  it('instance khác đang giữ khoá → bỏ qua, không quét', async () => {
    const { svc, findMany, add } = setup({ locked: false, rows: [{ id: 'e1' }] });
    expect(await svc.redriveEvents(NOW)).toEqual({ skipped: 'LOCKED' });
    expect(findMany).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it('lượt trước còn chạy → bỏ qua lượt chồng', async () => {
    const { svc, findMany } = setup();
    (svc as unknown as { running: boolean }).running = true;
    expect(await svc.redriveEvents(NOW)).toEqual({ skipped: 'RUNNING' });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('reconcile() không ném lỗi ra ngoài khi DB lỗi (tránh unhandledRejection làm sập API)', async () => {
    const { svc, findMany } = setup();
    findMany.mockRejectedValue(new Error('db down'));
    await expect(svc.reconcile()).resolves.toBeUndefined();
  });
});
