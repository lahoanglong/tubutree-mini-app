import { useEffect, useState } from 'react';
import { Box, Page, Text, Button, useNavigate } from 'zmp-ui';
import { useQuery } from '@tanstack/react-query';
import {
  getLoyalty,
  getCoupons,
  getPointsTransactions,
  type CouponDTO,
  type PointsTxn,
} from '../services/account-api';
import { getErrorMessage } from '../services/api';
import { formatVnd } from '../utils/format';
import { Skeleton } from '../components/ui/skeleton';

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
  const loyaltyQ = useQuery({ queryKey: ['loyalty'], queryFn: getLoyalty });
  const couponsQ = useQuery({ queryKey: ['coupons'], queryFn: getCoupons });
  const txnQ = useQuery({ queryKey: ['points-txn'], queryFn: getPointsTransactions });

  const data = loyaltyQ.data;
  const style = data?.tier ? (TIER_STYLE[data.tier.name] ?? DEFAULT_STYLE) : DEFAULT_STYLE;
  const tierName = data?.tier?.name ?? 'Mầm Xanh';
  const perks = Array.isArray(data?.tier?.perks) ? (data.tier.perks as string[]) : [];

  // Progress lên hạng kế: tính TỪ SÀN ĐIỂM hạng hiện tại → ngưỡng hạng kế (không phải từ 0).
  const next = data?.nextTier;
  const curMin = data?.tiers.find((t) => t.id === data.tier?.id)?.minPoints ?? 0;
  const progress =
    next && next.minPoints > curMin
      ? Math.min(100, Math.max(0, Math.round(((data!.pointsBalance - curMin) / (next.minPoints - curMin)) * 100)))
      : 100;

  // Phát hiện LÊN HẠNG (§6.6 #78): so minPoints hạng hiện tại với lần xem trước (localStorage).
  const [celebrate, setCelebrate] = useState<string | null>(null);
  useEffect(() => {
    if (!data?.tier) return;
    const KEY = 'tubu_last_tier_min';
    let stored = NaN;
    try {
      stored = Number(localStorage.getItem(KEY));
    } catch {
      /* ignore */
    }
    if (!Number.isNaN(stored) && curMin > stored) setCelebrate(data.tier.name);
    try {
      localStorage.setItem(KEY, String(curMin));
    } catch {
      /* ignore */
    }
  }, [data?.tier, curMin]);

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)' }}>

      {loyaltyQ.isLoading ? (
        <Box p={4} style={{ gap: 12 }} flex flexDirection="column">
          <Skeleton style={{ height: 180, borderRadius: 16 }} />
          <Skeleton style={{ height: 80, borderRadius: 16 }} />
        </Box>
      ) : loyaltyQ.isError ? (
        <Box p={6} style={{ textAlign: 'center' }}>
          <Text style={{ color: 'var(--danger)' }}>{getErrorMessage(loyaltyQ.error)}</Text>
        </Box>
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
                Tích điểm ×{data.tier?.multiplier ?? 1} · {data.pointsBalance} Điểm Xanh
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
                    Còn <b>{next.pointsToGo}</b> điểm để lên hạng {next.name}
                  </Text>
                </Box>
              ) : (
                <Text size="xSmall" style={{ color: style.color, marginTop: 8 }}>
                  Bạn đang ở hạng cao nhất 🎉
                </Text>
              )}
            </Box>
          </Box>

          {/* Quyền lợi hạng */}
          {perks.length > 0 && (
            <Section title="Quyền lợi của bạn">
              <Box flex flexDirection="column" style={{ gap: 8 }}>
                {perks.map((p, i) => (
                  <Box key={i} flex alignItems="center" style={{ gap: 8 }}>
                    <Text style={{ color: 'var(--leaf-600)' }}>✓</Text>
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
                      từ {t.minPoints} điểm · ×{t.multiplier}
                    </Text>
                  </Box>
                );
              })}
            </Box>
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
                      <Text size="small">{reasonLabel(t.reason)}</Text>
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

          <Box p={4}>
            <Text
              size="xSmall"
              style={{ color: 'var(--neutral-400)', textAlign: 'center' }}
              onClick={() => navigate('/browse')}
            >
              Mua sắm để tích thêm Điểm Xanh →
            </Text>
          </Box>
        </>
      ) : null}

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

function reasonLabel(reason: string): string {
  if (reason.startsWith('ORDER_DELIVERED')) return 'Tích điểm từ đơn hàng';
  if (reason.startsWith('ORDER_REVERSED')) return 'Hoàn ngược điểm (hủy/trả)';
  if (reason.startsWith('ORDER_REFUND_POINTS')) return 'Hoàn lại điểm đã dùng';
  if (reason.startsWith('GAME')) return 'Phần thưởng Vườn Xanh';
  if (reason.startsWith('REVIEW')) return 'Đánh giá sản phẩm';
  return reason;
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
