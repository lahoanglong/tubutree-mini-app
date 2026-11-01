import { fillCopy } from '../shop-copy';

/**
 * Nhãn nút "xem tất cả" của một khối: "Tất cả (n)" với n là số mục trang đích sẽ vẽ (Mã của tôi, Nhận mã, tổng sản phẩm của thương hiệu), không phải số đang hiện ở khối.
 * Không có mục nào (hoặc số không đọc được) thì không có nút: trả null để nơi gọi bỏ `action`, tránh nút dẫn tới trang rỗng.
 */
export function seeAllLabel(total: number | null | undefined): string | null {
  if (typeof total !== 'number' || !Number.isFinite(total) || total < 1) return null;
  return fillCopy('section.seeAllCount', { n: total });
}
