'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useAuthPhase } from '@/lib/auth-phase';
import { formatVnd, getWallet, getWalletTransactions } from '@/lib/shop-client';
import { walletTxTitle } from '@/lib/ledger-labels';
import { formatDateTime } from '@/lib/format-date';
import { ui } from '@/lib/guest-ui';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { LedgerShell, SignedAmount } from '../ledger-shell';

const TITLE = 'Ví Tubu';

export default function WalletHistoryPage() {
  const phase = useAuthPhase();
  const authed = phase === 'authenticated';
  const walletQ = useQuery({ queryKey: ['wallet'], queryFn: getWallet, enabled: authed, refetchOnWindowFocus: true });
  const txnQ = useInfiniteQuery({
    queryKey: ['wallet-txn'],
    queryFn: ({ pageParam }) => getWalletTransactions(pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.meta.page * last.meta.limit < last.meta.total ? last.meta.page + 1 : undefined),
    enabled: authed,
  });

  if (phase === 'loading') {
    return (
      <LedgerShell title={TITLE}>
        <AuthLoading />
      </LedgerShell>
    );
  }
  if (phase === 'unavailable') {
    return (
      <LedgerShell title={TITLE}>
        <SessionUnavailable />
      </LedgerShell>
    );
  }
  if (phase === 'guest') {
    return (
      <LedgerShell title={TITLE}>
        <LoginRequired message="Đăng nhập để xem Ví Tubu của bạn." returnTo="/tai-khoan/vi-tubu" />
      </LedgerShell>
    );
  }

  const rows = txnQ.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <LedgerShell title={TITLE}>
      {walletQ.data && (
        <section aria-label="Số dư Ví Tubu" className={`p-4 ${ui.card}`}>
          <div className="text-2xl font-bold text-stone-900">{formatVnd(walletQ.data.walletBalance)}</div>
          <div className="text-sm text-stone-600">Số dư dùng được để thanh toán đơn</div>
          {walletQ.data.cashbackPending > 0 && (
            <div className="mt-0.5 text-xs text-stone-600">
              Hoàn tiền đang chờ về ví: {formatVnd(walletQ.data.cashbackPending)}
            </div>
          )}
        </section>
      )}

      <h2 className={`mt-5 ${ui.sectionTitle}`}>Lịch sử Ví</h2>
      {txnQ.isLoading ? (
        <p className="py-10 text-center text-stone-600">Đang tải lịch sử…</p>
      ) : txnQ.isError && rows.length === 0 ? (
        <div className={`mt-3 p-6 text-center ${ui.card}`}>
          <p className={ui.error}>Không tải được lịch sử Ví.</p>
          <button type="button" onClick={() => void txnQ.refetch()} className={`${ui.btnText} mt-1 text-forest-700`}>
            Thử lại
          </button>
        </div>
      ) : rows.length === 0 ? (
        <p className={`mt-3 p-6 text-center text-sm text-stone-600 ${ui.card}`}>Chưa có biến động nào trong Ví.</p>
      ) : (
        <>
          <ul className={`mt-3 divide-y divide-stone-200 ${ui.card}`}>
            {rows.map((t) => (
              <li key={t.id} className="flex items-start justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="break-words text-sm font-medium text-stone-900">{walletTxTitle(t)}</div>
                  <div className="break-words text-xs text-stone-600">
                    {formatDateTime(t.createdAt)}
                    {t.reason ? ` · ${t.reason}` : ''}
                  </div>
                </div>
                <div className="flex-none text-right">
                  <div className="text-sm">
                    <SignedAmount delta={t.delta} text={formatVnd(Math.abs(t.delta))} />
                  </div>
                  <div className="text-xs text-stone-600">Số dư {formatVnd(t.balanceAfter)}</div>
                </div>
              </li>
            ))}
          </ul>
          {txnQ.hasNextPage && (
            <div className="mt-3 text-center">
              <button
                type="button"
                onClick={() => void txnQ.fetchNextPage()}
                disabled={txnQ.isFetchingNextPage}
                className={ui.btnSecondary}
              >
                {txnQ.isFetchingNextPage ? 'Đang tải…' : 'Xem thêm'}
              </button>
              {txnQ.isFetchNextPageError && (
                <p role="alert" className={`mt-2 ${ui.error}`}>
                  Không tải thêm được lịch sử. Vui lòng thử lại.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </LedgerShell>
  );
}
