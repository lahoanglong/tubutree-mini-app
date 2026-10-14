import { PancakePushReconcileService } from './pancake-push-reconcile.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { PancakeClient } from './pancake.client';
import type { PancakeOrderService } from './pancake-order.service';
import type { GomdonAlertService } from '../gomdon/gomdon-alert.service';

type Where = { createdAt?: { gte?: Date; lt?: Date }; status?: unknown; pancakeCancelStatus?: unknown; paidAt?: unknown };

/** findMany của test chỉ trả dữ liệu cho truy vấn đẩy đơn tồn (pushStale); các truy vấn theo dõi khác lấy từ `followUps`. */
function mk(
  prisma: { order: Record<string, unknown> } & Record<string, unknown>,
  opts: {
    configured?: boolean;
    enqueuePush?: jest.Mock;
    alert?: jest.Mock;
    followUps?: { overdue?: unknown[]; cancels?: unknown[]; payments?: unknown[] };
  } = {},
) {
  const client = { isConfigured: jest.fn().mockReturnValue(opts.configured ?? true) } as unknown as PancakeClient;
  const enqueuePush = opts.enqueuePush ?? jest.fn().mockResolvedValue(undefined);
  const enqueueCancel = jest.fn().mockResolvedValue(undefined);
  const enqueuePayment = jest.fn().mockResolvedValue(undefined);
  const alert = opts.alert ?? jest.fn().mockResolvedValue(undefined);
  const stale = prisma.order.findMany as jest.Mock | undefined;
  const overdue = jest.fn().mockResolvedValue(opts.followUps?.overdue ?? []);
  const cancels = jest.fn().mockResolvedValue(opts.followUps?.cancels ?? []);
  const payments = jest.fn().mockResolvedValue(opts.followUps?.payments ?? []);
  if (stale) {
    prisma.order.findMany = jest.fn((args: { where: Where }) => {
      const w = args.where;
      if (w.pancakeCancelStatus) return cancels(args);
      if (w.paidAt) return payments(args);
      if (w.createdAt && !w.createdAt.gte) return overdue(args);
      return stale(args);
    });
  }
  const svc = new PancakePushReconcileService(
    prisma as unknown as PrismaService,
    client,
    { enqueuePush, enqueueCancel, enqueuePayment } as unknown as PancakeOrderService,
    { alert } as unknown as GomdonAlertService,
  );
  return { svc, enqueuePush, enqueueCancel, enqueuePayment, alert, overdue, cancels, payments };
}

describe('PancakePushReconcileService.reconcile', () => {
  it('Pancake chưa cấu hình → bỏ qua, không query DB', async () => {
    const findMany = jest.fn();
    const prisma = { order: { findMany } };
    const { svc } = mk(prisma, { configured: false });
    await svc.reconcile();
    expect(prisma.order.findMany).not.toHaveBeenCalled();
  });

  it('không có đơn tồn đọng → không gọi enqueuePush', async () => {
    const { svc, enqueuePush } = mk({ order: { findMany: jest.fn().mockResolvedValue([]) } });
    await svc.reconcile();
    expect(enqueuePush).not.toHaveBeenCalled();
  });

  it('tìm đơn pancakeOrderId=null còn trong kho, 15 phút < tuổi < 72 giờ → re-enqueue từng đơn (PLATFORM-8)', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { id: 'o1', code: 'TUBU1', hasRecyclingPickup: false },
      { id: 'o2', code: 'TUBU2', hasRecyclingPickup: false },
    ]);
    const { svc, enqueuePush } = mk({ order: { findMany } });
    await svc.reconcile();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          pancakeOrderId: null,
          status: { in: ['PENDING_PAYMENT', 'CONFIRMED', 'PACKED'] },
          createdAt: { lt: expect.any(Date), gte: expect.any(Date) },
        }),
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

describe('PancakePushReconcileService.reconcile — đơn đại lý còn backorder (C-011)', () => {
  const old = new Date(Date.now() - 20 * 60_000);
  const base = { createdAt: old, hasRecyclingPickup: false, gomdonOrderId: null, gomdonPartnerCode: null, gomdonStatus: null };

  it('đơn DEALER có item backorderedQty=3, tạo 20 phút trước → KHÔNG enqueuePush', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { ...base, id: 'd1', code: 'DLR1', type: 'DEALER', items: [{ backorderedQty: 0 }, { backorderedQty: 3 }] },
    ]);
    const { svc, enqueuePush } = mk({ order: { findMany } });
    await svc.reconcile();
    expect(enqueuePush).not.toHaveBeenCalled();
  });

  it('đơn DEALER đã đủ hàng (backorderedQty=0 hết) → vẫn re-enqueue', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { ...base, id: 'd2', code: 'DLR2', type: 'DEALER', items: [{ backorderedQty: 0 }] },
    ]);
    const { svc, enqueuePush } = mk({ order: { findMany } });
    await svc.reconcile();
    expect(enqueuePush).toHaveBeenCalledWith('d2');
  });

  it('đơn khách lẻ giữ hành vi cũ: vẫn re-enqueue dù item có backorderedQty > 0', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { ...base, id: 'r1', code: 'TUBU1', type: 'RETAIL', items: [{ backorderedQty: 2 }] },
    ]);
    const { svc, enqueuePush } = mk({ order: { findMany } });
    await svc.reconcile();
    expect(enqueuePush).toHaveBeenCalledWith('r1');
  });

  it('truy vấn loại đơn DEALER còn backorder ngay ở where (không chiếm lô BATCH_SIZE)', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const { svc } = mk({ order: { findMany } });
    await svc.reconcile();
    expect(findMany.mock.calls[0][0].where.AND).toContainEqual({
      NOT: { type: 'DEALER', items: { some: { backorderedQty: { gt: 0 } } } },
    });
  });
});

describe('PancakePushReconcileService.reconcile — đơn cũ, huỷ, thanh toán (PLATFORM-1, PLATFORM-8, PANCAKE-2)', () => {
  it('trả trước qua cổng chưa PAID không chiếm lô (chờ tiền); chuyển khoản chưa PAID vẫn được đẩy', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const { svc } = mk({ order: { findMany } });
    await svc.reconcile();
    const not = findMany.mock.calls[0][0].where.AND[1].NOT;
    expect(not.paymentStatus).toEqual({ not: 'PAID' });
    expect(not.paymentMethod.in).toEqual(expect.arrayContaining(['ZALOPAY', 'WALLET']));
    expect(not.paymentMethod.in).not.toContain('BANK_TRANSFER');
  });

  it('đơn còn mở quá 72 giờ chưa lên Pancake → STALE + "Cần xử lý Pancake" (không tự đẩy đơn cũ)', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const { svc, enqueuePush, alert, overdue } = mk(
      { order: { findMany: jest.fn().mockResolvedValue([]), updateMany } },
      { followUps: { overdue: [{ id: 'o9', code: 'TUBU9', createdAt: new Date('2026-10-01') }] } },
    );
    await svc.reconcile();
    expect(overdue.mock.calls[0][0].where.createdAt.lt.getTime()).toBeLessThanOrEqual(Date.now() - 72 * 3_600_000);
    expect(updateMany).toHaveBeenCalledWith({ where: { id: 'o9', pancakeOrderId: null }, data: { pancakePushStatus: 'STALE' } });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ pancakeAttention: expect.stringContaining('KHÔNG tự đẩy nữa') }) }),
    );
    expect(alert).toHaveBeenCalledTimes(1);
    expect(enqueuePush).not.toHaveBeenCalled();
  });

  it('đơn huỷ chờ huỷ bên Pancake (PENDING/FAILED) → xếp lại job huỷ; cửa sổ tính theo ngày đặt', async () => {
    const { svc, enqueueCancel, cancels } = mk(
      { order: { findMany: jest.fn().mockResolvedValue([]) } },
      { followUps: { cancels: [{ id: 'c1', code: 'TUBU7' }] } },
    );
    await svc.reconcile();
    expect(cancels.mock.calls[0][0].where).toMatchObject({ status: 'CANCELLED', pancakeCancelStatus: { in: ['PENDING', 'FAILED'] } });
    expect(cancels.mock.calls[0][0].where.createdAt.gte).toBeInstanceOf(Date);
    expect(enqueueCancel).toHaveBeenCalledWith('c1');
  });

  it('đơn đã lên Pancake, nay PAID mà Pancake chưa biết → xếp job "đã thanh toán"', async () => {
    const { svc, enqueuePayment, payments } = mk(
      { order: { findMany: jest.fn().mockResolvedValue([]) } },
      { followUps: { payments: [{ id: 'p1', code: 'TUBU8' }] } },
    );
    await svc.reconcile();
    expect(payments.mock.calls[0][0].where).toMatchObject({ pancakeOrderId: { not: null }, pancakePaymentSynced: false, paymentStatus: 'PAID' });
    expect(enqueuePayment).toHaveBeenCalledWith('p1');
  });

  it('không quét đơn đối tác tự giao (D4): đơn đó không bao giờ có pancakeOrderId', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const { svc } = mk({ order: { findMany } });
    await svc.reconcile();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ fulfiller: 'TUBU' }) }),
    );
  });
});
