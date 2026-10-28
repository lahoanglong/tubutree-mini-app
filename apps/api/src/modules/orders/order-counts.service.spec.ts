import { OrderCountsService, ORDER_COUNT_GROUPS, type OrderStatusCounts } from './order-counts.service';
import { OrdersService, type OrderListFilter } from './orders.service';
import { OrderReversalService } from './order-reversal.service';
import type { PrismaService } from '../../prisma/prisma.service';

type Row = { userId: string; status: string };

// Bộ lọc đúng như các tab trang Đơn hàng (Mini `orders-tabs.ts`, web `orders-tabs.ts`) đang gửi cho GET /orders.
const TAB_FILTERS: Record<keyof OrderStatusCounts, OrderListFilter> = {
  pending_payment: { status: 'PENDING_PAYMENT' },
  processing: { group: 'processing' },
  shipping: { status: 'SHIPPING' },
  delivered: { status: 'DELIVERED' },
  closed: { group: 'closed' },
};

const ROWS: Row[] = [
  ...['PENDING_PAYMENT', 'PENDING_PAYMENT'].map((status) => ({ userId: 'u1', status })),
  ...['CONFIRMED', 'PACKED', 'PACKED'].map((status) => ({ userId: 'u1', status })),
  ...['SHIPPING'].map((status) => ({ userId: 'u1', status })),
  ...['DELIVERED', 'DELIVERED', 'DELIVERED', 'DELIVERED'].map((status) => ({ userId: 'u1', status })),
  ...['CANCELLED', 'RETURNED'].map((status) => ({ userId: 'u1', status })),
  // Đơn của khách khác không được lọt vào số của u1.
  ...['PENDING_PAYMENT', 'SHIPPING', 'CONFIRMED'].map((status) => ({ userId: 'u2', status })),
];

/** Postgres giả đủ cho where `{ userId, status | { in } }`: count, groupBy theo status và findMany rỗng cho phần danh sách. */
function fakePrisma(rows: Row[]) {
  const matches = (r: Row, where: { userId?: string; status?: string | { in: string[] } }) =>
    (where.userId === undefined || r.userId === where.userId) &&
    (where.status === undefined ||
      (typeof where.status === 'string' ? r.status === where.status : where.status.in.includes(r.status)));
  const count = jest.fn(async ({ where }: { where: Parameters<typeof matches>[1] }) => rows.filter((r) => matches(r, where)).length);
  const groupBy = jest.fn(async ({ where }: { where: Parameters<typeof matches>[1] }) => {
    const by = new Map<string, number>();
    for (const r of rows.filter((x) => matches(x, where))) by.set(r.status, (by.get(r.status) ?? 0) + 1);
    return [...by].map(([status, n]) => ({ status, _count: { _all: n } }));
  });
  const findMany = jest.fn().mockResolvedValue([]);
  const prisma = {
    order: { count, groupBy, findMany },
    variation: { findMany: jest.fn().mockResolvedValue([]) },
    orderStatusHistory: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  } as unknown as PrismaService;
  return { prisma, count, groupBy };
}

describe('OrderCountsService.statusCounts', () => {
  it('một truy vấn gom theo trạng thái, chỉ của chính khách', async () => {
    const { prisma, groupBy, count } = fakePrisma(ROWS);
    const out = await new OrderCountsService(prisma).statusCounts('u1');
    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(groupBy).toHaveBeenCalledWith(expect.objectContaining({ by: ['status'], where: { userId: 'u1' } }));
    expect(count).not.toHaveBeenCalled();
    expect(out).toEqual({ pending_payment: 2, processing: 3, shipping: 1, delivered: 4, closed: 2 });
  });

  it('khách chưa có đơn: mọi nhóm là 0 (không thiếu khoá)', async () => {
    const { prisma } = fakePrisma([]);
    expect(await new OrderCountsService(prisma).statusCounts('u1')).toEqual({ pending_payment: 0, processing: 0, shipping: 0, delivered: 0, closed: 0 });
  });

  it('khớp meta.total của GET /orders với đúng bộ lọc từng tab, cho mọi nhóm', async () => {
    const { prisma } = fakePrisma(ROWS);
    const ordersSvc = new OrdersService(prisma, {} as never, {} as never, {} as never, {} as never, {} as never, new OrderReversalService({} as never, {} as never));
    const counts = await new OrderCountsService(prisma).statusCounts('u1');
    for (const key of Object.keys(TAB_FILTERS) as (keyof OrderStatusCounts)[]) {
      const page = await ordersSvc.list('u1', TAB_FILTERS[key], 1, 1);
      expect({ key, n: counts[key] }).toEqual({ key, n: page.meta.total });
    }
  });

  it('mỗi nhóm đếm có đúng một bộ lọc tab ở trên để so (thêm nhóm mới thì phải thêm ca so)', () => {
    expect(Object.keys(ORDER_COUNT_GROUPS).sort()).toEqual(Object.keys(TAB_FILTERS).sort());
  });
});
