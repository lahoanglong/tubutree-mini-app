'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Gift, Info, Leaf, Sprout, Ticket } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { RedeemRewardResultDTO, RewardCatalogDTO, RewardItemDTO } from '@tubutree/shared-types';
import { redeemLoyaltyReward } from '@tubutree/app-core/api/loyalty';
import { errorCode } from '@tubutree/app-core/api/error-status';
import { buyTree } from '@tubutree/app-core/api/game';
import { WASTE_QUERY_KEYS, WASTE_REDEEM_INVALIDATE_KEYS } from '@tubutree/app-core/api/waste';
import { loyaltyPreviewQuery, loyaltyQuery, rewardsQuery } from '@tubutree/app-core/queries/loyalty';
import { guestPreviewCopy, previewAsCatalog } from '@tubutree/app-core/guest-preview';
import { couponUseCopy } from '@tubutree/app-core/coupon-use';
import {
  REWARD_TABS,
  WAREHOUSE_PICKUP_DONE,
  freeShipConfirmText,
  rewardPhoneVerifyCopy,
  rewardsGuideCopy,
  NEW_COUPON_PARAM,
  rewardDetailLines,
  rewardFreeShipNote,
  rewardPill,
  isWarehousePickup,
  lockedPointsNote,
  orderRewards,
  rewardCardState,
  warehouseConfirmText,
} from '@tubutree/app-core/reward-rules';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { miniAppPathLink } from '@/lib/zalo-mini-app';
import { useIdempotencyKey } from '@/lib/use-idempotency-key';
import { formatCount, pointsSummary } from '@/lib/checkout-points';
import { formatDate } from '@/lib/format-date';
import { formatVnd } from '@/lib/format-vnd';
import { settleWithin } from '@/lib/settle-within';
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
import { actionErrorText, loadErrorText } from '@/lib/error-text';

const errText = loadErrorText;
const actErrText = actionErrorText;
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
  /** Lệnh POST đang bay: khung cha không cho đóng (X, Esc, nền, Huỷ), để mở lại không dựng ô xác nhận mới trong lúc máy chủ chưa trả lời. */
  posting: boolean;
  onPosting: (posting: boolean) => void;
  onRedeemed: () => void;
  onDone: (outcome: RedeemOutcome) => void;
  onCancel: () => void;
  onPhoneNotVerified?: () => void;
}

function RedeemConfirm({ reward, catalog, idemKey, posting, onPosting, onRedeemed, onDone, onCancel, onPhoneNotVerified }: RedeemConfirmProps) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  // `isPending` chỉ đúng sau lần render kế: hai cú bấm trong cùng khung hình vẫn gọi mutate hai lần.
  const busyRef = useRef(false);
  const claimPoint = reward.kind === 'SEED_PACK' || reward.kind === 'GIFT' ? catalog.claimPoint : null;
  const freeNote = rewardFreeShipNote(reward, catalog, formatVnd);

  const redeem = useMutation({
    // `onPosting(true)` đặt ở `confirm` (đồng bộ với cú bấm), `false` nhả ngay khi POST xong, không đợi làm mới.
    mutationFn: async (): Promise<RedeemOutcome> => {
      try {
        if (reward.kind === 'TREE') {
          await buyTree(coreHttp, idemKey);
          return outcomeOf(reward, null);
        }
        return outcomeOf(reward, await redeemLoyaltyReward(coreHttp, reward.id, idemKey));
      } finally {
        onPosting(false);
      }
    },
    // Điểm đã trừ nên kết quả phải hiện ngay cả khi làm mới dữ liệu treo: chờ có hạn, không chờ vô hạn.
    onSuccess: async (outcome) => {
      onRedeemed();
      await settleWithin(Promise.all(WASTE_REDEEM_INVALIDATE_KEYS.map((queryKey) => qc.invalidateQueries({ queryKey }))));
      onDone(outcome);
    },
    // Khoá NÚT trong khung này (khung đóng được ngay khi POST xong): trả Promise làm mới để khung còn mở thì nút không gửi lại trên danh sách cũ, có hạn để mạng chậm không giữ nút mãi.
    onError: (e) => {
      setError(actErrText(e));
      const refresh = settleWithin(qc.invalidateQueries({ queryKey: WASTE_QUERY_KEYS.rewards }));
      if (errorCode(e) === 'PHONE_NOT_VERIFIED') {
        return refresh.then(() => {
          onCancel();
          onPhoneNotVerified?.();
        });
      }
      return refresh;
    },
    onSettled: () => {
      busyRef.current = false;
    },
  });

  const confirm = () => {
    if (busyRef.current) return;
    busyRef.current = true;
    onPosting(true);
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
      {freeNote && <p className="text-sm text-stone-700">{freeShipConfirmText(freeNote)}</p>}
      {claimPoint && (
        <div className="space-y-0.5">
          <ClaimPointInfo point={claimPoint} heading={claimPoint.name} />
          <div className="text-caption text-stone-700">{`Hạn nhận ${catalog.giftClaimDays} ngày`}</div>
        </div>
      )}
      {error && (
        <p role="alert" className={ui.error}>
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} disabled={posting} className={`${miniBtnSecondary} flex-1`}>
          Huỷ
        </button>
        {/* Nút đang giữ focus mà `disabled` thì Chromium thả focus về body: báo bận bằng aria-*, chặn ở `confirm`. */}
        <button type="button" onClick={confirm} aria-busy={redeem.isPending || undefined} aria-disabled={redeem.isPending || undefined} className={`${ui.btnPrimary} flex-1`}>
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

/** Phần nút của thẻ quà theo trạng thái (Đổi, Đã hết, Chờ mở khoá, Cần thêm), như Mini `RewardAction`. */
function RewardAction({ s, preview, onRedeem }: { s: ReturnType<typeof rewardCardState>; preview: boolean; onRedeem: () => void }) {
  if (s.kind === 'soldOut') return <Badge>Đã hết</Badge>;
  if (preview) return null;
  if (s.kind === 'redeem')
    return (
      <button type="button" onClick={onRedeem} className={`${ui.btnPrimary} min-w-[88px]`}>
        Đổi
      </button>
    );
  if (s.kind === 'needPhoneVerify')
    return (
      <button type="button" disabled className={ui.btnPrimary}>
        Đổi
      </button>
    );
  if (s.kind === 'locked')
    return (
      <button type="button" disabled className={ui.btnPrimary}>
        Chờ mở khoá điểm
      </button>
    );
  return <div className="text-caption tabular-nums text-stone-700">{`Cần thêm ${formatCount(s.missing)} điểm`}</div>;
}

/**
 * Thẻ quà gọn (bản web của Mini `RewardCard`, cùng lớp CSS ở member-polish.css): biểu tượng, tên, viên giá điểm, tối đa một viên ngắn và nút Đổi.
 * Câu dài nằm trong sheet chi tiết: quà có nội dung thêm thì tên là nút phủ cả thẻ, nút Đổi nổi trên lớp phủ.
 */
function RewardCard({ reward, catalog, onRedeem, onDetail, preview = false }: { reward: RewardItemDTO; catalog: RewardCatalogDTO; onRedeem: () => void; onDetail: () => void; preview?: boolean }) {
  const s = rewardCardState(reward, catalog);
  const freeNote = preview ? null : rewardFreeShipNote(reward, catalog, formatVnd);
  const pill = rewardPill(reward, { covered: freeNote !== null, formatNumber: formatCount });
  const hasDetail = rewardDetailLines(reward, { freeNote, formatNumber: formatCount }).length > 0;
  const KindIcon = KIND_ICON[reward.kind];
  return (
    <div data-reward className={`tubu-reward-card relative p-3 ${miniOutline}`}>
      <div className="tubu-reward-row">
        <span data-testid="reward-icon" className="tubu-reward-icon text-forest-700">
          <KindIcon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="tubu-reward-main">
          <div className="tubu-reward-title text-base font-semibold text-stone-900">
            {hasDetail ? (
              <button type="button" className="tubu-reward-hit" aria-haspopup="dialog" onClick={onDetail}>
                {reward.name}
                <span className="tubu-reward-info">
                  <Info className="h-4 w-4 text-stone-500" aria-hidden="true" />
                </span>
              </button>
            ) : (
              reward.name
            )}
          </div>
          <div className="tubu-reward-meta">
            <span className="tubu-reward-points" data-testid="reward-points">
              {points(reward.pointsCost)}
            </span>
            {pill && (
              <span className="tubu-reward-pill" data-testid="reward-pill">
                {pill}
              </span>
            )}
          </div>
        </div>
        <div className="tubu-reward-cta">
          <RewardAction s={s} preview={preview} onRedeem={onRedeem} />
        </div>
      </div>
      {!preview && s.kind === 'need' && <ProgressBar value={reward.pointsCost - s.missing} max={reward.pointsCost} ariaLabel={`${reward.name}: điểm đang có so với điểm cần để đổi`} />}
    </div>
  );
}

/** Giữ giá trị khác null gần nhất: sheet còn chạy hoạt ảnh đóng sau khi state về null, nội dung không được biến mất giữa chừng. */
function useLastNonNull<T>(value: T | null): T | null {
  const ref = useRef<T | null>(value);
  if (value !== null) ref.current = value;
  return ref.current;
}

/** Lưới thẻ quà kèm MỘT sheet chi tiết dùng chung (như Mini `RewardList`); chân sheet có nút Đổi khi quà đổi được. */
function RewardList({ rewards, catalog, onRedeem, preview = false }: { rewards: readonly RewardItemDTO[]; catalog: RewardCatalogDTO; onRedeem: (r: RewardItemDTO) => void; preview?: boolean }) {
  const [detail, setDetail] = useState<RewardItemDTO | null>(null);
  const shown = useLastNonNull(detail);
  const s = shown ? rewardCardState(shown, catalog) : null;
  const lines = shown ? rewardDetailLines(shown, { freeNote: preview ? null : rewardFreeShipNote(shown, catalog, formatVnd), formatNumber: formatCount }) : [];
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rewards.map((r) => (
          <RewardCard key={r.id} reward={r} catalog={catalog} onRedeem={() => onRedeem(r)} onDetail={() => setDetail(r)} preview={preview} />
        ))}
      </div>
      <Sheet
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={shown?.name ?? ''}
        footer={
          shown && s && !preview && s.kind === 'redeem' ? (
            <button
              type="button"
              className={`${ui.btnPrimary} w-full`}
              onClick={() => {
                setDetail(null);
                onRedeem(shown);
              }}
            >
              {`Đổi · ${points(shown.pointsCost)}`}
            </button>
          ) : (
            <button type="button" className={`${miniBtnSecondary} w-full`} onClick={() => setDetail(null)}>
              Đóng
            </button>
          )
        }
      >
        {shown && (
          <div className="flex flex-col gap-3" data-testid="reward-detail">
            <div className="tubu-reward-meta">
              <span className="tubu-reward-points">{points(shown.pointsCost)}</span>
            </div>
            {lines.map((l) => (
              <p key={l} className="text-sm text-stone-700">
                {l}
              </p>
            ))}
          </div>
        )}
      </Sheet>
    </>
  );
}

function RewardResult({ outcome, onClose }: { outcome: RedeemOutcome | null; onClose: () => void }) {
  const { use, notice, cancel, usingCode } = useCouponUse();
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
            <button
              type="button"
              onClick={() => void use(outcome.couponCode ?? '', onClose)}
              aria-busy={usingCode === outcome.couponCode || undefined}
              aria-disabled={usingCode === outcome.couponCode || undefined}
              className={`${ui.btnPrimary} w-full`}
            >
              {couponUseCopy.use}
            </button>
          )}
          {notice && (
            <p role={notice.error ? 'alert' : 'status'} className={`text-caption ${notice.error ? 'text-danger-fg' : 'text-stone-700'}`}>
              {notice.text}
            </p>
          )}
          <Link
            href={outcome.couponCode ? `/kho-qua/cua-toi?${NEW_COUPON_PARAM}=${encodeURIComponent(outcome.couponCode)}` : '/kho-qua/cua-toi'}
            onClick={onClose}
            className={`${miniBtnSecondary} w-full`}
          >
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
  const verifyBannerRef = useRef<HTMLDivElement | null>(null);
  const rewardsQ = useQuery(rewardsQuery(coreHttp));
  const loyaltyQ = useQuery(loyaltyQuery(coreHttp));
  const cfg = usePublicConfig();
  const [tab, setTab] = useState<string>(REWARD_TABS[0].key);
  const [confirmReward, setConfirmReward] = useState<RewardItemDTO | null>(null);
  const [posting, setPosting] = useState(false);
  const [result, setResult] = useState<RedeemOutcome | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  // Giữ khoá ở thân trang để đóng khung rồi mở lại cùng quà sau lỗi mạng vẫn gửi đúng khoá cũ: máy chủ có thể đã trừ điểm.
  const idem = useIdempotencyKey({ rewardId: confirmReward?.id ?? null });

  if (rewardsQ.isError && !rewardsQ.data) return <ErrorState message={errText(rewardsQ.error)} onRetry={() => void rewardsQ.refetch()} />;
  const c = rewardsQ.data;
  if (!c) return <Skeleton height={120} />;

  const kinds: readonly string[] = REWARD_TABS.find((t) => t.key === tab)?.kinds ?? [];
  const shown = orderRewards(c.rewards.filter((r) => kinds.includes(r.kind)), c);
  const showPhoneBanner = c.phoneVerified === false && shown.some(isWarehousePickup);
  const total = pointsSummary(c).total;
  const rulesNote = cfg.isLoaded ? pointsRulesNote(cfg.loyalty) : null;
  const lockedNote = loyaltyQ.data ? lockedPointsNote(loyaltyQ.data) : null;
  const scrollToVerifyBanner = () => {
    requestAnimationFrame(() => {
      verifyBannerRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    });
  };

  return (
    <div className="space-y-4 pb-12">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <div className="font-bold tabular-nums text-stone-900 md:text-3xl max-md:font-display max-md:text-[length:var(--type-display-md-size)] max-md:font-semibold max-md:leading-[var(--type-display-md-lh)]">
            {points(total)}
          </div>
          <button type="button" onClick={() => setRulesOpen(true)} className={`${ui.btnText} flex-none gap-1.5 text-forest-700`}>
            <Info className="h-4 w-4" aria-hidden="true" />
            {rewardsGuideCopy.rulesButton}
          </button>
        </div>
        {c.redeemablePoints !== total && <p className="text-sm text-stone-700">{`Đổi quà dùng được ${points(c.redeemablePoints)}`}</p>}
        {lockedNote && <p className="text-sm text-stone-700">{lockedNote}</p>}
      </div>
      {total === 0 && (
        <section className={`space-y-2 p-4 ${ui.card}`}>
          <h2 className="font-display text-base font-semibold text-stone-900">{rewardsGuideCopy.earnTitle}</h2>
          {rewardsGuideCopy.earnItems.map((line) => (
            <p key={line} className="text-sm text-stone-700">
              {line}
            </p>
          ))}
          <Link href="/tai-khoan/diem-xanh" className={`${miniBtnSecondary} w-full`}>
            {rewardsGuideCopy.earnCta}
          </Link>
        </section>
      )}
      <Sheet open={rulesOpen} onClose={() => setRulesOpen(false)} title={rewardsGuideCopy.rulesTitle}>
        <div className="space-y-2">
          {rulesNote && <p className="text-sm text-stone-700">{rulesNote}</p>}
          {c.pointsConvertedBalance > 0 && (
            <p className="text-sm text-stone-700">Điểm không hết hạn chỉ dùng khi thanh toán và góp quỹ trồng cây, không dùng để đổi mã giảm giá hay quà.</p>
          )}
        </div>
      </Sheet>
      <Link href="/kho-qua/cua-toi" className={`flex min-h-11 items-center gap-3 p-3 hover:bg-stone-50 ${ui.card} max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:px-0 max-md:shadow-none`}>
        <Gift className="h-5 w-5 flex-none text-forest-600" aria-hidden="true" />
        <span className="flex-1 text-sm font-semibold text-stone-900">Quà của tôi</span>
        <ChevronRight className="h-4 w-4 flex-none text-stone-500" aria-hidden="true" />
      </Link>
      <SegmentedTabs value={tab} onChange={setTab} items={REWARD_TABS.map((t) => ({ key: t.key, label: t.label }))} label="Loại quà" />
      {showPhoneBanner && (
        <div ref={verifyBannerRef} data-testid="rewards-phone-verify-banner" className={`space-y-3 p-4 ${ui.card}`}>
          <p className="text-sm font-semibold text-stone-900">{rewardPhoneVerifyCopy.notice}</p>
          <a href={miniAppPathLink('/rewards')} className={`${miniBtnSecondary} w-full sm:w-auto`}>
            {rewardPhoneVerifyCopy.webCta}
          </a>
        </div>
      )}
      {shown.length === 0 ? (
        <p className="text-sm text-stone-700">Chưa có quà trong mục này</p>
      ) : (
        <RewardList rewards={shown} catalog={c} onRedeem={setConfirmReward} />
      )}
      <Sheet open={confirmReward !== null} dismissible={!posting} onClose={() => setConfirmReward(null)} title="Xác nhận đổi quà">
        {confirmReward && (
          <RedeemConfirm
            reward={confirmReward}
            catalog={c}
            idemKey={idem.key}
            posting={posting}
            onPosting={setPosting}
            onRedeemed={idem.rotate}
            onDone={(outcome) => {
              // Làm mới của lệnh này có thể về muộn, sau khi khách đã Huỷ và mở quà khác: chỉ đóng khung nếu vẫn là khung của quà này.
              setConfirmReward((cur) => (cur?.id === confirmReward.id ? null : cur));
              setResult(outcome);
            }}
            onCancel={() => setConfirmReward(null)}
            onPhoneNotVerified={scrollToVerifyBanner}
          />
        )}
      </Sheet>
      <RewardResult outcome={result} onClose={() => setResult(null)} />
    </div>
  );
}

/** Khách chưa đăng nhập: xem được quà đổi bằng Điểm Xanh nhưng chưa đổi được. */
function GuestRewards() {
  // Trang đang đứng (kèm query) làm nơi quay về: RewardsView nhúng ở tab Đổi quà của /uu-dai thì đăng nhập xong phải về đúng hub, không nhảy sang /kho-qua.
  // Hai hook đọc ở đây (không ở RewardsView) vì GuestRewards chỉ vẽ sau hydrate, nên trang /kho-qua dựng tĩnh không bị buộc bọc Suspense.
  const pathname = usePathname();
  const search = useSearchParams()?.toString();
  const returnTo = search ? `${pathname}?${search}` : pathname;
  const q = useQuery(loyaltyPreviewQuery(coreHttp));
  const [tab, setTab] = useState<string>(REWARD_TABS[0].key);
  const kinds: readonly string[] = REWARD_TABS.find((t) => t.key === tab)?.kinds ?? [];
  const shown = q.data ? q.data.rewards.filter((r) => kinds.includes(r.kind)) : [];
  const catalog = q.data ? previewAsCatalog(q.data) : null;
  return (
    <div className="space-y-4 pb-12">
      <p className="text-base text-stone-700">{guestPreviewCopy.hint}</p>
      <GuestLoginLink returnTo={returnTo} />
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
            <RewardList rewards={shown} catalog={catalog} onRedeem={() => undefined} preview />
          )}
        </>
      )}
    </div>
  );
}

/**
 * Thân Kho quà dùng chung cho trang `/kho-qua` và tab Đổi quà của Ưu đãi (một nguồn, không chép logic đổi quà). Bản web của `RewardsView` ở Mini App
 * (`pages/rewards.tsx`). Tự đọc phiên: đang tải, phiên không khả dụng, khách chưa đăng nhập (xem được quà, chưa đổi được) hay đã đăng nhập.
 */
export function RewardsView() {
  const phase = useAuthPhase();
  return (
    <>
      {phase === 'loading' && <AuthLoading />}
      {phase === 'unavailable' && <SessionUnavailable />}
      {phase === 'guest' && <GuestRewards />}
      {phase === 'authenticated' && <RewardsBody />}
    </>
  );
}
