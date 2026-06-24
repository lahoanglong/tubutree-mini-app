import { api } from './api';

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
}

export const listGroupBuys = () => api.get<GroupBuy[]>('/group-buy').then((r) => r.data);
export const getGroupBuy = (id: string) => api.get<GroupBuy>(`/group-buy/${id}`).then((r) => r.data);
export const createGroupBuy = (productId: string) =>
  api.post<GroupBuy>('/group-buy', { productId }).then((r) => r.data);
export const joinGroupBuy = (id: string) =>
  api.post<{ joined: boolean; currentSize: number; status: GroupBuyStatus }>(`/group-buy/${id}/join`).then((r) => r.data);
