'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { useAuthPhase } from '@/lib/auth-phase';
import { getMe, getPointsTransactions } from '@/lib/shop-client';
import { formatCount, pointsSummary } from '@/lib/checkout-points';
import { pointsReasonLabel } from '@/lib/ledger-labels';
import { formatDate } from '@/lib/format-date';
import { ui } from '@/lib/guest-ui';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { LedgerShell, SignedAmount } from '../ledger-shell';

const TITLE = 'Lịch sử Điểm Xanh';

export default function PointsHistoryPage() {
  const phase = useAuthPhase();
  const { user } = useAuth();
  const authed = phase === 'authenticated';
  const meQ = useQuery({ queryKey: ['me'], queryFn: getMe, enabled: authed, refetchOnWindowFocus: true });
  const txnQ = useQuery({ queryKey: ['points-txn'], queryFn: getPointsTransactions, enabled: authed });

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
        <LoginRequired message="Đăng nhập để xem lịch sử Điểm Xanh của bạn." returnTo="/tai-khoan/diem-xanh" />
      </LedgerShell>
    );
  }

  const balances = meQ.data ?? user;
  const points = balances ? pointsSummary(balances) : null;
  const rows = txnQ.data ?? [];

  return (
    <LedgerShell title={TITLE}>
      {points && (
        <section aria-label="Số dư Điểm Xanh" className={`p-4 ${ui.card}`}>
          <div className="text-2xl font-bold text-stone-900">{formatCount(points.total)}</div>
          <div className="text-sm text-stone-600">Điểm Xanh hiện có</div>
          {points.convertedNote && <div className="mt-0.5 text-xs text-stone-600">{points.convertedNote}</div>}
        </section>
      )}

      {txnQ.isLoading ? (
        <p className="py-10 text-center text-stone-600">Đang tải lịch sử…</p>
      ) : txnQ.isError ? (
        <div className={`mt-3 p-6 text-center ${ui.card}`}>
          <p className={ui.error}>Không tải được lịch sử Điểm Xanh.</p>
          <button type="button" onClick={() => void txnQ.refetch()} className={`${ui.btnText} mt-1 text-forest-700`}>
            Thử lại
          </button>
        </div>
      ) : rows.length === 0 ? (
        <p className={`mt-3 p-6 text-center text-sm text-stone-600 ${ui.card}`}>Chưa có giao dịch điểm nào.</p>
      ) : (
        <>
          <ul className={`mt-3 divide-y divide-stone-200 ${ui.card}`}>
            {rows.map((t) => (
              <li key={t.id} className="flex items-start justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="break-words text-sm font-medium text-stone-900">{pointsReasonLabel(t.reason)}</div>
                  <div className="text-xs text-stone-600">
                    {formatDate(t.createdAt)}
                    {t.lot === 'CONVERTED' ? ' · Điểm không hết hạn' : ''}
                    {t.delta > 0 && t.expiresAt ? ` · Hết hạn ${formatDate(t.expiresAt)}` : ''}
                  </div>
                </div>
                <SignedAmount delta={t.delta} text={formatCount(Math.abs(t.delta))} />
              </li>
            ))}
          </ul>
          <p className="mt-3 text-center text-xs text-stone-600">Hiển thị tối đa 100 giao dịch gần nhất.</p>
        </>
      )}
    </LedgerShell>
  );
}
