import { FLASH_ALLOWANCE_MAX_ITEMS, type FlashAllowanceResponse } from '@tubutree/shared-types';

/**
 * Khoá truy vấn số suất theo khách. Nằm dưới `'orders'` để mọi lần đặt đơn thành công (đã `invalidateQueries(['orders'])`) làm số suất tải lại,
 * không phải sửa trang thanh toán của từng app. Không chứa số lượng đang chọn: đổi số lượng không gọi lại.
 */
export const flashAllowanceKey = (itemIds: readonly string[]) => ['orders', 'flash-allowance', itemIds.join(',')] as const;

/** Id các suất thuộc những phân loại đang vẽ (một sản phẩm, hoặc bảng chọn): không trùng, sắp xếp để khoá ổn định, tối đa số endpoint cho phép. */
export function allowanceItemIds(flash: readonly { itemId?: string; variationId: string }[], variationIds: readonly string[]): string[] {
  const wanted = new Set(variationIds);
  const ids = new Set<string>();
  for (const f of flash) if (f.itemId && wanted.has(f.variationId)) ids.add(f.itemId);
  return [...ids].sort().slice(0, FLASH_ALLOWANCE_MAX_ITEMS);
}

/**
 * Trộn `perUserLeft` của khách vào danh sách Giờ vàng. Chưa có kết quả (khách chưa đăng nhập, đang tải, API cũ, lỗi) hoặc không khớp suất nào thì trả
 * lại đúng mảng đầu vào để giá trị phát sinh từ nó giữ nguyên tham chiếu; không sửa phần tử gốc.
 */
export function withFlashAllowance<T extends { itemId?: string }>(
  flash: readonly T[],
  res: FlashAllowanceResponse | null | undefined,
): (T & { perUserLeft?: number | null })[] {
  const items = res?.items;
  if (!items || typeof items !== 'object') return flash as (T & { perUserLeft?: number | null })[];
  let changed = false;
  const merged = flash.map((f) => {
    const left = f.itemId ? items[f.itemId]?.perUserLeft : undefined;
    if (typeof left !== 'number' || !Number.isFinite(left)) return f;
    changed = true;
    return { ...f, perUserLeft: left };
  });
  return changed ? merged : (flash as (T & { perUserLeft?: number | null })[]);
}
