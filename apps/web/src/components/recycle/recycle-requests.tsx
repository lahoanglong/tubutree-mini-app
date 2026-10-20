'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { wasteMeQuery, wasteRequestsQuery } from '@tubutree/app-core/queries/waste';
import { friendlyError as errText, isAuthError } from '@/lib/friendly-error';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { formatDate } from '@/lib/format-date';
import { usePublicConfig } from '@/lib/use-public-config';
import { ui } from '@/lib/guest-ui';
import { skin } from '@/components/pro-shared/mini-skin';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { SegmentedTabs } from '@/components/ui/segmented-tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { MiniAppOnlyNotice } from '@/components/mini-app-only-notice';
import { RecycleLinkRow } from './recycle-link-row';
import { METHOD_LABELS, isRequestPaused, requestStatusText } from './recycle-labels';

const OPEN_STATUSES: readonly string[] = ['OPEN', 'IN_TRANSIT', 'RECEIVED'];

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-6 pb-12">
      <PageHeader title="Yêu cầu của tôi" backHref="/doi-rac" backLabel="Đổi rác lấy quà" />
      {children}
    </main>
  );
}

export function RecycleRequests() {
  const phase = useAuthPhase();
  const [tab, setTab] = useState<'open' | 'closed'>('open');
  const cfg = usePublicConfig();
  const meQ = useQuery({ ...wasteMeQuery(coreHttp), enabled: phase === 'authenticated' });
  const me = meQ.data;
  // /waste/me lỗi thì vẫn cho xem danh sách (dòng giữ chữ thường); chỉ khách chưa đủ điều kiện mới không gọi.
  const q = useQuery({
    ...wasteRequestsQuery(coreHttp),
    enabled: phase === 'authenticated' && (meQ.isError || me?.eligibility === 'OK'),
  });

  if (phase === 'loading') return <Shell><AuthLoading /></Shell>;
  if (phase === 'unavailable') return <Shell><SessionUnavailable /></Shell>;
  if (phase === 'guest') return <Shell><LoginRequired message="Đăng nhập để xem các yêu cầu đổi rác của bạn." returnTo="/doi-rac/yeu-cau" /></Shell>;
  // Chưa có SĐT đã xác minh thì web không xin được (chỉ Zalo xin được): chỉ chỉ đường sang Mini App, như ba trang đổi rác kia (Q2).
  if (me && me.eligibility !== 'OK') return <Shell><MiniAppOnlyNotice path="/doi-rac/yeu-cau" /></Shell>;
  if (q.isError) return <Shell><ErrorState message={errText(q.error)} onRetry={isAuthError(q.error) ? undefined : () => void q.refetch()} /></Shell>;
  if (q.isPending || !q.data) return <Shell><Skeleton height={120} rounded="rounded-card" /></Shell>;

  const rows = q.data;
  if (rows.length === 0) {
    return (
      <Shell>
        <div className={`flex flex-col items-center gap-3 p-8 text-center ${skin.card}`}>
          <p className="text-base font-semibold text-stone-900">Chưa có yêu cầu nào</p>
          <Link href="/doi-rac/tao" className={ui.btnPrimary}>
            Đổi rác ngay
          </Link>
        </div>
      </Shell>
    );
  }
  const openRows = rows.filter((r) => OPEN_STATUSES.includes(r.status));
  const closedRows = rows.filter((r) => !OPEN_STATUSES.includes(r.status));
  const shown = tab === 'open' ? openRows : closedRows;

  return (
    <Shell>
      <SegmentedTabs
        value={tab}
        onChange={(k) => setTab(k as 'open' | 'closed')}
        label="Trạng thái yêu cầu"
        items={[
          { key: 'open', label: 'Đang xử lý', count: openRows.length },
          { key: 'closed', label: 'Đã đóng', count: closedRows.length },
        ]}
      />
      <div className={`divide-y divide-stone-200 ${skin.plain} max-md:divide-y-0`}>
        {shown.map((r) => {
          const paused =
            !!me &&
            isRequestPaused(r, {
              programmeEnabled: me.programmeEnabled,
              blocked: me.blocked,
              shipLockedAt: me.shipLockedAt,
              cfg: { enabled: cfg.waste.enabled, pickup: cfg.waste.pickup, isLoaded: cfg.isLoaded },
            });
          return (
            <RecycleLinkRow
              bare
              key={r.id}
              href={r.status === 'COMPLETED' ? `/doi-rac/xong/${r.id}` : `/doi-rac/yeu-cau/${r.id}`}
              title={`${r.code} · ${METHOD_LABELS[r.method]}`}
              subtitle={`${requestStatusText(r, { blocked: me?.blocked, paused })} · ${formatDate(r.createdAt)}`}
            />
          );
        })}
      </div>
    </Shell>
  );
}
