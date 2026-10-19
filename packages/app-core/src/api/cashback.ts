import type { HttpClient } from '../http';

export interface CashbackMerchant {
  id: string;
  slug: string;
  name: string;
  logoUrl: string;
  category: string;
  baseRate: string; // Decimal → string, % người dùng nhận
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

export const getMerchants = (http: HttpClient) => http.get<CashbackMerchant[]>('/cashback/merchants');
export const createCashbackClick = (http: HttpClient, merchantId: string, productUrl?: string) =>
  http.post<{ deeplink: string }>('/cashback/click', { merchantId, productUrl });
export const getCashbackTransactions = (http: HttpClient) => http.get<CashbackTxn[]>('/cashback/transactions');
