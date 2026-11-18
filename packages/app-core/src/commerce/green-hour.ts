import { fillCopy } from '../shop-copy';

/**
 * Khối Giờ vàng ở Trang chủ và Ưu đãi hiện dạng "Giờ Xanh Ưu Đãi" khi cờ `flashsale.green_hour_enabled` bật: cùng suất, cùng giá, cùng đồng hồ
 * và cùng chiều cao; chỉ đổi tên khối, tông (lá xanh thay tia chớp cam), thanh đã bán xanh và thêm nút ＋ thêm nhanh trên ảnh thẻ.
 * Trang Giờ vàng (danh sách theo khung giờ) giữ tên cũ.
 */
export interface FlashBlockLook {
  title: string;
  icon: 'zap' | 'leaf';
  tone: 'promo' | 'default';
  soldTone: 'flash' | 'green';
  quickAdd: boolean;
}

export function flashBlockLook(greenHour: boolean | undefined, where: 'home' | 'offers'): FlashBlockLook {
  if (greenHour === true) return { title: fillCopy('greenHour.title'), icon: 'leaf', tone: 'default', soldTone: 'green', quickAdd: true };
  return { title: fillCopy(where === 'home' ? 'flash.title' : 'flash.todayTitle'), icon: 'zap', tone: 'promo', soldTone: 'flash', quickAdd: false };
}

/** Nút ＋ chỉ trên thẻ còn mua được: suất chưa bán hết và thẻ không ở trạng thái hết hàng. */
export function greenHourCanQuickAdd(item: { quota: number; soldCount: number }, stock: string | undefined): boolean {
  return !(item.quota > 0 && item.soldCount >= item.quota) && stock !== 'out';
}
