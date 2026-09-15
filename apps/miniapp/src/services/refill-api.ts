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
/** Đổi vỏ chai kèm Idempotency-Key: double-tap/mất mạng-retry không tạo thêm 1 yêu cầu đổi vỏ nữa
 * (double-credit nước tưới Vườn Xanh khi duyệt). */
export const returnBottles = (quantity: number, idempotencyKey: string) =>
  api
    .post<RefillResult>('/refill/return', { quantity }, { headers: { 'Idempotency-Key': idempotencyKey } })
    .then((r) => r.data);

export const getPendingRefillReturns = () => api.get<PendingRefillItem[]>('/refill/admin/pending').then((r) => r.data);
export const approveRefillReturn = (id: string) => api.post<{ ok: boolean }>(`/refill/admin/${id}/approve`).then((r) => r.data);
export const rejectRefillReturn = (id: string) => api.post<{ ok: boolean }>(`/refill/admin/${id}/reject`).then((r) => r.data);
