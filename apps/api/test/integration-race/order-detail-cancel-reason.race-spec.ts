import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { cancelReasonNote } from '../../src/modules/orders/cancel-reasons';
import { createOrder, createUser, warmPool } from './helpers';

/** GET /orders/:code trả cancelReason từ sổ lịch sử thật: đúng dòng huỷ, không lộ ghi chú nội bộ, đơn chưa huỷ thì null. */
describe('Chi tiết đơn: cancelReason (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let orders: OrdersService;
  const userIds: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    const stub = {} as never;
    orders = new OrdersService(prisma, stub, stub, stub, stub, stub, stub);
  });

  afterAll(async () => {
    if (prisma && userIds.length > 0) {
      await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: (await prisma.order.findMany({ where: { userId: { in: userIds } }, select: { id: true } })).map((o) => o.id) } } });
      await prisma.order.deleteMany({ where: { userId: { in: userIds } } });
    }
    await moduleRef?.close();
  });

  const cancelledOrder = async (rows: { fromStatus: string; actorType: string; note: string | null; at: string }[], status = 'CANCELLED') => {
    const user = await createUser(prisma, { role: 'CUSTOMER' });
    userIds.push(user.id);
    const order = await createOrder(prisma, { userId: user.id, status: status as never });
    for (const r of rows) {
      await prisma.orderStatusHistory.create({
        data: { orderId: order.id, fromStatus: r.fromStatus, toStatus: 'CANCELLED', actorType: r.actorType, note: r.note, createdAt: new Date(r.at) },
      });
    }
    return { user, order };
  };

  it('khách tự huỷ: "Bạn đã huỷ: <nhãn>. <chữ khách>"', async () => {
    const { user, order } = await cancelledOrder([
      { fromStatus: 'CONFIRMED', actorType: 'CUSTOMER', note: cancelReasonNote('OTHER', 'Con ốm'), at: '2026-11-05T03:00:00Z' },
    ]);
    expect((await orders.detailView(user.id, order.code)).cancelReason).toBe('Bạn đã huỷ: Lý do khác. Con ốm');
  });

  it('admin huỷ có lý do: dùng đúng lý do đã gửi khách; dòng đánh dấu CANCELLED -> CANCELLED của Pancake muộn hơn không che dòng huỷ, ghi chú của nó không lọt ra', async () => {
    const { user, order } = await cancelledOrder([
      { fromStatus: 'CONFIRMED', actorType: 'ADMIN', note: 'Admin: Trùng đơn, xin lỗi bạn.', at: '2026-11-05T03:00:00Z' },
      { fromStatus: 'CANCELLED', actorType: 'PANCAKE', note: 'Pancake báo đã thanh toán, chờ đối chiếu', at: '2026-11-05T09:00:00Z' },
    ]);
    const view = await orders.detailView(user.id, order.code);
    expect(view.cancelReason).toBe('Tubu Tree đã huỷ đơn này. Lý do: Trùng đơn, xin lỗi bạn');
    expect(JSON.stringify(view)).not.toContain('chờ đối chiếu');
  });

  it('hệ thống tự huỷ quá hạn: câu cố định, không lộ gợi ý đối chiếu cổng', async () => {
    const { user, order } = await cancelledOrder([
      { fromStatus: 'PENDING_PAYMENT', actorType: 'SYSTEM', note: 'Tự huỷ: quá 24 giờ chưa thanh toán — đã mở lệnh ZALOPAY: đối chiếu ZALOPAY, đã trừ tiền thì hoàn thủ công', at: '2026-11-05T03:00:00Z' },
    ]);
    const view = await orders.detailView(user.id, order.code);
    expect(view.cancelReason).toBe('Đơn tự huỷ vì quá hạn thanh toán');
    expect(JSON.stringify(view)).not.toContain('hoàn thủ công');
  });

  it('đơn chưa huỷ: null; đơn huỷ không có dòng sổ: null; đơn của người khác: 404', async () => {
    const open = await cancelledOrder([], 'CONFIRMED');
    expect((await orders.detailView(open.user.id, open.order.code)).cancelReason).toBeNull();
    const legacy = await cancelledOrder([]);
    expect((await orders.detailView(legacy.user.id, legacy.order.code)).cancelReason).toBeNull();
    await expect(orders.detailView(open.user.id, legacy.order.code)).rejects.toThrow();
  });
});
