import type { HttpClient } from '../http';
import { getCashbackTransactions, getMerchants } from '../api/cashback';

export const cashbackMerchantsQuery = (http: HttpClient) => ({ queryKey: ['cashback-merchants'] as const, queryFn: () => getMerchants(http) });
export const cashbackTxnQuery = (http: HttpClient) => ({ queryKey: ['cashback-txn'] as const, queryFn: () => getCashbackTransactions(http) });
