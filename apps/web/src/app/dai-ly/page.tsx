'use client';

import { useQuery } from '@tanstack/react-query';
import { dealerMeQuery } from '@tubutree/app-core/queries/dealer';
import { coreHttp } from '@/lib/core-http';
import { useAuthPhase } from '@/lib/auth-phase';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { DealerApply, DealerPending } from '@/components/dealer/dealer-apply';
import { DealerHub } from '@/components/dealer/dealer-hub';
import { DealerShell, errText } from '@/components/dealer/dealer-shell';

const TITLE = 'Kênh đại lý';

/**
 * `/dai-ly` theo `dealer.tsx` của Mini App: đã là đại lý (APPROVED) → hub; PENDING → màn chờ; còn lại → form đăng ký
 * (REJECTED kèm lý do). Mọi nhánh có đúng một h1.
 */
export default function DealerPage() {
  const phase = useAuthPhase();
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
      <DealerShell title={TITLE}>
        <LoginRequired message="Đăng nhập để vào kênh đại lý." returnTo="/dai-ly" />
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
        <ErrorState message={errText(meQ.error)} onRetry={() => void meQ.refetch()} />
      </DealerShell>
    );
  }

  const me = meQ.data!;
  if (me.isDealer || me.status === 'APPROVED') return <DealerHub />;
  if (me.status === 'PENDING') return <DealerPending />;
  return <DealerApply rejected={me.status === 'REJECTED'} rejectionReason={me.rejectionReason ?? null} />;
}
