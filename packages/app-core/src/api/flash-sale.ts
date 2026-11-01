import type { HttpClient } from '../http';
import { syncServerClock } from '../server-clock';

export interface FlashSaleActiveItem {
  itemId: string;
  variationId: string;
  productSlug: string;
  productName: string;
  /** Tên phân loại có suất Giờ vàng; chỉ có khi sản phẩm bán nhiều phân loại. */
  variationName?: string | null;
  thumbnail: string | null;
  flashPrice: number;
  retailPrice: number;
  salePrice?: number | null;
  soldCount: number;
  quota: number;
  endAt: string;
  /** Giờ máy chủ lúc dựng danh sách; thiếu thì app dùng đồng hồ máy khách. */
  serverNow?: string;
  /** Giới hạn mua mỗi khách (PDP ghi "Mỗi khách tối đa {n}"); API cũ không gửi, thiếu thì không hiện dòng. */
  perUserLimit?: number;
  /** Khung giờ chứa suất (API cũ không gửi). */
  saleId?: string;
  title?: string;
  startAt?: string;
}
export const fetchActiveFlashSales = async (http: HttpClient) => {
  const items = await http.get<FlashSaleActiveItem[]>('/flash-sales/active', { anonymous: true });
  syncServerClock(items?.[0]?.serverNow);
  return items;
};

export interface UpcomingFlashItem {
  itemId: string;
  variationId: string;
  productSlug: string;
  productName: string;
  thumbnail: string | null;
  flashPrice: number;
  retailPrice: number;
  salePrice?: number | null;
  startAt: string;
  reminded: boolean;
}
/** Công khai: không cần phiên. Có phiên thì `reminded` theo khách, không có thì luôn false (không dùng `anonymous` để khách đã đăng nhập vẫn có trạng thái nhắc). */
export const fetchUpcomingFlashSales = (http: HttpClient) => http.get<UpcomingFlashItem[]>('/flash-sales/upcoming');
export const setFlashReminder = (http: HttpClient, itemId: string) => http.post(`/flash-sales/items/${itemId}/remind`);
export const cancelFlashReminder = (http: HttpClient, itemId: string) => http.delete(`/flash-sales/items/${itemId}/remind`);

export type FlashSlotStatus = 'LIVE' | 'UPCOMING' | 'ENDED';

/** Một khung Giờ vàng (một đợt flash sale). `status` là của lúc máy chủ trả lời; màn hình tính lại theo đồng hồ khi dùng. */
export interface FlashSlot {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  status: FlashSlotStatus;
  itemCount: number;
}

export interface FlashSlotItem {
  itemId: string;
  variationId: string;
  variationName: string | null;
  productId: string;
  productSlug: string;
  productName: string;
  thumbnail: string | null;
  categoryIds: string[];
  flashPrice: number;
  retailPrice: number;
  salePrice: number | null;
  soldCount: number;
  quota: number;
  /** Hết suất hoặc hết hàng thật: vẫn hiện, mờ và nút khoá. */
  soldOut: boolean;
  perUserLimit: number;
}

export interface FlashSlotsResponse {
  serverNow: string;
  slots: FlashSlot[];
}

export interface FlashSlotItemsResponse {
  serverNow: string;
  slot: FlashSlot;
  items: FlashSlotItem[];
}

/** Công khai (khách xem được); bọc `{ serverNow, ... }` để danh sách rỗng vẫn đồng bộ được đồng hồ máy chủ. */
export const fetchFlashSlots = async (http: HttpClient) => {
  const res = await http.get<FlashSlotsResponse>('/flash-sales/slots', { anonymous: true });
  syncServerClock(res?.serverNow);
  return res;
};
export const fetchFlashSlotItems = async (http: HttpClient, slotId: string) => {
  const res = await http.get<FlashSlotItemsResponse>(`/flash-sales/slots/${slotId}/items`, { anonymous: true });
  syncServerClock(res?.serverNow);
  return res;
};
