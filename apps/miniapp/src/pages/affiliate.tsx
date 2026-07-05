import { useState } from 'react';
import { Box, Page, Text, Button, Input, Sheet, useSnackbar, useNavigate } from 'zmp-ui';
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
  type Commission,
  type CommissionStatus,
} from '../services/affiliate-api';
import { getErrorMessage } from '../services/api';
import { shareLink } from '../services/zmp-bridge';
import { formatVnd } from '../utils/format';
import { haptic } from '../utils/haptic';
import { Skeleton } from '../components/ui/skeleton';
import { ErrorState } from '../components/ui/empty-state';
import { CtvOrderSheet } from '../components/affiliate/ctv-order-sheet';
import { vi } from '../i18n/vi';

const COMMISSION_META: Record<CommissionStatus, { label: string; color: string; bg: string }> = {
  PENDING: { label: 'Chờ (đơn chưa giao)', color: 'var(--clay-700)', bg: 'var(--clay-50)' },
  LOCKED: { label: 'Đang giữ', color: 'var(--info)', bg: '#e8f0f8' },
  APPROVED: { label: 'Có thể rút', color: 'var(--leaf-700)', bg: 'var(--leaf-50)' },
  PAID: { label: 'Đã trả', color: 'var(--neutral-600)', bg: 'var(--neutral-100)' },
  REJECTED: { label: 'Từ chối', color: 'var(--danger)', bg: '#fbe9e9' },
};

export default function AffiliatePage() {
  const meQ = useQuery({ queryKey: ['affiliate-me'], queryFn: getAffiliateMe });

  if (meQ.isLoading) {
    return (
      <Page className="page" style={{ background: 'var(--neutral-50)' }}>
        <Box p={4} flex flexDirection="column" style={{ gap: 12 }}>
          <Skeleton style={{ height: 120, borderRadius: 16 }} />
          <Skeleton style={{ height: 80, borderRadius: 16 }} />
        </Box>
      </Page>
    );
  }

  if (meQ.isError) {
    return (
      <Page className="page" style={{ background: 'var(--neutral-50)' }}>
        <Box p={6} style={{ textAlign: 'center' }}>
          <Text style={{ color: 'var(--danger)' }}>{getErrorMessage(meQ.error)}</Text>
        </Box>
      </Page>
    );
  }

  return meQ.data?.isAffiliate ? <Dashboard /> : <RegisterGate />;
}

function RegisterGate() {
  const { openSnackbar } = useSnackbar();
  const qc = useQueryClient();
  const reg = useMutation({
    mutationFn: registerAffiliate,
    onSuccess: () => {
      haptic('medium');
      openSnackbar({ text: 'Chào mừng CTV Tubu Tree! 🎉', type: 'success' });
      void qc.invalidateQueries({ queryKey: ['affiliate-me'] });
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const benefits = [
    { icon: '💸', text: 'Hoa hồng theo từng sản phẩm + thưởng bậc doanh số tháng' },
    { icon: '🔗', text: 'Tạo link chia sẻ riêng, theo dõi click & chuyển đổi' },
    { icon: '🏦', text: 'Rút về ngân hàng (tối thiểu 50k) hoặc Ví Tubu ×1.5' },
    { icon: '📈', text: 'Dashboard hoa hồng realtime, minh bạch' },
  ];

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)' }}>
      <Box p={4}>
        <Box
          p={5}
          style={{
            background: 'linear-gradient(135deg, var(--primary-600), var(--primary-700))',
            borderRadius: 'var(--radius-xl)',
            color: '#fff',
            textAlign: 'center',
          }}
        >
          <Text style={{ fontSize: 48 }}>🤝</Text>
          <Text bold size="xLarge" style={{ color: '#fff', marginTop: 4 }}>
            Trở thành CTV Tubu
          </Text>
          <Text size="small" style={{ color: 'rgba(255,255,255,0.9)', marginTop: 6 }}>
            Chia sẻ sản phẩm sống xanh bạn yêu thích — nhận hoa hồng cho mỗi đơn thành công.
          </Text>
        </Box>

        <Box mt={4} flex flexDirection="column" style={{ gap: 12 }}>
          {benefits.map((b, i) => (
            <Box key={i} flex alignItems="center" style={{ gap: 12 }}>
              <Text style={{ fontSize: 24 }}>{b.icon}</Text>
              <Text size="small" style={{ flex: 1 }}>
                {b.text}
              </Text>
            </Box>
          ))}
        </Box>

        <Button
          fullWidth
          loading={reg.isPending}
          onClick={() => reg.mutate()}
          style={{ marginTop: 24, background: 'var(--primary-600)' }}
        >
          Đăng ký miễn phí ngay
        </Button>
      </Box>
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
  const [withdrawing, setWithdrawing] = useState(false);
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

  const shareReferral = () => {
    haptic('light');
    void shareLink({
      title: 'Tubu Tree — Sống xanh An Lành',
      description: `Mua sắm sản phẩm thiên nhiên cùng mình, dùng mã ${referral} nhé!`,
      path: `/?ref=${referral}`,
    }).catch(() => {});
  };

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)' }}>

      {/* Hoa hồng tháng nổi bật */}
      <Box p={4}>
        {dashQ.isError ? (
          // KHÔNG fallback 0đ khi lỗi tải — hiển thị nhầm "0đ" gây hiểu lầm CTV chưa có hoa hồng.
          <ErrorState message={getErrorMessage(dashQ.error)} onRetry={() => void dashQ.refetch()} />
        ) : (
          <Box
            p={5}
            style={{
              background: 'linear-gradient(135deg, var(--primary-600), var(--primary-700))',
              borderRadius: 'var(--radius-xl)',
              color: '#fff',
              boxShadow: 'var(--shadow-md)',
            }}
          >
            <Text size="small" style={{ color: 'rgba(255,255,255,0.85)' }}>
              Hoa hồng tháng này
            </Text>
            <Text bold style={{ fontSize: 32, lineHeight: '40px', color: '#fff', marginTop: 4 }}>
              {formatVnd(d?.monthCommission ?? 0)}
            </Text>
            <Box flex style={{ gap: 16, marginTop: 12 }}>
              <MiniStat label="Hôm nay" value={formatVnd(d?.todayCommission ?? 0)} />
              <MiniStat label="Click" value={String(d?.totalClicks ?? 0)} />
              <MiniStat label="Chuyển đổi" value={String(d?.totalConversions ?? 0)} />
            </Box>
          </Box>
        )}
      </Box>

      {/* Bậc doanh số tháng (§6.8.2) */}
      {d?.tier && (
        <Box mx={4} mb={3} p={4} style={{ background: 'var(--neutral-0)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-xs)' }}>
          <Box flex alignItems="center" justifyContent="space-between">
            <Box flex alignItems="center" style={{ gap: 8 }}>
              <Text style={{ fontSize: 28 }}>{d.tier.emoji}</Text>
              <Box>
                <Text bold>CTV {d.tier.name}</Text>
                <Text size="xSmall" style={{ color: 'var(--leaf-700)' }}>
                  Bonus +{d.tier.bonusPct}% hoa hồng tháng này
                </Text>
              </Box>
            </Box>
            <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
              DS: {formatVnd(d.monthRevenue)}
            </Text>
          </Box>
          {d.tier.nextName && d.tier.nextThreshold && (
            <Box mt={3}>
              <Box style={{ height: 8, background: 'var(--neutral-100)', borderRadius: 99, overflow: 'hidden' }}>
                <Box
                  style={{
                    width: `${Math.min(100, Math.round((d.monthRevenue / d.tier.nextThreshold) * 100))}%`,
                    height: '100%',
                    background: 'var(--primary-600)',
                  }}
                />
              </Box>
              <Text size="xSmall" style={{ color: 'var(--neutral-600)', marginTop: 4 }}>
                Còn <b>{formatVnd(d.tier.toNext)}</b> doanh số để lên bậc {d.tier.nextName}
              </Text>
            </Box>
          )}
        </Box>
      )}

      {/* Rút tiền — luôn hiển thị nút Rút (CTV vẫn có thể rút khi dashboard lỗi transient).
          Khi dashQ lỗi: hiển thị "—" thay vì giá trị giả, để WithdrawForm tự query số dư riêng. */}
      <Box mx={4} mb={3} flex style={{ gap: 10 }}>
        <KpiCard
          label="Chờ duyệt"
          value={dashQ.isError ? '—' : formatVnd(d?.pendingCommission ?? 0)}
        />
        <KpiCard
          label="Có thể rút"
          value={dashQ.isError ? '—' : formatVnd(d?.withdrawableCommission ?? 0)}
          highlight
        />
      </Box>
      <Box mx={4} mb={3}>
        <Button
          fullWidth
          variant="secondary"
          // Khi dashQ lỗi: cho phép mở WithdrawForm để BE tự validate số dư (CTV không bị kẹt
          // do dashboard lỗi tạm thời mà không rút được commission đã APPROVED).
          disabled={!dashQ.isError && (d?.withdrawableCommission ?? 0) <= 0}
          onClick={() => setWithdrawing(true)}
        >
          Rút hoa hồng
        </Button>
      </Box>

      <Box mx={4} mb={3}>
        <Button
          fullWidth
          onClick={() => {
            haptic('light');
            setCtvOrdering(true);
          }}
          style={{ background: 'var(--primary-600)' }}
        >
          🧾 {vi.ctvOrder.entry}
        </Button>
        <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 4, textAlign: 'center' }}>
          {vi.ctvOrder.entryHint}
        </Text>
      </Box>

      <Box mx={4} mb={3}>
        <Button fullWidth variant="secondary" onClick={() => navigate('/storefront')}>
          🏪 Gian hàng của tôi
        </Button>
      </Box>

      {/* Mã giới thiệu + chia sẻ */}
      <Section title="Mã giới thiệu của bạn">
        <Box
          flex
          alignItems="center"
          justifyContent="space-between"
          p={3}
          style={{ background: 'var(--primary-50)', borderRadius: 'var(--radius-md)' }}
        >
          <Text bold size="large" style={{ color: 'var(--primary-700)', letterSpacing: 1 }}>
            {referral}
          </Text>
          <Button size="small" onClick={shareReferral} style={{ background: 'var(--primary-600)' }}>
            Chia sẻ
          </Button>
        </Box>

        {/* Caption gợi ý (§6.8.4) — chạm để copy */}
        <Text size="xSmall" bold style={{ marginTop: 12, marginBottom: 6 }}>
          Caption gợi ý (chạm để sao chép)
        </Text>
        {[
          `Mình đang dùng sản phẩm sống xanh của Tubu Tree, ưng lắm! Mua qua mã ${referral} nhé 🌿`,
          `Sống xanh an lành cùng Tubu Tree 🌱 Nhập mã ${referral} khi mua để ủng hộ mình nha!`,
          `Đồ thiên nhiên, lành cho da & nhẹ với đất. Săn deal Tubu Tree với mã ${referral} 💚`,
        ].map((cap, i) => (
          <Box
            key={i}
            className="tubu-press"
            onClick={() => {
              if (navigator.clipboard) {
                void navigator.clipboard.writeText(cap);
                openSnackbar({ text: 'Đã sao chép caption', type: 'success' });
              }
            }}
            p={2}
            style={{ background: 'var(--neutral-50)', borderRadius: 'var(--radius-sm)', marginBottom: 6 }}
          >
            <Text size="xSmall" style={{ color: 'var(--neutral-600)' }}>
              {cap}
            </Text>
          </Box>
        ))}
      </Section>

      {/* Link chia sẻ */}
      <Section
        title="Link chia sẻ"
        action={
          <Text
            size="small"
            bold
            style={{ color: 'var(--primary-700)' }}
            onClick={() => createLink.mutate()}
          >
            + Tạo link
          </Text>
        }
      >
        {linksQ.isError ? (
          // Phân biệt rõ "chưa có link" vs "lỗi tải" — tránh user tưởng rằng họ chưa tạo link.
          <ErrorState message={getErrorMessage(linksQ.error)} onRetry={() => void linksQ.refetch()} />
        ) : linksQ.data && linksQ.data.length > 0 ? (
          <Box flex flexDirection="column" style={{ gap: 8 }}>
            {linksQ.data.map((l) => (
              <Box
                key={l.id}
                flex
                alignItems="center"
                justifyContent="space-between"
                p={2}
                style={{ borderBottom: '1px solid var(--neutral-100)' }}
              >
                <Box>
                  <Text size="small" bold>
                    {l.targetType === 'HOMEPAGE' ? 'Trang chủ' : l.targetType}
                  </Text>
                  <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
                    {l.clicks} click · {l.conversions} đơn
                  </Text>
                </Box>
                <Text
                  size="xSmall"
                  bold
                  style={{ color: 'var(--primary-700)' }}
                  onClick={() => {
                    if (navigator.clipboard) {
                      const base = (import.meta.env.VITE_WEB_BASE_URL as string | undefined) ?? 'https://shop.tubutree.com';
                      void navigator.clipboard.writeText(`${base}/?ref=${referral}&l=${l.shortCode}`);
                      openSnackbar({ text: 'Đã sao chép link', type: 'success' });
                    }
                  }}
                >
                  Sao chép
                </Text>
              </Box>
            ))}
          </Box>
        ) : (
          <Text size="small" style={{ color: 'var(--neutral-400)' }}>
            Chưa có link. Tạo link đầu tiên để bắt đầu chia sẻ.
          </Text>
        )}
      </Section>

      {/* Lịch sử hoa hồng */}
      <Section title="Lịch sử hoa hồng">
        {commQ.isError ? (
          // Tránh hiển thị "Chưa có hoa hồng" khi thực tế là API lỗi — CTV sẽ mất niềm tin.
          <ErrorState message={getErrorMessage(commQ.error)} onRetry={() => void commQ.refetch()} />
        ) : commQ.data && commQ.data.length > 0 ? (
          <Box flex flexDirection="column" style={{ gap: 2 }}>
            {commQ.data.slice(0, 30).map((c: Commission) => {
              const m = COMMISSION_META[c.status];
              return (
                <Box
                  key={c.id}
                  flex
                  alignItems="center"
                  justifyContent="space-between"
                  py={2}
                  style={{ borderBottom: '1px solid var(--neutral-100)' }}
                >
                  <Box>
                    <Text size="small" bold style={{ color: 'var(--leaf-700)' }}>
                      +{formatVnd(c.amount)}
                    </Text>
                    <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
                      Đơn {formatVnd(c.orderTotal)} ·{' '}
                      {new Date(c.createdAt).toLocaleDateString('vi-VN')}
                    </Text>
                  </Box>
                  <Text
                    size="xSmall"
                    style={{
                      color: m.color,
                      background: m.bg,
                      padding: '2px 8px',
                      borderRadius: 'var(--radius-full)',
                    }}
                  >
                    {m.label}
                  </Text>
                </Box>
              );
            })}
          </Box>
        ) : (
          <Text size="small" style={{ color: 'var(--neutral-400)' }}>
            Chưa có hoa hồng. Chia sẻ link để nhận hoa hồng từ đơn của bạn bè.
          </Text>
        )}
      </Section>

      {/* Hoa hồng theo gian hàng */}
      <Section title="Theo gian hàng">
        {sfQ.isError ? (
          <ErrorState message={getErrorMessage(sfQ.error)} onRetry={() => void sfQ.refetch()} />
        ) : sfQ.data && sfQ.data.storefronts.length > 0 ? (
          <Box flex flexDirection="column" style={{ gap: 2 }}>
            {sfQ.data.storefronts.map((sf) => (
              <Box
                key={sf.slug}
                flex
                alignItems="center"
                justifyContent="space-between"
                py={2}
                style={{ borderBottom: '1px solid var(--neutral-100)' }}
              >
                <Box>
                  <Text size="small" bold>
                    {sf.title ?? sf.slug}
                  </Text>
                  <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
                    {sf.orders} đơn · DS {formatVnd(sf.revenue)}
                  </Text>
                </Box>
                <Text size="small" bold style={{ color: 'var(--leaf-700)' }}>
                  +{formatVnd(sf.commission)}
                </Text>
              </Box>
            ))}
          </Box>
        ) : sfQ.isLoading ? (
          <Text size="small" style={{ color: 'var(--neutral-400)' }}>Đang tải…</Text>
        ) : (
          <Text size="small" style={{ color: 'var(--neutral-400)' }}>
            Chưa có đơn từ gian hàng nào. Chia sẻ link gian hàng để nhận hoa hồng.
          </Text>
        )}
      </Section>

      {/* Hoa hồng theo sản phẩm */}
      <Section title="Theo sản phẩm">
        {pbQ.isError ? (
          <ErrorState message={getErrorMessage(pbQ.error)} onRetry={() => void pbQ.refetch()} />
        ) : pbQ.data && pbQ.data.length > 0 ? (
          <Box flex flexDirection="column" style={{ gap: 2 }}>
            {pbQ.data.slice(0, 10).map((p, i) => (
              <Box
                key={i}
                flex
                alignItems="center"
                justifyContent="space-between"
                py={2}
                style={{ borderBottom: '1px solid var(--neutral-100)' }}
              >
                <Box>
                  <Text size="small" bold>
                    {p.productName}
                  </Text>
                  <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
                    {p.orders} đơn
                  </Text>
                </Box>
                <Text size="small" bold style={{ color: 'var(--leaf-700)' }}>
                  +{formatVnd(p.commission)}
                </Text>
              </Box>
            ))}
          </Box>
        ) : pbQ.isLoading ? (
          <Text size="small" style={{ color: 'var(--neutral-400)' }}>Đang tải…</Text>
        ) : (
          <Text size="small" style={{ color: 'var(--neutral-400)' }}>
            Chưa có hoa hồng theo sản phẩm. Chia sẻ link sản phẩm để bắt đầu.
          </Text>
        )}
      </Section>

      <Box style={{ height: 24 }} />

      <Sheet visible={withdrawing} onClose={() => setWithdrawing(false)} autoHeight>
        {/* Mount khi mở để form lấy ĐÚNG max hiện tại (tránh kẹt amount="0" nếu data về sau lần mount đầu). */}
        {withdrawing && (
          <WithdrawForm
            max={d?.withdrawableCommission ?? 0}
            onDone={() => {
              setWithdrawing(false);
              void qc.invalidateQueries({ queryKey: ['affiliate-dashboard'] });
              void qc.invalidateQueries({ queryKey: ['affiliate-commissions'] });
            }}
          />
        )}
      </Sheet>

      <Sheet visible={ctvOrdering} onClose={() => setCtvOrdering(false)} autoHeight>
        {/* Mount khi mở để reset state form mỗi lần lên đơn mới. */}
        {ctvOrdering && <CtvOrderSheet onClose={() => setCtvOrdering(false)} />}
      </Sheet>
    </Page>
  );
}

function WithdrawForm({ max, onDone }: { max: number; onDone: () => void }) {
  const { openSnackbar } = useSnackbar();
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
  const valid = amountNum > 0 && amountNum <= max && (method !== 'BANK' || amountNum >= 50_000) && bankValid;

  return (
    <Box p={4} style={{ paddingBottom: 'calc(16px + var(--safe-bottom))' }}>
      <Text bold size="large" style={{ marginBottom: 16 }}>
        Rút hoa hồng
      </Text>

      <Box flex style={{ gap: 8, marginBottom: 12 }}>
        <MethodChip
          active={method === 'WALLET_BALANCE'}
          title="Ví Tubu ×1.5"
          sub="Nhận ngay, mua sắm"
          onClick={() => setMethod('WALLET_BALANCE')}
        />
        <MethodChip
          active={method === 'BANK'}
          title="Ngân hàng"
          sub="Tối thiểu 50k"
          onClick={() => setMethod('BANK')}
        />
      </Box>

      <Input
        label="Số tiền"
        type="number"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 4 }}>
        Tối đa {formatVnd(max)}
      </Text>

      {method === 'BANK' && (
        <Box flex flexDirection="column" style={{ gap: 10, marginTop: 12 }}>
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
        </Box>
      )}

      <Button
        fullWidth
        loading={mut.isPending}
        disabled={!valid}
        onClick={() => mut.mutate()}
        style={{ marginTop: 20, background: 'var(--primary-600)' }}
      >
        {method === 'WALLET_BALANCE'
          ? `Nhận ${formatVnd(Math.round(amountNum * 1.5))} vào Ví`
          : `Rút ${formatVnd(amountNum)}`}
      </Button>
    </Box>
  );
}

function MethodChip({
  active,
  title,
  sub,
  onClick,
}: {
  active: boolean;
  title: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <Box
      className="tubu-press"
      onClick={onClick}
      p={3}
      style={{
        flex: 1,
        borderRadius: 'var(--radius-md)',
        border: `1.5px solid ${active ? 'var(--primary-600)' : 'var(--neutral-200)'}`,
        background: active ? 'var(--primary-50)' : 'var(--neutral-0)',
      }}
    >
      <Text size="small" bold style={{ color: active ? 'var(--primary-700)' : 'var(--neutral-900)' }}>
        {title}
      </Text>
      <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
        {sub}
      </Text>
    </Box>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Text bold style={{ color: '#fff' }}>
        {value}
      </Text>
      <Text size="xSmall" style={{ color: 'rgba(255,255,255,0.8)' }}>
        {label}
      </Text>
    </Box>
  );
}

function KpiCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <Box
      p={3}
      style={{
        flex: 1,
        background: highlight ? 'var(--leaf-50)' : 'var(--neutral-0)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-xs)',
      }}
    >
      <Text bold style={{ color: highlight ? 'var(--leaf-700)' : 'var(--neutral-900)' }}>
        {value}
      </Text>
      <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
        {label}
      </Text>
    </Box>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Box mx={4} mb={3} p={4} style={{ background: 'var(--neutral-0)', borderRadius: 'var(--radius-lg)' }}>
      <Box flex alignItems="center" justifyContent="space-between" mb={3}>
        <Text bold>{title}</Text>
        {action}
      </Box>
      {children}
    </Box>
  );
}
