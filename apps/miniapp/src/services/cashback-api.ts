import { api } from './api';

export interface CashbackMerchant {
  id: string;
  slug: string;
  name: string;
  logoUrl: string;
  category: string;
  baseRate: string; // Decimal → string, % người dùng nhận
  fullRate: string;
  terms: string | null;
}

export type CashbackStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'PAID';
export interface CashbackTxn {
  id: string;
  merchantOrderId: string;
  orderAmount: number;
  commission: number;
  userReward: number;
  status: CashbackStatus;
  confirmedAt: string | null;
  paidAt: string | null;
}

export const getMerchants = () =>
  api.get<CashbackMerchant[]>('/cashback/merchants').then((r) => r.data);
export const createCashbackClick = (merchantId: string, productUrl?: string) =>
  api.post<{ deeplink: string }>('/cashback/click', { merchantId, productUrl }).then((r) => r.data);
export const getCashbackTransactions = () =>
  api.get<CashbackTxn[]>('/cashback/transactions').then((r) => r.data);
