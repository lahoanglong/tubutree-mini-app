import { useEffect, useRef, useState } from 'react';
import { Box, Page, Text, Button, useNavigate, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Sprout, Recycle, Check, ChevronRight, QrCode as QrCodeIcon, CalendarCheck, Gift, X, Copy } from 'lucide-react';
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
import { useAuthStore } from '../store/auth';
import { formatVnd, formatPoints } from '../utils/format';
import { haptic } from '../utils/haptic';
import { copyText } from '../utils/clipboard';
import { Skeleton } from '../components/ui/skeleton';
import { ErrorState } from '../components/ui/empty-state';
import { QrCode } from '../components/qr-code';

/** Biểu tượng + màu theo hạng (4 hạng §6.6). */
const TIER_STYLE: Record<string, { emoji: string; color: string; bg: string }> = {
  'Mầm Xanh': { emoji: '🌱', color: 'var(--leaf-700)', bg: 'var(--leaf-50)' },
  'Lộc Biếc': { emoji: '🌿', color: 'var(--leaf-600)', bg: 'var(--leaf-100)' },
  'Đại Thụ': { emoji: '🌳', color: 'var(--primary-700)', bg: 'var(--primary-50)' },
  'Cổ Thụ': { emoji: '🌲', color: 'var(--primary-900)', bg: 'var(--clay-50)' },
};
const DEFAULT_STYLE = { emoji: '🌱', color: 'var(--leaf-700)', bg: 'var(--leaf-50)' };

function couponLabel(c: CouponDTO): string {
  if (c.type === 'FREESHIP') return 'Miễn phí vận chuyển';
  if (c.type === 'PERCENT') return `Giảm ${c.value}%`;
  return `Giảm ${formatVnd(c.value)}`;
}

export default function LoyaltyPage() {
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const qc = useQueryClient();
  // Các endpoint /me/* cần auth — fetch trước khi restore() xong sẽ 401 và kẹt vĩnh viễn
  // (queryClient retry:false cho 4xx) dù login thành công ~200ms sau (cùng bug đã fix ở wallet.tsx).
  const authed = useAuthStore((s) => s.status === 'authenticated');
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
  // điểm = 1 voucher mới) nên phải chặn ngay tại chỗ; điểm danh thì backend đã unique theo ngày.
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
      openSnackbar({ text: `Đổi thành công! Mã ${res.coupon.code} đã vào Kho voucher.`, type: 'success' });
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

  const data = loyaltyQ.data;
  const style = data?.tier ? (TIER_STYLE[data.tier.name] ?? DEFAULT_STYLE) : DEFAULT_STYLE;
  const tierName = data?.tier?.name ?? 'Mầm Xanh';
  const perks = Array.isArray(data?.tier?.perks) ? (data.tier.perks as string[]) : [];

  // Progress lên hạng kế: tính TỪ SÀN ĐIỂM hạng hiện tại → ngưỡng hạng kế (không phải từ 0), theo
  // điểm XÉT HẠNG (điểm danh / tích tại quầy không tính) — xem tierProgressPercent.
  const next = data?.nextTier;
  const curMin = data?.tiers.find((t) => t.id === data.tier?.id)?.minPoints ?? 0;
  const progress = data ? tierProgressPercent(data) : 0;
  const checkIn = checkInQ.data ? checkInView(checkInQ.data) : null;
  // Điểm của đơn mới giao/đang đổi-trả chưa đổi quà được (backend chặn) — nói rõ lý do ngay trên danh mục.
  const lockedNote = data ? lockedPointsNote(data) : null;

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

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)' }}>

      {!authed || loyaltyQ.isLoading ? (
        <Box p={4} style={{ gap: 12 }} flex flexDirection="column">
          <Skeleton style={{ height: 180, borderRadius: 16 }} />
          <Skeleton style={{ height: 80, borderRadius: 16 }} />
        </Box>
      ) : loyaltyQ.isError ? (
        <ErrorState message={getErrorMessage(loyaltyQ.error)} onRetry={() => void loyaltyQ.refetch()} />
      ) : data ? (
        <>
          {/* Medallion hạng */}
          <Box p={4}>
            <Box
              p={5}
              style={{
                background: style.bg,
                borderRadius: 'var(--radius-xl)',
                textAlign: 'center',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              <Text style={{ fontSize: 56, lineHeight: '64px' }}>{style.emoji}</Text>
              <Text bold size="xLarge" style={{ color: style.color, marginTop: 4 }}>
                {tierName}
              </Text>
              <Text size="small" style={{ color: 'var(--neutral-600)', marginTop: 2 }}>
                Tích điểm ×{data.tier?.multiplier ?? 1} · {formatPoints(data.pointsBalance)} Xanh
              </Text>

              {next ? (
                <Box mt={4}>
                  <Box
                    style={{
                      height: 10,
                      background: 'var(--neutral-0)',
                      borderRadius: 'var(--radius-full)',
                      overflow: 'hidden',
                    }}
                  >
                    <Box
                      style={{
                        height: '100%',
                        width: `${progress}%`,
                        background: style.color,
                        borderRadius: 'var(--radius-full)',
                        transition: 'width var(--dur-slow) var(--ease-out)',
                      }}
                    />
                  </Box>
                  <Text size="xSmall" style={{ color: 'var(--neutral-600)', marginTop: 6 }}>
                    Còn <b>{next.pointsToGo.toLocaleString('vi-VN')}</b> điểm tích từ mua hàng để lên hạng {next.name}
                  </Text>
                </Box>
              ) : (
                <Text size="xSmall" style={{ color: style.color, marginTop: 8 }}>
                  Bạn đang ở hạng cao nhất 🎉
                </Text>
              )}

              {/* Nút mở thẻ thành viên số (mã QR) */}
              <Box mt={4} flex justifyContent="center">
                <Box
                  className="tubu-press"
                  onClick={() => {
                    haptic('light');
                    setShowMemberCard(true);
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 16px',
                    background: 'rgba(255, 255, 255, 0.92)',
                    borderRadius: 'var(--radius-full)',
                    cursor: 'pointer',
                    boxShadow: 'var(--shadow-sm)',
                    border: `1px solid ${style.color}`,
                  }}
                >
                  <QrCodeIcon size={16} color={style.color} />
                  <Text size="xSmall" bold style={{ color: style.color }}>
                    Thẻ thành viên số (mã QR)
                  </Text>
                </Box>
              </Box>
            </Box>
          </Box>

          {/* Widget Điểm danh 7 ngày (Điểm Xanh) — tách riêng với điểm danh hạt giống ở Vườn Xanh */}
          {checkInQ.isLoading ? (
            <Box mx={4} mb={3}>
              <Skeleton style={{ height: 120, borderRadius: 16 }} />
            </Box>
          ) : checkInQ.isError ? (
            <Box mx={4} mb={3} p={3} style={{ background: 'var(--neutral-0)', borderRadius: 'var(--radius-lg)' }}>
              <Box flex alignItems="center" justifyContent="space-between" style={{ gap: 8 }}>
                <Text size="xSmall" style={{ color: 'var(--neutral-600)', flex: 1 }}>
                  Chưa tải được lịch điểm danh: {getErrorMessage(checkInQ.error)}
                </Text>
                <Button size="small" variant="secondary" onClick={() => void checkInQ.refetch()}>
                  Thử lại
                </Button>
              </Box>
            </Box>
          ) : checkInQ.data && checkIn ? (
            <Box mx={4} mb={3} p={4} style={{ background: 'var(--neutral-0)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)' }}>
              <Box flex alignItems="center" justifyContent="space-between" mb={3}>
                <Box flex alignItems="center" style={{ gap: 8 }}>
                  <Box style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--leaf-50)', display: 'grid', placeItems: 'center' }}>
                    <CalendarCheck size={18} color="var(--leaf-600)" />
                  </Box>
                  <Box>
                    <Text bold size="small">Điểm danh nhận Điểm Xanh</Text>
                    <Text size="xSmall" style={{ color: 'var(--neutral-500)' }}>
                      Chuỗi: <b>{checkInQ.data.streakDays}</b> ngày liên tiếp {checkInQ.data.streakDays > 0 ? '🔥' : ''}
                    </Text>
                  </Box>
                </Box>
                <Button
                  size="small"
                  disabled={!checkIn.canCheckIn || checkInMut.isPending}
                  loading={checkInMut.isPending}
                  onClick={doCheckIn}
                  style={{
                    borderRadius: 'var(--radius-full)',
                    background: checkIn.canCheckIn ? 'var(--leaf-600)' : 'var(--neutral-200)',
                    color: checkIn.canCheckIn ? 'var(--neutral-0)' : 'var(--neutral-500)',
                  }}
                >
                  {checkIn.buttonLabel}
                </Button>
              </Box>

              {/* 7 ngày streak */}
              <Box style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, textAlign: 'center' }}>
                {checkInQ.data.rewards.map((r) => (
                  <Box
                    key={r.day}
                    p={2}
                    style={{
                      borderRadius: 'var(--radius-md)',
                      background: r.claimed
                        ? 'var(--leaf-50)'
                        : r.isToday
                        ? 'var(--primary-50)'
                        : 'var(--neutral-100)',
                      border: r.isToday
                        ? '1px solid var(--primary-600)'
                        : r.claimed
                        ? '1px solid var(--leaf-200)'
                        : '1px solid transparent',
                    }}
                  >
                    <Text size="xSmall" style={{ color: 'var(--neutral-500)', fontSize: 10 }}>N{r.day}</Text>
                    <Text bold size="xSmall" style={{ color: r.claimed ? 'var(--leaf-700)' : 'var(--neutral-800)', marginTop: 2 }}>
                      +{r.points}
                    </Text>
                    <Text style={{ fontSize: 12, marginTop: 2 }}>
                      {r.claimed ? '✓' : r.day === 7 ? '🎁' : '🌱'}
                    </Text>
                  </Box>
                ))}
              </Box>
              <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 8, lineHeight: '16px' }}>
                Mỗi ngày 1 lần (giờ Việt Nam), lỡ 1 ngày thì vòng 7 ngày bắt đầu lại. Điểm danh không tính
                vào xét hạng; hạt giống Vườn Xanh điểm danh riêng trong Vườn Cây.
              </Text>
            </Box>
          ) : null}

          {/* Lối tắt tích Điểm & Giọt nước */}
          <Box px={4} pb={2}>
            <Box style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Box
                className="tubu-press"
                onClick={() => navigate('/game')}
                p={3}
                style={{
                  background: 'var(--neutral-0)',
                  borderRadius: 'var(--radius-lg)',
                  border: '1px solid var(--leaf-200)',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <Box flex alignItems="center" justifyContent="space-between">
                  <Box
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      background: 'var(--leaf-50)',
                      display: 'grid',
                      placeItems: 'center',
                    }}
                  >
                    <Sprout size={18} color="var(--leaf-600)" />
                  </Box>
                  <ChevronRight size={16} color="var(--neutral-400)" />
                </Box>
                <Text size="small" bold style={{ color: 'var(--leaf-800)', marginTop: 4 }}>
                  Vườn Cây Tubu
                </Text>
                <Text size="xSmall" style={{ color: 'var(--neutral-500)' }}>
                  Chăm cây nhận quà
                </Text>
              </Box>

              <Box
                className="tubu-press"
                onClick={() => navigate('/refill')}
                p={3}
                style={{
                  background: 'var(--neutral-0)',
                  borderRadius: 'var(--radius-lg)',
                  border: '1px solid var(--primary-200)',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <Box flex alignItems="center" justifyContent="space-between">
                  <Box
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      background: 'var(--primary-50)',
                      display: 'grid',
                      placeItems: 'center',
                    }}
                  >
                    <Recycle size={18} color="var(--primary-700)" />
                  </Box>
                  <ChevronRight size={16} color="var(--neutral-400)" />
                </Box>
                <Text size="small" bold style={{ color: 'var(--primary-800)', marginTop: 4 }}>
                  Trạm Refill
                </Text>
                <Text size="xSmall" style={{ color: 'var(--neutral-500)' }}>
                  Đổi vỏ tích nước
                </Text>
              </Box>
            </Box>
          </Box>

          {/* Quyền lợi hạng */}
          {perks.length > 0 && (
            <Section title="Quyền lợi của bạn">
              <Box flex flexDirection="column" style={{ gap: 8 }}>
                {perks.map((p, i) => (
                  <Box key={i} flex alignItems="center" style={{ gap: 8 }}>
                    <Check size={16} color="var(--leaf-600)" />
                    <Text size="small">{p}</Text>
                  </Box>
                ))}
              </Box>
            </Section>
          )}

          {/* Bậc thang hạng */}
          <Section title="Các hạng">
            <Box flex flexDirection="column" style={{ gap: 6 }}>
              {data.tiers.map((t) => {
                const active = t.name === tierName;
                const ts = TIER_STYLE[t.name] ?? DEFAULT_STYLE;
                return (
                  <Box
                    key={t.id}
                    flex
                    alignItems="center"
                    justifyContent="space-between"
                    p={3}
                    style={{
                      borderRadius: 'var(--radius-md)',
                      background: active ? ts.bg : 'transparent',
                      border: active ? `1px solid ${ts.color}` : '1px solid var(--neutral-100)',
                    }}
                  >
                    <Box flex alignItems="center" style={{ gap: 8 }}>
                      <Text>{ts.emoji}</Text>
                      <Text size="small" bold={active}>
                        {t.name}
                      </Text>
                    </Box>
                    <Text size="xSmall" style={{ color: 'var(--neutral-600)' }}>
                      từ {t.minPoints.toLocaleString('vi-VN')} điểm tích luỹ · ×{t.multiplier}
                    </Text>
                  </Box>
                );
              })}
            </Box>
          </Section>

          {/* Đổi Điểm Nhận Voucher (Reward Catalog) */}
          <Section
            title="Đổi Điểm Nhận Voucher"
            action={rewardsQ.data ? `${rewardsQ.data.rewards.length} ưu đãi` : undefined}
          >
            {rewardsQ.isLoading ? (
              <Skeleton style={{ height: 96, borderRadius: 12 }} />
            ) : rewardsQ.isError ? (
              <Box flex alignItems="center" justifyContent="space-between" style={{ gap: 8 }}>
                <Text size="small" style={{ color: 'var(--neutral-600)', flex: 1 }}>
                  Chưa tải được danh mục đổi quà: {getErrorMessage(rewardsQ.error)}
                </Text>
                <Button size="small" variant="secondary" onClick={() => void rewardsQ.refetch()}>
                  Thử lại
                </Button>
              </Box>
            ) : rewardsQ.data && rewardsQ.data.rewards.length > 0 ? (
              <Box flex flexDirection="column" style={{ gap: 10 }}>
                {lockedNote && (
                  <Box
                    p={3}
                    data-testid="loyalty-locked-points"
                    style={{ background: 'var(--clay-50)', borderRadius: 'var(--radius-md)', border: '1px solid var(--neutral-200)' }}
                  >
                    <Text size="xSmall" style={{ color: 'var(--neutral-700)', lineHeight: '16px' }}>
                      🔒 {lockedNote}
                    </Text>
                  </Box>
                )}
                {rewardsQ.data.rewards.map((r) => (
                  <Box
                    key={r.id}
                    p={3}
                    style={{
                      background: 'var(--neutral-50)',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--neutral-200)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    <Box flex alignItems="flex-start" justifyContent="space-between">
                      <Box style={{ flex: 1 }}>
                        <Box flex alignItems="center" style={{ gap: 6 }}>
                          <Text bold size="small">{r.title}</Text>
                          {r.badge && (
                            <Box
                              px={2}
                              py={0.5}
                              style={{
                                background: 'var(--primary-100)',
                                borderRadius: 'var(--radius-full)',
                              }}
                            >
                              <Text size="xSmall" bold style={{ color: 'var(--primary-700)', fontSize: 10 }}>
                                {r.badge}
                              </Text>
                            </Box>
                          )}
                        </Box>
                        <Text size="xSmall" style={{ color: 'var(--neutral-600)', marginTop: 2 }}>
                          {r.description}
                        </Text>
                      </Box>
                      <Box style={{ textAlign: 'right', marginLeft: 8 }}>
                        <Text bold size="small" style={{ color: 'var(--leaf-700)' }}>
                          {formatPoints(r.pointsCost)}
                        </Text>
                      </Box>
                    </Box>

                    <Box flex alignItems="center" justifyContent="space-between" pt={1} style={{ borderTop: '1px dashed var(--neutral-200)' }}>
                      <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
                        HSD 30 ngày sau đổi
                      </Text>
                      <Button
                        size="small"
                        disabled={!r.canRedeem || redeemMut.isPending}
                        onClick={() => {
                          haptic('light');
                          setConfirmReward(r);
                        }}
                        style={{
                          borderRadius: 'var(--radius-full)',
                          background: r.canRedeem ? 'var(--leaf-600)' : 'var(--neutral-200)',
                          color: r.canRedeem ? 'var(--neutral-0)' : 'var(--neutral-500)',
                          padding: '4px 12px',
                          fontSize: 12,
                        }}
                      >
                        {rewardButtonLabel(r, rewardsQ.data!)}
                      </Button>
                    </Box>
                  </Box>
                ))}
              </Box>
            ) : (
              <Text size="small" style={{ color: 'var(--neutral-400)' }}>
                Hiện chưa có ưu đãi nào để đổi.
              </Text>
            )}
          </Section>

          {/* Kho voucher */}
          <Section
            title="Kho voucher"
            action={
              couponsQ.data && couponsQ.data.length > 0
                ? `${couponsQ.data.length} mã`
                : undefined
            }
          >
            {couponsQ.data && couponsQ.data.length > 0 ? (
              <Box flex flexDirection="column" style={{ gap: 8 }}>
                {couponsQ.data.map((c) => (
                  <Box
                    key={c.code}
                    flex
                    alignItems="center"
                    justifyContent="space-between"
                    p={3}
                    style={{
                      background: 'var(--clay-50)',
                      borderRadius: 'var(--radius-md)',
                      border: '1px dashed var(--clay-200)',
                    }}
                  >
                    <Box>
                      <Text bold size="small" style={{ color: 'var(--clay-700)' }}>
                        {couponLabel(c)}
                      </Text>
                      <Text size="xSmall" style={{ color: 'var(--neutral-600)' }}>
                        Mã {c.code}
                        {c.minOrder ? ` · đơn từ ${formatVnd(c.minOrder)}` : ''}
                      </Text>
                    </Box>
                    <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
                      HSD {new Date(c.endAt).toLocaleDateString('vi-VN')}
                    </Text>
                  </Box>
                ))}
              </Box>
            ) : (
              <Text size="small" style={{ color: 'var(--neutral-400)' }}>
                Chưa có voucher khả dụng.
              </Text>
            )}
          </Section>

          {/* Lịch sử điểm */}
          <Section title="Lịch sử Điểm Xanh">
            {txnQ.data && txnQ.data.length > 0 ? (
              <Box flex flexDirection="column" style={{ gap: 2 }}>
                {txnQ.data.slice(0, 20).map((t: PointsTxn) => (
                  <Box
                    key={t.id}
                    flex
                    alignItems="center"
                    justifyContent="space-between"
                    py={2}
                    style={{ borderBottom: '1px solid var(--neutral-100)' }}
                  >
                    <Box>
                      <Text size="small">{pointsReasonLabel(t.reason)}</Text>
                      <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
                        {new Date(t.createdAt).toLocaleDateString('vi-VN')}
                      </Text>
                    </Box>
                    <Text
                      bold
                      size="small"
                      style={{ color: t.delta >= 0 ? 'var(--leaf-600)' : 'var(--danger)' }}
                    >
                      {t.delta >= 0 ? '+' : ''}
                      {t.delta}
                    </Text>
                  </Box>
                ))}
              </Box>
            ) : (
              <Text size="small" style={{ color: 'var(--neutral-400)' }}>
                Chưa có giao dịch điểm nào.
              </Text>
            )}
          </Section>

          <Box p={4} flex justifyContent="center">
            <Box
              className="tubu-press"
              onClick={() => navigate('/browse')}
              style={{ cursor: 'pointer', padding: '8px 16px', background: 'var(--leaf-50)', borderRadius: 'var(--radius-full)', border: '1px solid var(--leaf-200)' }}
            >
              <Text size="small" bold style={{ color: 'var(--leaf-700)', textAlign: 'center' }}>
                Mua sắm để tích thêm Điểm Xanh →
              </Text>
            </Box>
          </Box>
        </>
      ) : null}

      {/* Modal Thẻ thành viên số (mã QR) */}
      {showMemberCard && (
        <Box
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 3000,
            background: 'rgba(26,26,23,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
          onClick={() => setShowMemberCard(false)}
        >
          <Box
            className="tubu-pop"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--neutral-0)',
              borderRadius: 'var(--radius-xl)',
              padding: '24px 20px',
              maxWidth: 340,
              width: '100%',
              boxShadow: 'var(--shadow-md)',
              position: 'relative',
            }}
          >
            <Box
              style={{
                position: 'absolute',
                top: 14,
                right: 14,
                cursor: 'pointer',
                padding: 4,
              }}
              onClick={() => setShowMemberCard(false)}
            >
              <X size={20} color="var(--neutral-400)" />
            </Box>

            <Box style={{ textAlign: 'center' }}>
              <Text bold size="normal" style={{ color: 'var(--neutral-900)' }}>
                Thẻ Thành Viên Tubu
              </Text>
              <Box
                mt={2}
                px={3}
                py={1}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  background: style.bg,
                  borderRadius: 'var(--radius-full)',
                }}
              >
                <Text style={{ fontSize: 14 }}>{style.emoji}</Text>
                <Text bold size="xSmall" style={{ color: style.color }}>
                  Hạng {tierName} · {formatPoints(data?.pointsBalance ?? 0)} Xanh
                </Text>
              </Box>
            </Box>

            {/* Mã QR THẬT của memberCode — đúng chuỗi mà /loyalty/staff/scan-member nhận (khớp chính xác). */}
            <Box
              mt={4}
              p={3}
              style={{
                background: 'var(--neutral-50)',
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--neutral-200)',
                textAlign: 'center',
              }}
            >
              {memberCardQ.isLoading ? (
                <Box flex justifyContent="center">
                  <Skeleton style={{ width: 180, height: 180, borderRadius: 12 }} />
                </Box>
              ) : memberCardQ.isError || !memberCardQ.data ? (
                <Box flex flexDirection="column" alignItems="center" style={{ gap: 8 }}>
                  <Text size="xSmall" style={{ color: 'var(--neutral-600)' }}>
                    Chưa tải được mã thành viên: {getErrorMessage(memberCardQ.error)}
                  </Text>
                  <Button size="small" variant="secondary" onClick={() => void memberCardQ.refetch()}>
                    Thử lại
                  </Button>
                </Box>
              ) : (
                <>
                  <Box flex justifyContent="center">
                    <QrCode value={memberCardQ.data.memberCode} size={180} />
                  </Box>

                  {/* Mã thành viên (gõ tay được nếu không quét) & nút chép */}
                  <Box mt={3} flex alignItems="center" justifyContent="center" style={{ gap: 8 }}>
                    <Text
                      bold
                      size="normal"
                      style={{ letterSpacing: '2px', fontFamily: 'monospace', color: 'var(--neutral-800)' }}
                    >
                      {memberCardQ.data.memberCode}
                    </Text>
                    <Box
                      className="tubu-press"
                      onClick={async () => {
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
                      }}
                      style={{
                        padding: '4px 8px',
                        borderRadius: 'var(--radius-full)',
                        background: copiedCode ? 'var(--leaf-50)' : 'var(--neutral-100)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <Copy size={12} color={copiedCode ? 'var(--leaf-700)' : 'var(--neutral-600)'} />
                      <Text size="xSmall" style={{ color: copiedCode ? 'var(--leaf-700)' : 'var(--neutral-600)', fontSize: 11 }}>
                        {copiedCode ? 'Đã chép' : 'Chép'}
                      </Text>
                    </Box>
                  </Box>
                </>
              )}
            </Box>

            {memberCardQ.data && (
              <Box mt={3} p={2} style={{ background: 'var(--leaf-50)', borderRadius: 'var(--radius-md)' }}>
                <Text size="xSmall" style={{ color: 'var(--leaf-800)', textAlign: 'center', lineHeight: '16px' }}>
                  💡 {memberCardHint(memberCardQ.data)}
                </Text>
              </Box>
            )}

            <Button
              fullWidth
              onClick={() => setShowMemberCard(false)}
              style={{
                marginTop: 16,
                background: 'var(--neutral-900)',
                color: 'var(--neutral-0)',
                borderRadius: 'var(--radius-full)',
              }}
            >
              Đóng
            </Button>
          </Box>
        </Box>
      )}

      {/* Modal Xác nhận đổi voucher */}
      {confirmReward && (
        <Box
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 3000,
            background: 'rgba(26,26,23,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
          onClick={() => setConfirmReward(null)}
        >
          <Box
            className="tubu-pop"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--neutral-0)',
              borderRadius: 'var(--radius-xl)',
              padding: '24px 20px',
              maxWidth: 320,
              width: '100%',
              boxShadow: 'var(--shadow-md)',
              textAlign: 'center',
            }}
          >
            <Box
              style={{
                width: 48,
                height: 48,
                borderRadius: 'var(--radius-full)',
                background: 'var(--leaf-50)',
                display: 'grid',
                placeItems: 'center',
                margin: '0 auto',
              }}
            >
              <Gift size={24} color="var(--leaf-600)" />
            </Box>

            <Text bold size="normal" style={{ marginTop: 12, color: 'var(--neutral-900)' }}>
              Xác nhận đổi ưu đãi
            </Text>

            <Box mt={3} p={3} style={{ background: 'var(--neutral-50)', borderRadius: 'var(--radius-md)', textAlign: 'left' }}>
              <Text bold size="small" style={{ color: 'var(--neutral-900)' }}>
                {confirmReward.title}
              </Text>
              <Text size="xSmall" style={{ color: 'var(--neutral-600)', marginTop: 2 }}>
                {confirmReward.description}
              </Text>
              <Box mt={2} pt={2} flex justifyContent="space-between" style={{ borderTop: '1px dashed var(--neutral-200)' }}>
                <Text size="xSmall" style={{ color: 'var(--neutral-500)' }}>Điểm cần trừ:</Text>
                <Text bold size="small" style={{ color: 'var(--leaf-700)' }}>
                  -{confirmReward.pointsCost} Xanh
                </Text>
              </Box>
              <Box mt={1} flex justifyContent="space-between">
                <Text size="xSmall" style={{ color: 'var(--neutral-500)' }}>Điểm còn lại:</Text>
                <Text bold size="small" style={{ color: 'var(--neutral-800)' }}>
                  {formatPoints((data?.pointsBalance ?? 0) - confirmReward.pointsCost)} Xanh
                </Text>
              </Box>
            </Box>

            <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 10, lineHeight: '16px' }}>
              Voucher sau khi đổi sẽ có hạn 30 ngày và xuất hiện ngay trong Kho voucher của bạn.
            </Text>

            <Box mt={4} flex style={{ gap: 8 }}>
              <Button
                fullWidth
                variant="secondary"
                disabled={redeemMut.isPending}
                onClick={() => setConfirmReward(null)}
                style={{ borderRadius: 'var(--radius-full)' }}
              >
                Huỷ
              </Button>
              <Button
                fullWidth
                disabled={redeemMut.isPending}
                loading={redeemMut.isPending}
                onClick={() => doRedeem(confirmReward.id)}
                style={{
                  borderRadius: 'var(--radius-full)',
                  background: 'var(--leaf-600)',
                  color: 'var(--neutral-0)',
                }}
              >
                Đổi ngay
              </Button>
            </Box>
          </Box>
        </Box>
      )}

      {/* Modal chúc mừng lên hạng (§6.6 #78) */}
      {celebrate && (
        <Box
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 3000,
            background: 'rgba(26,26,23,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 28,
          }}
          onClick={() => setCelebrate(null)}
        >
          <Box
            className="tubu-pop"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--neutral-0)',
              borderRadius: 'var(--radius-xl)',
              padding: '28px 24px',
              textAlign: 'center',
              maxWidth: 320,
              width: '100%',
            }}
          >
            <Text style={{ fontSize: 64 }}>{(TIER_STYLE[celebrate] ?? DEFAULT_STYLE).emoji}🎉</Text>
            <Text className="t-h2" style={{ marginTop: 8, color: style.color }}>
              Chúc mừng lên hạng {celebrate}!
            </Text>
            <Text size="small" style={{ color: 'var(--neutral-600)', marginTop: 6 }}>
              Bạn vừa mở khoá quyền lợi mới của hạng {celebrate}. Cảm ơn bạn đã đồng hành sống xanh
              cùng Tubu 🌿
            </Text>
            {perks.length > 0 && (
              <Box style={{ textAlign: 'left', marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {perks.slice(0, 4).map((p, i) => (
                  <Text key={i} size="small" style={{ color: 'var(--neutral-900)' }}>
                    ✓ {p}
                  </Text>
                ))}
              </Box>
            )}
            <Button
              fullWidth
              onClick={() => setCelebrate(null)}
              style={{ marginTop: 18, background: 'var(--leaf-600)' }}
            >
              Tuyệt vời!
            </Button>
          </Box>
        </Box>
      )}
    </Page>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: string;
  children: React.ReactNode;
}) {
  return (
    <Box mx={4} mb={3} p={4} style={{ background: 'var(--neutral-0)', borderRadius: 'var(--radius-lg)' }}>
      <Box flex alignItems="center" justifyContent="space-between" mb={3}>
        <Text bold>{title}</Text>
        {action && (
          <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
            {action}
          </Text>
        )}
      </Box>
      {children}
    </Box>
  );
}
