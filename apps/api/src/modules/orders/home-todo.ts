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
  const results = await Promise.allSettled([
    first({ status: 'PENDING_PAYMENT' }),
    first({ status: 'SHIPPING' }),
    first({ group: 'processing' }),
  ]);
  const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  // Cả ba lỗi thì lỗi như GET /orders; lỗi một phần thì phần còn lại vẫn hiện (như ba lời lẻ trước đây) và `partial` báo giao diện đừng ghi số dòng.
  if (failed.length === results.length) throw failed[0]?.reason;
  const [pending, shipping, processing] = results.map((r) => (r.status === 'fulfilled' ? r.value : null));
  return { pending, shipping, processing, ...(failed.length > 0 ? { partial: true as const } : {}) };
}
