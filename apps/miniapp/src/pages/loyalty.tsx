import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Page, useNavigate, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Sprout, Recycle, Check, CalendarCheck, Gift, Copy, Lock, Lightbulb, QrCode as QrCodeIcon } from 'lucide-react';
import {
  getLoyalty,
  getCoupons,
  getPointsTransactions,
  getLoyaltyRewards,
  redeemLoyaltyReward,
  getDailyCheckInStatus,
  postDailyCheckIn,
  getMemberCard,
  checkInView,
  lockedPointsNote,
  memberCardHint,
  pointsReasonLabel,
  rewardButtonLabel,
  tierProgressPercent,
  type CheckInStatusResponse,
  type CouponDTO,
  type PointsTxn,
  type RewardItem,
} from '../services/account-api';
import { getErrorMessage } from '../services/api';
import { AuthPhaseView } from '../components/ui/auth-gate';
import { useAuthPhase } from '../hooks/use-auth-phase';
import { formatVnd, formatPoints, formatNumber, formatDate } from '../utils/format';
import { haptic } from '../utils/haptic';
import { earnRuleLine, moneyShort, pointsToSpend, redeemRuleLine, tierThresholdLabel } from '../utils/loyalty-copy';
import { copyText } from '../utils/clipboard';
import { PageHeader } from '../components/ui/page-header';
import { Heading, Text } from '../components/ui/text';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Icon } from '../components/ui/icon';
import { ListRow } from '../components/ui/list-row';
import { KeyValueRow } from '../components/ui/key-value-row';
import { BottomSheet } from '../components/ui/bottom-sheet';
import { Skeleton } from '../components/ui/skeleton';
import { Button } from '../components/ui/button';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { QrCode } from '../components/qr-code';
import { convertedPointsNote, expiringPointsNote, pointExpiryPolicyNote, pointsSummary } from '../utils/points-lots';

/**
 * Biểu tượng + màu theo hạng (4 hạng §6.6). Emoji là NỘI DUNG của hạng nên được giữ. Màu trỏ thẳng
 * primitive v2 (thang sage → forest → clay): hạng phân biệt nhau theo độ "già" của xanh, không có
 * token semantic --color-* nào diễn đạt được, và scripts/check-undefined-css-vars.mjs chỉ biết các
 * token trong design-tokens/tokens.css nên token riêng của trang sẽ bị báo "chưa định nghĩa".
 */
const TIER_STYLE: Record<string, { emoji: string; color: string; bg: string }> = {
  'Mầm Xanh': { emoji: '🌱', color: 'var(--sage-700)', bg: 'var(--sage-50)' },
  'Lộc Biếc': { emoji: '🌿', color: 'var(--sage-600)', bg: 'var(--sage-100)' },
  'Đại Thụ': { emoji: '🌳', color: 'var(--forest-700)', bg: 'var(--forest-50)' },
  'Cổ Thụ': { emoji: '🌲', color: 'var(--forest-900)', bg: 'var(--clay-50)' },
};
const DEFAULT_STYLE = TIER_STYLE['Mầm Xanh']!;

function couponLabel(c: CouponDTO): string {
  if (c.type === 'FREESHIP') return 'Miễn phí vận chuyển';
  if (c.type === 'PERCENT') return `Giảm ${c.value}%`;
  return `Giảm ${formatVnd(c.value)}`;
}

/** Giữ giá trị khác null gần nhất: BottomSheet còn chạy hoạt ảnh đóng ~200ms sau khi state về null,
 * nội dung không được trống đi trong lúc trượt xuống. */
function useLastNonNull<T>(value: T | null): T | null {
  const ref = useRef<T | null>(null);
  if (value !== null) ref.current = value;
  return value ?? ref.current;
}

export default function LoyaltyPage() {
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const qc = useQueryClient();
  // Các endpoint /me/* cần auth — fetch trước khi restore() xong sẽ 401 và kẹt vĩnh viễn
  // (queryClient retry:false cho 4xx) dù login thành công ~200ms sau (cùng bug đã fix ở wallet.tsx).
  const phase = useAuthPhase();
  const authed = phase === 'authenticated';
  const loyaltyQ = useQuery({ queryKey: ['loyalty'], queryFn: getLoyalty, enabled: authed });
  const couponsQ = useQuery({ queryKey: ['coupons'], queryFn: getCoupons, enabled: authed });
  const txnQ = useQuery({ queryKey: ['points-txn'], queryFn: getPointsTransactions, enabled: authed });
  const rewardsQ = useQuery({ queryKey: ['loyalty-rewards'], queryFn: getLoyaltyRewards, enabled: authed });
  const checkInQ = useQuery({ queryKey: ['loyalty-checkin'], queryFn: getDailyCheckInStatus, enabled: authed });
  const memberCardQ = useQuery({ queryKey: ['loyalty-member-card'], queryFn: getMemberCard, enabled: authed });

  const [showMemberCard, setShowMemberCard] = useState(false);
  const [confirmReward, setConfirmReward] = useState<RewardItem | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  // Khoá đồng bộ chống chạm đúp: `disabled={mut.isPending}` chỉ có hiệu lực sau lần render kế,
  // 2 cú chạm trong cùng khung hình vẫn gọi mutate 2 lần. Đổi quà KHÔNG idempotent (mỗi lần đủ
  // điểm = 1 mã giảm giá mới) nên phải chặn ngay tại chỗ; điểm danh thì backend đã unique theo ngày.
  const busyRef = useRef({ checkIn: false, redeem: false });

  const refreshPoints = () => {
    void qc.invalidateQueries({ queryKey: ['loyalty'] });
    void qc.invalidateQueries({ queryKey: ['loyalty-checkin'] });
    void qc.invalidateQueries({ queryKey: ['points-txn'] });
    void qc.invalidateQueries({ queryKey: ['loyalty-rewards'] });
  };

  const checkInMut = useMutation({
    mutationFn: postDailyCheckIn,
    onSuccess: (res) => {
      haptic('medium');
      openSnackbar({ text: res.message, type: 'success' });
      // Khoá nút ngay (trước khi refetch trạng thái về) — tránh chạm thêm lúc chờ bị 400 "đã điểm danh".
      qc.setQueryData<CheckInStatusResponse>(['loyalty-checkin'], (old) =>
        old ? { ...old, checkedInToday: true } : old,
      );
      refreshPoints();
    },
    onError: (e) => {
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
      // Vd đã điểm danh trên thiết bị khác → tải lại trạng thái để nút chuyển "Đã điểm danh".
      void qc.invalidateQueries({ queryKey: ['loyalty-checkin'] });
    },
    onSettled: () => {
      busyRef.current.checkIn = false;
    },
  });

  const redeemMut = useMutation({
    mutationFn: (rewardId: string) => redeemLoyaltyReward(rewardId),
    onSuccess: (res) => {
      haptic('heavy');
      setConfirmReward(null);
      openSnackbar({ text: `Đổi thành công! Mã ${res.coupon.code} đã vào mục Mã giảm giá của tôi.`, type: 'success' });
      refreshPoints();
      void qc.invalidateQueries({ queryKey: ['coupons'] });
    },
    onError: (e) => {
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
      refreshPoints();
    },
    onSettled: () => {
      busyRef.current.redeem = false;
    },
  });

  const doCheckIn = () => {
    if (busyRef.current.checkIn) return;
    busyRef.current.checkIn = true;
    checkInMut.mutate();
  };
  const doRedeem = (rewardId: string) => {
    if (busyRef.current.redeem) return;
    busyRef.current.redeem = true;
    redeemMut.mutate(rewardId);
  };

  const copyMemberCode = async () => {
    const code = memberCardQ.data?.memberCode;
    if (!code) return;
    const ok = await copyText(code);
    haptic('light');
    if (!ok) {
      openSnackbar({ text: 'Không sao chép được — hãy đọc mã cho nhân viên.', type: 'error' });
      return;
    }
    setCopiedCode(true);
    openSnackbar({ text: 'Đã sao chép mã thành viên', type: 'success' });
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const data = loyaltyQ.data;
  const tierStyle = data?.tier ? (TIER_STYLE[data.tier.name] ?? DEFAULT_STYLE) : DEFAULT_STYLE;
  const tierName = data?.tier?.name ?? 'Mầm Xanh';
  const perks = Array.isArray(data?.tier?.perks) ? (data.tier.perks as string[]) : [];

  // Progress lên hạng kế: tính TỪ SÀN ĐIỂM hạng hiện tại → ngưỡng hạng kế (không phải từ 0), theo
  // điểm XÉT HẠNG (điểm danh / tích tại quầy không tính) — xem tierProgressPercent.
  const next = data?.nextTier;
  const rates = data?.rates;
  const curMin = data?.tiers.find((t) => t.id === data.tier?.id)?.minPoints ?? 0;
  const progress = data ? tierProgressPercent(data) : 0;
  const checkIn = checkInQ.data ? checkInView(checkInQ.data) : null;
  // Điểm của đơn mới giao/đang đổi-trả chưa đổi quà được (backend chặn) — nói rõ lý do ngay trên danh mục.
  const lockedNote = data ? lockedPointsNote(data) : null;
  // Con số khách thấy là tổng hai lô; đổi mã giảm giá chỉ dùng được lô thường (pointsBalance).
  const lots = data ? pointsSummary(data) : null;
  const convertedNote = convertedPointsNote(lots?.converted);
  const expiringNote = expiringPointsNote(data?.expiringPoints);
  const expiryPolicy = pointExpiryPolicyNote(data?.pointExpireMonths);
  const rewardCatalog = rewardsQ.data;

  // Phát hiện LÊN HẠNG (§6.6 #78): so minPoints hạng hiện tại với lần xem trước (localStorage).
  const [celebrate, setCelebrate] = useState<string | null>(null);
  useEffect(() => {
    if (!data?.tier) return;
    const KEY = 'tubu_last_tier_min';
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(KEY);
    } catch {
      /* ignore */
    }
    // Chỉ chúc mừng khi ĐÃ có mốc trước (lần đầu chỉ ghi nhận, tránh popup giả cho user hạng cao mở app lần đầu).
    if (raw != null && curMin > Number(raw)) setCelebrate(data.tier.name);
    try {
      localStorage.setItem(KEY, String(curMin));
    } catch {
      /* ignore */
    }
  }, [data?.tier, curMin]);

  // sheetReward chỉ để vẽ nội dung lúc sheet trượt xuống; hành động đọc confirmReward (state sống).
  const sheetReward = useLastNonNull(confirmReward);
  const sheetCelebrate = useLastNonNull(celebrate);

  const pageSkeleton = (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Skeleton height={180} radius="var(--radius-card)" />
      <Skeleton height={80} radius="var(--radius-card)" />
    </div>
  );

  return (
    <Page style={{ background: 'var(--color-bg-canvas)', paddingBottom: 'calc(16px + var(--safe-bottom))' }}>
      <PageHeader title="Hạng thành viên & Điểm Xanh" />

      {phase !== 'authenticated' ? (
        <AuthPhaseView phase={phase} loading={pageSkeleton} />
      ) : loyaltyQ.isLoading ? (
        pageSkeleton
      ) : loyaltyQ.isError && !loyaltyQ.data ? (
        <ErrorState message={getErrorMessage(loyaltyQ.error)} onRetry={() => void loyaltyQ.refetch()} />
      ) : data ? (
        <>
          {/* Medallion hạng */}
          <div style={{ padding: 16 }}>
            <div
              style={{
                background: tierStyle.bg,
                borderRadius: 'var(--radius-sheet)',
                padding: 20,
                textAlign: 'center',
                boxShadow: 'var(--elevation-1)',
              }}
            >
              <div aria-hidden style={{ fontSize: 56, lineHeight: '64px' }}>
                {tierStyle.emoji}
              </div>
              <Heading variant="title-lg" as="h2" style={{ color: tierStyle.color, marginTop: 4 }}>
                {tierName}
              </Heading>
              <Text variant="body-sm" tone="secondary" as="div" style={{ marginTop: 2 }}>
                Tích điểm ×{data.tier?.multiplier ?? 1} · {formatPoints(lots?.total ?? 0)} Xanh
              </Text>
              {convertedNote && (
                <Text variant="caption" tone="secondary" as="div" style={{ marginTop: 2 }}>
                  {convertedNote}
                </Text>
              )}
              {expiringNote && (
                <Text
                  variant="caption"
                  tone={expiringNote.urgent ? 'warning' : 'secondary'}
                  as="div"
                  style={{ marginTop: 6, fontWeight: expiringNote.urgent ? 600 : undefined }}
                >
                  {expiringNote.text}
                </Text>
              )}
              {expiryPolicy && (
                <Text variant="caption" tone="secondary" as="div" style={{ marginTop: 2 }}>
                  {expiryPolicy}
                </Text>
              )}

              {next ? (
                <div style={{ marginTop: 16 }}>
                  <div
                    role="progressbar"
                    aria-label="Tiến độ lên hạng kế"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progress}
                    style={{
                      height: 10,
                      background: 'var(--color-bg-surface)',
                      borderRadius: 'var(--radius-pill)',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${progress}%`,
                        background: tierStyle.color,
                        borderRadius: 'var(--radius-pill)',
                        transition: 'width var(--motion-emphasize)',
                      }}
                    />
                  </div>
                  <Text variant="caption" tone="secondary" as="div" style={{ marginTop: 6 }}>
                    Còn <b>{formatNumber(next.pointsToGo)}</b> điểm tích từ mua hàng
                    {rates && next.pointsToGo > 0 ? ` (tương đương khoảng ${moneyShort(pointsToSpend(next.pointsToGo, rates))} mua hàng)` : ''} để
                    lên hạng {next.name}
                  </Text>
                </div>
              ) : (
                <Text variant="caption" as="div" style={{ color: tierStyle.color, marginTop: 8 }}>
                  Bạn đang ở hạng cao nhất 🎉
                </Text>
              )}

              {rates && (
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <Text variant="caption" tone="secondary" as="div">
                    {earnRuleLine(rates, data.tier?.multiplier ?? 1)}
                  </Text>
                  <Text variant="caption" tone="secondary" as="div">
                    {redeemRuleLine(rates)}
                  </Text>
                </div>
              )}

              {/* Nút mở thẻ thành viên số (mã QR) */}
              <div style={{ marginTop: 16, display: 'flex', justifyContent: 'center' }}>
                <Button
                  variant="secondary"
                  icon={QrCodeIcon}
                  onPress={() => {
                    haptic('light');
                    setShowMemberCard(true);
                  }}
                >
                  Thẻ thành viên số (mã QR)
                </Button>
              </div>
            </div>
          </div>

          {/* Mã giảm giá của tôi — ngay dưới thẻ hạng: khách có mã mà không thấy thì mất lý do quay lại (A1-021). */}
          <Section
            title="Mã giảm giá của tôi"
            action={couponsQ.data && couponsQ.data.length > 0 ? `${couponsQ.data.length} mã` : undefined}
          >
            {couponsQ.isLoading ? (
              <Skeleton height={64} />
            ) : couponsQ.isError ? (
              <ErrorState
                variant="inline"
                message={`Chưa tải được mã giảm giá: ${getErrorMessage(couponsQ.error)}`}
                onRetry={() => void couponsQ.refetch()}
              />
            ) : couponsQ.data && couponsQ.data.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {couponsQ.data.map((c) => (
                  <div
                    key={c.code}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      padding: 12,
                      background: 'var(--color-promo-bg)',
                      borderRadius: 'var(--radius-control)',
                      border: '1px dashed var(--clay-100)',
                    }}
                  >
                    <div>
                      <Text variant="body-sm" tone="primary" as="div" style={{ color: 'var(--color-promo-fg)', fontWeight: 700 }}>
                        {couponLabel(c)}
                      </Text>
                      <Text variant="caption" tone="secondary" as="div">
                        Mã {c.code}
                        {c.minOrder ? ` · đơn từ ${formatVnd(c.minOrder)}` : ''}
                      </Text>
                    </div>
                    <Text variant="caption" tone="tertiary">
                      HSD {formatDate(c.endAt)}
                    </Text>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                variant="inline"
                art="leaf"
                heading="Chưa có mã giảm giá khả dụng"
                body="Đổi Điểm Xanh ở mục bên dưới để nhận mã."
              />
            )}
          </Section>

          {/* Widget Điểm danh 7 ngày (Điểm Xanh) — tách riêng với điểm danh giọt nước ở Vườn Xanh */}
          {checkInQ.isLoading ? (
            <div style={{ margin: '0 16px 12px' }}>
              <Skeleton height={120} radius="var(--radius-card)" />
            </div>
          ) : checkInQ.isError ? (
            <Card style={{ margin: '0 16px 12px' }} padding={16}>
              <ErrorState
                variant="inline"
                message={`Chưa tải được lịch điểm danh: ${getErrorMessage(checkInQ.error)}`}
                onRetry={() => void checkInQ.refetch()}
              />
            </Card>
          ) : checkInQ.data && checkIn ? (
            <Card style={{ margin: '0 16px 12px' }} padding={16}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                  <IconTile>
                    <Icon icon={CalendarCheck} tone="brand" />
                  </IconTile>
                  <div style={{ minWidth: 0 }}>
                    <Heading variant="title-sm" as="h2">
                      Điểm danh nhận Điểm Xanh
                    </Heading>
                    <Text variant="caption" tone="tertiary" as="div">
                      Chuỗi: <b>{checkInQ.data.streakDays}</b> ngày liên tiếp {checkInQ.data.streakDays > 0 ? '🔥' : ''}
                    </Text>
                  </div>
                </div>
                <Button
                  disabled={!checkIn.canCheckIn || checkInMut.isPending}
                  loading={checkInMut.isPending}
                  onPress={doCheckIn}
                  style={{ flexShrink: 0 }}
                >
                  {checkIn.buttonLabel}
                </Button>
              </div>

              {/* 7 ngày streak */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, textAlign: 'center' }}>
                {checkInQ.data.rewards.map((r) => (
                  <div
                    key={r.day}
                    style={{
                      padding: 8,
                      borderRadius: 'var(--radius-control)',
                      background: r.claimed
                        ? 'var(--color-bg-subtle)'
                        : r.isToday
                        ? 'var(--color-action-secondary-bg)'
                        : 'var(--color-bg-canvas)',
                      border: r.isToday
                        ? '1px solid var(--color-border-selected)'
                        : r.claimed
                        ? '1px solid var(--color-action-secondary-border)'
                        : '1px solid transparent',
                    }}
                  >
                    <Text variant="label" tone="tertiary" as="div" style={{ fontWeight: 400 }}>
                      N{r.day}
                    </Text>
                    <Text variant="label" tone={r.claimed ? 'brand' : 'primary'} as="div" style={{ marginTop: 2 }}>
                      +{formatNumber(r.points)}
                    </Text>
                    <div style={{ marginTop: 2, display: 'flex', justifyContent: 'center' }}>
                      <Icon
                        icon={r.claimed ? Check : r.day === 7 ? Gift : Sprout}
                        size="sm"
                        tone={r.claimed ? 'brand' : 'muted'}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 8 }}>
                Mỗi ngày 1 lần (giờ Việt Nam), lỡ 1 ngày thì vòng 7 ngày bắt đầu lại. Điểm danh không tính
                vào xét hạng; giọt nước Vườn Xanh điểm danh riêng trong Vườn Cây.
              </Text>
            </Card>
          ) : null}

          {/* Lối tắt tích Điểm & Giọt nước */}
          <Card style={{ margin: '0 16px 12px' }} padding={16}>
            <ListRow
              icon={
                <IconTile>
                  <Icon icon={Sprout} tone="brand" />
                </IconTile>
              }
              title="Vườn Cây Tubu"
              subtitle="Chăm cây nhận quà"
              trailing="chevron"
              onPress={() => navigate('/game')}
            />
            <ListRow
              icon={
                <IconTile>
                  <Icon icon={Recycle} tone="brand" />
                </IconTile>
              }
              title="Trạm Refill"
              subtitle="Đổi vỏ tích nước"
              trailing="chevron"
              onPress={() => navigate('/refill')}
              style={{ borderTop: '1px solid var(--color-border-subtle)' }}
            />
          </Card>

          {/* Quyền lợi hạng */}
          {perks.length > 0 && (
            <Section title="Quyền lợi của bạn">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {perks.map((p, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Icon icon={Check} size="sm" tone="brand" />
                    <Text variant="body-sm">{p}</Text>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Bậc thang hạng */}
          <Section title="Các hạng">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {data.tiers.map((t) => {
                const active = t.name === tierName;
                const ts = TIER_STYLE[t.name] ?? DEFAULT_STYLE;
                return (
                  <div
                    key={t.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      padding: 12,
                      borderRadius: 'var(--radius-control)',
                      background: active ? ts.bg : 'transparent',
                      border: active ? `1px solid ${ts.color}` : '1px solid var(--color-border-subtle)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span aria-hidden>{ts.emoji}</span>
                      <Text variant="body-sm" style={{ fontWeight: active ? 700 : 400 }}>
                        {t.name}
                      </Text>
                    </div>
                    <Text variant="caption" tone="secondary" style={{ textAlign: 'right' }}>
                      {tierThresholdLabel(t, rates)} · ×{t.multiplier}
                    </Text>
                  </div>
                );
              })}
            </div>
          </Section>

          {/* Đổi Điểm Xanh nhận mã giảm giá (Reward Catalog) */}
          <Section
            title="Đổi Điểm Xanh nhận mã giảm giá"
            action={rewardCatalog ? `${rewardCatalog.rewards.length} ưu đãi` : undefined}
          >
            {rewardsQ.isLoading ? (
              <Skeleton height={96} />
            ) : rewardsQ.isError ? (
              <ErrorState
                variant="inline"
                message={`Chưa tải được danh mục đổi quà: ${getErrorMessage(rewardsQ.error)}`}
                onRetry={() => void rewardsQ.refetch()}
              />
            ) : rewardCatalog && rewardCatalog.rewards.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {lockedNote && (
                  <div
                    data-testid="loyalty-locked-points"
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 8,
                      padding: 12,
                      background: 'var(--color-promo-bg)',
                      borderRadius: 'var(--radius-control)',
                      border: '1px solid var(--color-border-subtle)',
                    }}
                  >
                    <Icon icon={Lock} size="sm" tone="muted" style={{ flexShrink: 0, marginTop: 2 }} />
                    <Text variant="caption" tone="secondary">
                      {lockedNote}
                    </Text>
                  </div>
                )}
                {convertedNote && (
                  <Text variant="caption" tone="secondary" as="div">
                    Điểm không hết hạn chỉ dùng khi thanh toán, không dùng để đổi mã giảm giá.
                  </Text>
                )}
                {rewardCatalog.rewards.map((r) => (
                  <div
                    key={r.id}
                    style={{
                      padding: 12,
                      background: 'var(--color-bg-canvas)',
                      borderRadius: 'var(--radius-control)',
                      border: '1px solid var(--color-border-subtle)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <Text variant="body-sm" style={{ fontWeight: 700 }}>
                            {r.title}
                          </Text>
                          {r.badge && (
                            <Badge tone="brand" size="sm">
                              {r.badge}
                            </Badge>
                          )}
                        </div>
                        <Text variant="caption" tone="secondary" as="div" style={{ marginTop: 2 }}>
                          {r.description}
                        </Text>
                      </div>
                      <Text variant="body-sm" tone="brand" style={{ fontWeight: 700, textAlign: 'right' }}>
                        {formatPoints(r.pointsCost)}
                      </Text>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: 8,
                        paddingTop: 8,
                        borderTop: '1px dashed var(--color-border-subtle)',
                      }}
                    >
                      <Text variant="caption" tone="tertiary">
                        HSD 30 ngày sau đổi
                      </Text>
                      <Button
                        style={{ flexShrink: 0, marginLeft: 'auto' }}
                        disabled={!r.canRedeem || redeemMut.isPending}
                        onPress={() => {
                          haptic('light');
                          setConfirmReward(r);
                        }}
                      >
                        {rewardButtonLabel(r, rewardCatalog)}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState variant="inline" art="box" heading="Hiện chưa có ưu đãi nào để đổi" />
            )}
          </Section>

          {/* Lịch sử điểm */}
          <Section title="Lịch sử Điểm Xanh">
            {txnQ.data && txnQ.data.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {txnQ.data.slice(0, 20).map((t: PointsTxn) => (
                  <div
                    key={t.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      padding: '8px 0',
                      borderBottom: '1px solid var(--color-border-subtle)',
                    }}
                  >
                    <div>
                      <Text variant="body-sm" as="div">
                        {pointsReasonLabel(t.reason)}
                      </Text>
                      <Text variant="caption" tone="tertiary" as="div">
                        {formatDate(t.createdAt)}
                        {t.lot === 'CONVERTED' ? ' · Điểm không hết hạn' : ''}
                      </Text>
                    </div>
                    <Text variant="body-sm" tone={t.delta >= 0 ? 'success' : 'danger'} style={{ fontWeight: 700 }}>
                      {t.delta >= 0 ? '+' : ''}
                      {formatNumber(t.delta)}
                    </Text>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState variant="inline" art="sprout" heading="Chưa có giao dịch điểm nào" />
            )}
          </Section>

          <div style={{ padding: 16, display: 'flex', justifyContent: 'center' }}>
            <Button variant="secondary" onPress={() => navigate('/browse')}>
              Mua sắm để tích thêm Điểm Xanh →
            </Button>
          </div>
        </>
      ) : null}

      {/* Thẻ thành viên số (mã QR) */}
      <BottomSheet
        open={showMemberCard}
        onClose={() => setShowMemberCard(false)}
        title="Thẻ Thành Viên Tubu"
        footer={
          <Button fullWidth variant="secondary" onPress={() => setShowMemberCard(false)}>
            Đóng
          </Button>
        }
      >
        <div style={{ textAlign: 'center' }}>
          <Badge size="md" style={{ background: tierStyle.bg, color: tierStyle.color }}>
            <span aria-hidden>{tierStyle.emoji}</span> Hạng {tierName} · {formatPoints(lots?.total ?? 0)} Xanh
          </Badge>
        </div>

        {/* Mã QR THẬT của memberCode — đúng chuỗi mà /loyalty/staff/scan-member nhận (khớp chính xác). */}
        <div
          style={{
            marginTop: 16,
            padding: 12,
            background: 'var(--color-bg-canvas)',
            borderRadius: 'var(--radius-card)',
            border: '1px solid var(--color-border-subtle)',
            textAlign: 'center',
          }}
        >
          {memberCardQ.isLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <Skeleton width={180} height={180} />
            </div>
          ) : memberCardQ.isError || !memberCardQ.data ? (
            <ErrorState
              variant="inline"
              message={`Chưa tải được mã thành viên: ${getErrorMessage(memberCardQ.error)}`}
              onRetry={() => void memberCardQ.refetch()}
            />
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <QrCode value={memberCardQ.data.memberCode} size={180} />
              </div>

              {/* Mã thành viên (gõ tay được nếu không quét) & nút chép */}
              <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <Text
                  variant="body-lg"
                  style={{ fontWeight: 700, letterSpacing: '2px', fontFamily: 'monospace' }}
                >
                  {memberCardQ.data.memberCode}
                </Text>
                <Button variant="ghost" icon={Copy} onPress={copyMemberCode}>
                  {copiedCode ? 'Đã chép' : 'Chép'}
                </Button>
              </div>
            </>
          )}
        </div>

        {memberCardQ.data && (
          <div
            style={{
              marginTop: 12,
              padding: 8,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              background: 'var(--color-bg-subtle)',
              borderRadius: 'var(--radius-control)',
            }}
          >
            <Icon icon={Lightbulb} size="sm" tone="brand" style={{ flexShrink: 0, marginTop: 2 }} />
            <Text variant="caption" tone="secondary">
              {memberCardHint(memberCardQ.data)}
            </Text>
          </div>
        )}
      </BottomSheet>

      {/* Xác nhận đổi mã giảm giá */}
      <BottomSheet
        open={confirmReward !== null}
        onClose={() => setConfirmReward(null)}
        title="Xác nhận đổi ưu đãi"
        footer={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              fullWidth
              variant="secondary"
              disabled={redeemMut.isPending || confirmReward === null}
              onPress={() => setConfirmReward(null)}
            >
              Huỷ
            </Button>
            <Button
              fullWidth
              disabled={redeemMut.isPending || confirmReward === null}
              loading={redeemMut.isPending}
              onPress={() => {
                if (confirmReward) doRedeem(confirmReward.id);
              }}
            >
              Đổi ngay
            </Button>
          </div>
        }
      >
        {sheetReward && (
          <>
            <div style={{ padding: 12, background: 'var(--color-bg-canvas)', borderRadius: 'var(--radius-control)' }}>
              <Text variant="body-sm" as="div" style={{ fontWeight: 700 }}>
                {sheetReward.title}
              </Text>
              <Text variant="caption" tone="secondary" as="div" style={{ marginTop: 2 }}>
                {sheetReward.description}
              </Text>
              <div style={{ marginTop: 8, paddingTop: 4, borderTop: '1px dashed var(--color-border-subtle)' }}>
                <KeyValueRow label="Điểm cần trừ:" value={`-${formatPoints(sheetReward.pointsCost)} Xanh`} />
                <KeyValueRow
                  label="Điểm còn lại:"
                  value={`${formatPoints((lots?.total ?? 0) - sheetReward.pointsCost)} Xanh`}
                />
              </div>
            </div>
            <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 10 }}>
              Mã giảm giá sau khi đổi có hạn 30 ngày và xuất hiện ngay trong mục Mã giảm giá của tôi.
            </Text>
          </>
        )}
      </BottomSheet>

      {/* Chúc mừng lên hạng (§6.6 #78) */}
      <BottomSheet
        open={celebrate !== null}
        onClose={() => setCelebrate(null)}
        title={`Chúc mừng lên hạng ${sheetCelebrate ?? ''}!`}
        footer={
          <Button fullWidth onPress={() => setCelebrate(null)}>
            Tuyệt vời!
          </Button>
        }
      >
        {sheetCelebrate && (
          <div style={{ textAlign: 'center' }}>
            <div aria-hidden style={{ fontSize: 64, lineHeight: '72px' }}>
              {(TIER_STYLE[sheetCelebrate] ?? DEFAULT_STYLE).emoji}🎉
            </div>
            <Text variant="body-sm" tone="secondary" as="div" style={{ marginTop: 6 }}>
              Bạn vừa mở khoá quyền lợi mới của hạng {sheetCelebrate}. Cảm ơn bạn đã đồng hành sống xanh
              cùng Tubu 🌿
            </Text>
            {perks.length > 0 && (
              <div style={{ textAlign: 'left', marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {perks.slice(0, 4).map((p, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Icon icon={Check} size="sm" tone="brand" />
                    <Text variant="body-sm">{p}</Text>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </BottomSheet>
    </Page>
  );
}

function IconTile({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        width: 32,
        height: 32,
        flexShrink: 0,
        borderRadius: 'var(--radius-control)',
        background: 'var(--color-bg-subtle)',
        display: 'grid',
        placeItems: 'center',
      }}
    >
      {children}
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: string; children: ReactNode }) {
  return (
    <Card style={{ margin: '0 16px 12px' }} padding={16}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
        <Heading variant="title-sm" as="h2">
          {title}
        </Heading>
        {action && (
          <Text variant="caption" tone="tertiary">
            {action}
          </Text>
        )}
      </div>
      {children}
    </Card>
  );
}
