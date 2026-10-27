'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Gift, Leaf, Sprout, Ticket } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { RedeemRewardResultDTO, RewardCatalogDTO, RewardItemDTO } from '@tubutree/shared-types';
import { redeemLoyaltyReward } from '@tubutree/app-core/api/loyalty';
import { buyTree } from '@tubutree/app-core/api/game';
import { WASTE_QUERY_KEYS, WASTE_REDEEM_INVALIDATE_KEYS } from '@tubutree/app-core/api/waste';
import { loyaltyPreviewQuery, loyaltyQuery, rewardsQuery } from '@tubutree/app-core/queries/loyalty';
import { guestPreviewCopy, previewAsCatalog } from '@tubutree/app-core/guest-preview';
import { couponUseCopy } from '@tubutree/app-core/coupon-use';
import {
  REWARD_TABS,
  WAREHOUSE_ONLY_LABEL,
  WAREHOUSE_PICKUP_DONE,
  rewardFreeShipNote,
  isWarehousePickup,
  lockedPointsNote,
  orderRewards,
  rewardCardState,
  warehouseConfirmText,
} from '@tubutree/app-core/reward-rules';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { useIdempotencyKey } from '@/lib/use-idempotency-key';
import { formatCount, pointsSummary } from '@/lib/checkout-points';
import { formatDate } from '@/lib/format-date';
import { formatVnd } from '@/lib/format-vnd';
import { pointsRulesNote } from '@/lib/loyalty-copy';
import { useCouponUse } from '@/lib/use-coupon-use';
import { usePublicConfig } from '@/lib/use-public-config';
import { ui } from '@/lib/guest-ui';
import { AuthLoading, SessionUnavailable } from '@/components/login-required';
import { GuestLoginLink } from '@/components/loyalty/guest-tiers';
import { ClaimPointInfo } from '@/components/loyalty/claim-point';
import { Badge } from '@/components/ui/badge';
import { ErrorState } from '@/components/ui/error-state';
import { ProgressBar } from '@/components/ui/progress-bar';
import { SegmentedTabs } from '@/components/ui/segmented-tabs';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { miniBtnSecondary, miniOutline } from '@/components/loyalty/mini-surface';
import { LedgerShell } from '../tai-khoan/ledger-shell';
import { loadErrorText } from '@/lib/error-text';

const TITLE = 'Kho quà';

const errText = loadErrorText;
const points = (n: number) => `${formatCount(n)} điểm`;

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
  const [error, setError] = useState<string | null>(null);
  // `disabled={isPending}` chỉ có hiệu lực sau lần render kế: hai cú bấm trong cùng khung hình vẫn gọi mutate hai lần.
  const busyRef = useRef(false);
  const claimPoint = reward.kind === 'SEED_PACK' || reward.kind === 'GIFT' ? catalog.claimPoint : null;

  const redeem = useMutation({
    mutationFn: async (): Promise<RedeemOutcome> => {
      if (reward.kind === 'TREE') {
        await buyTree(coreHttp, idemKey);
        return outcomeOf(reward, null);
      }
      return outcomeOf(reward, await redeemLoyaltyReward(coreHttp, reward.id, idemKey));
    },
    onSuccess: async (outcome) => {
      onRedeemed();
      await Promise.all(WASTE_REDEEM_INVALIDATE_KEYS.map((queryKey) => qc.invalidateQueries({ queryKey })));
      onDone(outcome);
    },
    onError: (e) => {
      setError(errText(e));
      void qc.invalidateQueries({ queryKey: WASTE_QUERY_KEYS.rewards });
    },
    onSettled: () => {
      busyRef.current = false;
    },
  });

  const confirm = () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    redeem.mutate();
  };

  return (
    <div className="space-y-3">
      <div className="text-base font-semibold text-stone-900">{reward.name}</div>
      <div className="flex justify-between gap-2 text-sm">
        <span className="text-stone-700">Điểm đổi</span>
        <span className="tabular-nums">{`-${points(reward.pointsCost)}`}</span>
      </div>
      <div className="flex justify-between gap-2 text-sm">
        <span className="text-stone-700">Điểm còn lại</span>
        <span className="tabular-nums">{points(Math.max(0, pointsSummary(catalog).total - reward.pointsCost))}</span>
      </div>
      {isWarehousePickup(reward) && <p className="text-sm font-semibold text-stone-900">{warehouseConfirmText(claimPoint)}</p>}
      {claimPoint && (
        <div className="space-y-0.5">
          <ClaimPointInfo point={claimPoint} heading={claimPoint.name} />
          <div className="text-xs text-stone-700">{`Hạn nhận ${catalog.giftClaimDays} ngày`}</div>
        </div>
      )}
      {error && (
        <p role="alert" className={ui.error}>
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className={`${miniBtnSecondary} flex-1`}>
          Huỷ
        </button>
        <button type="button" onClick={confirm} disabled={redeem.isPending} className={`${ui.btnPrimary} flex-1`}>
          Xác nhận đổi
        </button>
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
  const KindIcon = KIND_ICON[reward.kind];
  return (
    <div data-reward className={`flex flex-col gap-2.5 p-4 ${miniOutline}`}>
      <div className="flex items-start gap-3">
        <span data-testid="reward-icon" className="flex h-10 w-10 flex-none items-center justify-center rounded-control bg-forest-50 text-forest-700">
          <KindIcon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <div className="text-base font-semibold text-stone-900">{reward.name}</div>
            {reward.label && !freeNote && <Badge tone="brand">{reward.label}</Badge>}
          </div>
          {reward.description && <div className="text-xs text-stone-700">{reward.description}</div>}
          {reward.stockRemaining != null && !reward.soldOut && <div className="text-xs text-stone-600">{`Còn ${formatCount(reward.stockRemaining)}`}</div>}
          {reward.claimInstructions && <div className="text-xs text-stone-600">{reward.claimInstructions}</div>}
          {freeNote && <div className="text-xs text-stone-700">{freeNote}</div>}
          {isWarehousePickup(reward) && <Badge>{WAREHOUSE_ONLY_LABEL}</Badge>}
        </div>
      </div>
      <div className="mt-auto flex items-center justify-between gap-2">
        <div className="text-sm font-semibold tabular-nums text-forest-700">{points(reward.pointsCost)}</div>
        {!preview && s.kind === 'redeem' && (
          <button type="button" onClick={onRedeem} className={`${ui.btnPrimary} min-w-[88px]`}>
            Đổi
          </button>
        )}
        {s.kind === 'soldOut' && <Badge>Đã hết</Badge>}
        {!preview && s.kind === 'locked' && (
          <button type="button" disabled className={ui.btnPrimary}>
            Chờ mở khoá điểm
          </button>
        )}
        {!preview && s.kind === 'need' && <div className="text-xs text-stone-700">{`Cần thêm ${formatCount(s.missing)} điểm`}</div>}
      </div>
      {!preview && s.kind === 'need' && <ProgressBar value={reward.pointsCost - s.missing} max={reward.pointsCost} />}
    </div>
  );
}

function RewardResult({ outcome, onClose }: { outcome: RedeemOutcome | null; onClose: () => void }) {
  const { use, notice, cancel } = useCouponUse();
  // Sheet đóng (bấm X, nền, hoặc "Tiếp tục mua sắm") giữa lúc câu báo đang giữ: khách đã chọn ở lại, không kéo sang giỏ.
  useEffect(() => {
    if (outcome === null) cancel();
  }, [outcome, cancel]);
  return (
    <Sheet open={outcome !== null} onClose={onClose} title="Đổi quà thành công">
      {outcome?.kind === 'VOUCHER' && (
        <div className="space-y-3">
          <p className="text-base text-stone-900">{`Mã ${outcome.couponCode ?? ''} đã vào ví mã giảm giá`}</p>
          {outcome.couponCode && (
            <button type="button" onClick={() => void use(outcome.couponCode ?? '', onClose)} className={`${ui.btnPrimary} w-full`}>
              {couponUseCopy.use}
            </button>
          )}
          {notice && (
            <p role={notice.error ? 'alert' : 'status'} className={`text-xs ${notice.error ? 'text-danger-fg' : 'text-stone-700'}`}>
              {notice.text}
            </p>
          )}
          <Link href="/tai-khoan/diem-xanh" onClick={onClose} className={`${miniBtnSecondary} w-full`}>
            Xem ví mã
          </Link>
        </div>
      )}
      {outcome?.kind === 'CLAIM' && (
        <div className="space-y-3">
          <p className="font-display text-2xl font-semibold tracking-wide text-stone-900">{outcome.code ?? ''}</p>
          <p className="text-base text-stone-900">{WAREHOUSE_PICKUP_DONE}</p>
          {outcome.claimExpiresAt && <p className="text-sm text-stone-700">{`Hạn nhận ${formatDate(outcome.claimExpiresAt)}`}</p>}
          <Link href="/kho-qua/cua-toi" onClick={onClose} className={`${ui.btnPrimary} w-full`}>
            Quà của tôi
          </Link>
        </div>
      )}
      {outcome?.kind === 'TREE' && <p className="text-base text-stone-900">Bạn đã góp một cây vào quỹ trồng cây của Tubu</p>}
    </Sheet>
  );
}

function RewardsBody() {
  const rewardsQ = useQuery(rewardsQuery(coreHttp));
  const loyaltyQ = useQuery(loyaltyQuery(coreHttp));
  const cfg = usePublicConfig();
  const [tab, setTab] = useState<string>(REWARD_TABS[0].key);
  const [confirmReward, setConfirmReward] = useState<RewardItemDTO | null>(null);
  const [result, setResult] = useState<RedeemOutcome | null>(null);
  // Giữ khoá ở thân trang để đóng khung rồi mở lại cùng quà sau lỗi mạng vẫn gửi đúng khoá cũ: máy chủ có thể đã trừ điểm.
  const idem = useIdempotencyKey({ rewardId: confirmReward?.id ?? null });

  if (rewardsQ.isError && !rewardsQ.data) return <ErrorState message={errText(rewardsQ.error)} onRetry={() => void rewardsQ.refetch()} />;
  const c = rewardsQ.data;
  if (!c) return <Skeleton height={120} />;

  const kinds: readonly string[] = REWARD_TABS.find((t) => t.key === tab)?.kinds ?? [];
  const shown = orderRewards(c.rewards.filter((r) => kinds.includes(r.kind)), c);
  const total = pointsSummary(c).total;
  const rulesNote = cfg.isLoaded ? pointsRulesNote(cfg.loyalty) : null;
  const lockedNote = loyaltyQ.data ? lockedPointsNote(loyaltyQ.data) : null;

  return (
    <div className="space-y-4 pb-12">
      <div className="space-y-1">
        <div className="font-bold tabular-nums text-stone-900 md:text-3xl max-md:font-display max-md:text-[length:var(--type-display-md-size)] max-md:font-semibold max-md:leading-[var(--type-display-md-lh)]">
          {points(total)}
        </div>
        {c.redeemablePoints !== total && <p className="text-sm text-stone-700">{`Đổi quà dùng được ${points(c.redeemablePoints)}`}</p>}
        {rulesNote && <p className="text-xs text-stone-600">{rulesNote}</p>}
        {lockedNote && <p className="text-xs text-stone-600">{lockedNote}</p>}
        {c.pointsConvertedBalance > 0 && (
          <p className="text-xs text-stone-600">
            Điểm không hết hạn chỉ dùng khi thanh toán và góp quỹ trồng cây, không dùng để đổi mã giảm giá hay quà.
          </p>
        )}
      </div>
      <Link href="/kho-qua/cua-toi" className={`flex min-h-11 items-center gap-3 p-3 hover:bg-stone-50 ${ui.card} max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:px-0 max-md:shadow-none`}>
        <Gift className="h-5 w-5 flex-none text-forest-600" aria-hidden="true" />
        <span className="flex-1 text-sm font-semibold text-stone-900">Quà của tôi</span>
        <ChevronRight className="h-4 w-4 flex-none text-stone-500" aria-hidden="true" />
      </Link>
      <SegmentedTabs value={tab} onChange={setTab} items={REWARD_TABS.map((t) => ({ key: t.key, label: t.label }))} label="Loại quà" />
      {shown.length === 0 ? (
        <p className="text-sm text-stone-700">Chưa có quà trong mục này</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((r) => (
            <RewardCard key={r.id} reward={r} catalog={c} onRedeem={() => setConfirmReward(r)} />
          ))}
        </div>
      )}
      <Sheet open={confirmReward !== null} onClose={() => setConfirmReward(null)} title="Xác nhận đổi quà">
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
      </Sheet>
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
    <div className="space-y-4 pb-12">
      <p className="text-base text-stone-700">{guestPreviewCopy.hint}</p>
      <GuestLoginLink returnTo="/kho-qua" />
      {q.isError && !q.data ? (
        <ErrorState message={errText(q.error)} onRetry={() => void q.refetch()} />
      ) : !catalog ? (
        <Skeleton height={120} />
      ) : (
        <>
          <SegmentedTabs value={tab} onChange={setTab} items={REWARD_TABS.map((t) => ({ key: t.key, label: t.label }))} label="Loại quà" />
          {shown.length === 0 ? (
            <p className="text-sm text-stone-700">Chưa có quà trong mục này</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
  const phase = useAuthPhase();
  return (
    <LedgerShell title={TITLE} wide>
      {phase === 'loading' && <AuthLoading />}
      {phase === 'unavailable' && <SessionUnavailable />}
      {phase === 'guest' && <GuestRewards />}
      {phase === 'authenticated' && <RewardsBody />}
    </LedgerShell>
  );
}
