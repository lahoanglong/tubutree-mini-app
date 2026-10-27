import { useState } from 'react';
import type { ReactNode } from 'react';
import { Page, useNavigate } from 'zmp-ui';
import { useQuery } from '@tanstack/react-query';
import { wasteGuestCopy } from '@tubutree/app-core/waste-copy';
import { useRecycleLogin } from '../hooks/use-recycle-login';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Text } from '../components/ui/text';
import { WASTE_QUERY_KEYS, getWasteMe, listWasteRequests } from '../services/waste-api';
import { getLoadErrorMessage } from '../services/api';
import { usePublicConfig } from '../hooks/use-public-config';
import { useAuthPhase } from '../hooks/use-auth-phase';
import { SessionUnavailable } from '../components/ui/auth-gate';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { ListRow } from '../components/ui/list-row';
import { PageHeader } from '../components/ui/page-header';
import { SegmentedTabs } from '../components/ui/segmented-tabs';
import { Skeleton } from '../components/ui/skeleton';
import { formatDate } from '../utils/format';
import { METHOD_LABELS, isRequestPaused, requestStatusText } from '../utils/waste-labels';

const OPEN_STATUSES: readonly string[] = ['OPEN', 'IN_TRANSIT', 'RECEIVED'];
const COLUMN = { display: 'flex', flexDirection: 'column' } as const;

export default function RecycleRequestsPage() {
  const navigate = useNavigate();
  const phase = useAuthPhase();
  const [tab, setTab] = useState<'open' | 'closed'>('open');
  const q = useQuery({ queryKey: WASTE_QUERY_KEYS.requests, queryFn: listWasteRequests, enabled: phase === 'authenticated' });
  const cfg = usePublicConfig();
  const meQ = useQuery({ queryKey: WASTE_QUERY_KEYS.me, queryFn: getWasteMe, enabled: phase === 'authenticated' });
  const me = meQ.data;
  const guestLogin = useRecycleLogin();

  const shell = (content: ReactNode) => (
    <Page style={{ background: 'var(--color-bg-canvas)' }}>
      <PageHeader title="Yêu cầu của tôi" />
      <div style={{ ...COLUMN, padding: 16, paddingBottom: 48, gap: 16 }}>{content}</div>
    </Page>
  );

  if (phase === 'unavailable') return shell(<SessionUnavailable />);
  if (phase === 'guest') {
    return shell(
      <Card variant="outline">
        <div style={{ ...COLUMN, gap: 12 }}>
          <Text variant="body-md" as="div" style={{ fontWeight: 600 }}>{wasteGuestCopy.historyBody}</Text>
          <Text variant="body-sm" tone="secondary" as="div">{wasteGuestCopy.whyPhone}</Text>
          <Button fullWidth onPress={guestLogin}>{wasteGuestCopy.historyButton}</Button>
        </div>
      </Card>,
    );
  }
  if (q.isError) return shell(<ErrorState message={getLoadErrorMessage(q.error)} onRetry={() => void q.refetch()} />);
  if (q.isPending || !q.data) return shell(<Skeleton height={120} />);

  const rows = q.data;
  if (rows.length === 0) {
    const canCreate = !cfg.isLoaded || cfg.waste.enabled;
    return shell(
      <EmptyState
        art="box"
        heading="Chưa có yêu cầu nào"
        {...(canCreate ? { ctaLabel: 'Đổi rác ngay', onCta: () => navigate('/recycle/new') } : {})}
      />,
    );
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
            <ListRow
              key={r.id}
              title={`${r.code} · ${METHOD_LABELS[r.method]}`}
              subtitle={`${requestStatusText(r, { blocked: me?.blocked, paused })} · ${formatDate(r.createdAt)}`}
              trailing="chevron"
              onPress={() => navigate(r.status === 'COMPLETED' ? `/recycle/done/${r.id}` : `/recycle/r/${r.id}`)}
            />
          );
        })}
      </div>
    </>,
  );
}
