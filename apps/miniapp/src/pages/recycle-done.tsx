import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Page, useNavigate, useParams } from 'zmp-ui';
import { useQuery } from '@tanstack/react-query';
import { Droplet } from 'lucide-react';
import { WASTE_QUERY_KEYS, getWasteMe, getWasteRequest } from '../services/waste-api';
import { getLoyaltyRewards } from '../services/account-api';
import { getErrorMessage } from '../services/api';
import { useAuthPhase } from '../hooks/use-auth-phase';
import { SessionUnavailable } from '../components/ui/auth-gate';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { ErrorState } from '../components/ui/empty-state';
import { Icon } from '../components/ui/icon';
import { PageHeader } from '../components/ui/page-header';
import { ProgressBar } from '../components/ui/progress-bar';
import { Skeleton } from '../components/ui/skeleton';
import { Heading, Text } from '../components/ui/text';
import { formatNumber, formatPoints } from '../utils/format';
import { pointsSummary } from '../utils/points-lots';
import { nextRewardProgress } from '../utils/waste-labels';
import { DeclaredCountedTable } from './recycle-request';
import { formatImpactKg } from './recycle';

const COLUMN = { display: 'flex', flexDirection: 'column' } as const;

export default function RecycleDonePage() {
  const navigate = useNavigate();
  const { id = '' } = useParams();
  const phase = useAuthPhase();
  const authed = phase === 'authenticated';

  const q = useQuery({ queryKey: WASTE_QUERY_KEYS.request(id), queryFn: () => getWasteRequest(id), enabled: authed });
  const meQ = useQuery({ queryKey: WASTE_QUERY_KEYS.me, queryFn: getWasteMe, enabled: authed });
  const rewardsQ = useQuery({ queryKey: WASTE_QUERY_KEYS.rewards, queryFn: getLoyaltyRewards, enabled: authed });
  const r = q.data;
  const notDone = !!r && r.status !== 'COMPLETED';

  useEffect(() => {
    if (notDone) navigate(`/recycle/r/${id}`, { replace: true });
  }, [notDone, navigate, id]);

  const shell = (content: ReactNode, subtitle?: string) => (
    <Page style={{ background: 'var(--color-bg-canvas)' }}>
      <PageHeader title="Kết quả đổi rác" subtitle={subtitle} />
      <div style={{ ...COLUMN, padding: 16, paddingBottom: 48, gap: 16 }}>{content}</div>
    </Page>
  );

  if (phase === 'unavailable') return shell(<SessionUnavailable />);
  if (q.isError) return shell(<ErrorState message={getErrorMessage(q.error)} onRetry={() => void q.refetch()} />);
  if (!r) return shell(<Skeleton height={120} />);
  if (notDone) return null;

  const awarded = r.pointsAwarded ?? 0;
  const short = r.lines.filter((l) => (l.receivedQty ?? 0) < l.unitsPerPoint);
  const me = meQ.data;
  const p = nextRewardProgress(rewardsQ.data);
  const drops = r.dropsAwarded ?? 0;

  return shell(
    <>
      {awarded > 0 ? (
        <Heading variant="display-md" as="h2">{`Đã cộng ${formatPoints(awarded)}`}</Heading>
      ) : (
        <div style={{ ...COLUMN, gap: 6 }}>
          <Heading variant="display-md" as="h2">Lượt này chưa đủ để cộng điểm</Heading>
          {short.map((l) => (
            <Text key={l.itemId} variant="body-sm" tone="secondary" as="div">
              {`${l.itemName} cần ${l.unitsPerPoint} ${l.unitLabel} mới được ${formatPoints(l.pointsPerGroup)}, kho đếm được ${l.receivedQty ?? 0} ${l.unitLabel}`}
            </Text>
          ))}
        </div>
      )}
      <DeclaredCountedTable lines={r.lines} />
      {me && (
        <div style={{ ...COLUMN, gap: 8 }}>
          <Text variant="body-md" as="div">{`Số dư mới ${formatPoints(pointsSummary(me.balance ?? { pointsBalance: 0 }).total)}`}</Text>
          {p && <ProgressBar value={p.have} max={p.cost} label={`Còn ${formatPoints(p.missing)} tới ${p.rewardName}`} />}
        </div>
      )}
      {drops > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon icon={Droplet} size="sm" tone="brand" />
          <Text variant="body-sm" as="span">{`+${formatNumber(drops)} giọt nước vào bình của bạn`}</Text>
        </div>
      )}
      {r.impactGrams != null && (
        <Card>
          <Text variant="body-sm" as="div">{`Bạn đã gửi khoảng ${formatImpactKg(r.impactGrams)} kg bao bì cho Tubu`}</Text>
          <Text variant="caption" tone="tertiary" as="div">Ước tính theo khối lượng trung bình</Text>
        </Card>
      )}
      <Button fullWidth onPress={() => navigate('/rewards')}>
        Đổi quà ngay
      </Button>
      <Button fullWidth variant="secondary" onPress={() => navigate('/recycle/new')}>
        Đổi thêm rác
      </Button>
    </>,
    r.code,
  );
}
