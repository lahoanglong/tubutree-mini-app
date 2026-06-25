import { api } from './api';

export interface RefillHistoryItem {
  id: string;
  quantity: number;
  seedsAwarded: number;
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
  quantity: number;
  seedsAwarded: number;
  monthlyRemaining: number;
  totalRecycled: number;
}

export const getRefillSummary = () => api.get<RefillSummary>('/refill/me').then((r) => r.data);
export const returnBottles = (quantity: number) =>
  api.post<RefillResult>('/refill/return', { quantity }).then((r) => r.data);
