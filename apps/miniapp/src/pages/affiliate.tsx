import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Input, Page, Sheet, useSnackbar, useNavigate } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchCourses } from '../services/academy-api';
import { useAuthStore } from '../store/auth';
import {
  getAffiliateMe,
  registerAffiliate,
  getAffiliateDashboard,
  getAffiliateLinks,
  createAffiliateLink,
  getCommissions,
  getMyPayouts,
  getTaxStatement,
  requestPayout,
  getStorefrontAnalytics,
  getProductBreakdown,
  getCtvTiers,
  getCtvMilestones,
  type AffiliatePayout,
  type Commission,
  type CommissionStatus,
  type PayoutStatus,
} from '../services/affiliate-api';
import { getErrorMessage, getLoadErrorMessage } from '../services/api';
import { useShareWithFallback } from '../components/share-sheet';
import { AuthPhaseView } from '../components/ui/auth-gate';
import { useAuthPhase } from '../hooks/use-auth-phase';
import { formatDate, formatVnd } from '../utils/format';
import { haptic } from '../utils/haptic';
import { newIdempotencyKey } from '../utils/idempotency';
import { PERSONAL_TAX_ID_PATTERN } from '../utils/tax-id';
import { vi as copy } from '../i18n/vi';
import { Badge, type BadgeTone } from '../components/ui/badge';
import { BottomSheet } from '../components/ui/bottom-sheet';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Checkbox } from '../components/ui/form';
import { Icon } from '../components/ui/icon';
import { PageHeader } from '../components/ui/page-header';
import { ProgressBar } from '../components/ui/progress-bar';
import { Skeleton } from '../components/ui/skeleton';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { Heading, Text } from '../components/ui/text';
import { CtvOrderSheet } from '../components/affiliate/ctv-order-sheet';
import { CtvShortcuts } from '../components/affiliate/ctv-shortcuts';
import { MilestoneRewards } from '../components/affiliate/milestone-rewards';
import { progressPct, tierRewardLabel } from '../components/affiliate/milestone-copy';
import { Handshake, BadgePercent, Link2, Landmark, TrendingUp, Receipt, Store, GraduationCap, Wallet, ChevronDown, ChevronUp } from 'lucide-react';
import { vi } from '../i18n/vi';
import { usePublicConfig } from '../hooks/use-public-config';
import { copyText } from '../utils/clipboard';
import { WEB_BASE_URL } from '../utils/web-base-url';

const PAGE_TITLE = 'Cộng tác viên';

const HERO_GRADIENT = 'linear-gradient(135deg, var(--color-action-primary-bg), var(--color-action-primary-bg-pressed))';
const BLOCK_GAP = { margin: '0 16px 12px' } as const;
const BOLD = { fontWeight: 600 } as const;

// Thẻ tổng "Đang chờ" gộp cả PENDING lẫn LOCKED (BE aggregate status IN [PENDING, LOCKED]).
// Nhãn của hai dòng đó PHẢI cùng tiền tố "Đang chờ" thì CTV mới cộng lại khớp được với thẻ —
// trước đây một khoản tiền có ba tên gọi: "Chờ duyệt" (thẻ), "Chờ (đơn chưa giao)", "Đang giữ".
const COMMISSION_META: Record<CommissionStatus, { label: string; tone: BadgeTone }> = {
  PENDING: { label: 'Đang chờ · đơn chưa giao', tone: 'promo' },
  LOCKED: { label: 'Đang chờ · đang giữ', tone: 'info' },
  APPROVED: { label: 'Có thể chuyển vào Ví', tone: 'success' },
  PAID: { label: 'Đã trả', tone: 'neutral' },
  REJECTED: { label: 'Từ chối', tone: 'danger' },
};
// Chỉ còn cho lệnh rút ngân hàng cũ (trước khi bỏ rút) chưa chuyển tiền.
const WITHDRAWING_META = { label: 'Lệnh rút cũ đang xử lý', tone: 'info' as BadgeTone };

const PAYOUT_META: Record<PayoutStatus, { label: string; tone: BadgeTone }> = {
  REQUESTED: { label: 'Chờ duyệt', tone: 'promo' },
  APPROVED: { label: 'Đã duyệt · chờ chuyển', tone: 'info' },
  PAID: { label: 'Đã chuyển', tone: 'success' },
  REJECTED: { label: 'Bị từ chối', tone: 'danger' },
};
const PAYOUT_METHOD: Record<AffiliatePayout['method'], string> = {
  BANK: 'Về ngân hàng',
  WALLET_BALANCE: 'Về Ví Tubu',
  ZALOPAY: 'Về ZaloPay',
};

/** Dự phòng khi API cũ chưa trả `withdrawTaxPreview`: chỉ xét riêng lần chuyển này, không biết các lần chuyển trước trong tháng. */
function payoutTax(gross: number, pit: { pct: number; threshold: number } | undefined): number {
  if (!pit || !(pit.pct > 0) || gross < pit.threshold) return 0;
  return Math.round(gross * Math.min(pit.pct, 1));
}

export default function AffiliatePage() {
  // /affiliate/me cần auth — fetch trước khi restore() xong sẽ 401 và kẹt vĩnh viễn
  // (queryClient retry:false cho 4xx) dù login thành công ~200ms sau (cùng bug đã fix ở wallet.tsx).
  const phase = useAuthPhase();
  const meQ = useQuery({ queryKey: ['affiliate-me'], queryFn: getAffiliateMe, enabled: phase === 'authenticated' });

  if (phase !== 'authenticated' || meQ.isLoading) {
    const skeleton = (
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Skeleton height={120} radius="var(--radius-card)" />
        <Skeleton height={80} radius="var(--radius-card)" />
      </div>
    );
    return (
      <Page style={{ background: 'var(--color-bg-canvas)' }}>
        <PageHeader title={PAGE_TITLE} />
        {phase === 'authenticated' ? skeleton : <AuthPhaseView phase={phase} loading={skeleton} />}
      </Page>
    );
  }

  if (meQ.isError && !meQ.data) {
    return (
      <Page style={{ background: 'var(--color-bg-canvas)' }}>
        <PageHeader title={PAGE_TITLE} />
        <ErrorState message={getLoadErrorMessage(meQ.error)} onRetry={() => void meQ.refetch()} />
      </Page>
    );
  }

  if (meQ.data?.isAffiliate) return <Dashboard />;
  // Đại lý/nhân viên không đăng ký CTV một chạm được (API từ chối): đưa form đăng ký là ngõ cụt.
  return meQ.data?.canRegister === false ? <CannotRegister /> : <RegisterGate />;
}

function CannotRegister() {
  const navigate = useNavigate();
  return (
    <Page style={{ background: 'var(--color-bg-canvas)' }}>
      <PageHeader title={PAGE_TITLE} />
      <EmptyState
        art="leaf"
        heading="Tài khoản này không đăng ký CTV được"
        body="Màn hoa hồng CTV hiện khi tài khoản đã có gian hàng CTV hoặc đã có hoa hồng."
        ctaLabel="Về Hồ sơ"
        onCta={() => navigate('/profile')}
      />
    </Page>
  );
}

function RegisterGate() {
  const { openSnackbar } = useSnackbar();
  const qc = useQueryClient();
  const [agreed, setAgreed] = useState(false);
  const reg = useMutation({
    mutationFn: () => registerAffiliate(vi.ctvTerms.version),
    onSuccess: () => {
      haptic('medium');
      openSnackbar({ text: 'Chào mừng CTV Tubu Tree! 🎉', type: 'success' });
      void qc.invalidateQueries({ queryKey: ['affiliate-me'] });
      // Vai trò trong phiên còn là khách thường: nạp lại để Học viện không chặn người vừa thành CTV.
      void useAuthStore.getState().restore();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const benefits = [
    { Icon: Store, text: 'Gian hàng riêng với đường dẫn mang tên bạn để gửi cho khách' },
    { Icon: BadgePercent, text: 'Hoa hồng theo từng sản phẩm + thưởng bậc doanh số tháng' },
    { Icon: Link2, text: 'Tạo link chia sẻ riêng, theo dõi lượt bấm & chuyển đổi' },
    // Chuyển vào Ví luôn là 1:1, không nhân hệ số.
    { Icon: Landmark, text: 'Hoa hồng vào Ví Tubu 1:1, dùng trả tiền hàng' },
    { Icon: TrendingUp, text: 'Bảng hoa hồng cập nhật liên tục, minh bạch' },
  ];

  return (
    <Page style={{ background: 'var(--color-bg-canvas)' }}>
      <PageHeader title={PAGE_TITLE} />
      <div style={{ padding: 16 }}>
        <div
          style={{
            padding: 20,
            background: HERO_GRADIENT,
            borderRadius: 'var(--radius-card)',
            textAlign: 'center',
            boxShadow: 'var(--elevation-2)',
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 'var(--radius-pill)',
              background: 'var(--color-action-primary-bg-pressed)',
              display: 'grid',
              placeItems: 'center',
              margin: '0 auto 14px',
            }}
          >
            <Icon icon={Handshake} size="lg" tone="inverse" />
          </div>
          <Heading variant="title-md" as="h2" tone="inverse">
            Trở thành CTV Tubu
          </Heading>
          <Text variant="body-sm" tone="inverse" as="div" style={{ opacity: 0.9, marginTop: 6 }}>
            Chia sẻ sản phẩm sống xanh bạn yêu thích — nhận hoa hồng cho mỗi đơn thành công.
          </Text>
        </div>

        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {benefits.map((b, i) => (
            <Card key={i}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 'var(--radius-control)',
                    background: 'var(--color-bg-subtle)',
                    display: 'grid',
                    placeItems: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Icon icon={b.Icon} size="md" tone="brand" />
                </div>
                <Text variant="body-sm" tone="secondary" style={{ flex: 1 }}>
                  {b.text}
                </Text>
              </div>
            </Card>
          ))}
        </div>

        {/* Điều khoản hoa hồng/thuế: trước đây đăng ký một chạm, không có gì để viện dẫn khi
            hoa hồng bị thu hồi hoặc phải khấu trừ thuế. Phiên bản + thời điểm đồng ý được máy
            chủ lưu lại (User.metadata.affiliateTerms). */}
        <Card padding={16} style={{ marginTop: 16 }}>
          <Text variant="body-sm" as="div" style={BOLD}>
            {vi.ctvTerms.heading}
          </Text>
          <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
            {vi.ctvTerms.items.map((item) => (
              <li key={item} style={{ marginBottom: 6 }}>
                <Text variant="caption" tone="secondary">
                  {item}
                </Text>
              </li>
            ))}
          </ul>
          <Checkbox checked={agreed} onChange={() => setAgreed((v) => !v)} label={vi.ctvTerms.agree} />
        </Card>

        <Button
          fullWidth
          loading={reg.isPending}
          disabled={!agreed}
          onPress={() => reg.mutate()}
          style={{ marginTop: 16 }}
        >
          Đăng ký miễn phí ngay
        </Button>
        {!agreed && (
          <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 6, textAlign: 'center' }}>
            {vi.ctvTerms.mustAgree}
          </Text>
        )}
      </div>
    </Page>
  );
}

function Dashboard() {
  const { openSnackbar } = useSnackbar();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const meQ = useQuery({ queryKey: ['affiliate-me'], queryFn: getAffiliateMe });
  const dashQ = useQuery({ queryKey: ['affiliate-dashboard'], queryFn: getAffiliateDashboard });
  const linksQ = useQuery({ queryKey: ['affiliate-links'], queryFn: getAffiliateLinks });
  const commQ = useQuery({ queryKey: ['affiliate-commissions'], queryFn: getCommissions });
  const payoutsQ = useQuery({ queryKey: ['affiliate-payouts'], queryFn: getMyPayouts });
  const taxQ = useQuery({ queryKey: ['affiliate-tax-statement'], queryFn: () => getTaxStatement() });
  const sfQ = useQuery({ queryKey: ['affiliate-sf-analytics'], queryFn: getStorefrontAnalytics });
  const pbQ = useQuery({ queryKey: ['affiliate-product-breakdown'], queryFn: getProductBreakdown });
  const ctvTiersQ = useQuery({ queryKey: ['affiliate-ctv-tiers'], queryFn: getCtvTiers });
  const milestonesQ = useQuery({ queryKey: ['affiliate-milestones'], queryFn: getCtvMilestones });
  // Lối vào Học viện chỉ hiện khi đã có khoá để học: vào mà thấy trống thì CTV mới tưởng sản phẩm chưa xong.
  const academyQ = useQuery({ queryKey: ['academy-courses'], queryFn: fetchCourses, retry: false });
  const hasCourses = (academyQ.data?.length ?? 0) > 0;
  const [showAllTiers, setShowAllTiers] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [ctvOrdering, setCtvOrdering] = useState(false);

  const createLink = useMutation({
    mutationFn: () => createAffiliateLink('HOMEPAGE'),
    onSuccess: () => {
      haptic('medium');
      openSnackbar({ text: 'Đã tạo link chia sẻ mới', type: 'success' });
      void qc.invalidateQueries({ queryKey: ['affiliate-links'] });
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const d = dashQ.data;
  const referral = meQ.data?.referralCode ?? '';

  const shareWithFallback = useShareWithFallback();
  const shareReferral = () => {
    haptic('light');
    const description = `Mua sắm sản phẩm thiên nhiên cùng mình, dùng mã ${referral} nhé!`;
    void shareWithFallback(
      { title: 'Tubu Tree — Sống xanh An Lành', description, path: `/?ref=${referral}` },
      `${description} ${WEB_BASE_URL}/?ref=${referral}`,
    );
  };

  return (
    <Page style={{ background: 'var(--color-bg-canvas)' }}>
      <PageHeader title={PAGE_TITLE} />

      {/* Hoa hồng tháng nổi bật */}
      <div style={{ padding: 16 }}>
        {dashQ.isError ? (
          // KHÔNG fallback 0đ khi lỗi tải — hiển thị nhầm "0đ" gây hiểu lầm CTV chưa có hoa hồng.
          <ErrorState message={getLoadErrorMessage(dashQ.error)} onRetry={() => void dashQ.refetch()} />
        ) : (
          <div
            style={{
              padding: 20,
              background: HERO_GRADIENT,
              borderRadius: 'var(--radius-card)',
              boxShadow: 'var(--elevation-2)',
            }}
          >
            <Text variant="body-sm" tone="inverse" as="div" style={{ opacity: 0.85 }}>
              Hoa hồng tháng này
            </Text>
            <Text
              variant="price-xl"
              tone="inverse"
              as="div"
              style={{
                fontSize: 'var(--type-display-lg-size)',
                lineHeight: '40px',
                marginTop: 4,
                fontFamily: 'var(--font-display)',
              }}
            >
              {formatVnd(d?.monthCommission ?? 0)}
            </Text>
            <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
              <MiniStat label="Hôm nay" value={formatVnd(d?.todayCommission ?? 0)} />
              <MiniStat label="Lượt bấm" value={String(d?.totalClicks ?? 0)} />
              <MiniStat label="Chuyển đổi" value={String(d?.totalConversions ?? 0)} />
            </div>
          </div>
        )}
      </div>

      {/* Đại lý không có lối tắt Lên đơn hộ (API từ chối) và chỉ có Gian hàng khi còn gian hàng CTV (trình dựng trả 400 nếu không). */}
      <div style={BLOCK_GAP}>
        <CtvShortcuts
          items={[
            { key: 'share', label: 'Chia sẻ', ariaLabel: 'Chia sẻ link và mã giới thiệu', icon: Link2, onPress: shareReferral },
            ...(meQ.data?.canOpenStorefront !== false
              ? [{ key: 'store', label: 'Gian hàng', ariaLabel: 'Gian hàng của tôi', icon: Store, onPress: () => navigate('/storefront') }]
              : []),
            ...(meQ.data?.canOrderForCustomer !== false
              ? [
                  {
                    key: 'order',
                    label: 'Lên đơn hộ',
                    ariaLabel: vi.ctvOrder.entry,
                    icon: Receipt,
                    onPress: () => {
                      haptic('light');
                      setCtvOrdering(true);
                    },
                  },
                ]
              : []),
            {
              key: 'transfer',
              label: 'Chuyển vào Ví',
              ariaLabel: 'Chuyển vào Ví Tubu',
              icon: Wallet,
              // Khi dashQ lỗi: cho phép mở form để BE tự validate số dư (CTV không bị kẹt
              // do dashboard lỗi tạm thời mà không chuyển được commission đã APPROVED).
              disabled: !dashQ.isError && (d?.withdrawableCommission ?? 0) <= 0,
              onPress: () => setTransferring(true),
            },
          ]}
        />
      </div>

      {/* Khi dashQ lỗi: hiển thị "—" thay vì giá trị giả, để form chuyển tự query số dư riêng. */}
      <div style={{ ...BLOCK_GAP, display: 'flex', gap: 10 }}>
        <KpiCard
          label="Đang chờ"
          hint="đơn chưa giao hoặc đang giữ"
          value={dashQ.isError ? '—' : formatVnd(d?.pendingCommission ?? 0)}
        />
        <KpiCard
          label="Có thể chuyển vào Ví"
          value={dashQ.isError ? '—' : formatVnd(d?.withdrawableCommission ?? 0)}
          highlight
        />
      </div>
      {(d?.withdrawingCommission ?? 0) > 0 && (
        <Text variant="caption" tone="secondary" as="p" style={{ ...BLOCK_GAP, marginTop: -4 }}>
          Còn {formatVnd(d!.withdrawingCommission!)} nằm trong lệnh rút ngân hàng cũ, đang chờ Tubu Tree xử lý.
        </Text>
      )}

      {/* Bậc doanh số tháng (§6.8.2) & Danh sách 5 bậc CTV */}
      {d?.tier && (
        <Card padding={16} style={BLOCK_GAP}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontSize: 'var(--type-display-md-size)', lineHeight: 1 }}>{d.tier.emoji}</Text>
              <div>
                <Text variant="body-md" as="div" style={BOLD}>CTV {d.tier.name}</Text>
                <Text variant="caption" tone="brand" as="div">
                  Bậc theo doanh số đã chốt tháng này
                </Text>
              </div>
            </div>
            <Text variant="caption" tone="tertiary">
              Đã chốt: {formatVnd(d.monthRevenue)}
            </Text>
          </div>
          {d.tier.nextName && d.tier.nextThreshold && (
            <div style={{ marginTop: 12 }}>
              <ProgressBar value={progressPct(d.monthRevenue, d.tier.nextThreshold)} max={100} ariaLabel="Tiến độ lên hạng kế tiếp" />
              <Text variant="caption" tone="secondary" as="div" style={{ marginTop: 4 }}>
                Còn <b>{formatVnd(d.tier.toNext)}</b> doanh số đã chốt để lên bậc {d.tier.nextName}
              </Text>
            </div>
          )}

          {/* Toggle mở rộng danh sách 5 bậc CTV */}
          {/* ListRow của DS không nhận aria-expanded nên dùng <button> thật để trình đọc màn hình biết đang mở hay đóng. */}
          <button
            type="button"
            className="tubu-press"
            aria-expanded={showAllTiers}
            onClick={() => {
              haptic('light');
              setShowAllTiers(!showAllTiers);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              width: '100%',
              minHeight: 44,
              boxSizing: 'border-box',
              padding: '12px 0',
              marginTop: 12,
              background: 'none',
              border: 'none',
              borderTop: '1px solid var(--color-border-subtle)',
              font: 'inherit',
              textAlign: 'left',
              cursor: 'pointer',
            }}
          >
            <Text variant="body-sm" style={{ fontWeight: 600 }}>
              Bảng 5 bậc CTV & thưởng mốc Điểm Xanh
            </Text>
            <Icon icon={showAllTiers ? ChevronUp : ChevronDown} size="sm" tone="brand" />
          </button>

          {showAllTiers && ctvTiersQ.data && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {ctvTiersQ.data.allTiers.map((t) => {
                const isCurrent = t.name === d.tier.name;
                return (
                  <div
                    key={t.name}
                    style={{
                      padding: 8,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      borderRadius: 'var(--radius-control)',
                      background: isCurrent ? 'var(--color-action-secondary-bg)' : 'var(--color-bg-canvas)',
                      border: isCurrent ? '1px solid var(--color-action-secondary-border)' : '1px solid transparent',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Text style={{ fontSize: 'var(--type-body-lg-size)' }}>{t.emoji}</Text>
                      <Text
                        variant="caption"
                        tone={isCurrent ? 'brand' : 'primary'}
                        style={isCurrent ? BOLD : undefined}
                      >
                        {t.name} {isCurrent ? '(Hiện tại)' : ''}
                      </Text>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <Text variant="caption" tone="brand" as="div" style={BOLD}>
                        {tierRewardLabel(t)}
                      </Text>
                      <Text variant="label" tone="tertiary" as="div" style={{ fontWeight: 400 }}>
                        {t.min === 0 ? 'Mặc định' : `DS từ ${formatVnd(t.min)}`}
                      </Text>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* Thưởng mốc doanh số tháng — thưởng bằng Điểm Xanh (tiêu trong app, không rút được) */}
      {milestonesQ.isError ? (
        <Card padding={16} style={BLOCK_GAP}>
          <ErrorState variant="inline" message={getLoadErrorMessage(milestonesQ.error)} onRetry={() => void milestonesQ.refetch()} />
        </Card>
      ) : milestonesQ.isLoading ? (
        <Card padding={16} style={BLOCK_GAP}>
          <SectionSkeleton />
        </Card>
      ) : milestonesQ.data ? (
        <MilestoneRewards data={milestonesQ.data} />
      ) : null}

      {hasCourses && (
        <div style={BLOCK_GAP}>
          <Button fullWidth variant="secondary" icon={GraduationCap} onPress={() => navigate('/academy')}>
            {vi.academy.entry}
          </Button>
          <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 4, textAlign: 'center' }}>
            {vi.academy.entryHint}
          </Text>
        </div>
      )}

      {/* Mã giới thiệu + chia sẻ */}
      <Section title="Mã giới thiệu của bạn">
        <div
          style={{
            padding: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            background: 'var(--color-action-secondary-bg)',
            borderRadius: 'var(--radius-control)',
          }}
        >
          <Text variant="price-lg" tone="brand" style={{ letterSpacing: 1 }}>
            {referral}
          </Text>
          <Button onPress={shareReferral}>Chia sẻ</Button>
        </div>

        {/* Caption gợi ý (§6.8.4) — chạm để copy */}
        <Text variant="caption" as="div" style={{ ...BOLD, marginTop: 12, marginBottom: 6 }}>
          Lời đăng gợi ý (chạm để sao chép)
        </Text>
        {[
          `Mình đang dùng sản phẩm sống xanh của Tubu Tree, ưng lắm! Mua qua mã ${referral} nhé 🌿`,
          `Sống xanh an lành cùng Tubu Tree 🌱 Nhập mã ${referral} khi mua để ủng hộ mình nha!`,
          `Đồ thiên nhiên, lành cho da & nhẹ với đất. Săn deal Tubu Tree với mã ${referral} 💚`,
        ].map((cap, i) => (
          <button
            key={i}
            type="button"
            className="tubu-press"
            onClick={() => {
              void copyText(cap).then((ok) =>
                openSnackbar(
                  ok
                    ? { text: 'Đã sao chép lời đăng', type: 'success' }
                    : { text: 'Không sao chép được — hãy chọn và chép thủ công.', type: 'error' },
                ),
              );
            }}
            style={{
              display: 'block',
              width: '100%',
              minHeight: 44,
              padding: 8,
              marginBottom: 6,
              border: 'none',
              textAlign: 'left',
              fontFamily: 'inherit',
              cursor: 'pointer',
              background: 'var(--color-bg-canvas)',
              borderRadius: 'var(--radius-control)',
            }}
          >
            <Text variant="caption" tone="secondary">
              {cap}
            </Text>
          </button>
        ))}
      </Section>

      {/* Link chia sẻ */}
      <Section
        title="Link chia sẻ"
        action={
          <Button
            variant="ghost"
            loading={createLink.isPending}
            onPress={() => !createLink.isPending && createLink.mutate()}
          >
            + Tạo link
          </Button>
        }
      >
        {linksQ.isError ? (
          // Phân biệt rõ "chưa có link" vs "lỗi tải" — tránh user tưởng rằng họ chưa tạo link.
          <ErrorState variant="inline" message={getLoadErrorMessage(linksQ.error)} onRetry={() => void linksQ.refetch()} />
        ) : linksQ.data && linksQ.data.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {linksQ.data.map((l) => (
              <div
                key={l.id}
                style={{
                  padding: 8,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderBottom: '1px solid var(--color-border-subtle)',
                }}
              >
                <div>
                  <Text variant="body-sm" as="div" style={BOLD}>
                    {l.targetType === 'HOMEPAGE' ? 'Trang chủ' : l.targetType}
                  </Text>
                  <Text variant="caption" tone="tertiary" as="div">
                    {l.clicks} lượt bấm
                  </Text>
                </div>
                <Button
                  variant="ghost"
                  onPress={() => {
                    void copyText(`${WEB_BASE_URL}/?ref=${referral}&l=${l.shortCode}`).then((ok) =>
                      openSnackbar(
                        ok
                          ? { text: 'Đã sao chép link', type: 'success' }
                          : { text: 'Không sao chép được — hãy chép link thủ công.', type: 'error' },
                      ),
                    );
                  }}
                >
                  Sao chép
                </Button>
              </div>
            ))}
          </div>
        ) : linksQ.isLoading ? (
          <SectionSkeleton />
        ) : (
          <EmptyState
            variant="inline"
            art="leaf"
            heading="Chưa có link"
            body="Tạo link đầu tiên để bắt đầu chia sẻ."
          />
        )}
      </Section>

      {/* Lịch sử hoa hồng */}
      <Section title="Lịch sử hoa hồng">
        {commQ.isError ? (
          // Tránh hiển thị "Chưa có hoa hồng" khi thực tế là API lỗi — CTV sẽ mất niềm tin.
          <ErrorState variant="inline" message={getLoadErrorMessage(commQ.error)} onRetry={() => void commQ.refetch()} />
        ) : commQ.data && commQ.data.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {commQ.data.slice(0, 30).map((c: Commission) => {
              const m = c.withdrawing ? WITHDRAWING_META : COMMISSION_META[c.status];
              return (
                <div
                  key={c.id}
                  style={{
                    padding: '8px 0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    borderBottom: '1px solid var(--color-border-subtle)',
                  }}
                >
                  <div>
                    <Text variant="body-sm" tone="brand" as="div" style={BOLD}>
                      +{formatVnd(c.amount)}
                    </Text>
                    <Text variant="caption" tone="tertiary" as="div">
                      {c.orderCode ? `Đơn ${c.orderCode} · ` : 'Đơn '}
                      {formatVnd(c.orderTotal)} · {formatDate(c.createdAt)}
                    </Text>
                    {c.orderStatus && (
                      <Text variant="caption" tone="tertiary" as="div">
                        {copy.orderStatus[c.orderStatus] ?? c.orderStatus}
                      </Text>
                    )}
                  </div>
                  <Badge tone={m.tone}>{m.label}</Badge>
                </div>
              );
            })}
          </div>
        ) : commQ.isLoading ? (
          <SectionSkeleton />
        ) : (
          <EmptyState
            variant="inline"
            art="sprout"
            heading="Chưa có hoa hồng"
            body="Chia sẻ link để nhận hoa hồng từ đơn của bạn bè."
          />
        )}
      </Section>

      <Section title="Lịch sử chuyển vào Ví">
        {taxQ.data && taxQ.data.totals.taxWithheld > 0 && (
          <div style={{ marginBottom: 8 }}>
            <Text variant="body-sm" as="div">
              Năm {taxQ.data.year}: thu nhập hoa hồng {formatVnd(taxQ.data.totals.grossAmount)} · đã khấu trừ thuế TNCN{' '}
              {formatVnd(taxQ.data.totals.taxWithheld)}
            </Text>
            <Text variant="caption" tone="tertiary" as="div">
              Cần chứng từ khấu trừ thuế TNCN để quyết toán thuế? Liên hệ CSKH Tubu Tree, kế toán cấp theo bảng kê năm này.
            </Text>
          </div>
        )}
        {payoutsQ.isError ? (
          <ErrorState variant="inline" message={getLoadErrorMessage(payoutsQ.error)} onRetry={() => void payoutsQ.refetch()} />
        ) : payoutsQ.data && payoutsQ.data.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {payoutsQ.data.map((p) => (
              <PayoutRow key={p.id} p={p} />
            ))}
          </div>
        ) : payoutsQ.isLoading ? (
          <SectionSkeleton />
        ) : (
          <Text variant="body-sm" tone="tertiary" as="p" style={{ margin: 0 }}>
            Chưa có lần chuyển nào.
          </Text>
        )}
      </Section>

      {/* Hoa hồng theo gian hàng */}
      <Section title="Theo gian hàng">
        {sfQ.isError ? (
          <ErrorState variant="inline" message={getLoadErrorMessage(sfQ.error)} onRetry={() => void sfQ.refetch()} />
        ) : sfQ.data && sfQ.data.storefronts.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {sfQ.data.storefronts.map((sf) => (
              <div
                key={sf.slug}
                style={{
                  padding: '8px 0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  borderBottom: '1px solid var(--color-border-subtle)',
                }}
              >
                <div>
                  <Text variant="body-sm" as="div" style={BOLD}>
                    {sf.title ?? sf.slug}
                  </Text>
                  <Text variant="caption" tone="tertiary" as="div">
                    {sf.orders} đơn · DS {formatVnd(sf.revenue)}
                  </Text>
                </div>
                <Text variant="body-sm" tone="brand" style={BOLD}>
                  +{formatVnd(sf.commission)}
                </Text>
              </div>
            ))}
          </div>
        ) : sfQ.isLoading ? (
          <SectionSkeleton />
        ) : (
          <EmptyState
            variant="inline"
            art="box"
            heading="Chưa có đơn từ gian hàng nào"
            body="Chia sẻ link gian hàng để nhận hoa hồng."
          />
        )}
      </Section>

      {/* Hoa hồng theo sản phẩm */}
      <Section title="Theo sản phẩm">
        {pbQ.isError ? (
          <ErrorState variant="inline" message={getLoadErrorMessage(pbQ.error)} onRetry={() => void pbQ.refetch()} />
        ) : pbQ.data && pbQ.data.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {pbQ.data.slice(0, 10).map((p, i) => (
              <div
                key={i}
                style={{
                  padding: '8px 0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  borderBottom: '1px solid var(--color-border-subtle)',
                }}
              >
                <div>
                  <Text variant="body-sm" as="div" style={BOLD}>
                    {p.productName}
                  </Text>
                  <Text variant="caption" tone="tertiary" as="div">
                    {p.orders} đơn
                  </Text>
                </div>
                <Text variant="body-sm" tone="brand" style={BOLD}>
                  +{formatVnd(p.commission)}
                </Text>
              </div>
            ))}
          </div>
        ) : pbQ.isLoading ? (
          <SectionSkeleton />
        ) : (
          <EmptyState
            variant="inline"
            art="basket"
            heading="Chưa có hoa hồng theo sản phẩm"
            body="Chia sẻ link sản phẩm để bắt đầu."
          />
        )}
      </Section>

      <div style={{ height: 24 }} />

      <BottomSheet open={transferring} onClose={() => setTransferring(false)} title="Chuyển hoa hồng vào Ví">
        {/* Mount khi mở để form lấy ĐÚNG max hiện tại (tránh kẹt amount="0" nếu data về sau lần mount đầu). */}
        {transferring && (
          <TransferForm
            max={d?.withdrawableCommission ?? 0}
            taxPreview={d?.withdrawTaxPreview}
            taxIdOnFile={meQ.data?.personalTaxId ?? null}
            // dashQ lỗi → max tạm =0 (không phải số dư thật) — đừng chặn theo max chưa xác thực,
            // để BE tự validate số dư (đồng bộ với nút "Chuyển vào Ví" phía trên vẫn cho mở sheet).
            knownMax={!dashQ.isError}
            onDone={() => {
              setTransferring(false);
              void qc.invalidateQueries({ queryKey: ['affiliate-dashboard'] });
              void qc.invalidateQueries({ queryKey: ['affiliate-commissions'] });
              void qc.invalidateQueries({ queryKey: ['affiliate-payouts'] });
              void qc.invalidateQueries({ queryKey: ['affiliate-tax-statement'] });
              void qc.invalidateQueries({ queryKey: ['affiliate-me'] });
              // Chuyển vào Ví cộng thẳng vào Ví Tubu — invalidate để trang Ví không
              // hiển thị số dư cũ (cache stale) nếu user chuyển sang đó ngay sau khi chuyển.
              void qc.invalidateQueries({ queryKey: ['wallet'] });
            }}
          />
        )}
      </BottomSheet>

      <Sheet visible={ctvOrdering} onClose={() => setCtvOrdering(false)} autoHeight>
        {/* Mount khi mở để reset state form mỗi lần lên đơn mới. */}
        {ctvOrdering && <CtvOrderSheet onClose={() => setCtvOrdering(false)} />}
      </Sheet>
    </Page>
  );
}

function TransferForm({
  max,
  taxPreview,
  knownMax,
  taxIdOnFile,
  onDone,
}: {
  max: number;
  /** Thuế máy chủ sẽ khấu trừ nếu chuyển hết ngay (đã cộng dồn các lần chuyển trong tháng); thiếu khi API cũ. */
  taxPreview?: number;
  knownMax: boolean;
  taxIdOnFile: string | null;
  onDone: () => void;
}) {
  const { openSnackbar } = useSnackbar();
  // Không đọc affiliateWalletMultiplier: chuyển hoa hồng vào Ví Tubu là quy đổi 1:1.
  const { affiliatePitWithhold: pit, isLoaded: cfgLoaded } = usePublicConfig();
  const [taxId, setTaxId] = useState('');
  // Một khoá cho mỗi lần mở form: chạm đúp hay thử lại sau lỗi mạng gửi cùng khoá nên BE không tạo lệnh thứ hai.
  const payKey = useRef(newIdempotencyKey());

  const mut = useMutation({
    mutationFn: () =>
      askTaxId ? requestPayout(max, payKey.current, taxId.trim()) : requestPayout(max, payKey.current),
    onSuccess: (r) => {
      haptic('medium');
      openSnackbar({
        text: r.note ?? 'Đã chuyển hoa hồng vào Ví Tubu.',
        type: 'success',
      });
      onDone();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  // BE chỉ nhận chuyển toàn bộ hoa hồng có thể chuyển (affiliate.service.requestPayout), nên số tiền không cho sửa.
  const amountNum = max;
  const tax = taxPreview ?? payoutTax(amountNum, pit);
  // Lần chuyển bị khấu trừ thuế TNCN cần MST/CCCD để Tubu Tree kê khai và cấp chứng từ (BE trả PIT_TAX_ID_REQUIRED nếu thiếu).
  const askTaxId = tax > 0 && !taxIdOnFile;
  const taxIdValid = !askTaxId || PERSONAL_TAX_ID_PATTERN.test(taxId.trim());
  // knownMax=false khi dashboard lỗi (max truyền vào tạm =0, KHÔNG phải số dư thật) — bỏ qua so
  // sánh với max để không khoá chết nút Gửi; BE vẫn tự validate số dư thật khi submit.
  // !mut.isPending chặn double-submit (Button.loading của zmp-ui KHÔNG tự set thuộc tính disabled).
  const valid =
    knownMax &&
    amountNum > 0 &&
    // Chờ config THẬT: mức thuế TNCN lấy từ config, chưa có thì số nhận trên nút có thể lệch số được cộng.
    cfgLoaded &&
    taxIdValid &&
    !mut.isPending;

  return (
    <div>
      {knownMax ? (
        <div>
          <Text variant="caption" tone="secondary" as="div">
            Số tiền chuyển vào Ví
          </Text>
          <Text variant="price-md" as="div">
            {formatVnd(amountNum)}
          </Text>
          <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 2 }}>
            Mỗi lần chuyển là toàn bộ hoa hồng có thể chuyển.
          </Text>
          {pit && pit.pct > 0 && (
            <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 2 }}>
              Thuế TNCN {Math.round(Math.min(pit.pct, 1) * 100)}% tính trên tổng hoa hồng bạn chuyển trong tháng (giờ Việt Nam). Khi
              tổng từ {formatVnd(pit.threshold)} trở lên, thuế của các lần chuyển trước trong tháng chưa bị trừ sẽ được trừ bù vào lần chuyển này (tối đa bằng số tiền lần này).
            </Text>
          )}
          {tax > 0 && (
            <Text variant="caption" tone="secondary" as="div" style={{ marginTop: 4 }}>
              Khấu trừ thuế TNCN {formatVnd(tax)} · thực nhận {formatVnd(amountNum - tax)}
            </Text>
          )}
          {tax > 0 && taxIdOnFile && (
            <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 2 }}>
              Kê khai khấu trừ theo MST/CCCD {taxIdOnFile}
            </Text>
          )}
        </div>
      ) : (
        <div role="alert">
          <Text variant="caption" tone="danger" as="p" style={{ margin: 0 }}>
            Chưa tải được số hoa hồng có thể chuyển. Đóng lại rồi thử lại sau ít phút.
          </Text>
        </div>
      )}

      {askTaxId && (
        <div style={{ marginTop: 12 }}>
          <Input
            label="Mã số thuế cá nhân hoặc số CCCD"
            inputMode="numeric"
            value={taxId}
            onChange={(e) => setTaxId(e.target.value)}
          />
          <Text
            variant="caption"
            tone={taxId.trim() && !taxIdValid ? 'danger' : 'tertiary'}
            as="div"
            style={{ marginTop: 4 }}
          >
            {taxId.trim() && !taxIdValid
              ? 'Mã số thuế cá nhân gồm 10 chữ số, hoặc số CCCD 12 chữ số.'
              : 'Tubu Tree dùng số này để kê khai thuế đã khấu trừ và cấp chứng từ khấu trừ cho bạn. Chỉ cần nhập một lần.'}
          </Text>
        </div>
      )}

      <Button
        fullWidth
        loading={mut.isPending}
        disabled={!valid}
        onPress={() => mut.mutate()}
        style={{ marginTop: 20 }}
      >
        {`Nhận ${formatVnd(amountNum - tax)} vào Ví`}
      </Button>
    </div>
  );
}

function PayoutRow({ p }: { p: AffiliatePayout }) {
  const m = PAYOUT_META[p.status];
  return (
    <div style={{ padding: '8px 0', borderBottom: '1px solid var(--color-border-subtle)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <Text variant="body-sm" as="div" style={BOLD}>
            {formatVnd(p.amount)}
          </Text>
          <Text variant="caption" tone="tertiary" as="div">
            {PAYOUT_METHOD[p.method]} · {formatDate(p.requestedAt)}
          </Text>
        </div>
        <Badge tone={m.tone}>{m.label}</Badge>
      </div>
      {(p.taxWithheld > 0 || (p.taxRefunded ?? 0) > 0) && (
        <Text variant="caption" tone="tertiary" as="div">
          Hoa hồng {formatVnd(p.grossAmount ?? p.amount + p.taxWithheld)}
          {p.taxWithheld > 0 ? ` · đã khấu trừ thuế TNCN ${formatVnd(p.taxWithheld)}` : ''}
          {(p.taxRefunded ?? 0) > 0 ? ` · đã hoàn ${formatVnd(p.taxRefunded ?? 0)} thuế giữ dư vào Ví` : ''}
        </Text>
      )}
      {p.status === 'REJECTED' && (
        <Text variant="caption" tone="danger" as="div">
          Lý do: {p.rejectionReason ?? 'không ghi lý do'}. Hoa hồng đã trở lại mục Có thể chuyển vào Ví.
        </Text>
      )}
      {p.bankRef && (
        <Text variant="caption" tone="tertiary" as="div">
          Mã giao dịch: {p.bankRef}
        </Text>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Text variant="body-md" tone="inverse" as="div" style={BOLD}>
        {value}
      </Text>
      <Text variant="caption" tone="inverse" as="div" style={{ opacity: 0.8 }}>
        {label}
      </Text>
    </div>
  );
}

function KpiCard({
  label,
  value,
  highlight,
  hint,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  hint?: string;
}) {
  return (
    <Card style={{ flex: 1 }}>
      <Text variant="price-md" tone={highlight ? 'brand' : 'primary'} as="div">
        {value}
      </Text>
      <Text variant="caption" tone="tertiary" as="div">
        {label}
      </Text>
      {hint && (
        <Text variant="label" tone="tertiary" as="div" style={{ fontWeight: 400 }}>
          {hint}
        </Text>
      )}
    </Card>
  );
}

function SectionSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Skeleton height={16} />
      <Skeleton height={16} width="60%" />
    </div>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card padding={16} style={BLOCK_GAP}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <Heading variant="title-sm" as="h2">
          {title}
        </Heading>
        {action}
      </div>
      {children}
    </Card>
  );
}
