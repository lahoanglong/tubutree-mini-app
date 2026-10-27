import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Page, useNavigate, useSnackbar } from 'zmp-ui';
import { useQuery } from '@tanstack/react-query';
import { Sprout, Recycle, Check, Gift, Copy, Lightbulb, QrCode as QrCodeIcon } from 'lucide-react';
import {
  getLoyalty,
  getCoupons,
  getPointsTransactions,
  getMemberCard,
  memberCardHint,
  pointsReasonLabel,
  tierProgressPercent,
  type PointsTxn,
} from '../services/account-api';
import { wasteHistoryMenu } from '@tubutree/app-core/waste-copy';
import { getLoadErrorMessage } from '../services/api';
import { WASTE_QUERY_KEYS, listWasteRequests } from '../services/waste-api';
import { GuestTiers } from '../components/loyalty/guest-tiers';
import { AuthPhaseView } from '../components/ui/auth-gate';
import { useAuthPhase } from '../hooks/use-auth-phase';
import { usePublicConfig } from '../hooks/use-public-config';
import { formatNumber, formatDate, formatMultiplier } from '../utils/format';
import { haptic } from '../utils/haptic';
import { earnRuleLine, moneyShort, pointsToSpend, redeemRuleLine, tierThresholdLabel } from '../utils/loyalty-copy';
import { copyText } from '../utils/clipboard';
import { PageHeader } from '../components/ui/page-header';
import { Heading, Text } from '../components/ui/text';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Icon } from '../components/ui/icon';
import { ListRow } from '../components/ui/list-row';
import { BottomSheet } from '../components/ui/bottom-sheet';
import { Skeleton } from '../components/ui/skeleton';
import { Button } from '../components/ui/button';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { QrCode } from '../components/qr-code';
import { PointsBoostStrip } from '../components/loyalty/points-boost-strip';
import { CouponCard } from '../components/loyalty/coupon-card';
import { DailyCheckInCard } from '../components/loyalty/daily-check-in-card';
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

/** Giữ giá trị khác null gần nhất: BottomSheet còn chạy hoạt ảnh đóng ~200ms sau khi state về null,
 * nội dung không được trống đi trong lúc trượt xuống. */
function useLastNonNull<T>(value: T | null): T | null {
  const ref = useRef<T | null>(null);
  if (value !== null) ref.current = value;
  return value ?? ref.current;
}

export default function LoyaltyPage() {
  const navigate = useNavigate();
  const publicConfig = usePublicConfig();
  const { openSnackbar } = useSnackbar();
  // Các endpoint /me/* cần auth — fetch trước khi restore() xong sẽ 401 và kẹt vĩnh viễn
  // (queryClient retry:false cho 4xx) dù login thành công ~200ms sau (cùng bug đã fix ở wallet.tsx).
  const phase = useAuthPhase();
  const authed = phase === 'authenticated';
  // Chương trình tắt mà khách từng có yêu cầu thì vẫn cho xem lại (không tạo mới được).
  const wasteOff = publicConfig.isLoaded && !publicConfig.waste.enabled;
  const wasteHistoryQ = useQuery({ queryKey: WASTE_QUERY_KEYS.requests, queryFn: listWasteRequests, enabled: authed && wasteOff, retry: false });
  const hasWasteHistory = (wasteHistoryQ.data?.length ?? 0) > 0;
  const loyaltyQ = useQuery({ queryKey: ['loyalty'], queryFn: getLoyalty, enabled: authed });
  const couponsQ = useQuery({ queryKey: ['coupons'], queryFn: getCoupons, enabled: authed });
  const txnQ = useQuery({ queryKey: ['points-txn'], queryFn: getPointsTransactions, enabled: authed });
  const memberCardQ = useQuery({ queryKey: ['loyalty-member-card'], queryFn: getMemberCard, enabled: authed });

  const [showMemberCard, setShowMemberCard] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
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
  // Con số khách thấy là tổng hai lô.
  const lots = data ? pointsSummary(data) : null;
  const convertedNote = convertedPointsNote(lots?.converted);
  const expiringNote = expiringPointsNote(data?.expiringPoints);
  const expiryPolicy = pointExpiryPolicyNote(data?.pointExpireMonths);

  // Phát hiện LÊN HẠNG (§6.6 #78): so minPoints hạng hiện tại với lần xem trước (localStorage).
  const [celebrate, setCelebrate] = useState<string | null>(null);
  useEffect(() => {
    if (!data?.tier) return;
    const KEY = 'tubu_last_tier_min_v2';
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
        <AuthPhaseView phase={phase} loading={pageSkeleton} guest={<GuestTiers />} />
      ) : loyaltyQ.isLoading ? (
        pageSkeleton
      ) : loyaltyQ.isError && !loyaltyQ.data ? (
        <ErrorState message={getLoadErrorMessage(loyaltyQ.error)} onRetry={() => void loyaltyQ.refetch()} />
      ) : data ? (
        <>
          <PointsBoostStrip placement="wallet" />
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
                Tích điểm ×{formatMultiplier(data.tier?.multiplier ?? 1)} · {formatNumber(lots?.total ?? 0)} Điểm Xanh
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
                    {next.spendingToGo != null ? (
                      <>
                        Còn <b>{moneyShort(next.spendingToGo)}</b> mua hàng để lên hạng {next.name}
                      </>
                    ) : (
                      <>
                        Còn <b>{formatNumber(next.pointsToGo)}</b> điểm tích từ mua hàng
                        {rates && next.pointsToGo > 0 ? ` (tương đương khoảng ${moneyShort(pointsToSpend(next.pointsToGo, rates))} mua hàng)` : ''} để
                        lên hạng {next.name}
                      </>
                    )}
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
                  style={{ whiteSpace: 'normal', height: 'auto', maxWidth: '100%', paddingTop: 8, paddingBottom: 8, textAlign: 'center' }}
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
                message={`Chưa tải được mã giảm giá: ${getLoadErrorMessage(couponsQ.error)}`}
                onRetry={() => void couponsQ.refetch()}
              />
            ) : couponsQ.data && couponsQ.data.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {couponsQ.data.map((c) => (
                  <CouponCard key={c.code} coupon={c} />
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
          <DailyCheckInCard authed={authed} margin="0 16px 12px" />

          {/* Lối tắt tích Điểm & Giọt nước */}
          <Card style={{ margin: '0 16px 12px' }} padding={16}>
            <ListRow
              icon={
                <IconTile>
                  <Icon icon={Sprout} tone="brand" />
                </IconTile>
              }
              title="Vườn Xanh"
              subtitle="Chăm cây nhận quà"
              trailing="chevron"
              onPress={() => navigate('/game')}
            />
            {!publicConfig.waste.enabled && hasWasteHistory && (
              <ListRow
                icon={
                  <IconTile>
                    <Icon icon={Recycle} tone="brand" />
                  </IconTile>
                }
                title={wasteHistoryMenu.label}
                subtitle={wasteHistoryMenu.hint}
                trailing="chevron"
                onPress={() => navigate('/recycle/requests')}
                style={{ borderTop: '1px solid var(--color-border-subtle)' }}
              />
            )}
            {publicConfig.waste.enabled && (
              <ListRow
                icon={
                  <IconTile>
                    <Icon icon={Recycle} tone="brand" />
                  </IconTile>
                }
                title="Đổi rác lấy quà"
                subtitle="Đổi bao bì lấy Điểm Xanh"
                trailing="chevron"
                onPress={() => navigate('/recycle')}
                style={{ borderTop: '1px solid var(--color-border-subtle)' }}
              />
            )}
            <ListRow
              icon={
                <IconTile>
                  <Icon icon={Gift} tone="brand" />
                </IconTile>
              }
              title="Kho quà"
              subtitle="Đổi Điểm Xanh lấy mã giảm giá và quà"
              trailing="chevron"
              onPress={() => navigate('/rewards')}
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
                      {tierThresholdLabel(t, rates)} · ×{formatMultiplier(t.multiplier)}
                    </Text>
                  </div>
                );
              })}
            </div>
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
            <span aria-hidden>{tierStyle.emoji}</span> Hạng {tierName} · {formatNumber(lots?.total ?? 0)} Điểm Xanh
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
              message={`Chưa tải được mã thành viên: ${getLoadErrorMessage(memberCardQ.error)}`}
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
