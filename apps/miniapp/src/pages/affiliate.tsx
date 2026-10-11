import { useState } from 'react';
import type { ReactNode } from 'react';
import { Input, Page, Sheet, useSnackbar, useNavigate } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getAffiliateMe,
  registerAffiliate,
  getAffiliateDashboard,
  getAffiliateLinks,
  createAffiliateLink,
  getCommissions,
  requestPayout,
  getStorefrontAnalytics,
  getProductBreakdown,
  getCtvTiers,
  getCtvMilestones,
  claimCtvMilestone,
  type Commission,
  type CommissionStatus,
  type CtvMilestoneItem,
} from '../services/affiliate-api';
import { getErrorMessage } from '../services/api';
import { useShareWithFallback } from '../components/share-sheet';
import { useAuthStore } from '../store/auth';
import { formatVnd, formatVndShort, formatXu } from '../utils/format';
import { haptic } from '../utils/haptic';
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
import { ChoiceCard } from '../components/affiliate/choice-card';
import { CtvOrderSheet } from '../components/affiliate/ctv-order-sheet';
import {
  milestoneStatusText,
  monthLabel,
  progressPct,
  revenueRuleText,
  tierRewardLabel,
} from '../components/affiliate/milestone-copy';
import { Handshake, BadgePercent, Link2, Landmark, TrendingUp, Receipt, Store, GraduationCap, Trophy, ChevronDown, ChevronUp, Check } from 'lucide-react';
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
  APPROVED: { label: 'Có thể rút', tone: 'success' },
  PAID: { label: 'Đã trả', tone: 'neutral' },
  REJECTED: { label: 'Từ chối', tone: 'danger' },
};

export default function AffiliatePage() {
  // /affiliate/me cần auth — fetch trước khi restore() xong sẽ 401 và kẹt vĩnh viễn
  // (queryClient retry:false cho 4xx) dù login thành công ~200ms sau (cùng bug đã fix ở wallet.tsx).
  const authed = useAuthStore((s) => s.status === 'authenticated');
  const meQ = useQuery({ queryKey: ['affiliate-me'], queryFn: getAffiliateMe, enabled: authed });

  if (!authed || meQ.isLoading) {
    return (
      <Page style={{ background: 'var(--color-bg-canvas)' }}>
        <PageHeader title={PAGE_TITLE} />
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Skeleton height={120} radius="var(--radius-card)" />
          <Skeleton height={80} radius="var(--radius-card)" />
        </div>
      </Page>
    );
  }

  if (meQ.isError) {
    return (
      <Page style={{ background: 'var(--color-bg-canvas)' }}>
        <PageHeader title={PAGE_TITLE} />
        <ErrorState message={getErrorMessage(meQ.error)} onRetry={() => void meQ.refetch()} />
      </Page>
    );
  }

  return meQ.data?.isAffiliate ? <Dashboard /> : <RegisterGate />;
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
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const cfg = usePublicConfig();
  const benefits = [
    { Icon: BadgePercent, text: 'Hoa hồng theo từng sản phẩm + thưởng bậc doanh số tháng' },
    { Icon: Link2, text: 'Tạo link chia sẻ riêng, theo dõi click & chuyển đổi' },
    {
      Icon: Landmark,
      // P0 FIX (A5-07, 2026-09-27): bỏ quảng cáo "×hệ số" — rút về Ví Tubu giờ luôn là quy đổi 1:1
      // (Ví là tiền VND rút được ra ngân hàng thật, không phải phần thưởng nội bộ).
      text: `Rút về ngân hàng (tối thiểu ${formatVndShort(cfg.affiliateMinWithdrawBank)}) hoặc quy đổi 1:1 vào Ví Tubu`,
    },
    { Icon: TrendingUp, text: 'Dashboard hoa hồng realtime, minh bạch' },
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
  const sfQ = useQuery({ queryKey: ['affiliate-sf-analytics'], queryFn: getStorefrontAnalytics });
  const pbQ = useQuery({ queryKey: ['affiliate-product-breakdown'], queryFn: getProductBreakdown });
  const ctvTiersQ = useQuery({ queryKey: ['affiliate-ctv-tiers'], queryFn: getCtvTiers });
  const milestonesQ = useQuery({ queryKey: ['affiliate-milestones'], queryFn: getCtvMilestones });
  const [showAllTiers, setShowAllTiers] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [ctvOrdering, setCtvOrdering] = useState(false);

  // Thưởng mốc cộng TubuXu (coinsBalance) — làm mới số dư xu ở Ví (['coins'] + ['wallet'] vì
  // GET /me/wallet cũng trả coinsBalance). `month` = tháng của mốc (tháng này hoặc tháng trước).
  const claimMilestoneMut = useMutation({
    mutationFn: (v: { id: string; month: string }) => claimCtvMilestone(v.id, v.month),
    onSuccess: (res) => {
      haptic('heavy');
      openSnackbar({ text: res.message || 'Đã nhận thưởng mốc thành công!', type: 'success' });
      void qc.invalidateQueries({ queryKey: ['affiliate-milestones'] });
      void qc.invalidateQueries({ queryKey: ['coins'] });
      void qc.invalidateQueries({ queryKey: ['wallet'] });
    },
    onError: (e) => {
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
      // Lỗi "đã nhận"/"chưa đạt" → trạng thái trên máy đã cũ, tải lại để nút khớp backend.
      void qc.invalidateQueries({ queryKey: ['affiliate-milestones'] });
    },
  });

  const renderMilestone = (m: CtvMilestoneItem, month: string, confirmedRevenue: number) => (
    <div
      key={`${month}:${m.id}`}
      style={{
        padding: 12,
        borderRadius: 'var(--radius-control)',
        background: m.canClaim ? 'var(--color-bg-subtle)' : 'var(--color-bg-canvas)',
        border: m.canClaim ? '1px solid var(--color-action-secondary-border)' : '1px solid var(--color-border-subtle)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Text variant="body-sm" style={BOLD}>{m.title}</Text>
            {m.claimed && <Badge size="sm">Đã nhận</Badge>}
          </div>
          <Text variant="caption" tone="secondary" as="div" style={{ marginTop: 2 }}>
            {m.description}
          </Text>
        </div>
        <Text variant="body-sm" tone="brand" style={{ ...BOLD, marginLeft: 8 }}>
          +{formatXu(m.rewardXu)}
        </Text>
      </div>

      {/* Thanh tiến độ mốc (backend tính: chưa đạt tối đa 99%) */}
      <div style={{ marginTop: 8 }}>
        <ProgressBar value={m.progressPct} max={100} />
      </div>

      <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Text variant="caption" tone="tertiary">
          {milestoneStatusText(m, confirmedRevenue)}
        </Text>

        <Button
          variant={m.canClaim ? 'primary' : 'secondary'}
          icon={m.claimed ? Check : undefined}
          disabled={!m.canClaim}
          loading={
            claimMilestoneMut.isPending &&
            claimMilestoneMut.variables?.id === m.id &&
            claimMilestoneMut.variables?.month === month
          }
          onPress={() => claimMilestoneMut.mutate({ id: m.id, month })}
        >
          {m.claimed ? 'Đã nhận' : m.canClaim ? 'Nhận thưởng' : 'Chưa đạt'}
        </Button>
      </div>
    </div>
  );

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
          <ErrorState message={getErrorMessage(dashQ.error)} onRetry={() => void dashQ.refetch()} />
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
              <MiniStat label="Click" value={String(d?.totalClicks ?? 0)} />
              <MiniStat label="Chuyển đổi" value={String(d?.totalConversions ?? 0)} />
            </div>
          </div>
        )}
      </div>

      {/* Lối tắt "Lên đơn hộ" ngay dưới thẻ hoa hồng: việc CTV làm nhiều lần mỗi ngày, trước đây
          nằm sau thẻ bậc, thưởng mốc và nút rút nên phải cuộn qua ~3 màn mới thấy. */}
      <div style={BLOCK_GAP}>
        <Button
          fullWidth
          icon={Receipt}
          onPress={() => {
            haptic('light');
            setCtvOrdering(true);
          }}
        >
          {vi.ctvOrder.entry}
        </Button>
        <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 4, textAlign: 'center' }}>
          {vi.ctvOrder.entryHint}
        </Text>
      </div>

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
              <ProgressBar value={progressPct(d.monthRevenue, d.tier.nextThreshold)} max={100} />
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
              Bảng 5 bậc CTV & thưởng mốc TubuXu
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

      {/* Thưởng mốc doanh số tháng — thưởng bằng TubuXu (tiêu trong app, không rút được) */}
      {milestonesQ.data && milestonesQ.data.milestones.length > 0 && (
        <Card padding={16} style={BLOCK_GAP}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 'var(--radius-control)',
                background: 'var(--color-action-secondary-bg)',
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <Icon icon={Trophy} size="md" tone="brand" />
            </div>
            <div>
              <Text variant="body-sm" as="div" style={BOLD}>Thưởng Mốc Doanh Số Tháng</Text>
              <Text variant="caption" tone="tertiary" as="div">
                {monthLabel(milestonesQ.data.monthKey)} · Đã chốt {formatVnd(milestonesQ.data.currentRevenue)}
              </Text>
            </div>
          </div>

          <Text variant="caption" tone="tertiary" as="div" style={{ marginBottom: 4 }}>
            {revenueRuleText(milestonesQ.data.holdDays)}
          </Text>
          {milestonesQ.data.pendingRevenue > 0 && (
            <Text variant="caption" tone="secondary" as="div" style={{ marginBottom: 8 }}>
              Đang chờ chốt: <b>{formatVnd(milestonesQ.data.pendingRevenue)}</b> (đơn chưa giao hoặc đang trong thời gian giữ đổi/trả — chưa tính vào mốc)
            </Text>
          )}

          {milestonesQ.data.previousMonth && (
            <div style={{ marginBottom: 12 }}>
              <Text variant="caption" tone="brand" as="div" style={{ ...BOLD, marginBottom: 6 }}>
                Còn thưởng {monthLabel(milestonesQ.data.previousMonth.monthKey)} chưa nhận — nhận trước khi hết {monthLabel(milestonesQ.data.monthKey)}
              </Text>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {milestonesQ.data.previousMonth.milestones.map((m) =>
                  renderMilestone(m, milestonesQ.data!.previousMonth!.monthKey, milestonesQ.data!.previousMonth!.revenue),
                )}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {milestonesQ.data.milestones.map((m) =>
              renderMilestone(m, milestonesQ.data!.monthKey, milestonesQ.data!.currentRevenue),
            )}
          </div>
        </Card>
      )}

      {/* Rút tiền — luôn hiển thị nút Rút (CTV vẫn có thể rút khi dashboard lỗi transient).
          Khi dashQ lỗi: hiển thị "—" thay vì giá trị giả, để WithdrawForm tự query số dư riêng. */}
      <div style={{ ...BLOCK_GAP, display: 'flex', gap: 10 }}>
        <KpiCard
          label="Đang chờ"
          hint="đơn chưa giao hoặc đang giữ"
          value={dashQ.isError ? '—' : formatVnd(d?.pendingCommission ?? 0)}
        />
        <KpiCard
          label="Có thể rút"
          value={dashQ.isError ? '—' : formatVnd(d?.withdrawableCommission ?? 0)}
          highlight
        />
      </div>
      <div style={BLOCK_GAP}>
        <Button
          fullWidth
          variant="secondary"
          // Khi dashQ lỗi: cho phép mở WithdrawForm để BE tự validate số dư (CTV không bị kẹt
          // do dashboard lỗi tạm thời mà không rút được commission đã APPROVED).
          disabled={!dashQ.isError && (d?.withdrawableCommission ?? 0) <= 0}
          onPress={() => setWithdrawing(true)}
        >
          Rút hoa hồng
        </Button>
      </div>

      <div style={BLOCK_GAP}>
        <Button fullWidth variant="secondary" icon={Store} onPress={() => navigate('/storefront')}>
          Gian hàng của tôi
        </Button>
      </div>

      <div style={BLOCK_GAP}>
        <Button fullWidth variant="secondary" icon={GraduationCap} onPress={() => navigate('/academy')}>
          {vi.academy.entry}
        </Button>
        <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 4, textAlign: 'center' }}>
          {vi.academy.entryHint}
        </Text>
      </div>

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
          Caption gợi ý (chạm để sao chép)
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
                    ? { text: 'Đã sao chép caption', type: 'success' }
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
          <ErrorState variant="inline" message={getErrorMessage(linksQ.error)} onRetry={() => void linksQ.refetch()} />
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
                    {l.clicks} click · {l.conversions} đơn
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
          <ErrorState variant="inline" message={getErrorMessage(commQ.error)} onRetry={() => void commQ.refetch()} />
        ) : commQ.data && commQ.data.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {commQ.data.slice(0, 30).map((c: Commission) => {
              const m = COMMISSION_META[c.status];
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
                      Đơn {formatVnd(c.orderTotal)} ·{' '}
                      {new Date(c.createdAt).toLocaleDateString('vi-VN')}
                    </Text>
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

      {/* Hoa hồng theo gian hàng */}
      <Section title="Theo gian hàng">
        {sfQ.isError ? (
          <ErrorState variant="inline" message={getErrorMessage(sfQ.error)} onRetry={() => void sfQ.refetch()} />
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
          <ErrorState variant="inline" message={getErrorMessage(pbQ.error)} onRetry={() => void pbQ.refetch()} />
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

      <BottomSheet open={withdrawing} onClose={() => setWithdrawing(false)} title="Rút hoa hồng">
        {/* Mount khi mở để form lấy ĐÚNG max hiện tại (tránh kẹt amount="0" nếu data về sau lần mount đầu). */}
        {withdrawing && (
          <WithdrawForm
            max={d?.withdrawableCommission ?? 0}
            // dashQ lỗi → max tạm =0 (không phải số dư thật) — đừng chặn theo max chưa xác thực,
            // để BE tự validate số dư (đồng bộ với nút "Rút hoa hồng" phía trên vẫn cho mở sheet).
            knownMax={!dashQ.isError}
            onDone={() => {
              setWithdrawing(false);
              void qc.invalidateQueries({ queryKey: ['affiliate-dashboard'] });
              void qc.invalidateQueries({ queryKey: ['affiliate-commissions'] });
              // Rút về WALLET_BALANCE cộng thẳng vào Ví Tubu — invalidate để trang Ví không
              // hiển thị số dư cũ (cache stale) nếu user chuyển sang đó ngay sau khi rút.
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

function WithdrawForm({
  max,
  knownMax,
  onDone,
}: {
  max: number;
  knownMax: boolean;
  onDone: () => void;
}) {
  const { openSnackbar } = useSnackbar();
  // P0 FIX (A5-07): KHÔNG còn đọc affiliateWalletMultiplier — rút về Ví Tubu là quy đổi 1:1.
  const { affiliateMinWithdrawBank: minBank, isLoaded: cfgLoaded } = usePublicConfig();
  const [method, setMethod] = useState<'BANK' | 'WALLET_BALANCE'>('WALLET_BALANCE');
  const [amount, setAmount] = useState(String(max));
  const [bank, setBank] = useState({ bankName: '', accountNumber: '', accountName: '' });

  const mut = useMutation({
    mutationFn: () =>
      requestPayout(Number(amount), method, method === 'BANK' ? bank : undefined),
    onSuccess: (r) => {
      haptic('medium');
      openSnackbar({ text: r.note ?? 'Đã gửi yêu cầu rút.', type: 'success' });
      onDone();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const amountNum = Number(amount) || 0;
  const bankValid =
    method !== 'BANK' ||
    (bank.bankName.trim() && bank.accountNumber.trim().length >= 6 && bank.accountName.trim());
  // knownMax=false khi dashboard lỗi (max truyền vào tạm =0, KHÔNG phải số dư thật) — bỏ qua so
  // sánh với max để không khoá chết nút Gửi; BE vẫn tự validate số dư thật khi submit.
  // !mut.isPending chặn double-submit (Button.loading của zmp-ui KHÔNG tự set thuộc tính disabled).
  const valid =
    amountNum > 0 &&
    (!knownMax || amountNum <= max) &&
    // Chờ config THẬT trước khi cho gửi lệnh rút về ngân hàng: mốc mặc định (50k) có thể khác
    // config đang chạy, nên trong ~200ms đầu CTV gõ 60k sẽ thấy nút hợp lệ rồi bị BE từ chối,
    // và nhãn "Tối thiểu 50k" cũng hiện sai trong khoảng đó.
    (method !== 'BANK' || (cfgLoaded && amountNum >= minBank)) &&
    bankValid &&
    !mut.isPending;

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <ChoiceCard
          active={method === 'WALLET_BALANCE'}
          title="Ví Tubu"
          sub="Quy đổi 1:1, nhận ngay"
          onPress={() => setMethod('WALLET_BALANCE')}
        />
        <ChoiceCard
          active={method === 'BANK'}
          title="Ngân hàng"
          sub={cfgLoaded ? `Tối thiểu ${formatVndShort(minBank)}` : 'Đang tải mốc tối thiểu…'}
          onPress={() => setMethod('BANK')}
        />
      </div>

      <Input
        label="Số tiền"
        type="number"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 4 }}>
        {knownMax ? `Tối đa ${formatVnd(max)}` : 'Số dư sẽ được máy chủ xác thực khi gửi yêu cầu.'}
      </Text>

      {method === 'BANK' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
          <Input
            label="Tên ngân hàng"
            value={bank.bankName}
            onChange={(e) => setBank((b) => ({ ...b, bankName: e.target.value }))}
          />
          <Input
            label="Số tài khoản"
            value={bank.accountNumber}
            onChange={(e) => setBank((b) => ({ ...b, accountNumber: e.target.value }))}
          />
          <Input
            label="Chủ tài khoản"
            value={bank.accountName}
            onChange={(e) => setBank((b) => ({ ...b, accountName: e.target.value }))}
          />
        </div>
      )}

      <Button
        fullWidth
        loading={mut.isPending}
        disabled={!valid}
        onPress={() => mut.mutate()}
        style={{ marginTop: 20 }}
      >
        {method === 'WALLET_BALANCE'
          ? `Nhận ${formatVnd(amountNum)} vào Ví`
          : `Rút ${formatVnd(amountNum)}`}
      </Button>
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
    <Card variant={highlight ? 'flat' : 'raised'} style={{ flex: 1 }}>
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
