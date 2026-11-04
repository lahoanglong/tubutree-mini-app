'use client';

import { useQuery } from '@tanstack/react-query';
import { listCustomerRefunds } from '@/lib/admin-client';
import { CUSTOMER_REFUNDS_QUERY_KEY } from '@/lib/customer-refunds-admin';

/**
 * Số khoản hoàn cần xử lý cạnh nhãn tab — bộ lọc "Đang mở", cùng tập với thẻ "Hoàn tiền khách" ở trang chủ: một lần gọi
 * limit=1 lấy meta.total. Lỗi tải thì không hiện gì, không chặn thanh tab. Cùng tiền tố khoá với danh sách nên mark-paid
 * làm mới cả hai.
 */
export function CustomerRefundsPendingBadge() {
  const q = useQuery({
    queryKey: [CUSTOMER_REFUNDS_QUERY_KEY, 'OPEN', 'count'],
    queryFn: () => listCustomerRefunds('OPEN', 1, 1).then((r) => r.meta.total),
  });
  const n = q.data ?? 0;
  if (n <= 0) return null;
  return (
    <span
      data-refunds-pending
      className="ml-1.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-warning-bg px-1.5 text-[11px] font-semibold leading-5 text-warning-fg"
    >
      <span className="sr-only">, </span>
      {n > 99 ? '99+' : n}
      <span className="sr-only"> khoản hoàn cần xử lý</span>
    </span>
  );
}
