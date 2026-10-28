'use client';

import Link from 'next/link';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Ticket } from 'lucide-react';
import type { GiftRedemptionDTO } from '@tubutree/shared-types';
import { myRedemptionsQuery } from '@tubutree/app-core/queries/loyalty';
import { NEW_COUPON_BADGE, NEW_COUPON_PARAM, sortRedemptions } from '@tubutree/app-core/reward-rules';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { formatCount } from '@/lib/checkout-points';
import { formatDate } from '@/lib/format-date';
import { EmptyState } from '@/components/mini';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { ClaimPointInfo } from '@/components/loyalty/claim-point';
import { Badge } from '@/components/ui/badge';
import { ErrorState } from '@/components/ui/error-state';
import { QrCode } from '@/components/ui/qr-code';
import { Skeleton } from '@/components/ui/skeleton';
import { miniOutline } from '@/components/loyalty/mini-surface';
import { LedgerShell } from '../../tai-khoan/ledger-shell';
import { loadErrorText } from '@/lib/error-text';

const TITLE = 'Quà của tôi';

const errText = loadErrorText;

function RedemptionStatus({ r }: { r: GiftRedemptionDTO }) {
  if (r.status === 'READY' && r.code) {
    return (
      <>
        <p className="font-display text-2xl font-semibold tracking-wide text-stone-900">{r.code}</p>
        <div data-testid="qr-center" className="flex justify-center">
          <QrCode value={r.code} size={140} />
        </div>
        {r.claimPoint && <ClaimPointInfo point={r.claimPoint} heading={`Nhận tại ${r.claimPoint.name}`} />}
        {r.claimExpiresAt && <div className="text-sm text-stone-700">{`Hạn nhận ${formatDate(r.claimExpiresAt)}`}</div>}
      </>
    );
  }
  if (r.status === 'CANCELLED') {
    return (
      <>
        <div className="text-sm text-stone-900">{`Đã huỷ: ${r.cancelReason ?? 'không rõ lý do'}`}</div>
        <div className="text-sm text-stone-700">{`Đã hoàn ${formatCount(r.refundedPoints ?? 0)} điểm`}</div>
      </>
    );
  }
  if (r.status === 'FULFILLED' && r.fulfilledAt) {
    return <div className="text-sm text-stone-700">{`Đã nhận ngày ${formatDate(r.fulfilledAt)}`}</div>;
  }
  return null;
}

function RedemptionEntry({ r, isNew }: { r: GiftRedemptionDTO; isNew?: boolean }) {
  if (r.giftKind === 'VOUCHER') {
    return (
      <div data-redemption>
        <Link href="/tai-khoan/diem-xanh" className={`flex min-h-11 items-center gap-3 p-4 hover:bg-stone-50 ${miniOutline}`}>
          <Ticket className="h-5 w-5 flex-none text-forest-600" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-sm font-semibold text-stone-900">
              {r.giftName}
              {isNew && <Badge tone="brand">{NEW_COUPON_BADGE}</Badge>}
            </span>
            {r.couponCode && <span className="block text-xs text-stone-700">{`Mã ${r.couponCode}`}</span>}
          </span>
          <ChevronRight className="h-4 w-4 flex-none text-stone-500" aria-hidden="true" />
        </Link>
      </div>
    );
  }
  return (
    <div data-redemption className={`space-y-2 p-4 ${miniOutline}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-base font-semibold text-stone-900">{r.giftName}</div>
        {r.status === 'READY' && <Badge tone="info">Chờ nhận</Badge>}
      </div>
      <RedemptionStatus r={r} />
    </div>
  );
}

function RewardsMineBody() {
  const q = useQuery(myRedemptionsQuery(coreHttp));
  const router = useRouter();
  const newCode = useSearchParams().get(NEW_COUPON_PARAM);

  if (q.isError) return <ErrorState message={errText(q.error)} onRetry={() => void q.refetch()} />;
  if (!q.data) return <Skeleton height={120} />;
  if (q.data.length === 0) return <EmptyState art="box" heading="Bạn chưa đổi quà nào" ctaLabel="Đến Kho quà" onCta={() => router.push('/kho-qua')} />;

  return (
    <div className="grid gap-3 pb-12 md:grid-cols-2">
      {sortRedemptions(q.data, newCode).map((r) => (
        <RedemptionEntry key={r.id} r={r} isNew={!!newCode && r.couponCode === newCode} />
      ))}
    </div>
  );
}

export default function RewardsMinePage() {
  const phase = useAuthPhase();
  return (
    <LedgerShell title={TITLE} wide>
      {phase === 'loading' && <AuthLoading />}
      {phase === 'unavailable' && <SessionUnavailable />}
      {phase === 'guest' && <LoginRequired message="Đăng nhập để xem quà bạn đã đổi." returnTo="/kho-qua/cua-toi" />}
      {phase === 'authenticated' && (
        <Suspense fallback={<Skeleton height={120} />}>
          <RewardsMineBody />
        </Suspense>
      )}
    </LedgerShell>
  );
}
