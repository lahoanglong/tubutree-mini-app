import { api } from './api';

export type RefillStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface RefillHistoryItem {
  id: string;
  quantity: number;
  seedsAwarded: number;
  status: RefillStatus;
  createdAt: string;
}

export interface RefillSummary {
  perBottle: number;
  monthlyCap: number;
  monthlyUsed: number;
  monthlyRemaining: number;
  totalRecycled: number;
  history: RefillHistoryItem[];
}

export interface RefillResult {
  id: string;
  quantity: number;
  seedsAwarded: number;
  status: RefillStatus;
  monthlyRemaining: number;
  totalRecycled: number;
}

export interface PendingRefillItem {
  id: string;
  quantity: number;
  seedsAwarded: number;
  status: RefillStatus;
  createdAt: string;
  user: {
    id: string;
    fullName: string;
    phone?: string;
    avatarUrl?: string;
  };
}

export const getRefillSummary = () => api.get<RefillSummary>('/refill/me').then((r) => r.data);
export const returnBottles = (quantity: number) =>
  api.post<RefillResult>('/refill/return', { quantity }).then((r) => r.data);

export const getPendingRefillReturns = () => api.get<PendingRefillItem[]>('/refill/admin/pending').then((r) => r.data);
export const approveRefillReturn = (id: string) => api.post<{ ok: boolean }>(`/refill/admin/${id}/approve`).then((r) => r.data);
export const rejectRefillReturn = (id: string) => api.post<{ ok: boolean }>(`/refill/admin/${id}/reject`).then((r) => r.data);
