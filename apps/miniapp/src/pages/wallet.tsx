import { useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Page, Input, useSnackbar } from 'zmp-ui';
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRightLeft, CheckCircle2, ChevronRight, Clock, Coins, Gift, History, Landmark, Leaf, ShoppingBag, Sprout, type LucideIcon } from 'lucide-react';
import { getWallet, getWalletTransactions, withdraw, getCoins, convertToXu, getLoyalty, type BankInfo } from '../services/account-api';
import { getErrorMessage } from '../services/api';
import { shareLink } from '../services/zmp-bridge';
import { useAuthStore } from '../store/auth';
import { newIdempotencyKey } from '../utils/idempotency';
import { canWithdraw as canWithdrawRule, canConvertToXu, walletTxLabel, formatWalletTxTime } from '../utils/wallet-rules';
import { formatVnd, formatPoints, formatXu } from '../utils/format';
import { Badge } from '../components/ui/badge';
import { BottomSheet } from '../components/ui/bottom-sheet';
import { Button } from '../components/ui/button';
import { ErrorState } from '../components/ui/empty-state';
import { Field } from '../components/ui/form';
import { Icon } from '../components/ui/icon';
import { PageHeader } from '../components/ui/page-header';
import { rowKeyboardProps } from '../components/ui/row-keyboard';
import { Skeleton } from '../components/ui/skeleton';
import { Text } from '../components/ui/text';
import { vi } from '../i18n/vi';

const CARD: CSSProperties = {
  background: 'var(--color-bg-surface)',
  borderRadius: 'var(--radius-card)',
  boxShadow: 'var(--elevation-1)',
};

// Chú thích dưới thẻ: lùi 4px cho thẳng mép chữ trong thẻ (thẻ bo góc làm chữ nhìn như lệch trái).
const CAPTION_BELOW: CSSProperties = { marginTop: 6, paddingLeft: 4 };

export default function WalletPage() {
  const { openSnackbar } = useSnackbar();
  const navigate = useNavigate();
  const qc = useQueryClient();
  // enabled theo trạng thái auth: nếu fetch trước khi restore() xong → 401 → (retry:false) kẹt
  // error vĩnh viễn dù login thành công ~200ms sau → màn Ví "trắng". Chờ authenticated rồi mới fetch.
  const authed = useAuthStore((s) => s.status === 'authenticated');
  const walletQ = useQuery({ queryKey: ['wallet'], queryFn: getWallet, enabled: authed });
  const coinsQ = useQuery({ queryKey: ['coins'], queryFn: getCoins, enabled: authed });
  const loyaltyQ = useQuery({ queryKey: ['loyalty'], queryFn: getLoyalty, enabled: authed });

  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [convertAmount, setConvertAmount] = useState('');
  const [bank, setBank] = useState<BankInfo>({ bankName: '', accountNumber: '', accountName: '' });

  const refreshAll = () => {
    void qc.invalidateQueries({ queryKey: ['wallet'] });
    void qc.invalidateQueries({ queryKey: ['coins'] });
  };

  // Idempotency-Key giữ nguyên qua các lần retry của CÙNG 1 lệnh rút (double-tap/timeout) →
  // BE không trừ ví/ tạo payout 2 lần; regenerate sau khi rút thành công (lệnh sau là lệnh mới).
  const withdrawKey = useRef(newIdempotencyKey());
  const withdrawMut = useMutation({
    mutationFn: () => withdraw(Number(amount), bank, withdrawKey.current),
    onSuccess: (r) => {
      openSnackbar({ text: `Đã gửi yêu cầu rút. Thực nhận ${formatVnd(r.net)} trong 1-3 ngày làm việc.`, type: 'success' });
      withdrawKey.current = newIdempotencyKey();
      setWithdrawOpen(false);
      setAmount('');
      refreshAll();
    },
    // Lỗi (kể cả server đã tạo giao dịch thật, hoặc BE báo key đã dùng với số tiền khác) →
    // regenerate key TRƯỚC khi cho phép bấm lại, để lần thử tiếp theo (số tiền có thể đã sửa)
    // dùng key MỚI thay vì lặp lại đúng lệnh cũ (mirror convertMut bên dưới).
    onError: (e) => {
      withdrawKey.current = newIdempotencyKey();
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
    },
  });

  // Cung ly do voi withdrawKey: giu nguyen key qua cac lan retry cua CUNG 1 lenh doi,
  // regenerate sau khi doi thanh cong (lenh sau la lenh moi).
  const convertKey = useRef(newIdempotencyKey());
  const convertMut = useMutation({
    mutationFn: () => convertToXu(Number(convertAmount), convertKey.current),
    onSuccess: (r) => {
      openSnackbar({ text: `Đã đổi ${formatVnd(r.spent)} → ${formatXu(r.received)} 🎉`, type: 'success' });
      convertKey.current = newIdempotencyKey();
      setConvertOpen(false);
      setConvertAmount('');
      refreshAll();
    },
    // Lỗi mạng/timeout: server CÓ THỂ đã tạo giao dịch thật dù FE nhận lỗi. Nếu user sửa số tiền
    // rồi bấm lại mà vẫn dùng key CŨ, BE sẽ coi là replay của lệnh trước (idempotency) → trả/ghép
    // sai số tiền. Regenerate key ngay khi lỗi để lần bấm tiếp theo luôn là lệnh MỚI.
    onError: (e) => {
      convertKey.current = newIdempotencyKey();
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
    },
  });

  const w = walletQ.data;
  const coins = coinsQ.data;
  const loyalty = loyaltyQ.data;
  const amountNum = Number(amount) || 0;
  const convertNum = Number(convertAmount) || 0;
  const fee = w?.withdrawFee ?? 3000;
  const min = w?.withdrawMin ?? 100000;
  const multiplier = w?.xuConvertMultiplier ?? 1.2;

  const canWithdraw = canWithdrawRule(amountNum, w, min, bank);
  const canConvert = canConvertToXu(convertNum, w);

  const shareReferral = async () => {
    if (!coins) return;
    try {
      await shareLink({
        title: 'Tubu Tree — Trồng cây, nhận quà 🌳',
        description: `Dùng mã ${coins.referralCode} vào Tubu Tree, cả hai cùng nhận TubuXu khi bạn hoàn tiền đơn đầu!`,
        path: `/?ref=${coins.referralCode}`,
      });
    } catch {
      openSnackbar({ text: `Mã giới thiệu của bạn: ${coins.referralCode}`, type: 'info' });
    }
  };

  const balance = w?.walletBalance ?? 0;

  return (
    <Page style={{ background: 'var(--color-bg-canvas)' }}>
      <PageHeader title={vi.profile.wallet} />
      {!authed || walletQ.isLoading ? (
        <div style={{ padding: 16, gap: 12, display: 'flex', flexDirection: 'column' }}>
          <Skeleton height={140} radius="var(--radius-card)" />
          <Skeleton height={110} radius="var(--radius-card)" />
          <Skeleton height={90} radius="var(--radius-card)" />
        </div>
      ) : walletQ.isError ? (
        <div style={{ padding: 24 }}>
          <ErrorState message={getErrorMessage(walletQ.error)} onRetry={() => void walletQ.refetch()} />
        </div>
      ) : w ? (
        <>
          {/* Ví Tubu (tiền thật) */}
          <div style={{ padding: '16px 16px 8px' }}>
            <div
              style={{
                padding: 20,
                background: 'linear-gradient(135deg, var(--forest-600), var(--forest-700))',
                borderRadius: 'var(--radius-card)',
                boxShadow: 'var(--elevation-2)',
              }}
            >
              <Text variant="body-sm" tone="inverse" as="div">
                Ví Tubu (số dư khả dụng)
              </Text>
              <Text
                variant="price-xl"
                tone="inverse"
                as="div"
                style={{ fontSize: 'var(--type-display-lg-size)', lineHeight: 'var(--type-display-lg-lh)', marginTop: 4 }}
              >
                {formatVnd(w.walletBalance)}
              </Text>
              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <Button variant="secondary" icon={ArrowRightLeft} style={{ flex: 1, padding: '0 8px' }} onPress={() => setConvertOpen(true)}>
                  Đổi TubuXu
                </Button>
                <Button
                  variant="secondary"
                  icon={Landmark}
                  style={{ flex: 1, padding: '0 8px' }}
                  onPress={() => {
                    // Mỗi lần MỞ Sheet = 1 lệnh rút mới → key mới (double-tap trong cùng phiên giữ
                    // nguyên key = idempotent; mở lại với số khác = key khác, không bị BE trả payout cũ).
                    withdrawKey.current = newIdempotencyKey();
                    setWithdrawOpen(true);
                  }}
                >
                  Rút ngân hàng
                </Button>
              </div>
            </div>
            <Text variant="caption" tone="tertiary" as="div" style={CAPTION_BELOW}>
              Tiền thật từ hoa hồng &amp; hoàn tiền sàn ngoài — rút về ngân hàng hoặc đổi sang TubuXu (×{multiplier}).
            </Text>
          </div>

          {/* TubuXu */}
          <div style={{ padding: '0 16px 8px' }}>
            <div
              style={{
                padding: 16,
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                background: 'linear-gradient(135deg, var(--clay-500), var(--clay-700))',
                borderRadius: 'var(--radius-card)',
                boxShadow: 'var(--elevation-1)',
              }}
            >
              <IconBubble solid>
                <Icon icon={Coins} size="lg" tone="inverse" />
              </IconBubble>
              <div style={{ flex: 1 }}>
                <Text variant="body-sm" tone="inverse" as="div">
                  TubuXu (tiêu trong app)
                </Text>
                <Text variant="price-xl" tone="inverse" as="div">
                  {formatXu(coins?.coinsBalance ?? w.coinsBalance)}
                </Text>
              </div>
            </div>
            <Text variant="caption" tone="tertiary" as="div" style={CAPTION_BELOW}>
              Dùng để mua hàng, mua nước 💧 và mua cây 🌳 trong app. Không rút được.
            </Text>
          </div>

          {/* Điểm Xanh (đổi giảm giá) */}
          <div style={{ padding: '0 16px 8px' }}>
            <div
              role="button"
              {...rowKeyboardProps()}
              className="tubu-press"
              onClick={() => navigate('/loyalty')}
              style={{ ...CARD, padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}
            >
              <IconBubble>
                <Icon icon={Leaf} size="md" tone="brand" />
              </IconBubble>
              <div style={{ flex: 1 }}>
                <Text variant="body-sm" tone="tertiary" as="div">
                  Điểm Xanh (đổi giảm giá)
                </Text>
                <Text variant="price-xl" as="div">
                  {formatPoints(loyalty?.pointsBalance ?? 0)}
                </Text>
              </div>
              {loyalty?.tier && (
                <Badge tone="brand" style={{ flex: '0 0 auto' }}>
                  {loyalty.tier.name}
                </Badge>
              )}
              <Icon icon={ChevronRight} size="sm" tone="muted" style={{ flex: '0 0 auto' }} />
            </div>
            <Text variant="caption" tone="tertiary" as="div" style={CAPTION_BELOW}>
              Tích từ mỗi đơn đã giao — đổi giảm giá cho đơn sau &amp; lên hạng thành viên.
            </Text>
          </div>

          {/* Giới thiệu bạn bè */}
          {coins && (
            <div style={{ padding: '0 16px 8px' }}>
              <div style={{ ...CARD, padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <Icon icon={Gift} size="md" tone="brand" />
                  <Text variant="body-lg" style={{ fontWeight: 600 }}>Mời bạn — cả hai nhận TubuXu</Text>
                </div>
                <Text variant="caption" tone="secondary" as="div">
                  Bạn bè vào app bằng mã của bạn và hoàn tiền đơn đầu tiên → cả hai cùng được thưởng xu.
                </Text>
                <div style={{ display: 'flex', gap: 16, marginTop: 12, marginBottom: 12 }}>
                  <div>
                    <Text variant="price-lg" tone="brand" as="div">{coins.referralSuccessCount}</Text>
                    <Text variant="caption" tone="tertiary" as="div">bạn thành công</Text>
                  </div>
                  <div>
                    <Text variant="price-lg" as="div" style={{ color: 'var(--color-promo-fg)' }}>{formatXu(coins.referralEarned)}</Text>
                    <Text variant="caption" tone="tertiary" as="div">đã nhận từ giới thiệu</Text>
                  </div>
                </div>
                {coins.nextMilestone && (
                  <Text variant="caption" tone="brand" as="div" style={{ marginBottom: 12 }}>
                    {vi.wallet.referralMilestoneProgress(
                      coins.nextMilestone.count - coins.referralSuccessCount,
                      formatXu(coins.nextMilestone.bonus),
                    )}
                  </Text>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div
                    style={{
                      flex: 1,
                      minHeight: 44,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'var(--color-bg-subtle)',
                      borderRadius: 'var(--radius-control)',
                    }}
                  >
                    <Text variant="body-lg" style={{ fontWeight: 600, letterSpacing: 1.5 }}>{coins.referralCode}</Text>
                  </div>
                  <Button onPress={() => void shareReferral()}>Chia sẻ</Button>
                </div>
              </div>
            </div>
          )}

          {/* Nguồn tiền chờ */}
          <div style={{ margin: '0 16px 12px', display: 'flex', gap: 10 }}>
            <SourceCard label="Hoa hồng chờ duyệt" value={w.commissionPending} Icon={Clock} />
            {/* Hoa hồng APPROVED KHÔNG tự vào Ví — phải bấm "Nhận về ví" ở trang Cộng tác viên.
                Trước đây thẻ này chỉ để đọc, nên CTV thấy "có thể rút 520.000đ" ngay cạnh
                "Ví: 0đ", bấm Rút thì bị báo chưa đủ mốc, và không có chỉ dẫn nào. */}
            <SourceCard
              label="Hoa hồng có thể rút"
              value={w.commissionApproved}
              Icon={CheckCircle2}
              hint={w.commissionApproved > 0 ? 'Nhận về Ví →' : undefined}
              onClick={w.commissionApproved > 0 ? () => navigate('/affiliate') : undefined}
            />
          </div>
          <div style={{ margin: '0 16px 12px', display: 'flex' }}>
            {/* Cùng lý do với màn Hoàn tiền: đây là khoản sàn ĐÃ duyệt, đang chờ về Ví —
                không phải đơn đang chờ sàn duyệt. */}
            <SourceCard label="Hoàn tiền đã duyệt, chờ về Ví" value={w.cashbackPending} Icon={ShoppingBag} wide />
          </div>

          <div
            style={{
              margin: '0 16px 16px',
              padding: 16,
              display: 'flex',
              gap: 8,
              background: 'var(--color-promo-bg)',
              borderRadius: 'var(--radius-card)',
            }}
          >
            <Icon icon={Coins} size="md" style={{ flex: '0 0 auto', color: 'var(--color-promo-fg)' }} />
            <Text variant="caption" as="div" style={{ color: 'var(--color-promo-fg)' }}>
              Mẹo: đổi tiền Ví sang <b>TubuXu (×{multiplier})</b> để được thêm{' '}
              {Math.round((multiplier - 1) * 100)}% giá trị mua sắm — và <b>miễn phí</b>, thay vì rút về
              ngân hàng (phí chuyển khoản {formatVnd(fee)}/lần).
            </Text>
          </div>

          <WalletHistory enabled={authed} />
        </>
      ) : null}

      {/* Sheet đổi Ví → TubuXu */}
      <BottomSheet
        open={convertOpen}
        onClose={() => {
          setConvertOpen(false);
          setConvertAmount('');
        }}
        title="Đổi Ví → TubuXu"
        description={`Nhận thêm ${Math.round((multiplier - 1) * 100)}% giá trị quy đổi — hoàn toàn miễn phí.`}
        footer={
          <Button fullWidth disabled={!canConvert || convertMut.isPending} onPress={() => convertMut.mutate()}>
            {convertMut.isPending ? 'Đang đổi...' : 'Đổi ngay'}
          </Button>
        }
      >
        {balance <= 0 && (
          <Notice icon={Sprout}>
            Bạn chưa có số dư khả dụng trong Ví Tubu (0đ). Hãy tích lũy hoa hồng từ Đơn hàng/CTV hoặc Hoàn tiền sàn ngoài để đổi sang TubuXu (×{multiplier})!
          </Notice>
        )}

        <Field label={`Số tiền muốn đổi (Khả dụng: ${formatVnd(balance)})`}>
          <Input
            type="number"
            placeholder="VD: 100.000"
            value={convertAmount}
            disabled={balance <= 0}
            onChange={(e) => setConvertAmount(e.target.value)}
          />
        </Field>
        {convertNum > 0 && (
          <div style={{ marginTop: 8, padding: 12, background: 'var(--color-promo-bg)', borderRadius: 'var(--radius-control)' }}>
            <Text variant="body-sm" as="div" style={{ color: 'var(--color-promo-fg)' }}>
              Nhận ≈ <b>{formatXu(Math.floor(convertNum * multiplier))}</b>
            </Text>
          </div>
        )}
      </BottomSheet>

      {/* Sheet rút tiền */}
      <BottomSheet
        open={withdrawOpen}
        onClose={() => {
          setWithdrawOpen(false);
          setAmount('');
        }}
        title="Rút tiền về ngân hàng"
        description={`Khả dụng: ${formatVnd(balance)} • Tối thiểu: ${formatVnd(min)}`}
        footer={
          <Button fullWidth disabled={!canWithdraw || withdrawMut.isPending} onPress={() => withdrawMut.mutate()}>
            {withdrawMut.isPending ? 'Đang gửi...' : `Rút ${amountNum > 0 ? formatVnd(amountNum) : ''}`}
          </Button>
        }
      >
        {balance < min && (
          <Notice icon={AlertTriangle}>
            Số dư Ví Tubu của bạn ({formatVnd(balance)}) chưa đủ mốc tối thiểu {formatVnd(min)} để rút về ngân hàng.
          </Notice>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Số tiền rút">
            <Input
              type="number"
              placeholder={`Tối thiểu ${formatVnd(min)}`}
              value={amount}
              disabled={balance < min}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field label="Tên ngân hàng">
            <Input placeholder="VD: Techcombank" value={bank.bankName} disabled={balance < min} onChange={(e) => setBank((b) => ({ ...b, bankName: e.target.value }))} />
          </Field>
          <Field label="Số tài khoản">
            <Input value={bank.accountNumber} disabled={balance < min} onChange={(e) => setBank((b) => ({ ...b, accountNumber: e.target.value }))} />
          </Field>
          <Field label="Chủ tài khoản">
            <Input placeholder="Tên in trên thẻ" value={bank.accountName} disabled={balance < min} onChange={(e) => setBank((b) => ({ ...b, accountName: e.target.value }))} />
          </Field>
        </div>
        {amountNum >= min && (
          <div style={{ marginTop: 8, padding: 12, background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-control)' }}>
            <Text variant="caption" tone="secondary" as="div">
              Phí chuyển khoản ngân hàng: {formatVnd(fee)} • Thực nhận: <b>{formatVnd(Math.max(0, amountNum - fee))}</b>
            </Text>
          </div>
        )}
      </BottomSheet>
    </Page>
  );
}

/** Ô tròn chứa biểu tượng ở đầu thẻ số dư; `solid` dùng trên nền thẻ màu (đất sét), mặc định trên thẻ trắng. */
function IconBubble({ children, solid }: { children: ReactNode; solid?: boolean }) {
  return (
    <div
      style={{
        width: 44,
        height: 44,
        borderRadius: '50%',
        background: solid ? 'var(--color-promo-solid-bg)' : 'var(--color-bg-subtle)',
        display: 'grid',
        placeItems: 'center',
        flex: '0 0 auto',
      }}
    >
      {children}
    </div>
  );
}

/** Khung cảnh báo trong sheet — biểu tượng + chữ cùng màu khuyến mãi/đất sét, thay emoji ⚠️ 🌱 cũ. */
function Notice({ icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <div
      style={{
        marginBottom: 12,
        padding: 12,
        display: 'flex',
        gap: 8,
        alignItems: 'flex-start',
        background: 'var(--color-promo-bg)',
        borderRadius: 'var(--radius-control)',
        border: '1px solid var(--clay-100)',
      }}
    >
      <Icon icon={icon} size="sm" style={{ flex: '0 0 auto', marginTop: 2, color: 'var(--color-promo-fg)' }} />
      <Text variant="caption" as="div" style={{ color: 'var(--color-promo-fg)' }}>
        {children}
      </Text>
    </div>
  );
}

/** Sao kê Ví Tubu từ sổ cái: mỗi biến động một dòng kèm số dư sau giao dịch. */
function WalletHistory({ enabled }: { enabled: boolean }) {
  // Khoá con của ['wallet'] → refreshAll() sau rút/đổi xu làm mới luôn sao kê.
  const q = useInfiniteQuery({
    queryKey: ['wallet', 'transactions'],
    queryFn: ({ pageParam }) => getWalletTransactions(pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.meta.page * last.meta.limit < last.meta.total ? last.meta.page + 1 : undefined),
    enabled,
  });
  const rows = q.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <div style={{ ...CARD, margin: '0 16px 24px', padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Icon icon={History} size="md" tone="brand" />
        <Text variant="body-lg" style={{ fontWeight: 600 }}>Lịch sử Ví</Text>
      </div>
      {q.isLoading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          <Skeleton height={44} />
          <Skeleton height={44} />
        </div>
      ) : q.isError ? (
        <ErrorState message={getErrorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 4 }}>
          Chưa có biến động nào trong Ví.
        </Text>
      ) : (
        <>
          {rows.map((t) => (
            <div
              key={t.id}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: '1px solid var(--color-border-subtle)' }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text variant="body-sm" as="div">{walletTxLabel(t.type)}</Text>
                <Text variant="caption" tone="tertiary" as="div">
                  {formatWalletTxTime(t.createdAt)}
                  {t.reason ? ` · ${t.reason}` : ''}
                </Text>
              </div>
              <div style={{ textAlign: 'right', flex: '0 0 auto' }}>
                <Text variant="price-sm" tone={t.delta > 0 ? 'success' : 'primary'} as="div">
                  {t.delta > 0 ? '+' : '−'}
                  {formatVnd(Math.abs(t.delta))}
                </Text>
                <Text variant="caption" tone="tertiary" as="div">Số dư {formatVnd(t.balanceAfter)}</Text>
              </div>
            </div>
          ))}
          {q.hasNextPage && (
            <Button
              fullWidth
              variant="ghost"
              loading={q.isFetchingNextPage}
              onPress={() => void q.fetchNextPage()}
              style={{ marginTop: 8 }}
            >
              Xem thêm
            </Button>
          )}
        </>
      )}
    </div>
  );
}

function SourceCard({
  label,
  value,
  Icon: SourceIcon,
  wide,
  hint,
  onClick,
}: {
  label: string;
  value: number;
  Icon: LucideIcon;
  wide?: boolean;
  /** Dòng phụ giải thích tiền này ở đâu / cần làm gì để lấy về. */
  hint?: string;
  onClick?: () => void;
}) {
  return (
    <div
      role={onClick ? 'button' : undefined}
      {...(onClick ? rowKeyboardProps() : null)}
      className={onClick ? 'tubu-press' : undefined}
      onClick={onClick}
      style={{ ...CARD, flex: 1, minWidth: 0, padding: 12 }}
    >
      <div
        style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--color-bg-subtle)', display: 'grid', placeItems: 'center' }}
      >
        <Icon icon={SourceIcon} size="sm" tone="brand" />
      </div>
      <Text variant={wide ? 'price-md' : 'price-sm'} as="div" style={{ marginTop: 4 }}>
        {formatVnd(value)}
      </Text>
      <Text variant="caption" tone="tertiary" as="div">
        {label}
      </Text>
      {hint && (
        <Text variant="caption" tone="brand" as="div" style={{ marginTop: 4, fontWeight: 600 }}>
          {hint}
        </Text>
      )}
    </div>
  );
}
