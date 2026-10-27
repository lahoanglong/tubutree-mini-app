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
}
export const fetchActiveFlashSales = async (http: HttpClient) => {
  const items = await http.get<FlashSaleActiveItem[]>('/flash-sales/active');
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
export const fetchUpcomingFlashSales = (http: HttpClient) => http.get<UpcomingFlashItem[]>('/flash-sales/upcoming');
export const setFlashReminder = (http: HttpClient, itemId: string) => http.post(`/flash-sales/items/${itemId}/remind`);
export const cancelFlashReminder = (http: HttpClient, itemId: string) => http.delete(`/flash-sales/items/${itemId}/remind`);
