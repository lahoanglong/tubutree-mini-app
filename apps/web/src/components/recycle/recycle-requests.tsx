'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { WasteRequestSummaryDTO } from '@tubutree/shared-types';
import { wasteRequestsQuery } from '@tubutree/app-core/queries/waste';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { formatDate } from '@/lib/format-date';
import { ui } from '@/lib/guest-ui';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { SegmentedTabs } from '@/components/ui/segmented-tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { RecycleLinkRow } from './recycle-link-row';
import { METHOD_LABELS, closedLabel, formatPoints } from './recycle-labels';

const OPEN_STATUSES: readonly string[] = ['OPEN', 'IN_TRANSIT', 'RECEIVED'];

const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Đã có lỗi xảy ra — Vui lòng thử lại');

function statusText(r: WasteRequestSummaryDTO): string {
  switch (r.status) {
    case 'OPEN':
      return 'Đang mở';
    case 'IN_TRANSIT':
      return 'Đang vận chuyển';
    case 'RECEIVED':
      return 'Kho đã nhận, đang đếm';
    case 'COMPLETED':
      return `Đã cộng ${formatPoints(r.pointsAwarded ?? 0)}`;
    case 'REJECTED':
      return 'Bị từ chối';
    case 'CANCELLED':
      return 'Đã huỷ';
    case 'REVERSED':
      return 'Đã thu hồi điểm';
    default:
      return closedLabel({ ...r, rejectionReason: null, rejectionNote: null, reversedPoints: null, reversalReason: null })!.label;
  }
}

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
  const q = useQuery({ ...wasteRequestsQuery(coreHttp), enabled: phase === 'authenticated' });

  if (phase === 'loading') return <Shell><AuthLoading /></Shell>;
  if (phase === 'unavailable') return <Shell><SessionUnavailable /></Shell>;
  if (phase === 'guest') return <Shell><LoginRequired message="Đăng nhập để xem các yêu cầu đổi rác của bạn." returnTo="/doi-rac/yeu-cau" /></Shell>;
  if (q.isError) return <Shell><ErrorState message={errText(q.error)} onRetry={() => void q.refetch()} /></Shell>;
  if (q.isPending || !q.data) return <Shell><Skeleton height={120} rounded="rounded-card" /></Shell>;

  const rows = q.data;
  if (rows.length === 0) {
    return (
      <Shell>
        <div className={`flex flex-col items-center gap-3 p-8 text-center ${ui.card}`}>
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
      <div className={`divide-y divide-stone-200 ${ui.card}`}>
        {shown.map((r) => (
          <RecycleLinkRow
            key={r.id}
            href={r.status === 'COMPLETED' ? `/doi-rac/xong/${r.id}` : `/doi-rac/yeu-cau/${r.id}`}
            title={`${r.code} · ${METHOD_LABELS[r.method]}`}
            subtitle={`${statusText(r)} · ${formatDate(r.createdAt)}`}
          />
        ))}
      </div>
    </Shell>
  );
}
