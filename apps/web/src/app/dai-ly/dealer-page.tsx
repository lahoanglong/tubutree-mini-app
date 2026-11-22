'use client';

import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { dealerMeQuery } from '@tubutree/app-core/queries/dealer';
import { coreHttp } from '@/lib/core-http';
import { useAuthPhase } from '@/lib/auth-phase';
import { usePublicConfig } from '@/lib/use-public-config';
import { AuthLoading, SessionUnavailable } from '@/components/login-required';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { DealerApply, DealerPending } from '@/components/dealer/dealer-apply';
import { DealerHub } from '@/components/dealer/dealer-hub';
import { DealerShell, errText } from '@/components/dealer/dealer-shell';
import { DealerGuestLanding } from '@/components/dealer/dealer-guest-landing';
import { GUEST_ONLY_WHILE_RESTORING, RESTORING_ONLY } from '@/lib/restoring-swap';
import { useHydrated } from '@/lib/use-hydrated';

const TITLE = 'Kênh đại lý';

/** Màn khách khi không có bản máy chủ dựng sẵn: số đọc từ cấu hình công khai phía trình duyệt. */
function DealerGuestLandingLive() {
  const config = usePublicConfig();
  return (
    <DealerGuestLanding
      maxDiscountPct={config.isLoaded ? (config.dealer?.maxDiscountPct ?? null) : null}
      reviewHours={config.isLoaded ? (config.dealer?.reviewHours ?? null) : null}
    />
  );
}

/**
 * `/dai-ly` theo `dealer.tsx` của Mini App: đã là đại lý (APPROVED) → hub; PENDING → màn chờ; còn lại → form đăng ký
 * (REJECTED kèm lý do). Mọi nhánh có đúng một h1.
 *
 * `guestLanding`: màn khách do `page.tsx` dựng ở máy chủ (trong `PrebuiltGuest`, lượt vẽ đầu là 'guest'). Máy còn cờ phiên (`data-restoring` trên
 * <html>, đặt trước khi vẽ) thì CSS giấu màn khách và hiện khung chờ cho tới khi hydrate biết pha thật (sau hydrate pha quyết định, ô khung chờ bỏ), nên khách đã đăng nhập không thấy màn khách chớp qua.
 */
export default function DealerPage({ guestLanding }: { guestLanding?: ReactNode }) {
  const phase = useAuthPhase();
  const hydrated = useHydrated();
  const meQ = useQuery({ ...dealerMeQuery(coreHttp), enabled: phase === 'authenticated' });

  if (phase === 'loading') {
    return (
      <DealerShell title={TITLE}>
        <AuthLoading />
      </DealerShell>
    );
  }
  if (phase === 'unavailable') {
    return (
      <DealerShell title={TITLE}>
        <SessionUnavailable />
      </DealerShell>
    );
  }
  if (phase === 'guest') {
    return (
      <DealerShell title={TITLE} guest>
        <div className={hydrated ? undefined : GUEST_ONLY_WHILE_RESTORING}>{guestLanding ?? <DealerGuestLandingLive />}</div>
        {!hydrated && (
          <div className={RESTORING_ONLY} aria-hidden="true">
            <AuthLoading />
          </div>
        )}
      </DealerShell>
    );
  }
  if (meQ.isLoading) {
    return (
      <DealerShell title={TITLE}>
        <div className="space-y-3">
          <Skeleton height={100} />
          <Skeleton height={60} />
        </div>
      </DealerShell>
    );
  }
  if (meQ.isError && !meQ.data) {
    return (
      <DealerShell title={TITLE}>
        <ErrorState message={errText(meQ.error)} onRetry={() => meQ.refetch()} />
      </DealerShell>
    );
  }

  const me = meQ.data!;
  if (me.isDealer || me.status === 'APPROVED') return <DealerHub />;
  if (me.status === 'PENDING') return <DealerPending />;
  return <DealerApply rejected={me.status === 'REJECTED'} rejectionReason={me.rejectionReason ?? null} />;
}
