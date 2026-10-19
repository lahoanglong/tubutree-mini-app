'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import type { WasteMeDTO, WasteMethod } from '@tubutree/shared-types';
import { wasteMeQuery } from '@tubutree/app-core/queries/waste';
import { rewardsQuery } from '@tubutree/app-core/queries/loyalty';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { usePublicConfig } from '@/lib/use-public-config';
import { pointsSummary } from '@/lib/checkout-points';
import { ui } from '@/lib/guest-ui';
import { skin } from '@/components/pro-shared/mini-skin';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { MiniAppOnlyNotice } from '@/components/mini-app-only-notice';
import { Badge } from '@/components/ui/badge';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Skeleton } from '@/components/ui/skeleton';
import { RecycleLinkRow } from './recycle-link-row';
import { RecycleTimeline } from './recycle-timeline';
import {
  BLOCKED_TEXT,
  LOGIN_TEXT,
  METHOD_FLAG,
  METHOD_LABELS,
  METHOD_LINE,
  METHOD_ORDER,
  PAUSED_TEXT,
  POINT_VALUE_VND,
  TIMELINE_STEPS,
  closedLabel,
  equivalentUnits,
  formatLineQty,
  formatPoints,
  formatVnd,
  impactLine,
  isRequestPaused,
  nextRewardProgress,
  requestStatusText,
  ruleText,
  timelineFor,
} from './recycle-labels';

const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Đã có lỗi xảy ra — Vui lòng thử lại');

function Shell({ children, showHistory = false }: { children: ReactNode; showHistory?: boolean }) {
  return (
    <main className={`mx-auto max-w-5xl space-y-4 px-4 py-6 pb-12 ${skin.mainUp}`}>
      <PageHeader
        title="Đổi rác lấy quà"
        actions={
          showHistory ? (
            <Link href="/doi-rac/yeu-cau" aria-label="Yêu cầu của tôi" className="inline-flex min-h-11 w-11 items-center justify-center rounded-control text-stone-800 hover:bg-stone-50 md:border md:border-stone-450 md:bg-stone-0">
              <History className="h-5 w-5" aria-hidden="true" />
            </Link>
          ) : undefined
        }
      />
      {children}
    </main>
  );
}

function NoticeCard({ text }: { text: string }) {
  return (
    <div className={`p-4 text-sm font-semibold text-stone-900 ${skin.card}`}>
      <p>{text}</p>
    </div>
  );
}

function RequestsBlock({ me }: { me: WasteMeDTO }) {
  const cfg = usePublicConfig();
  if (me.openRequests.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className={skin.sectionTitle}>Yêu cầu đang xử lý</h2>
      <div className="grid gap-3 md:grid-cols-2">
        {me.openRequests.map((r) => {
          const tl = timelineFor(r);
          const closed = tl ? null : closedLabel({ ...r, rejectionReason: null, rejectionNote: null, reversedPoints: null, reversalReason: null });
          const subtitle = r.lines.map((l) => formatLineQty(l.itemName, l.declaredQty, l.unitLabel)).join(', ');
          const paused = isRequestPaused(r, {
            programmeEnabled: me.programmeEnabled,
            blocked: me.blocked,
            shipLockedAt: me.shipLockedAt,
            cfg: { enabled: cfg.waste.enabled, pickup: cfg.waste.pickup, isLoaded: cfg.isLoaded },
          });
          const status = requestStatusText(r, { blocked: me.blocked, paused });
          return (
            <div key={r.id} className={skin.card}>
              <RecycleLinkRow href={`/doi-rac/yeu-cau/${r.id}`} title={`${r.code} · ${METHOD_LABELS[r.method]}`} subtitle={subtitle} />
              <div className="px-4 pb-3">
                {tl ? (
                  <div className="space-y-2">
                    <div>
                      <Badge tone="brand">{status}</Badge>
                    </div>
                    <RecycleTimeline compact label={`Tiến độ ${r.code}`} steps={TIMELINE_STEPS[r.method]} current={tl.current} />
                  </div>
                ) : (
                  closed && <p className="text-xs text-stone-600">{closed.reason ? `${closed.label}: ${closed.reason}` : closed.label}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function RecycleHome() {
  const phase = useAuthPhase();
  const cfg = usePublicConfig();

  const meQ = useQuery({ ...wasteMeQuery(coreHttp), enabled: phase === 'authenticated' });
  const me = meQ.data;
  const fullPage = me?.programmeEnabled === true && me.eligibility === 'OK' && !me.blocked;
  const rewardsQ = useQuery({ ...rewardsQuery(coreHttp), enabled: phase === 'authenticated' && fullPage });

  const showHistory = me?.eligibility === 'OK';

  if (phase === 'loading') {
    return (
      <Shell>
        <AuthLoading />
      </Shell>
    );
  }
  if (phase === 'unavailable') {
    return (
      <Shell>
        <SessionUnavailable />
      </Shell>
    );
  }
  if (phase === 'guest') {
    return <Shell>{cfg.isLoaded && !cfg.waste.enabled ? <NoticeCard text={PAUSED_TEXT} /> : <LoginRequired message={LOGIN_TEXT} returnTo="/doi-rac" />}</Shell>;
  }
  if (meQ.isPending) {
    return (
      <Shell>
        <Skeleton height={140} rounded="rounded-card" />
        <Skeleton height={80} rounded="rounded-card" />
        <Skeleton height={80} rounded="rounded-card" />
      </Shell>
    );
  }
  if (meQ.isError || !me) return <Shell><ErrorState message={errText(meQ.error)} onRetry={() => void meQ.refetch()} /></Shell>;

  const openRequests = <RequestsBlock me={me} />;
  // Kho vẫn mở quầy khi chương trình tạm dừng hoặc khách bị khoá (15.1), nên lối vào không phụ thuộc hai nhánh đó.
  const deskRow =
    me.deskPoints.length > 0 ? (
      <RecycleLinkRow href="/doi-rac/quay" title="Nhận hàng tại điểm" subtitle={me.deskPoints.map((p) => p.name).join(', ')} />
    ) : null;

  if (!me.programmeEnabled) {
    return (
      <Shell showHistory={showHistory}>
        <NoticeCard text={PAUSED_TEXT} />
        {openRequests}
        {deskRow && <div className={skin.card}>{deskRow}</div>}
      </Shell>
    );
  }
  // Chưa có SĐT đã xác minh thì web không xin được (chỉ Zalo xin được): chỉ chỉ đường sang Mini App, không có đường lách (Q2).
  if (me.eligibility !== 'OK') {
    return (
      <Shell>
        <MiniAppOnlyNotice path="/doi-rac" />
        {deskRow && <div className={skin.card}>{deskRow}</div>}
      </Shell>
    );
  }
  if (me.blocked) {
    return (
      <Shell showHistory={showHistory}>
        <NoticeCard text={BLOCKED_TEXT} />
        {openRequests}
        {deskRow && <div className={skin.card}>{deskRow}</div>}
      </Shell>
    );
  }

  const total = me.balance ? pointsSummary(me.balance).total : 0;
  const items = [...me.items].sort((a, b) => a.sortOrder - b.sortOrder);
  const firstActive = items.find((i) => i.status === 'ACTIVE');
  const progress = nextRewardProgress(rewardsQ.data);
  const methods = METHOD_ORDER.filter((m: WasteMethod) => {
    const flag = METHOD_FLAG[m];
    return cfg.waste[flag] && me.laneFlags[flag] && (m === 'DROP_OFF' || !me.shipLockedAt);
  });
  const impact = impactLine(me.impactGrams);
  const giftNames = rewardsQ.data?.rewards.slice(0, 2).map((r) => r.name).join(', ');

  return (
    <Shell showHistory>
      <div className={`space-y-2 p-4 ${skin.card}`}>
        <p className="text-xs text-stone-600">Điểm Xanh của bạn</p>
        <p className="font-display text-3xl font-semibold tabular-nums text-stone-900">{formatPoints(total)}</p>
        <p className="text-sm text-stone-700">{`Dùng như ${formatVnd(total * POINT_VALUE_VND)} khi mua sắm`}</p>
        {impact && (
          <div>
            <p className="text-sm text-stone-900">{impact}</p>
            <p className="text-xs text-stone-600">Ước tính theo khối lượng trung bình</p>
          </div>
        )}
        {progress && (
          <div>
            <ProgressBar value={progress.have} max={progress.cost} label={`Còn ${formatPoints(progress.missing)} tới ${progress.rewardName}`} />
            {firstActive && (
              <p className="mt-1 text-xs text-stone-600">{`tương đương khoảng ${equivalentUnits(progress.missing, firstActive)} ${firstActive.name.toLowerCase()}`}</p>
            )}
          </div>
        )}
        {methods.length > 0 && (
          <Link href="/doi-rac/tao" className={`${ui.btnPrimary} w-full sm:w-auto`}>
            Đổi rác ngay
          </Link>
        )}
      </div>

      {openRequests}

      <div className="grid gap-6 lg:grid-cols-2">
        {methods.length > 0 && (
          <section className="space-y-2">
            <h2 className={skin.sectionTitle}>Cách đổi</h2>
            {methods.map((m) => (
              <div key={m} className={`p-3 ${skin.card}`}>
                <p className="text-sm font-semibold text-stone-900">{METHOD_LABELS[m]}</p>
                <p className="text-xs text-stone-600">{METHOD_LINE[m]}</p>
              </div>
            ))}
          </section>
        )}

        <section className="space-y-2">
          <h2 className={skin.sectionTitle}>Tubu nhận những món này</h2>
          {items.map((item) => (
            <div key={item.id} data-item data-status={item.status} className={`space-y-0.5 ${item.status === 'COMING_SOON' ? 'opacity-70' : ''}`}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-stone-900 max-md:text-[length:var(--type-body-sm-size)]">{item.name}</span>
                {item.status === 'COMING_SOON' && <Badge>Sắp nhận</Badge>}
              </div>
              <p className="text-xs text-stone-700 max-md:text-[length:var(--type-caption-size)] max-md:leading-[var(--type-caption-lh)]">{ruleText(item)}</p>
              {item.prepInstructions && <p className="text-xs text-stone-600 max-md:text-[length:var(--type-caption-size)] max-md:leading-[var(--type-caption-lh)]">{item.prepInstructions}</p>}
            </div>
          ))}
        </section>
      </div>

      <div className={`divide-y divide-stone-200 ${skin.card} max-md:divide-y-0 max-md:bg-transparent max-md:shadow-none`}>
        <RecycleLinkRow bare href="/kho-qua" title="Kho quà" subtitle={giftNames || undefined} />
        {deskRow}
        <RecycleLinkRow bare href="/doi-rac/quy-dinh" title="Thể lệ chương trình" />
      </div>
    </Shell>
  );
}
