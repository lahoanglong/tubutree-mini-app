import type { Metadata } from 'next';
import { ADMIN_TABULAR } from '@/components/admin/tabular-nums';

/**
 * Trang nội bộ/riêng tư — chặn lập chỉ mục ở cả hai lớp: robots.txt (xem app/robots.ts) và thẻ
 * meta này, vì robots.txt chỉ ngăn thu thập chứ không ngăn URL đã biết lọt vào kết quả tìm kiếm.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Khung nền của khu quản trị: bảng/thẻ trắng (stone-0) nằm trên nền stone-50 và chữ gốc stone-900, đặt tại đây
 * để các tab không phụ thuộc nền toàn cục của web khách (đổi nền khách không làm lệch màn quản trị).
 *
 * `tabular-nums` ở đây (font-variant-numeric được kế thừa) để MỌI số trong quản trị (bộ đếm việc, doanh thu, tồn kho, tổng đơn, huy hiệu menu)
 * có chữ số rộng đều nhau (xem ADMIN_TABULAR: vì sao cần luật riêng cho nút/ô nhập và cho ngăn trượt, hộp thoại).
 */
export default function PrivateLayout({ children }: { children: React.ReactNode }) {
  return <div className={`bg-stone-50 text-stone-900 ${ADMIN_TABULAR}`}>{children}</div>;
}
