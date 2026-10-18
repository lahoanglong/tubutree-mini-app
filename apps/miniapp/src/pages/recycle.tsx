import { Page, useNavigate, useSnackbar } from 'zmp-ui';
import { History } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { WasteMeDTO, WasteMethod } from '@tubutree/shared-types';
import { getWasteMe, WASTE_QUERY_KEYS } from '../services/waste-api';
import { getLoyaltyRewards } from '../services/account-api';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { useAuthPhase } from '../hooks/use-auth-phase';
import { usePublicConfig } from '../hooks/use-public-config';
import { SessionUnavailable } from '../components/ui/auth-gate';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { ErrorState } from '../components/ui/empty-state';
import { IconButton } from '../components/ui/icon-button';
import { ListRow } from '../components/ui/list-row';
import { PageHeader } from '../components/ui/page-header';
import { ProgressBar } from '../components/ui/progress-bar';
import { Skeleton } from '../components/ui/skeleton';
import { Timeline } from '../components/ui/timeline';
import { Heading, Text } from '../components/ui/text';
import { formatNumber, formatPoints, formatVnd } from '../utils/format';
import { pointsSummary } from '../utils/points-lots';
import {
  METHOD_LABELS,
  PAUSED_TEXT,
  POINT_VALUE_VND,
  TIMELINE_STEPS,
  closedLabel,
  equivalentUnits,
  formatLineQty,
  nextRewardProgress,
  requestStatusText,
  ruleText,
  timelineFor,
} from '../utils/waste-labels';

/** Một chữ số thập phân; dưới 50 g làm tròn về 0 kg thì không có dòng nào (null). */
export function impactLine(grams: number | null | undefined): string | null {
  if (grams == null) return null;
  const kg = Math.round(grams / 100) / 10;
  return kg > 0 ? `Bạn đã gửi khoảng ${formatNumber(kg)} kg bao bì cho Tubu` : null;
}

const BLOCKED_TEXT = 'Tài khoản của bạn tạm không tham gia Đổi rác, liên hệ Tubu Tree';
const LOGIN_TEXT = 'Đăng nhập Zalo và chia sẻ số điện thoại để đổi rác';

const METHOD_FLAG = { DROP_OFF: 'dropoff', MAIL_IN: 'mailin', PICKUP: 'pickup' } as const;
const METHOD_ORDER: readonly WasteMethod[] = ['DROP_OFF', 'MAIL_IN', 'PICKUP'];
const METHOD_LINE: Record<WasteMethod, string> = {
  DROP_OFF: 'Miễn phí, nhận điểm khi người ở điểm xác nhận',
  MAIL_IN: 'Tự gửi qua hãng bất kỳ và tự trả phí ship',
  PICKUP: 'Miễn phí, bưu tá lấy khi giao đơn Tubu kế tiếp',
};

const SECTION_STYLE = { display: 'flex', flexDirection: 'column', gap: 8 } as const;

function NoticeCard({ text }: { text: string }) {
  return (
    <Card variant="outline">
      <Text variant="body-md" as="div" style={{ fontWeight: 600 }}>
        {text}
      </Text>
    </Card>
  );
}

function RequestsBlock({ me, onOpen }: { me: WasteMeDTO; onOpen: (id: string) => void }) {
  if (me.openRequests.length === 0) return null;
  return (
    <section style={SECTION_STYLE}>
      <Heading variant="title-md" as="h2">
        Yêu cầu đang xử lý
      </Heading>
      {me.openRequests.map((r) => {
        const tl = timelineFor(r);
        const closed = tl ? null : closedLabel({ ...r, rejectionReason: null, rejectionNote: null, reversedPoints: null, reversalReason: null });
        const subtitle = r.lines.map((l) => formatLineQty(l.itemName, l.declaredQty, l.unitLabel)).join(', ');
        const status = requestStatusText(r, { blocked: me.blocked });
        return (
          <Card key={r.id} variant="outline">
            <ListRow title={`${r.code} · ${METHOD_LABELS[r.method]}`} subtitle={subtitle} trailing="chevron" onPress={() => onOpen(r.id)} />
            {tl ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div>
                  <Badge tone="brand">{status}</Badge>
                </div>
                <Timeline compact label={`Tiến độ ${r.code}`} steps={TIMELINE_STEPS[r.method]} current={tl.current} />
              </div>
            ) : (
              closed && (
                <Text variant="caption" tone="tertiary" as="div">
                  {closed.reason ? `${closed.label}: ${closed.reason}` : closed.label}
                </Text>
              )
            )}
          </Card>
        );
      })}
    </section>
  );
}

export default function RecyclePage() {
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const qc = useQueryClient();
  const phase = useAuthPhase();
  const cfg = usePublicConfig();
  const login = useAuthStore((s) => s.login);
  const ensurePhone = useAuthStore((s) => s.ensurePhone);

  const meQ = useQuery({ queryKey: WASTE_QUERY_KEYS.me, queryFn: getWasteMe, enabled: phase === 'authenticated' });
  const me = meQ.data;
  const fullPage = me?.programmeEnabled === true && me.eligibility === 'OK' && !me.blocked;
  const rewardsQ = useQuery({
    queryKey: WASTE_QUERY_KEYS.rewards,
    queryFn: getLoyaltyRewards,
    enabled: phase === 'authenticated' && fullPage,
  });

  const guestLogin = async () => {
    try {
      await login();
      await ensurePhone();
      await qc.invalidateQueries({ queryKey: ['waste'] });
    } catch (e) {
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
    }
  };
  const sharePhone = async () => {
    try {
      const phone = await ensurePhone();
      if (phone) await qc.invalidateQueries({ queryKey: ['waste'] });
    } catch (e) {
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
    }
  };

  const loginCard = (onPress: () => Promise<void>) => (
    <Card variant="outline">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Text variant="body-md" as="div" style={{ fontWeight: 600 }}>
          {LOGIN_TEXT}
        </Text>
        <Button fullWidth onPress={onPress}>
          Chia sẻ số điện thoại
        </Button>
      </div>
    </Card>
  );

  const showHistory = me?.eligibility === 'OK';
  const header = (
    <PageHeader
      title="Đổi rác lấy quà"
      actions={showHistory ? <IconButton icon={History} label="Yêu cầu của tôi" onPress={() => navigate('/recycle/requests')} /> : undefined}
    />
  );
  const shell = (content: React.ReactNode) => (
    <Page style={{ background: 'var(--color-bg-canvas)' }}>
      {header}
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>{content}</div>
    </Page>
  );

  if (phase === 'loading' || (phase === 'authenticated' && meQ.isPending)) {
    return shell(
      <>
        <Skeleton height={140} radius="var(--radius-card)" />
        <Skeleton height={80} radius="var(--radius-card)" />
        <Skeleton height={80} radius="var(--radius-card)" />
      </>,
    );
  }
  if (phase === 'unavailable') return shell(<SessionUnavailable />);
  if (phase === 'guest') return shell(cfg.waste.enabled ? loginCard(guestLogin) : <NoticeCard text={PAUSED_TEXT} />);
  if (meQ.isError || !me) return shell(<ErrorState message={getErrorMessage(meQ.error)} onRetry={() => void meQ.refetch()} />);

  const openRequests = <RequestsBlock me={me} onOpen={(id) => navigate(`/recycle/r/${id}`)} />;
  // Kho vẫn mở quầy khi chương trình tạm dừng hoặc khách bị khoá (15.1), nên lối vào không phụ thuộc hai nhánh đó.
  const deskRow =
    me.deskPoints.length > 0 ? (
      <ListRow
        title="Nhận hàng tại điểm"
        subtitle={me.deskPoints.map((p) => p.name).join(', ')}
        trailing="chevron"
        onPress={() => navigate('/recycle/desk')}
      />
    ) : null;
  if (!me.programmeEnabled) {
    return shell(
      <>
        <NoticeCard text={PAUSED_TEXT} />
        {openRequests}
        {deskRow && <div>{deskRow}</div>}
      </>,
    );
  }
  if (me.eligibility !== 'OK') {
    return shell(
      <>
        {loginCard(sharePhone)}
        {deskRow && <div>{deskRow}</div>}
      </>,
    );
  }
  if (me.blocked) {
    return shell(
      <>
        <NoticeCard text={BLOCKED_TEXT} />
        {openRequests}
        {deskRow && <div>{deskRow}</div>}
      </>,
    );
  }

  const total = me.balance ? pointsSummary(me.balance).total : 0;
  const items = [...me.items].sort((a, b) => a.sortOrder - b.sortOrder);
  const firstActive = items.find((i) => i.status === 'ACTIVE');
  const progress = nextRewardProgress(rewardsQ.data);
  const methods = METHOD_ORDER.filter((m) => {
    const flag = METHOD_FLAG[m];
    return cfg.waste[flag] && me.laneFlags[flag] && (m === 'DROP_OFF' || !me.shipLockedAt);
  });
  const impact = impactLine(me.impactGrams);
  const giftNames = rewardsQ.data?.rewards.slice(0, 2).map((r) => r.name).join(', ');

  return shell(
    <>
      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Text variant="caption" tone="tertiary" as="div">
            Điểm Xanh của bạn
          </Text>
          <Heading variant="display-md" as="p">
            {formatPoints(total)}
          </Heading>
          <Text variant="body-sm" tone="secondary" as="div">
            {`Dùng như ${formatVnd(total * POINT_VALUE_VND)} khi mua sắm`}
          </Text>
          {impact && (
            <div>
              <Text variant="body-sm" as="div">
                {impact}
              </Text>
              <Text variant="caption" tone="tertiary" as="div">
                Ước tính theo khối lượng trung bình
              </Text>
            </div>
          )}
          {progress && (
            <div>
              <ProgressBar value={progress.have} max={progress.cost} label={`Còn ${formatPoints(progress.missing)} tới ${progress.rewardName}`} />
              {firstActive && (
                <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 4 }}>
                  {`tương đương khoảng ${equivalentUnits(progress.missing, firstActive)} ${firstActive.name.toLowerCase()}`}
                </Text>
              )}
            </div>
          )}
          {methods.length > 0 && (
            <Button fullWidth onPress={() => navigate('/recycle/new')}>
              Đổi rác ngay
            </Button>
          )}
        </div>
      </Card>

      {openRequests}

      {methods.length > 0 && (
        <section style={SECTION_STYLE}>
          <Heading variant="title-md" as="h2">
            Cách đổi
          </Heading>
          {methods.map((m) => (
            <Card key={m} variant="outline">
              <Text variant="body-sm" as="div" style={{ fontWeight: 600 }}>
                {METHOD_LABELS[m]}
              </Text>
              <Text variant="caption" tone="tertiary" as="div">
                {METHOD_LINE[m]}
              </Text>
            </Card>
          ))}
        </section>
      )}

      <section style={SECTION_STYLE}>
        <Heading variant="title-md" as="h2">
          Tubu nhận những món này
        </Heading>
        {items.map((item) => (
          <div
            key={item.id}
            data-item
            data-status={item.status}
            style={{ opacity: item.status === 'COMING_SOON' ? 0.55 : 1, display: 'flex', flexDirection: 'column', gap: 2 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Text variant="body-sm" as="span" style={{ fontWeight: 600 }}>
                {item.name}
              </Text>
              {item.status === 'COMING_SOON' && <Badge>Sắp nhận</Badge>}
            </div>
            <Text variant="caption" tone="secondary" as="div">
              {ruleText(item)}
            </Text>
            {item.prepInstructions && (
              <Text variant="caption" tone="tertiary" as="div">
                {item.prepInstructions}
              </Text>
            )}
          </div>
        ))}
      </section>

      <div>
        <ListRow title="Kho quà" subtitle={giftNames || undefined} trailing="chevron" onPress={() => navigate('/rewards')} />
        {deskRow}
        <ListRow title="Thể lệ chương trình" trailing="chevron" onPress={() => navigate('/recycle/rules')} />
      </div>
    </>,
  );
}
