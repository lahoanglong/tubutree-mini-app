import type { CompareItem, ProductCompare } from '@tubutree/app-core/api/product-compare';

/** Số món tối đa để so cạnh món đang xem (bảng 3 cột). */
const COMPARE_OTHERS_MAX = 2;

/**
 * Dữ liệu dùng được cho bảng "So với món tương tự": có món đang xem và ít nhất một món để so. API lỗi, cờ tắt (404) hay trả sai dạng thì null và trang
 * không có khối. Module thường (không 'use client') để trang dựng ở máy chủ cũng gọi được khi xếp lưới.
 */
export function compareRows(data: ProductCompare | null | undefined): { current: CompareItem; others: CompareItem[] } | null {
  if (!data || typeof data !== 'object' || !data.current || !Array.isArray(data.others)) return null;
  const others = data.others.filter((o) => !!o && typeof o.slug === 'string' && o.slug !== '').slice(0, COMPARE_OTHERS_MAX);
  return others.length > 0 ? { current: data.current, others } : null;
}
