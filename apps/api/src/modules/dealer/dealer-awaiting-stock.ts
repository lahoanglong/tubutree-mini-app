import type { Prisma } from '@prisma/client';

/**
 * Đơn đại lý còn dòng đặt trước (vượt tồn, `OrderItem.backorderedQty` > 0): kho chưa có đủ hàng để soạn, đẩy sớm
 * thành đơn ảo bên Pancake. DealerBackorderService đẩy sang Pancake khi lấp đủ 100%; mọi đường đẩy khác (job push,
 * job thanh toán, cron, "Đẩy lại Pancake") và bộ lọc "Chưa lên Pancake" đều phải loại các đơn này.
 */
export const DEALER_AWAITING_STOCK_WHERE = {
  type: 'DEALER',
  items: { some: { backorderedQty: { gt: 0 } } },
} as const satisfies Prisma.OrderWhereInput;

export function isDealerAwaitingStock(order: {
  type: string;
  items: { backorderedQty?: number | null }[];
}): boolean {
  return order.type === 'DEALER' && order.items.some((i) => (i.backorderedQty ?? 0) > 0);
}
