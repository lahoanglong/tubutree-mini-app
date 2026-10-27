import { Page, useNavigate } from 'zmp-ui';
import { useQuery } from '@tanstack/react-query';
import { Ticket } from 'lucide-react';
import type { GiftRedemption } from '../services/account-api';
import { getMyRedemptions } from '../services/account-api';
import { getLoadErrorMessage } from '../services/api';
import { WASTE_QUERY_KEYS } from '../services/waste-api';
import { AuthGate } from '../components/ui/auth-gate';
import { Badge } from '../components/ui/badge';
import { Card } from '../components/ui/card';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { Icon } from '../components/ui/icon';
import { ListRow } from '../components/ui/list-row';
import { PageHeader } from '../components/ui/page-header';
import { Skeleton } from '../components/ui/skeleton';
import { Heading, Text } from '../components/ui/text';
import { QrCode } from '../components/qr-code';
import { formatDate, formatPoints } from '../utils/format';
import { pointAddress } from '../utils/waste-labels';
import { openingHoursText } from './rewards';

const COLUMN = { display: 'flex', flexDirection: 'column' } as const;

function byReadyThenNewest(a: GiftRedemption, b: GiftRedemption): number {
  const ar = a.status === 'READY' ? 0 : 1;
  const br = b.status === 'READY' ? 0 : 1;
  if (ar !== br) return ar - br;
  return b.createdAt.localeCompare(a.createdAt);
}

function RedemptionStatus({ r }: { r: GiftRedemption }) {
  if (r.status === 'READY' && r.code) {
    const cp = r.claimPoint;
    return (
      <>
        <Heading variant="display-md" as="p">{r.code}</Heading>
        <div data-testid="qr-center" style={{ display: 'flex', justifyContent: 'center' }}>
          <QrCode value={r.code} size={140} />
        </div>
        {cp && (
          <div style={{ ...COLUMN, gap: 2 }}>
            <Text variant="body-sm" as="div" style={{ fontWeight: 600 }}>{`Nhận tại ${cp.name}`}</Text>
            <Text variant="caption" tone="secondary" as="div">{pointAddress(cp)}</Text>
            <Text variant="caption" tone="secondary" as="div">{openingHoursText(cp.openingHours)}</Text>
          </div>
        )}
        {r.claimExpiresAt && <Text variant="body-sm" tone="secondary" as="div">{`Hạn nhận ${formatDate(r.claimExpiresAt)}`}</Text>}
      </>
    );
  }
  if (r.status === 'CANCELLED') {
    return (
      <>
        <Text variant="body-sm" as="div">{`Đã huỷ: ${r.cancelReason ?? 'không rõ lý do'}`}</Text>
        <Text variant="body-sm" tone="secondary" as="div">{`Đã hoàn ${formatPoints(r.refundedPoints ?? 0)}`}</Text>
      </>
    );
  }
  if (r.status === 'FULFILLED' && r.fulfilledAt) {
    return <Text variant="body-sm" tone="secondary" as="div">{`Đã nhận ngày ${formatDate(r.fulfilledAt)}`}</Text>;
  }
  return null;
}

function RedemptionEntry({ r }: { r: GiftRedemption }) {
  const navigate = useNavigate();
  if (r.giftKind === 'VOUCHER') {
    return (
      <div data-redemption>
        <Card variant="outline" padding={0}>
          <ListRow
            icon={<Icon icon={Ticket} tone="brand" />}
            title={r.giftName}
            subtitle={r.couponCode ? `Mã ${r.couponCode}` : ''}
            trailing="chevron"
            onPress={() => navigate('/loyalty')}
            style={{ padding: '12px' }}
          />
        </Card>
      </div>
    );
  }
  return (
    <div data-redemption>
      <Card variant="outline">
        <div style={{ ...COLUMN, gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
            <Text variant="body-md" as="div" style={{ fontWeight: 600 }}>{r.giftName}</Text>
            {r.status === 'READY' && <Badge tone="info">Chờ nhận</Badge>}
          </div>
          <RedemptionStatus r={r} />
        </div>
      </Card>
    </div>
  );
}

function RewardsMineBody() {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: WASTE_QUERY_KEYS.rewardsMine, queryFn: getMyRedemptions });

  if (q.isError) return <ErrorState message={getLoadErrorMessage(q.error)} onRetry={() => void q.refetch()} />;
  if (!q.data) return <div style={{ padding: 16 }}><Skeleton height={120} /></div>;
  if (q.data.length === 0) {
    return <EmptyState art="box" heading="Bạn chưa đổi quà nào" ctaLabel="Đến Kho quà" onCta={() => navigate('/rewards')} />;
  }

  return (
    <div style={{ ...COLUMN, padding: 16, paddingBottom: 48, gap: 12 }}>
      {[...q.data].sort(byReadyThenNewest).map((r) => (
        <RedemptionEntry key={r.id} r={r} />
      ))}
    </div>
  );
}

export default function RewardsMinePage() {
  return (
    <Page style={{ background: 'var(--color-bg-canvas)' }}>
      <PageHeader title="Quà của tôi" />
      <AuthGate>
        <RewardsMineBody />
      </AuthGate>
    </Page>
  );
}
