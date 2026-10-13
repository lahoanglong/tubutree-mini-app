import { GomdonAlertService, GOMDON_ALERT_TEMPLATE } from './gomdon-alert.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { NotificationsService } from '../../notifications/notifications.service';

function build(opts: { order?: { id: string } | null; openSame?: boolean } = {}) {
  const prisma = {
    order: { findUnique: jest.fn().mockResolvedValue(opts.order === undefined ? { id: 'o1' } : opts.order) },
    gomdonAlert: {
      findFirst: jest.fn().mockResolvedValue(opts.openSame ? { id: 'a0' } : null),
      create: jest.fn().mockResolvedValue({ id: 'a1' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'admin1' }, { id: 'admin2' }]) },
    $executeRaw: jest.fn().mockResolvedValue(1),
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) => fn(prisma));
  const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
  const svc = new GomdonAlertService(prisma as unknown as PrismaService, notifications as unknown as NotificationsService);
  return { svc, prisma, notifications };
}

describe('GomdonAlertService (UAT GOMDON-2: báo động phải xem lại được trên web admin)', () => {
  it('lưu báo động vào gomdon_alerts gắn đơn rồi mới gửi in-app tới ADMIN', async () => {
    const { svc, prisma, notifications } = build();
    await svc.alert('TUBU1', 'Gomdon CÓ vận đơn BE1 — kiểm tra ngay tránh giao trùng 2 vận đơn.');
    expect(prisma.order.findUnique).toHaveBeenCalledWith({ where: { code: 'TUBU1' }, select: { id: true } });
    expect(prisma.gomdonAlert.create).toHaveBeenCalledWith({
      data: { orderId: 'o1', message: 'Gomdon CÓ vận đơn BE1 — kiểm tra ngay tránh giao trùng 2 vận đơn.' },
    });
    expect(notifications.notify).toHaveBeenCalledTimes(2);
    expect(notifications.notify).toHaveBeenCalledWith('admin1', GOMDON_ALERT_TEMPLATE, expect.objectContaining({ order_code: 'TUBU1' }));
  });

  it('cùng nội dung còn đang mở → không lưu/gửi trùng (chống báo lặp sau khi API khởi động lại)', async () => {
    const { svc, prisma, notifications } = build({ openSame: true });
    await svc.alert('TUBU1', 'x');
    expect(prisma.gomdonAlert.create).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('không khớp đơn nào (vd payload webhook không đọc được) → vẫn gửi in-app, không lưu', async () => {
    const { svc, prisma, notifications } = build({ order: null });
    await svc.alert('(không rõ đơn)', 'Webhook Gomdon không đọc được');
    expect(prisma.gomdonAlert.create).not.toHaveBeenCalled();
    expect(notifications.notify).toHaveBeenCalled();
  });

  it('lỗi DB khi lưu không làm hỏng luồng gọi (best-effort) và vẫn gửi in-app', async () => {
    const { svc, prisma, notifications } = build();
    prisma.gomdonAlert.create.mockRejectedValueOnce(new Error('db down'));
    await expect(svc.alert('TUBU1', 'x')).resolves.toBeUndefined();
    expect(notifications.notify).toHaveBeenCalled();
  });

  it('resolve: chỉ đóng báo động đang mở, ghi người xử lý', async () => {
    const { svc, prisma } = build();
    expect(await svc.resolve('a1', 'admin1')).toBe(true);
    expect(prisma.gomdonAlert.updateMany).toHaveBeenCalledWith({
      where: { id: 'a1', resolvedAt: null },
      data: { resolvedAt: expect.any(Date), resolvedById: 'admin1' },
    });
    prisma.gomdonAlert.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await svc.resolve('a1', 'admin1')).toBe(false);
  });

  it('resolveOpenForOrder: đóng mọi báo động đang mở của đơn', async () => {
    const { svc, prisma } = build();
    await svc.resolveOpenForOrder('o1', 'admin1');
    expect(prisma.gomdonAlert.updateMany).toHaveBeenCalledWith({
      where: { orderId: 'o1', resolvedAt: null },
      data: { resolvedAt: expect.any(Date), resolvedById: 'admin1' },
    });
  });
});
