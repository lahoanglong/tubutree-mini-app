'use client';

import { useEffect } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Droplet } from 'lucide-react';
import { wasteMeQuery, wasteRequestQuery } from '@tubutree/app-core/queries/waste';
import { rewardsQuery } from '@tubutree/app-core/queries/loyalty';
import { useAuthPhase } from '@/lib/auth-phase';
import { pointsSummary, formatCount } from '@/lib/checkout-points';
import { coreHttp } from '@/lib/core-http';
import { ui } from '@/lib/guest-ui';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Skeleton } from '@/components/ui/skeleton';
import { DeclaredCountedTable } from './declared-counted-table';
import { formatPoints, impactLine, nextRewardProgress } from './recycle-labels';

const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Đã có lỗi xảy ra — Vui lòng thử lại');

function Shell({ id, subtitle, children }: { id: string; subtitle?: string; children: ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-6 pb-12">
      <PageHeader title="Kết quả đổi rác" subtitle={subtitle} backHref={`/doi-rac/yeu-cau/${id}`} backLabel="Yêu cầu đổi rác" />
      {children}
    </main>
  );
}

export function RecycleDone({ id }: { id: string }) {
  const router = useRouter();
  const phase = useAuthPhase();
  const authed = phase === 'authenticated';
  const path = `/doi-rac/yeu-cau/${id}`;

  const q = useQuery({ ...wasteRequestQuery(coreHttp, id), enabled: authed });
  const meQ = useQuery({ ...wasteMeQuery(coreHttp), enabled: authed });
  const rewardsQ = useQuery({ ...rewardsQuery(coreHttp), enabled: authed });
  const r = q.data;
  const notDone = !!r && r.status !== 'COMPLETED';

  useEffect(() => {
    if (notDone) router.replace(path);
  }, [notDone, router, path]);

  if (phase === 'loading') return <Shell id={id}><AuthLoading /></Shell>;
  if (phase === 'unavailable') return <Shell id={id}><SessionUnavailable /></Shell>;
  if (phase === 'guest') return <Shell id={id}><LoginRequired message="Đăng nhập để xem kết quả đổi rác của bạn." returnTo={`/doi-rac/xong/${id}`} /></Shell>;
  if (q.isError) return <Shell id={id}><ErrorState message={errText(q.error)} onRetry={() => void q.refetch()} /></Shell>;
  if (!r) return <Shell id={id}><Skeleton height={120} rounded="rounded-card" /></Shell>;
  if (notDone) return <Shell id={id}><Skeleton height={120} rounded="rounded-card" /></Shell>;

  const awarded = r.pointsAwarded ?? 0;
  const short = r.lines.filter((l) => (l.receivedQty ?? 0) < l.unitsPerPoint);
  const me = meQ.data;
  const p = nextRewardProgress(rewardsQ.data);
  const drops = r.dropsAwarded ?? 0;
  const impact = impactLine(r.impactGrams);

  return (
    <Shell id={id} subtitle={r.code}>
      {awarded > 0 ? (
        <h2 className="font-display text-2xl font-semibold text-stone-900">{`Đã cộng ${formatPoints(awarded)}`}</h2>
      ) : (
        <div className="flex flex-col gap-1.5">
          <h2 className="font-display text-2xl font-semibold text-stone-900">Lượt này chưa đủ để cộng điểm</h2>
          {short.map((l) => (
            <p key={l.itemId} className="text-sm text-stone-600">
              {`${l.itemName} cần ${l.unitsPerPoint} ${l.unitLabel} mới được ${formatPoints(l.pointsPerGroup)}, kho đếm được ${l.receivedQty ?? 0} ${l.unitLabel}`}
            </p>
          ))}
        </div>
      )}
      <DeclaredCountedTable lines={r.lines} />
      {me && (
        <div className="flex flex-col gap-2">
          <p className="text-base text-stone-900">{`Số dư mới ${formatPoints(pointsSummary(me.balance ?? { pointsBalance: 0 }).total)}`}</p>
          {p && <ProgressBar value={p.have} max={p.cost} label={`Còn ${formatPoints(p.missing)} tới ${p.rewardName}`} />}
        </div>
      )}
      {drops > 0 && (
        <div className="flex items-center gap-2 text-sm text-stone-900">
          <Droplet className="h-5 w-5 text-forest-600" aria-hidden="true" />
          <span>{`+${formatCount(drops)} giọt nước vào bình của bạn`}</span>
        </div>
      )}
      {impact && (
        <div className={`p-4 ${ui.card}`}>
          <p className="text-sm text-stone-900">{impact}</p>
          <p className="text-xs text-stone-600">Ước tính theo khối lượng trung bình</p>
        </div>
      )}
      <div className="flex flex-col gap-2.5 sm:flex-row">
        <Link href="/kho-qua" className={`${ui.btnPrimary} w-full`}>
          Đổi quà ngay
        </Link>
        <Link href="/doi-rac/tao" className={`${ui.btnSecondary} w-full`}>
          Đổi thêm rác
        </Link>
      </div>
    </Shell>
  );
}
