import { api } from './api';

export interface SubscriptionDTO {
  id: string;
  quantity: number;
  intervalWeeks: number;
  status: 'ACTIVE' | 'PAUSED' | 'CANCELLED';
  nextRunAt: string;
  productName: string;
  variationName: string;
  thumbnail: string | null;
  slug: string | null;
  unitPrice: number;
}

export const getSubscriptions = () =>
  api.get<SubscriptionDTO[]>('/me/subscriptions').then((r) => r.data);

export const createSubscription = (data: {
  variationId: string;
  quantity: number;
  intervalWeeks: number;
  addressId: string;
}) => api.post<SubscriptionDTO>('/me/subscriptions', data).then((r) => r.data);

export const setSubscriptionStatus = (id: string, status: 'ACTIVE' | 'PAUSED' | 'CANCELLED') =>
  api.post<SubscriptionDTO>(`/me/subscriptions/${id}/status`, { status }).then((r) => r.data);
