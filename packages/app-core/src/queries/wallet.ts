import type { HttpClient } from '../http';
import { getWallet, getWalletTransactions } from '../api/wallet';

export const walletQuery = (http: HttpClient) => ({ queryKey: ['wallet'] as const, queryFn: () => getWallet(http) });
/** Khoá con của ['wallet'] để invalidate sau khi rút tiền làm mới luôn sao kê. Dùng với useInfiniteQuery (initialPageParam 1). */
export const walletTransactionsQuery = (http: HttpClient) => ({
  queryKey: ['wallet', 'transactions'] as const,
  queryFn: ({ pageParam }: { pageParam: number }) => getWalletTransactions(http, pageParam),
});
