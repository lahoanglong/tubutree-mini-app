import type { OrdersService } from './orders.service';

type ListFn = OrdersService['list'];
type OrderRow = Awaited<ReturnType<ListFn>>['data'][number];

export interface HomeTodoPart {
  order: OrderRow;
  /** Tổng đơn khớp bộ lọc (meta.total của GET /orders), để dải gộp "N đơn". */
  total: number;
}

/** Ba lời GET /orders?limit=1 của dải "Việc cần làm" ở Trang chủ gộp thành một: mỗi phần là đơn mới nhất của bộ lọc hoặc null. */
export async function loadHomeTodo(list: ListFn, userId: string) {
  const first = async (filter: Parameters<ListFn>[1]): Promise<HomeTodoPart | null> => {
    const res = await list(userId, filter, 1, 1);
    const order = res.data[0];
    return order ? { order, total: res.meta.total } : null;
  };
  const [pending, shipping, processing] = await Promise.all([
    first({ status: 'PENDING_PAYMENT' }),
    first({ status: 'SHIPPING' }),
    first({ group: 'processing' }),
  ]);
  return { pending, shipping, processing };
}
