import type { HttpClient } from '../http';

export interface WalletSummary {
  walletBalance: number;
  cashbackPending: number;
  commissionApproved: number;
  commissionPending: number;
}

/** Một dòng sao kê Ví Tubu (sổ cái wallet_transactions). delta có dấu: + vào ví, − ra khỏi ví. */
export interface WalletTxn {
  id: string;
  delta: number;
  balanceAfter: number;
  type: string;
  reason: string | null;
  orderId: string | null;
  createdAt: string;
}

export interface WalletTxnPage {
  data: WalletTxn[];
  meta: { page: number; limit: number; total: number };
}

export const getWallet = (http: HttpClient) => http.get<WalletSummary>('/me/wallet');
export const getWalletTransactions = (http: HttpClient, page: number, limit = 20) =>
  http.get<WalletTxnPage>('/me/wallet/transactions', { query: { page, limit } });
