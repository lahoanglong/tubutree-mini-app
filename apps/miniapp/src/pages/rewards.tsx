import { useRef, useState } from 'react';
import { Page, useNavigate, useSnackbar } from 'zmp-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gift, Leaf, Sprout, Ticket } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { RedeemRewardResultDTO, RewardCatalogDTO, RewardItemDTO } from '@tubutree/shared-types';
import { guestPreviewCopy, previewAsCatalog } from '@tubutree/app-core/guest-preview';
import { loyaltyPreviewQuery } from '@tubutree/app-core/queries/loyalty';
import { couponUseCopy } from '@tubutree/app-core/coupon-use';
import {
  REWARD_TABS,
  WAREHOUSE_ONLY_LABEL,
  WAREHOUSE_PICKUP_DONE,
  rewardFreeShipNote,
  isWarehousePickup,
  openingHoursText,
  orderRewards,
  warehouseConfirmText,
} from '@tubutree/app-core/reward-rules';
import { getLoyalty, getLoyaltyRewards, lockedPointsNote, redeemLoyaltyReward, rewardCardState } from '../services/account-api';
import { buyTree } from '../services/game-api';
import { getErrorMessage } from '../services/api';
import { coreHttp } from '../services/core-http';
import { WASTE_QUERY_KEYS, invalidateAfterRedeem } from '../services/waste-api';
import { usePublicConfig } from '../hooks/use-public-config';
import { useCouponUse } from '../hooks/use-coupon-use';
import { useIdempotencyKey } from '../hooks/use-idempotency-key';
import { GuestLoginButton } from '../components/loyalty/guest-tiers';
import { AuthGate } from '../components/ui/auth-gate';
import { Badge } from '../components/ui/badge';
import { BottomSheet } from '../components/ui/bottom-sheet';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { ErrorState } from '../components/ui/empty-state';
import { Icon } from '../components/ui/icon';
import { ListRow } from '../components/ui/list-row';
import { PageHeader } from '../components/ui/page-header';
import { ProgressBar } from '../components/ui/progress-bar';
import { SegmentedTabs } from '../components/ui/segmented-tabs';
import { Skeleton } from '../components/ui/skeleton';
import { Heading, Text } from '../components/ui/text';
import { formatDate, formatNumber, formatPoints, formatVnd } from '../utils/format';
import { pointsSummary } from '../utils/points-lots';
import { pointsRulesNote } from '../utils/points-rules-note';
import { pointAddress } from '../utils/waste-labels';

export { REWARD_TABS, openingHoursText };

const COLUMN = { display: 'flex', flexDirection: 'column' } as const;

type RedeemOutcome =
  | { kind: 'VOUCHER'; couponCode: string | null }
  | { kind: 'CLAIM'; code: string | null; claimExpiresAt: string | null }
  | { kind: 'TREE' };

function outcomeOf(reward: RewardItemDTO, res: RedeemRewardResultDTO | null): RedeemOutcome {
  if (reward.kind === 'TREE' || !res) return { kind: 'TREE' };
  if (reward.kind === 'VOUCHER') return { kind: 'VOUCHER', couponCode: res.coupon?.code ?? res.redemption.couponCode };
  return { kind: 'CLAIM', code: res.redemption.code, claimExpiresAt: res.redemption.claimExpiresAt };
}

interface RedeemConfirmProps {
  reward: RewardItemDTO;
  catalog: RewardCatalogDTO;
  idemKey: string;
  onRedeemed: () => void;
  onDone: (outcome: RedeemOutcome) => void;
  onCancel: () => void;
}

function RedeemConfirm({ reward, catalog, idemKey, onRedeemed, onDone, onCancel }: RedeemConfirmProps) {
  const qc = useQueryClient();
  const { openSnackbar } = useSnackbar();
  const busyRef = useRef(false);
  const claimPoint = reward.kind === 'SEED_PACK' || reward.kind === 'GIFT' ? catalog.claimPoint : null;

  const redeem = useMutation({
    mutationFn: async (): Promise<RedeemOutcome> => {
      if (reward.kind === 'TREE') {
        await buyTree(idemKey);
        return outcomeOf(reward, null);
      }
      return outcomeOf(reward, await redeemLoyaltyReward(reward.id, idemKey));
    },
    onSuccess: async (outcome) => {
      onRedeemed();
      await invalidateAfterRedeem(qc);
      onDone(outcome);
    },
    onError: (e) => {
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
      void qc.invalidateQueries({ queryKey: WASTE_QUERY_KEYS.rewards });
    },
    onSettled: () => {
      busyRef.current = false;
    },
  });

  const confirm = () => {
    if (busyRef.current) return;
    busyRef.current = true;
    redeem.mutate();
  };

  return (
    <div style={{ ...COLUMN, gap: 12 }}>
      <Text variant="body-md" as="div" style={{ fontWeight: 600 }}>{reward.name}</Text>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <Text variant="body-sm" tone="secondary" as="span">Điểm đổi</Text>
        <Text variant="body-sm" as="span">{`-${formatPoints(reward.pointsCost)}`}</Text>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <Text variant="body-sm" tone="secondary" as="span">Điểm còn lại</Text>
        <Text variant="body-sm" as="span">{formatPoints(Math.max(0, pointsSummary(catalog).total - reward.pointsCost))}</Text>
      </div>
      {isWarehousePickup(reward) && (
        <Text variant="body-sm" as="div" style={{ fontWeight: 600 }}>{warehouseConfirmText(claimPoint)}</Text>
      )}
      {claimPoint && (
        <div style={{ ...COLUMN, gap: 2 }}>
          <Text variant="body-sm" as="div" style={{ fontWeight: 600 }}>{claimPoint.name}</Text>
          <Text variant="caption" tone="secondary" as="div">{pointAddress(claimPoint)}</Text>
          <Text variant="caption" tone="secondary" as="div">{openingHoursText(claimPoint.openingHours)}</Text>
          <Text variant="caption" tone="secondary" as="div">{`Hạn nhận ${catalog.giftClaimDays} ngày`}</Text>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="secondary" fullWidth onPress={onCancel}>Huỷ</Button>
        <Button fullWidth loading={redeem.isPending} onPress={confirm}>Xác nhận đổi</Button>
      </div>
    </div>
  );
}

const KIND_ICON: Record<RewardItemDTO['kind'], LucideIcon> = {
  VOUCHER: Ticket,
  TREE: Sprout,
  SEED_PACK: Leaf,
  GIFT: Gift,
};

function RewardCard({ reward, catalog, onRedeem, preview = false }: { reward: RewardItemDTO; catalog: RewardCatalogDTO; onRedeem: () => void; preview?: boolean }) {
  const s = rewardCardState(reward, catalog);
  const freeNote = preview ? null : rewardFreeShipNote(reward, catalog, formatVnd);
  return (
    <Card variant="outline">
      <div data-reward style={{ ...COLUMN, gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <span
            data-testid="reward-icon"
            style={{
              flexShrink: 0, width: 40, height: 40, borderRadius: 'var(--radius-control)',
              background: 'var(--color-action-secondary-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Icon icon={KIND_ICON[reward.kind]} tone="brand" />
          </span>
          <div style={{ ...COLUMN, gap: 4, flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
              <Text variant="body-md" as="div" style={{ fontWeight: 600 }}>{reward.name}</Text>
              {reward.label && !freeNote && <Badge tone="brand">{reward.label}</Badge>}
            </div>
            {reward.description && <Text variant="caption" tone="secondary" as="div">{reward.description}</Text>}
            {reward.stockRemaining != null && !reward.soldOut && (
              <Text variant="caption" tone="tertiary" as="div">{`Còn ${formatNumber(reward.stockRemaining)}`}</Text>
            )}
            {reward.claimInstructions && <Text variant="caption" tone="tertiary" as="div">{reward.claimInstructions}</Text>}
            {freeNote && <Text variant="caption" tone="secondary" as="div">{freeNote}</Text>}
            {isWarehousePickup(reward) && <Badge>{WAREHOUSE_ONLY_LABEL}</Badge>}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <Text variant="body-sm" tone="brand" as="div" style={{ fontWeight: 600 }}>{formatPoints(reward.pointsCost)}</Text>
          {!preview && s.kind === 'redeem' && <Button style={{ minWidth: 88 }} onPress={onRedeem}>Đổi</Button>}
          {s.kind === 'soldOut' && <Badge>Đã hết</Badge>}
          {!preview && s.kind === 'locked' && <Button disabled>Chờ mở khoá điểm</Button>}
          {!preview && s.kind === 'need' && <Text variant="caption" tone="secondary" as="div">{`Cần thêm ${formatNumber(s.missing)} điểm`}</Text>}
        </div>
        {!preview && s.kind === 'need' && <ProgressBar value={reward.pointsCost - s.missing} max={reward.pointsCost} />}
      </div>
    </Card>
  );
}

function RewardResult({ outcome, onClose }: { outcome: RedeemOutcome | null; onClose: () => void }) {
  const navigate = useNavigate();
  const { use } = useCouponUse();
  const go = (path: string) => {
    onClose();
    navigate(path);
  };
  return (
    <BottomSheet open={outcome !== null} onClose={onClose} title="Đổi quà thành công">
      {outcome?.kind === 'VOUCHER' && (
        <div style={{ ...COLUMN, gap: 12 }}>
          <Text variant="body-md" as="div">{`Mã ${outcome.couponCode ?? ''} đã vào ví mã giảm giá`}</Text>
          {outcome.couponCode && <Button onPress={() => use(outcome.couponCode ?? '', onClose)}>{couponUseCopy.use}</Button>}
          <Button variant="secondary" onPress={() => go('/loyalty')}>Xem ví mã</Button>
        </div>
      )}
      {outcome?.kind === 'CLAIM' && (
        <div style={{ ...COLUMN, gap: 12 }}>
          <Heading variant="display-md" as="p">{outcome.code ?? ''}</Heading>
          <Text variant="body-md" as="div">{WAREHOUSE_PICKUP_DONE}</Text>
          {outcome.claimExpiresAt && <Text variant="body-sm" tone="secondary" as="div">{`Hạn nhận ${formatDate(outcome.claimExpiresAt)}`}</Text>}
          <Button onPress={() => go('/rewards/mine')}>Quà của tôi</Button>
        </div>
      )}
      {outcome?.kind === 'TREE' && <Text variant="body-md" as="div">Bạn đã góp một cây vào quỹ trồng cây của Tubu</Text>}
    </BottomSheet>
  );
}

function RewardsBody() {
  const navigate = useNavigate();
  const rewardsQ = useQuery({ queryKey: WASTE_QUERY_KEYS.rewards, queryFn: getLoyaltyRewards });
  const loyaltyQ = useQuery({ queryKey: ['loyalty'], queryFn: getLoyalty });
  const cfg = usePublicConfig();
  const [tab, setTab] = useState<string>(REWARD_TABS[0].key);
  const [confirmReward, setConfirmReward] = useState<RewardItemDTO | null>(null);
  const [result, setResult] = useState<RedeemOutcome | null>(null);
  // Giữ khoá ở thân trang để đóng khung rồi mở lại cùng quà sau lỗi mạng vẫn gửi đúng khoá cũ: máy chủ có thể đã trừ điểm.
  const idem = useIdempotencyKey({ rewardId: confirmReward?.id ?? null });

  if (rewardsQ.isError && !rewardsQ.data) return <ErrorState message={getErrorMessage(rewardsQ.error)} onRetry={() => void rewardsQ.refetch()} />;
  const c = rewardsQ.data;
  if (!c) return <div style={{ padding: 16 }}><Skeleton height={120} /></div>;

  const kinds: readonly string[] = REWARD_TABS.find((t) => t.key === tab)?.kinds ?? [];
  const shown = orderRewards(c.rewards.filter((r) => kinds.includes(r.kind)), c);
  const total = pointsSummary(c).total;
  const rulesNote = cfg.isLoaded ? pointsRulesNote(cfg.loyalty) : null;
  const lockedNote = loyaltyQ.data ? lockedPointsNote(loyaltyQ.data) : null;

  return (
    <div style={{ ...COLUMN, padding: 16, paddingBottom: 48, gap: 16 }}>
      <div style={{ ...COLUMN, gap: 4 }}>
        <Heading variant="display-md" as="div">{formatPoints(total)}</Heading>
        {c.redeemablePoints !== total && (
          <Text variant="body-sm" tone="secondary" as="div">{`Đổi quà dùng được ${formatPoints(c.redeemablePoints)}`}</Text>
        )}
        {rulesNote && <Text variant="caption" tone="secondary" as="div">{rulesNote}</Text>}
        {lockedNote && <Text variant="caption" tone="tertiary" as="div">{lockedNote}</Text>}
        {c.pointsConvertedBalance > 0 && (
          <Text variant="caption" tone="tertiary" as="div">
            Điểm không hết hạn chỉ dùng khi thanh toán và góp quỹ trồng cây, không dùng để đổi mã giảm giá hay quà.
          </Text>
        )}
      </div>
      <ListRow icon={<Icon icon={Gift} tone="brand" />} title="Quà của tôi" trailing="chevron" onPress={() => navigate('/rewards/mine')} />
      <SegmentedTabs value={tab} onChange={setTab} items={REWARD_TABS.map((t) => ({ key: t.key, label: t.label }))} />
      {shown.length === 0 ? (
        <Text variant="body-sm" tone="secondary" as="div">Chưa có quà trong mục này</Text>
      ) : (
        <div style={{ ...COLUMN, gap: 12 }}>
          {shown.map((r) => (
            <RewardCard key={r.id} reward={r} catalog={c} onRedeem={() => setConfirmReward(r)} />
          ))}
        </div>
      )}
      <BottomSheet open={confirmReward !== null} onClose={() => setConfirmReward(null)} title="Xác nhận đổi quà">
        {confirmReward && (
          <RedeemConfirm
            reward={confirmReward}
            catalog={c}
            idemKey={idem.key}
            onRedeemed={idem.rotate}
            onDone={(outcome) => {
              setConfirmReward(null);
              setResult(outcome);
            }}
            onCancel={() => setConfirmReward(null)}
          />
        )}
      </BottomSheet>
      <RewardResult outcome={result} onClose={() => setResult(null)} />
    </div>
  );
}

/** Khách chưa đăng nhập: xem được quà đổi bằng Điểm Xanh nhưng chưa đổi được. */
function GuestRewards() {
  const q = useQuery(loyaltyPreviewQuery(coreHttp));
  const [tab, setTab] = useState<string>(REWARD_TABS[0].key);
  const kinds: readonly string[] = REWARD_TABS.find((t) => t.key === tab)?.kinds ?? [];
  const shown = q.data ? q.data.rewards.filter((r) => kinds.includes(r.kind)) : [];
  const catalog = q.data ? previewAsCatalog(q.data) : null;
  return (
    <div style={{ ...COLUMN, padding: 16, paddingBottom: 48, gap: 16 }}>
      <Text variant="body-md" tone="secondary" as="div">{guestPreviewCopy.hint}</Text>
      <GuestLoginButton />
      {q.isError && !q.data ? (
        <ErrorState message={getErrorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : !catalog ? (
        <Skeleton height={120} />
      ) : (
        <>
          <SegmentedTabs value={tab} onChange={setTab} items={REWARD_TABS.map((t) => ({ key: t.key, label: t.label }))} />
          {shown.length === 0 ? (
            <Text variant="body-sm" tone="secondary" as="div">Chưa có quà trong mục này</Text>
          ) : (
            <div style={{ ...COLUMN, gap: 12 }}>
              {shown.map((r) => (
                <RewardCard key={r.id} reward={r} catalog={catalog} onRedeem={() => undefined} preview />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function RewardsPage() {
  return (
    <Page style={{ background: 'var(--color-bg-canvas)' }}>
      <PageHeader title="Kho quà" />
      <AuthGate guest={<GuestRewards />}>
        <RewardsBody />
      </AuthGate>
    </Page>
  );
}
