import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Page, useSnackbar } from 'zmp-ui';
import { useSmartNavigate } from '../lib/smart-nav';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Check, Gift, Copy, Lightbulb, QrCode as QrCodeIcon } from 'lucide-react';
import {
  getLoyalty,
  getCoupons,
  getMemberCard,
  memberCardHint,
  pointsReasonLabel,
  tierProgressPercent,
  type PointsTxn,
} from '../services/account-api';
import { getLoadErrorMessage } from '../services/api';
import { coreHttp } from '../services/core-http';
import { pointsTxnPagesQuery } from '@tubutree/app-core/queries/loyalty';
import { expiringRedeemCta, loyaltyOffersRow, memberCardOfflineHint } from '@tubutree/app-core/loyalty-page';
import { GuestTiers } from '../components/loyalty/guest-tiers';
import { LoyaltyRulesCard } from '../components/loyalty/loyalty-rules-card';
import { OffersCheckInStrip } from '../components/offers/offers-check-in-strip';
import { AuthPhaseView } from '../components/ui/auth-gate';
import { useAuthPhase } from '../hooks/use-auth-phase';
import { formatNumber, formatDate, formatMultiplier } from '../utils/format';
import { haptic } from '../utils/haptic';
import { tierGraceLine, tierRank } from '@tubutree/app-core/loyalty-tier-copy';
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
import { convertedPointsNote, expiringPointsNote, marketplacePointsNote, pointExpiryPolicyNote, pointsSummary } from '../utils/points-lots';
import { tierPerkLabel } from '@tubutree/app-core/number-format';

/**
 * Biểu tượng + màu theo hạng (4 hạng §6.6). Emoji là NỘI DUNG của hạng nên được giữ. Màu trỏ thẳng
 * primitive v2 (thang sage → forest → clay): hạng phân biệt nhau theo độ "già" của xanh, không có
 * token semantic --color-* nào diễn đạt được, và scripts/check-undefined-css-vars.mjs chỉ biết các
 * token trong design-tokens/tokens.css nên token riêng của trang sẽ bị báo "chưa định nghĩa".
 */
const TIER_STYLES: readonly { emoji: string; color: string; bg: string }[] = [
  { emoji: '🌱', color: 'var(--sage-700)', bg: 'var(--sage-50)' },
  { emoji: '🌿', color: 'var(--sage-600)', bg: 'var(--sage-100)' },
  { emoji: '🌳', color: 'var(--forest-700)', bg: 'var(--forest-50)' },
  { emoji: '🌲', color: 'var(--forest-900)', bg: 'var(--clay-50)' },
];
/** Tra theo THỨ HẠNG (không theo tên): đổi tên hạng trong admin vẫn giữ biểu tượng và màu. */
const tierStyleAt = (rank: number) => TIER_STYLES[Math.min(Math.max(rank, 0), TIER_STYLES.length - 1)]!;

/** Lề của các thẻ khối dưới thẻ hạng (dòng điểm danh, dòng sang Ưu đãi, mục gập luật). */
const BLOCK_INSET: CSSProperties = { margin: '0 var(--space-gutter) var(--space-inset-card)' };
const HINT_STACK: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 'var(--space-stack-xs)' };
// Trắng cố định (`--stone-0`, không phải `--color-bg-surface` đổi theo theme) + lề trắng 16px quanh lề 1 module của ảnh QR: đủ "vùng yên tĩnh" cho máy quét ở quầy.
const MEMBER_SCAN_FRAME: CSSProperties = { background: 'var(--stone-0)', padding: 'var(--space-inline-lg)', borderRadius: 'var(--radius-card)', lineHeight: 0 };

/** Giữ giá trị khác null gần nhất: BottomSheet còn chạy hoạt ảnh đóng ~200ms sau khi state về null,
 * nội dung không được trống đi trong lúc trượt xuống. */
function useLastNonNull<T>(value: T | null): T | null {
  const ref = useRef<T | null>(null);
  if (value !== null) ref.current = value;
  return value ?? ref.current;
}

export default function LoyaltyPage() {
  const goSmart = useSmartNavigate();
  const { openSnackbar } = useSnackbar();
  // Các endpoint /me/* cần auth — fetch trước khi restore() xong sẽ 401 và kẹt vĩnh viễn
  // (queryClient retry:false cho 4xx) dù login thành công ~200ms sau (cùng bug đã fix ở wallet.tsx).
  const phase = useAuthPhase();
  const authed = phase === 'authenticated';
  const loyaltyQ = useQuery({ queryKey: ['loyalty'], queryFn: getLoyalty, enabled: authed });
  const couponsQ = useQuery({ queryKey: ['coupons'], queryFn: getCoupons, enabled: authed });
  const txnQ = useInfiniteQuery({ ...pointsTxnPagesQuery(coreHttp), enabled: authed });
  const history: PointsTxn[] = txnQ.data?.pages.flat() ?? [];
  const [showMemberCard, setShowMemberCard] = useState(false);
  // Thẻ thành viên chỉ tải khi khách mở thẻ: bớt một lần gọi mỗi lần vào trang.
  const memberCardQ = useQuery({ queryKey: ['loyalty-member-card'], queryFn: getMemberCard, enabled: authed && showMemberCard });
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
  const tierStyle = tierStyleAt(data ? tierRank(data.tiers, { id: data.tier?.id }) : 0);
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
  const marketplaceNote = marketplacePointsNote(lots?.marketplace);
  const expiringNote = expiringPointsNote(data?.expiringPoints);
  const offersRow = loyaltyOffersRow('/offers', couponsQ.data?.length, expiringRedeemCta(expiringNote, { redeemable: data?.redeemablePoints, total: lots?.total ?? 0 }));
  const expiryPolicy = pointExpiryPolicyNote(data?.pointExpireMonths);
  const graceLine = tierGraceLine(data?.tierGrace, tierName, { money: moneyShort, points: formatNumber, date: formatDate });

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
    <Page className="tubu-nums" style={{ background: 'var(--color-bg-canvas)', paddingBottom: 'calc(16px + var(--safe-bottom))' }}>
      <PageHeader title="Hạng thành viên & Điểm Xanh" />

      {phase !== 'authenticated' ? (
        <AuthPhaseView phase={phase} loading={pageSkeleton} guest={<GuestTiers />} />
      ) : loyaltyQ.isLoading ? (
        pageSkeleton
      ) : loyaltyQ.isError && !loyaltyQ.data ? (
        <ErrorState message={getLoadErrorMessage(loyaltyQ.error)} onRetry={() => loyaltyQ.refetch()} />
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
              {(convertedNote || marketplaceNote) && (
                <Text variant="caption" tone="secondary" as="div" style={{ marginTop: 2 }}>
                  {convertedNote && <div>{convertedNote}</div>}
                  {marketplaceNote && <div data-testid="marketplace-points-note">{marketplaceNote}</div>}
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

              {graceLine && (
                <Text variant="caption" tone="warning" as="div" style={{ marginTop: 8, fontWeight: 600 }}>
                  {graceLine}
                </Text>
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

          {/* Điểm danh chỉ làm ở Vườn Xanh: trang này chỉ báo hôm nay đã/chưa và mở Vườn Xanh. */}
          <OffersCheckInStrip
            authed={authed}
            onOpenGarden={() => goSmart('/game')}
            variant="raised"
            style={{ padding: '0 var(--space-gutter) var(--space-inset-card)' }}
          />

          {/* Đổi quà và ví mã nằm ở hub Ưu đãi: một dòng dẫn sang, không lặp danh sách ở đây. */}
          <Card style={BLOCK_INSET} padding={0}>
            <ListRow
              icon={<Icon icon={Gift} tone="brand" />}
              title={
                offersRow.urgent ? (
                  <span data-testid="loyalty-expiring-cta" style={{ color: 'var(--color-text-brand)' }}>
                    {offersRow.title}
                  </span>
                ) : (
                  offersRow.title
                )
              }
              subtitle={offersRow.sub}
              trailing={offersRow.urgent ? undefined : 'chevron'}
              onPress={() => goSmart(offersRow.href)}
              style={{ padding: 'var(--space-inset-card)' }}
            />
          </Card>

          <LoyaltyRulesCard lines={rates ? [earnRuleLine(rates, data.tier?.multiplier ?? 1), redeemRuleLine(rates)] : []} style={BLOCK_INSET} />

          {/* Quyền lợi hạng */}
          {perks.length > 0 && (
            <Section title="Quyền lợi của bạn">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {perks.map((p, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Icon icon={Check} size="sm" tone="brand" />
                    <Text variant="body-sm">{tierPerkLabel(p)}</Text>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Bậc thang hạng */}
          <Section title="Các hạng">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {data.tiers.map((t, rank) => {
                const active = data.tier ? t.id === data.tier.id : rank === 0;
                const ts = tierStyleAt(rank);
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      <span aria-hidden>{ts.emoji}</span>
                      <Text variant="body-sm" style={{ fontWeight: active ? 700 : 400, whiteSpace: 'nowrap' }}>
                        {t.name}
                      </Text>
                    </div>
                    <Text variant="caption" tone="secondary" style={{ textAlign: 'right', minWidth: 0 }}>
                      {tierThresholdLabel(t, rates)} · ×{formatMultiplier(t.multiplier)}
                    </Text>
                  </div>
                );
              })}
            </div>
          </Section>

          {/* Lịch sử điểm */}
          <Section title="Lịch sử Điểm Xanh">
            {txnQ.isLoading ? (
              <Skeleton height={64} />
            ) : txnQ.isError && history.length === 0 ? (
              <ErrorState
                variant="inline"
                title="Chưa tải được lịch sử Điểm Xanh"
                message={getLoadErrorMessage(txnQ.error)}
                onRetry={() => txnQ.refetch()}
              />
            ) : history.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {history.map((t: PointsTxn) => (
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
                {txnQ.hasNextPage && (
                  <Button
                    variant="secondary"
                    fullWidth
                    loading={txnQ.isFetchingNextPage}
                    onPress={() => txnQ.fetchNextPage()}
                    style={{ marginTop: 12 }}
                  >
                    {txnQ.isFetchNextPageError ? 'Chưa tải được, bấm để thử lại' : 'Xem thêm'}
                  </Button>
                )}
              </div>
            ) : (
              <EmptyState variant="inline" art="sprout" heading="Chưa có giao dịch điểm nào" />
            )}
          </Section>
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
              onRetry={() => memberCardQ.refetch()}
            />
          ) : (
            <>
              {/* Khung quét ở quầy: nền trắng cố định (không theo theme tối) và lề trắng rộng quanh mã, máy quét POS bắt mã nhanh hơn trên nền xám. */}
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <div data-testid="member-card-scan" style={MEMBER_SCAN_FRAME}>
                  <QrCode value={memberCardQ.data.memberCode} size={180} />
                </div>
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
            <div style={HINT_STACK}>
              <Text variant="caption" tone="secondary">
                {memberCardHint(memberCardQ.data)}
              </Text>
              {memberCardOfflineHint(memberCardQ.data) && (
                <Text variant="caption" tone="secondary" data-testid="member-card-offline-hint">
                  {memberCardOfflineHint(memberCardQ.data)}
                </Text>
              )}
            </div>
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
              {tierStyleAt(tierRank(data?.tiers ?? [], { name: sheetCelebrate })).emoji}🎉
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
                    <Text variant="body-sm">{tierPerkLabel(p)}</Text>
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
