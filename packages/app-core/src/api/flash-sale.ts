import type { HttpClient } from '../http';

export interface FlashSaleActiveItem {
  itemId: string;
  variationId: string;
  productSlug: string;
  productName: string;
  thumbnail: string | null;
  flashPrice: number;
  retailPrice: number;
  salePrice?: number | null;
  soldCount: number;
  quota: number;
  endAt: string;
}
export const fetchActiveFlashSales = (http: HttpClient) => http.get<FlashSaleActiveItem[]>('/flash-sales/active');

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
