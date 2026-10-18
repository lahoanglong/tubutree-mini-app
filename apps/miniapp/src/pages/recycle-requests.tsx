import { useState } from 'react';
import type { ReactNode } from 'react';
import { Page, useNavigate } from 'zmp-ui';
import { useQuery } from '@tanstack/react-query';
import { WASTE_QUERY_KEYS, listWasteRequests } from '../services/waste-api';
import { getErrorMessage } from '../services/api';
import { useAuthPhase } from '../hooks/use-auth-phase';
import { SessionUnavailable } from '../components/ui/auth-gate';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { ListRow } from '../components/ui/list-row';
import { PageHeader } from '../components/ui/page-header';
import { SegmentedTabs } from '../components/ui/segmented-tabs';
import { Skeleton } from '../components/ui/skeleton';
import { formatDate } from '../utils/format';
import { METHOD_LABELS, requestStatusText } from '../utils/waste-labels';

const OPEN_STATUSES: readonly string[] = ['OPEN', 'IN_TRANSIT', 'RECEIVED'];
const COLUMN = { display: 'flex', flexDirection: 'column' } as const;

export default function RecycleRequestsPage() {
  const navigate = useNavigate();
  const phase = useAuthPhase();
  const [tab, setTab] = useState<'open' | 'closed'>('open');
  const q = useQuery({ queryKey: WASTE_QUERY_KEYS.requests, queryFn: listWasteRequests, enabled: phase === 'authenticated' });

  const shell = (content: ReactNode) => (
    <Page style={{ background: 'var(--color-bg-canvas)' }}>
      <PageHeader title="Yêu cầu của tôi" />
      <div style={{ ...COLUMN, padding: 16, paddingBottom: 48, gap: 16 }}>{content}</div>
    </Page>
  );

  if (phase === 'unavailable') return shell(<SessionUnavailable />);
  if (q.isError) return shell(<ErrorState message={getErrorMessage(q.error)} onRetry={() => void q.refetch()} />);
  if (q.isPending || !q.data) return shell(<Skeleton height={120} />);

  const rows = q.data;
  if (rows.length === 0) {
    return shell(<EmptyState art="box" heading="Chưa có yêu cầu nào" ctaLabel="Đổi rác ngay" onCta={() => navigate('/recycle/new')} />);
  }
  const openRows = rows.filter((r) => OPEN_STATUSES.includes(r.status));
  const closedRows = rows.filter((r) => !OPEN_STATUSES.includes(r.status));
  const shown = tab === 'open' ? openRows : closedRows;

  return shell(
    <>
      <SegmentedTabs
        value={tab}
        onChange={(k) => setTab(k as 'open' | 'closed')}
        items={[
          { key: 'open', label: 'Đang xử lý', count: openRows.length },
          { key: 'closed', label: 'Đã đóng', count: closedRows.length },
        ]}
      />
      <div style={{ ...COLUMN, gap: 8 }}>
        {shown.map((r) => (
          <ListRow
            key={r.id}
            title={`${r.code} · ${METHOD_LABELS[r.method]}`}
            subtitle={`${requestStatusText(r)} · ${formatDate(r.createdAt)}`}
            trailing="chevron"
            onPress={() => navigate(r.status === 'COMPLETED' ? `/recycle/done/${r.id}` : `/recycle/r/${r.id}`)}
          />
        ))}
      </div>
    </>,
  );
}
