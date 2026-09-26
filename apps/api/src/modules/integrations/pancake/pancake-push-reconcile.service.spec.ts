import { PancakePushReconcileService } from './pancake-push-reconcile.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { PancakeClient } from './pancake.client';
import type { PancakeOrderService } from './pancake-order.service';
import type { GomdonAlertService } from '../gomdon/gomdon-alert.service';

function mk(
  prisma: Record<string, unknown>,
  opts: { configured?: boolean; enqueuePush?: jest.Mock; alert?: jest.Mock } = {},
) {
  const client = { isConfigured: jest.fn().mockReturnValue(opts.configured ?? true) } as unknown as PancakeClient;
  const enqueuePush = opts.enqueuePush ?? jest.fn().mockResolvedValue(undefined);
  const alert = opts.alert ?? jest.fn().mockResolvedValue(undefined);
  const svc = new PancakePushReconcileService(
    prisma as unknown as PrismaService,
    client,
    { enqueuePush } as unknown as PancakeOrderService,
    { alert } as unknown as GomdonAlertService,
  );
  return { svc, enqueuePush, alert };
}

describe('PancakePushReconcileService.reconcile', () => {
  it('Pancake chưa cấu hình → bỏ qua, không query DB', async () => {
    const findMany = jest.fn();
    const { svc } = mk({ order: { findMany } }, { configured: false });
    await svc.reconcile();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('không có đơn tồn đọng → không gọi enqueuePush', async () => {
    const { svc, enqueuePush } = mk({ order: { findMany: jest.fn().mockResolvedValue([]) } });
    await svc.reconcile();
    expect(enqueuePush).not.toHaveBeenCalled();
  });

  it('tìm đơn pancakeOrderId=null, status khác CANCELLED, cũ hơn 15 phút → re-enqueue từng đơn', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { id: 'o1', code: 'TUBU1', hasRecyclingPickup: false },
      { id: 'o2', code: 'TUBU2', hasRecyclingPickup: false },
    ]);
    const { svc, enqueuePush } = mk({ order: { findMany } });
    await svc.reconcile();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ pancakeOrderId: null, status: { notIn: ['CANCELLED'] } }),
        take: PancakePushReconcileService.BATCH_SIZE,
      }),
    );
    expect(enqueuePush).toHaveBeenCalledWith('o1');
    expect(enqueuePush).toHaveBeenCalledWith('o2');
    expect(enqueuePush).toHaveBeenCalledTimes(2);
  });

  it('đơn thu gom còn chờ Gomdon (null/CREATING) < 60 phút → KHÔNG đẩy Pancake (GomdonReconcileService lo)', async () => {
    const recent = new Date(Date.now() - 20 * 60_000);
    const findMany = jest.fn().mockResolvedValue([
      { id: 'o1', code: 'TUBU1', createdAt: recent, hasRecyclingPickup: true, gomdonOrderId: null, gomdonPartnerCode: null, gomdonStatus: null },
      { id: 'o2', code: 'TUBU2', createdAt: recent, hasRecyclingPickup: true, gomdonOrderId: null, gomdonPartnerCode: null, gomdonStatus: 'CREATING' },
    ]);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const { svc, enqueuePush, alert } = mk({ order: { findMany, updateMany } });
    await svc.reconcile();
    expect(enqueuePush).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
  });

  it('đơn thu gom COD kẹt > 60 phút (vd job Gomdon đã COMPLETED mà không làm gì) → chốt FAILED có guard, BÁO ADMIN, RỒI đẩy Pancake', async () => {
    const old = new Date(Date.now() - 90 * 60_000);
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'o1', code: 'TUBU1', createdAt: old, hasRecyclingPickup: true, gomdonOrderId: null, gomdonPartnerCode: null, gomdonStatus: null,
        paymentMethod: 'COD', paymentStatus: 'UNPAID',
      },
    ]);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const { svc, enqueuePush, alert } = mk({ order: { findMany, updateMany } });
    await svc.reconcile();
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', gomdonOrderId: null, gomdonPartnerCode: null, gomdonStatus: null },
      data: { gomdonStatus: 'FAILED' },
    });
    // Chốt trạng thái TRƯỚC khi đẩy Pancake (note Pancake đọc trạng thái đã chốt).
    expect(updateMany.mock.invocationCallOrder[0]).toBeLessThan(enqueuePush.mock.invocationCallOrder[0]!);
    expect(enqueuePush).toHaveBeenCalledWith('o1');
    expect(alert).toHaveBeenCalledWith('TUBU1', expect.stringContaining('TẠO VẬN ĐƠN TAY'));
  });

  it('CREATING kẹt > 60 phút → NEEDS_MANUAL_CHECK có guard + báo KIỂM TRA GOMDON trước khi tạo tay', async () => {
    const old = new Date(Date.now() - 90 * 60_000);
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'o1', code: 'TUBU1', createdAt: old, hasRecyclingPickup: true, gomdonOrderId: null, gomdonPartnerCode: null, gomdonStatus: 'CREATING',
        paymentMethod: 'COD', paymentStatus: 'UNPAID',
      },
    ]);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const { svc, enqueuePush, alert } = mk({ order: { findMany, updateMany } });
    await svc.reconcile();
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', gomdonOrderId: null, gomdonPartnerCode: null, gomdonStatus: 'CREATING' },
      data: { gomdonStatus: 'NEEDS_MANUAL_CHECK' },
    });
    expect(enqueuePush).toHaveBeenCalledWith('o1');
    expect(alert).toHaveBeenCalledWith('TUBU1', expect.stringContaining('KIỂM TRA GOMDON'));
  });

  it('trả trước CHƯA thanh toán kẹt > 60 phút → AWAITING_PAYMENT (không FAILED) để tiền về vẫn tự đặt vận đơn; không báo động', async () => {
    const old = new Date(Date.now() - 90 * 60_000);
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'o1', code: 'TUBU1', createdAt: old, hasRecyclingPickup: true, gomdonOrderId: null, gomdonPartnerCode: null, gomdonStatus: null,
        status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID',
      },
    ]);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const { svc, enqueuePush, alert } = mk({ order: { findMany, updateMany } });
    await svc.reconcile();
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', gomdonOrderId: null, gomdonPartnerCode: null, gomdonStatus: null },
      data: { gomdonStatus: 'AWAITING_PAYMENT' },
    });
    expect(updateMany.mock.calls.some(([a]) => a.data.gomdonStatus === 'FAILED')).toBe(false);
    // Pancake vẫn phải có đơn để đối soát chuyển khoản.
    expect(enqueuePush).toHaveBeenCalledWith('o1');
    expect(alert).not.toHaveBeenCalled();
  });

  it('guard thua (count=0, tiến trình khác vừa đổi trạng thái) → không báo động', async () => {
    const old = new Date(Date.now() - 90 * 60_000);
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'o1', code: 'TUBU1', createdAt: old, hasRecyclingPickup: true, gomdonOrderId: null, gomdonPartnerCode: null, gomdonStatus: null,
        paymentMethod: 'COD', paymentStatus: 'UNPAID',
      },
    ]);
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const { svc, alert } = mk({ order: { findMany, updateMany } });
    await svc.reconcile();
    expect(alert).not.toHaveBeenCalled();
  });

  it('đơn thu gom đã có mã Gomdon / đã chốt FAILED / NOT_CONFIGURED / AWAITING_PAYMENT → đẩy Pancake bình thường', async () => {
    const recent = new Date(Date.now() - 20 * 60_000);
    const findMany = jest.fn().mockResolvedValue([
      { id: 'o2', code: 'TUBU2', createdAt: recent, hasRecyclingPickup: true, gomdonOrderId: '1', gomdonPartnerCode: 'GOM123', gomdonStatus: '1' },
      { id: 'o3', code: 'TUBU3', createdAt: recent, hasRecyclingPickup: true, gomdonOrderId: null, gomdonPartnerCode: null, gomdonStatus: 'FAILED' },
      { id: 'o4', code: 'TUBU4', createdAt: recent, hasRecyclingPickup: true, gomdonOrderId: null, gomdonPartnerCode: null, gomdonStatus: 'NOT_CONFIGURED' },
      { id: 'o5', code: 'TUBU5', createdAt: recent, hasRecyclingPickup: true, gomdonOrderId: null, gomdonPartnerCode: null, gomdonStatus: 'AWAITING_PAYMENT' },
    ]);
    const updateMany = jest.fn();
    const { svc, enqueuePush, alert } = mk({ order: { findMany, updateMany } });
    await svc.reconcile();
    expect(enqueuePush.mock.calls.map((c) => c[0])).toEqual(['o2', 'o3', 'o4', 'o5']);
    expect(updateMany).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
  });

  it('1 đơn enqueue lỗi → vẫn tiếp tục re-enqueue các đơn còn lại (không dừng cả batch)', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { id: 'o1', code: 'TUBU1', hasRecyclingPickup: false },
      { id: 'o2', code: 'TUBU2', hasRecyclingPickup: false },
    ]);
    const enqueuePush = jest.fn().mockRejectedValueOnce(new Error('redis down')).mockResolvedValueOnce(undefined);
    const { svc } = mk({ order: { findMany } }, { enqueuePush });
    await svc.reconcile();
    expect(enqueuePush).toHaveBeenCalledTimes(2);
  });
});
