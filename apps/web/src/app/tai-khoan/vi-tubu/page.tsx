'use client';

import Link from 'next/link';
import { useInfiniteQuery, useQuery, type InfiniteData, type UseInfiniteQueryResult } from '@tanstack/react-query';
import type { WalletTxnPage } from '@tubutree/app-core/api/wallet';
import { walletCopy } from '@tubutree/app-core/account-copy';
import { CheckCircle2, ChevronRight, Clock, History, Leaf, ShoppingBag, Wallet, type LucideIcon } from 'lucide-react';
import { loyaltyQuery } from '@tubutree/app-core/queries/loyalty';
import { walletQuery, walletTransactionsQuery } from '@tubutree/app-core/queries/wallet';
import { CASHBACK_ENABLED } from '@tubutree/app-core/features';
import { walletTxLabel } from '@tubutree/app-core/wallet-rules';
import { uniqueById } from '@tubutree/app-core/unique-by-id';
import { useAuth } from '@/lib/auth-context';
import { useAuthPhase } from '@/lib/auth-phase';
import { isWebRouteReady } from '@/lib/route-map';
import { coreHttp } from '@/lib/core-http';
import { formatCount, pointsSummary } from '@/lib/checkout-points';
import { formatDateTime } from '@/lib/format-date';
import { formatVnd } from '@/lib/format-vnd';
import { ui } from '@/lib/guest-ui';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { Badge } from '@/components/ui/badge';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { miniBtnSecondary, miniCard } from '@/components/loyalty/mini-surface';
import { LedgerShell, SignedAmount } from '../ledger-shell';
import { loadErrorText } from '@/lib/error-text';

const TITLE = 'Ví Tubu';

const errText = loadErrorText;

export default function WalletPage() {
  const phase = useAuthPhase();
  const authed = phase === 'authenticated';
  const { user } = useAuth();
  const isCommissionRole = user?.role === 'AFFILIATE' || user?.role === 'DEALER';
  const walletQ = useQuery({ ...walletQuery(coreHttp), enabled: authed, refetchOnWindowFocus: true });
  // Điểm là phần phụ: lỗi chỉ làm ẩn khối đó, không chặn cả màn Ví.
  const loyaltyQ = useQuery({ ...loyaltyQuery(coreHttp), enabled: authed });
  // Khoá con của ['wallet'] nên làm mới ví cũng làm mới luôn sao kê.
  const txQ = useInfiniteQuery({
    ...walletTransactionsQuery(coreHttp),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.meta.page * last.meta.limit < last.meta.total ? last.meta.page + 1 : undefined),
    enabled: authed,
  });

  const w = walletQ.data;
  const loyalty = loyaltyQ.data;

  if (phase === 'loading') {
    return (
      <LedgerShell title={TITLE} wide>
        <AuthLoading />
      </LedgerShell>
    );
  }
  if (phase === 'unavailable') {
    return (
      <LedgerShell title={TITLE} wide>
        <SessionUnavailable />
      </LedgerShell>
    );
  }
  if (phase === 'guest') {
    return (
      <LedgerShell title={TITLE} wide>
        <LoginRequired message="Đăng nhập để xem Ví Tubu của bạn." returnTo="/tai-khoan/vi-tubu" />
      </LedgerShell>
    );
  }
  if (walletQ.isLoading) {
    return (
      <LedgerShell title={TITLE} wide>
        <div className="space-y-3">
          <Skeleton height={140} />
          <Skeleton height={110} />
          <Skeleton height={90} />
        </div>
      </LedgerShell>
    );
  }
  if (!w) {
    return (
      <LedgerShell title={TITLE} wide>
        <ErrorState message={errText(walletQ.error)} onRetry={() => void walletQ.refetch()} />
      </LedgerShell>
    );
  }

  // Khách thường không có hoa hồng: hai thẻ 0đ chỉ khiến tiền hoàn bị hiểu thành hoa hồng.
  // Vẫn hiện khi còn khoản hoa hồng thật dù role chưa khớp (tiền của khách không được giấu).
  const showCommission = isCommissionRole || w.commissionPending > 0 || w.commissionApproved > 0;
  const ctvLinkable = w.commissionApproved > 0 && isWebRouteReady('/ctv');
  const points = loyalty ? pointsSummary(loyalty) : null;
  // Ví 0đ và chưa có biến động: nói tiền vào Ví từ đâu thay cho câu chung chung và khối Mẹo (trùng ý).
  const walletEmpty = w.walletBalance === 0 && txQ.isSuccess && (txQ.data?.pages[0]?.data.length ?? 0) === 0;
  const tierName = (loyalty?.tier as { name?: string } | null | undefined)?.name;

  return (
    <LedgerShell title={TITLE} wide>
      {/* Dưới md hai cột "contents" để mọi khối xếp một cột theo thứ tự của Mini App (max-md:order-*); từ md giữ hai cột của máy tính. */}
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <div className="max-md:contents md:flex md:flex-col md:gap-4">
          <section aria-label="Số dư Ví Tubu" className="rounded-card bg-gradient-to-br from-forest-600 to-forest-700 p-5 text-stone-0 shadow-raised max-md:order-1">
            <div className="text-sm">Ví Tubu (số dư khả dụng)</div>
            <div className="mt-1 text-3xl font-bold tabular-nums">{formatVnd(w.walletBalance)}</div>
          </section>
          <p className="-mt-2 px-1 text-xs text-stone-600 max-md:order-2">
            {walletEmpty
              ? walletCopy.empty
              : showCommission
              ? `Tiền thật từ hoa hồng${CASHBACK_ENABLED ? ' & hoàn tiền sàn ngoài' : ''} — dùng để trả tiền hàng.`
              : 'Dùng để trả tiền hàng ở bước thanh toán'}
          </p>

          <div className="max-md:order-3">
            <Link href="/tai-khoan/diem-xanh" className={`flex min-h-11 items-center gap-3 p-4 hover:bg-stone-50 ${miniCard}`}>
              <span className="grid h-11 w-11 flex-none place-items-center rounded-full bg-stone-100">
                <Leaf className="h-5 w-5 text-forest-600" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-stone-600">Điểm Xanh (đổi giảm giá)</span>
                {/* Hạng nằm dưới số, không cùng hàng: ở 390px cột số chỉ còn ~120px nên số bị gãy "130.000 / điểm". */}
                <span className="block whitespace-nowrap text-xl font-bold tabular-nums text-stone-900">{formatCount(points?.total ?? 0)} điểm</span>
                {tierName && (
                  <span className="mt-1 block">
                    <Badge tone="brand">{tierName}</Badge>
                  </span>
                )}
                {points?.convertedNote && <span className="mt-1 block text-xs text-stone-700">{points.convertedNote}</span>}
              </span>
              <ChevronRight className="h-4 w-4 flex-none text-stone-500" aria-hidden="true" />
            </Link>
            <p className="mt-1.5 px-1 text-xs text-stone-600">Tích từ mỗi đơn đã giao — đổi giảm giá cho đơn sau &amp; lên hạng thành viên.</p>
            {points?.convertedNote && (
              <p className="mt-0.5 px-1 text-xs text-stone-600">
                Điểm không hết hạn dùng trả đơn hàng tới 100% giá trị hàng và góp quỹ trồng cây. Không rút ra tiền.
              </p>
            )}
          </div>

          {showCommission && (
            <div className="flex gap-2.5 max-md:order-5">
              <SourceCard label="Hoa hồng chờ duyệt" value={w.commissionPending} icon={Clock} />
              {/* Hoa hồng đã duyệt KHÔNG tự vào Ví: phải bấm "Chuyển vào Ví" ở trang Cộng tác viên, nên thẻ chỉ dẫn khi có tiền. */}
              <SourceCard
                label="Hoa hồng có thể chuyển vào Ví"
                value={w.commissionApproved}
                icon={CheckCircle2}
                hint={ctvLinkable ? 'Chuyển vào Ví →' : undefined}
                href={ctvLinkable ? '/ctv' : undefined}
              />
            </div>
          )}

          {/* Khoản đã duyệt còn chờ về Ví là tiền của khách nên vẫn hiện dù lối vào Hoàn tiền sàn ngoài đã ẩn. */}
          {(CASHBACK_ENABLED || w.cashbackPending > 0) && (
            <div className="max-md:order-6">
              <SourceCard label="Hoàn tiền đã duyệt, chờ về Ví" value={w.cashbackPending} icon={ShoppingBag} wide />
            </div>
          )}

          {!walletEmpty && (
            <div className="flex gap-2 rounded-card bg-promo-bg p-4 max-md:order-7">
              <Wallet className="h-5 w-5 flex-none text-promo-fg" aria-hidden="true" />
              <p className="text-xs text-promo-fg">
                Mẹo: tiền hoàn đơn và hoa hồng CTV vào Ví Tubu, dùng <b>trả đơn sau</b> ở bước thanh toán.
              </p>
            </div>
          )}
        </div>

        <div className="max-md:contents md:flex md:flex-col md:gap-4">
          <WalletHistory q={txQ} />
        </div>
      </div>

    </LedgerShell>
  );
}

/** Thẻ một nguồn tiền; có `href` thì cả thẻ là liên kết. */
function SourceCard({ label, value, icon: SourceIcon, wide, hint, href }: { label: string; value: number; icon: LucideIcon; wide?: boolean; hint?: string; href?: string }) {
  const body = (
    <>
      <span className="grid h-8 w-8 place-items-center rounded-full bg-stone-100">
        <SourceIcon className="h-4 w-4 text-forest-600" aria-hidden="true" />
      </span>
      <span className={`mt-1 block font-bold tabular-nums text-stone-900 ${wide ? 'text-lg' : 'text-base'}`}>{formatVnd(value)}</span>
      <span className="block text-xs text-stone-600">{label}</span>
      {hint && <span className="mt-1 block text-xs font-semibold text-forest-700">{hint}</span>}
    </>
  );
  const cls = `block min-w-0 flex-1 p-3 ${miniCard}`;
  return href ? (
    <Link href={href} className={`${cls} min-h-11 hover:bg-stone-50`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Sao kê Ví Tubu từ sổ cái: mỗi biến động một dòng kèm số dư sau giao dịch. */
function WalletHistory({ q }: { q: UseInfiniteQueryResult<InfiniteData<WalletTxnPage>> }) {
  const rows = uniqueById(q.data?.pages.flatMap((p) => p.data) ?? []);

  return (
    <section aria-label="Lịch sử Ví" className={`p-4 max-md:order-8 ${miniCard}`}>
      <div className="mb-1 flex items-center gap-2">
        <History className="h-5 w-5 text-forest-600" aria-hidden="true" />
        <h2 className="text-base font-semibold text-stone-900">Lịch sử Ví</h2>
      </div>
      {q.isLoading ? (
        <div className="mt-2 space-y-2">
          <Skeleton height={44} />
          <Skeleton height={44} />
        </div>
      ) : q.isError && rows.length === 0 ? (
        <ErrorState message={errText(q.error)} onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <p className="mt-1 text-sm text-stone-600">Chưa có biến động nào trong Ví.</p>
      ) : (
        <>
          <ul className="divide-y divide-stone-200">
            {rows.map((t) => (
              <li key={t.id} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="break-words text-sm font-medium text-stone-900">{walletTxLabel(t.type, t.reason)}</div>
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
          {q.hasNextPage && (
            <div className="mt-3 text-center">
              <button type="button" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage} className={miniBtnSecondary}>
                {q.isFetchingNextPage ? 'Đang tải…' : 'Xem thêm'}
              </button>
              {q.isFetchNextPageError && (
                <p role="alert" className={`mt-2 ${ui.error}`}>
                  Không tải thêm được lịch sử. Vui lòng thử lại.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
