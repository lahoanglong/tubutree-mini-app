import type { HttpClient } from '../http';

export type GroupBuyStatus = 'OPEN' | 'SUCCESS' | 'FAILED';

export interface GroupBuy {
  id: string;
  product: { name: string; slug: string; thumbnail: string | null };
  targetSize: number;
  currentSize: number;
  unitPrice: number;
  basePrice: number;
  discountPct: number;
  status: GroupBuyStatus;
  expiresAt: string;
  joined: boolean;
  /** Người xem chính là người mở nhóm (API bản cũ không trả → coi như không). */
  isOwner?: boolean;
  /** Mã giảm của người đang xem khi nhóm đã đủ người và người đó là thành viên. */
  couponCode?: string;
  /** Đơn tối thiểu của mã = giá nhóm của biến thể rẻ nhất đang bán (API bản cũ không trả → dùng unitPrice). */
  minOrder?: number;
  /** Phân loại mà giá nhóm dựa trên (đại diện của thẻ); client chỉ xét Giờ vàng của phân loại này. API bản cũ không trả. */
  variationId?: string;
}

export const listGroupBuys = (http: HttpClient) => http.get<GroupBuy[]>('/group-buy');
export const getGroupBuy = (http: HttpClient, id: string) => http.get<GroupBuy>(`/group-buy/${id}`);
export const createGroupBuy = (http: HttpClient, productId: string) => http.post<GroupBuy>('/group-buy', { productId });
export const joinGroupBuy = (http: HttpClient, id: string) =>
  http.post<{ joined: boolean; currentSize: number; status: GroupBuyStatus }>(`/group-buy/${id}/join`);
