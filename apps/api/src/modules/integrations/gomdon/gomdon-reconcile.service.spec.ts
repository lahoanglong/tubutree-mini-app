import type { Queue } from 'bullmq';
import { GomdonReconcileService } from './gomdon-reconcile.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { GomdonOrderService } from './gomdon-order.service';
import type { GomdonClient } from './gomdon.client';

function build() {
  const prisma = {
    gomdonWebhookEvent: { findMany: jest.fn().mockResolvedValue([]) },
    order: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const gomdonOrder = {
    enqueuePush: jest.fn().mockResolvedValue(undefined),
    enqueueCancel: jest.fn().mockResolvedValue(undefined),
  };
  const eventsQueue = { getJob: jest.fn().mockResolvedValue(undefined), add: jest.fn().mockResolvedValue({}) };
  const client = { probeRejectedLogin: jest.fn().mockResolvedValue(undefined) };
  const svc = new GomdonReconcileService(
    prisma as unknown as PrismaService,
    gomdonOrder as unknown as GomdonOrderService,
    eventsQueue as unknown as Queue,
    client as unknown as GomdonClient,
  );
  return { svc, prisma, gomdonOrder, eventsQueue, client };
}

describe('GomdonReconcileService', () => {
  it('event webhook kẹt RECEIVED/FAILED → enqueue lại (xoá job completed/failed cùng jobId)', async () => {
    const { svc, prisma, eventsQueue } = build();
    prisma.gomdonWebhookEvent.findMany.mockResolvedValueOnce([{ id: 'ev1' }]);
    const remove = jest.fn();
    eventsQueue.getJob.mockResolvedValueOnce({ getState: jest.fn().mockResolvedValue('failed'), remove });
    await svc.redriveEvents();
    const where = prisma.gomdonWebhookEvent.findMany.mock.calls[0][0].where;
    expect(where.status).toEqual({ in: ['RECEIVED', 'FAILED'] });
    expect(where.attempts).toEqual({ lt: GomdonReconcileService.MAX_EVENT_ATTEMPTS });
    expect(remove).toHaveBeenCalled();
    expect(eventsQueue.add).toHaveBeenCalledWith('process', { eventId: 'ev1' }, { jobId: 'ev1' });
  });

  it('đơn thu gom chưa từng tạo vận đơn (enqueue lúc checkout lỗi) hoặc đã PAID mà còn AWAITING_PAYMENT → enqueue tạo vận đơn', async () => {
    const { svc, prisma, gomdonOrder } = build();
    prisma.order.findMany.mockResolvedValueOnce([{ id: 'o1', code: 'TUBU1' }]);
    await svc.redrivePushes();
    const where = prisma.order.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ hasRecyclingPickup: true, gomdonOrderId: null, gomdonPartnerCode: null });
    expect(where.status).toEqual({ notIn: ['CANCELLED', 'RETURNED'] });
    expect(where.OR).toEqual([{ gomdonStatus: null }, { gomdonStatus: 'AWAITING_PAYMENT', paymentStatus: 'PAID' }]);
    expect(gomdonOrder.enqueuePush).toHaveBeenCalledWith('o1');
  });

  it('CREATING quá hạn → enqueue (pushOrder chuyển NEEDS_MANUAL_CHECK, không tạo lại)', async () => {
    const { svc, prisma, gomdonOrder } = build();
    prisma.order.findMany.mockResolvedValueOnce([{ id: 'o2', code: 'TUBU2' }]);
    await svc.escalateStuckCreating();
    expect(prisma.order.findMany.mock.calls[0][0].where.gomdonStatus).toBe('CREATING');
    expect(gomdonOrder.enqueuePush).toHaveBeenCalledWith('o2');
  });

  it('CREATING kẹt: bỏ đơn đã huỷ/trả (lo ở luồng huỷ) + cũ nhất trước (đơn kẹt không chiếm hết lô)', async () => {
    const { svc, prisma } = build();
    await svc.escalateStuckCreating();
    const args = prisma.order.findMany.mock.calls[0][0];
    expect(args.where.status).toEqual({ notIn: ['CANCELLED', 'RETURNED'] });
    expect(args.orderBy).toEqual({ updatedAt: 'asc' });
  });

  it('đơn đã huỷ còn vận đơn chưa xử lý huỷ → enqueue huỷ', async () => {
    const { svc, prisma, gomdonOrder } = build();
    prisma.order.findMany.mockResolvedValueOnce([{ id: 'o3', code: 'TUBU3' }]);
    await svc.redriveCancels();
    expect(prisma.order.findMany.mock.calls[0][0].where).toMatchObject({ status: 'CANCELLED', gomdonCancelStatus: null });
    expect(gomdonOrder.enqueueCancel).toHaveBeenCalledWith('o3');
  });

  it('huỷ còn treo: vận đơn chỉ có mã BestExpress (thiếu id số) cũng tính là CÓ vận đơn', async () => {
    const { svc, prisma } = build();
    await svc.redriveCancels();
    expect(prisma.order.findMany.mock.calls[0][0].where.OR).toEqual(
      expect.arrayContaining([
        { gomdonOrderId: { not: null } },
        { gomdonPartnerCode: { not: null } },
        { gomdonStatus: 'NEEDS_MANUAL_CHECK' },
        // Đơn huỷ sau "Đã xử lý tay" / kẹt CREATING cũng phải qua cancelOnGomdon (mở lại kiểm tra tay).
        { gomdonStatus: 'MANUAL_HANDLED' },
        { gomdonStatus: 'CREATING' },
      ]),
    );
  });

  it('một bước lỗi (DB) không chặn các bước sau và KHÔNG ném ra ngoài @Cron', async () => {
    const { svc, prisma, gomdonOrder } = build();
    prisma.gomdonWebhookEvent.findMany.mockRejectedValueOnce(new Error('db down'));
    prisma.order.findMany
      .mockResolvedValueOnce([{ id: 'o1', code: 'TUBU1' }]) // push
      .mockResolvedValueOnce([]) // creating
      .mockResolvedValueOnce([{ id: 'o3', code: 'TUBU3' }]) // cancel chưa xử lý
      .mockResolvedValueOnce([]); // cancel FAILED tự thử lại
    await expect(svc.reconcile()).resolves.toBeUndefined();
    expect(gomdonOrder.enqueuePush).toHaveBeenCalledWith('o1');
    expect(gomdonOrder.enqueueCancel).toHaveBeenCalledWith('o3');
  });

  it('enqueue một đơn lỗi không chặn đơn khác', async () => {
    const { svc, prisma, gomdonOrder } = build();
    prisma.order.findMany.mockResolvedValueOnce([
      { id: 'o1', code: 'TUBU1' },
      { id: 'o2', code: 'TUBU2' },
    ]);
    gomdonOrder.enqueuePush.mockRejectedValueOnce(new Error('redis'));
    await svc.redrivePushes();
    expect(gomdonOrder.enqueuePush).toHaveBeenCalledWith('o2');
  });
  it('UAT GOMDON-1: huỷ vận đơn FAILED do lỗi tạm, vận đơn còn huỷ được (1/10), trong cửa sổ → cron xếp lại job huỷ', async () => {
    const { svc, prisma, gomdonOrder } = build();
    prisma.order.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'o9', code: 'TUBU9' }]);
    await svc.redriveCancels();
    const where = prisma.order.findMany.mock.calls[1][0].where;
    expect(where).toMatchObject({
      hasRecyclingPickup: true,
      status: 'CANCELLED',
      gomdonCancelStatus: 'FAILED',
      gomdonOrderId: { not: null },
      gomdonStatus: { in: ['1', '10'] },
    });
    expect(where.gomdonCancelRetrySince.gt).toBeInstanceOf(Date);
    expect(where.updatedAt.lt).toBeInstanceOf(Date);
    expect(gomdonOrder.enqueueCancel).toHaveBeenCalledWith('o9');
  });

  it('UAT GOMDON-1: Gomdon đang từ chối tài khoản → cron thử đăng nhập lại thưa thớt (tự bật lại thu gom khi hết lỗi)', async () => {
    const { svc, client } = build();
    await svc.reconcile();
    expect(client.probeRejectedLogin).toHaveBeenCalledWith(GomdonReconcileService.LOGIN_PROBE_MINUTES * 60_000);
  });
});
