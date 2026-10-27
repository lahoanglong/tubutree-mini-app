'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { guestPreviewCopy, tierRequirementText } from '@tubutree/app-core/guest-preview';
import { loyaltyPreviewQuery } from '@tubutree/app-core/queries/loyalty';
import { coreHttp } from '@/lib/core-http';
import { formatCount } from '@/lib/checkout-points';
import { formatMultiplier, moneyShort } from '@/lib/loyalty-copy';
import { loginHref } from '@/lib/return-to';
import { ui } from '@/lib/guest-ui';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { miniOutline } from './mini-surface';
import { loadErrorText } from '@/lib/error-text';

/** Nút đăng nhập của màn xem trước dành cho khách; đăng nhập xong quay lại đúng trang. */
export function GuestLoginLink({ returnTo }: { returnTo: string }) {
  return (
    <Link href={loginHref(returnTo)} className={`${ui.btnPrimary} w-full sm:w-auto`}>
      {guestPreviewCopy.loginCta}
    </Link>
  );
}

const errText = loadErrorText;

/** Trang Điểm Xanh cho khách chưa đăng nhập: chỉ xem bảng hạng, muốn đổi hay xem điểm của mình thì đăng nhập. */
export function GuestTiers({ returnTo }: { returnTo: string }) {
  const q = useQuery(loyaltyPreviewQuery(coreHttp));
  return (
    <div className="space-y-4 pb-12">
      <p className="text-base text-stone-700">{guestPreviewCopy.hint}</p>
      <GuestLoginLink returnTo={returnTo} />
      <h2 className="text-lg font-semibold text-stone-900">{guestPreviewCopy.tiersTitle}</h2>
      {q.isError && !q.data ? (
        <ErrorState message={errText(q.error)} onRetry={() => void q.refetch()} />
      ) : !q.data ? (
        <Skeleton height={120} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {q.data.tiers.map((t) => (
            <div key={t.id} data-tier className={`space-y-1 p-4 ${miniOutline}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="text-base font-semibold text-stone-900">{t.name}</div>
                <div className="text-caption font-semibold text-forest-700">{`Điểm x${formatMultiplier(t.multiplier)}`}</div>
              </div>
              <div className="text-caption text-stone-700">{tierRequirementText(t, (n) => `${formatCount(n)} điểm`, moneyShort)}</div>
              {t.perks.map((p) => (
                <div key={p} className="text-caption text-stone-600">{p}</div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
