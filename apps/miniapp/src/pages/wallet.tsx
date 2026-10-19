import { useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Page, Input, useSnackbar } from 'zmp-ui';
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ChevronRight, Clock, Gift, History, Landmark, Leaf, ShoppingBag, Wallet, type LucideIcon } from 'lucide-react';
import { getWallet, getWalletTransactions, withdraw, getReferral, getLoyalty, type BankInfo } from '../services/account-api';
import { getErrorMessage, isOutcomeUnknown } from '../services/api';
import { useShareWithFallback } from '../components/share-sheet';
import { WEB_BASE_URL } from '../utils/web-base-url';
import { useAuthStore } from '../store/auth';
import { AuthPhaseView } from '../components/ui/auth-gate';
import { useAuthPhase } from '../hooks/use-auth-phase';
import { newIdempotencyKey } from '../utils/idempotency';
import { canWithdraw as canWithdrawRule, walletTxLabel, formatWalletTxTime } from '../utils/wallet-rules';
import { formatVnd, formatPoints } from '../utils/format';
import { uniqueById } from '../utils/unique-by-id';
import { convertedPointsNote, pointsSummary } from '../utils/points-lots';
import { CASHBACK_ENABLED } from '../utils/features';
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
  const shareWithFallback = useShareWithFallback();
  const navigate = useNavigate();
  const qc = useQueryClient();
  // enabled theo trạng thái auth: nếu fetch trước khi restore() xong → 401 → (retry:false) kẹt
  // error vĩnh viễn dù login thành công ~200ms sau → màn Ví "trắng". Chờ authenticated rồi mới fetch.
  const phase = useAuthPhase();
  const authed = phase === 'authenticated';
  // CTV chỉ hưởng hoa hồng; API không bao giờ thưởng Điểm Xanh giới thiệu cho role này.
  const isAffiliate = useAuthStore((s) => s.user?.role === 'AFFILIATE');
  const isCommissionRole = useAuthStore((s) => s.user?.role === 'AFFILIATE' || s.user?.role === 'DEALER');
  const walletQ = useQuery({ queryKey: ['wallet'], queryFn: getWallet, enabled: authed });
  // Thống kê giới thiệu là phần phụ: lỗi chỉ làm ẩn khối mời bạn, không chặn cả màn Ví.
  const referralQ = useQuery({ queryKey: ['referral'], queryFn: getReferral, enabled: authed });
  const loyaltyQ = useQuery({ queryKey: ['loyalty'], queryFn: getLoyalty, enabled: authed });

  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [bank, setBank] = useState<BankInfo>({ bankName: '', accountNumber: '', accountName: '' });

  const refreshAll = () => {
    void qc.invalidateQueries({ queryKey: ['wallet'] });
  };

  // Idempotency-Key giữ nguyên qua các lần retry của CÙNG 1 lệnh rút (double-tap/timeout) →
  // BE không trừ ví/ tạo payout 2 lần; regenerate sau khi rút thành công (lệnh sau là lệnh mới).
  const withdrawKey = useRef(newIdempotencyKey());
  // Có một lệnh rút chưa rõ kết quả: mở lại sheet vẫn dùng key đó cho tới khi máy chủ trả lời dứt khoát.
  const withdrawUnresolved = useRef(false);
  const withdrawMut = useMutation({
    mutationFn: () => withdraw(Number(amount), bank, withdrawKey.current),
    onSuccess: (r) => {
      openSnackbar({ text: `Đã gửi yêu cầu rút. Thực nhận ${formatVnd(r.net)} trong 1-3 ngày làm việc.`, type: 'success' });
      withdrawKey.current = newIdempotencyKey();
      withdrawUnresolved.current = false;
      setWithdrawOpen(false);
      setAmount('');
      refreshAll();
    },
    // Quá thời gian/mất mạng/5xx: máy chủ có thể đã trừ ví và tạo lệnh rút. GIỮ key để bấm lại trả đúng lệnh đó thay vì rút thêm
    // lần nữa; chỉ đổi key khi máy chủ đã từ chối rõ ràng (4xx, kể cả "key đã dùng với số tiền khác") nên không có gì được ghi.
    onError: (e) => {
      if (isOutcomeUnknown(e)) {
        withdrawUnresolved.current = true;
        refreshAll();
        openSnackbar({ text: vi.wallet.withdrawUnknown, type: 'error' });
        return;
      }
      withdrawKey.current = newIdempotencyKey();
      withdrawUnresolved.current = false;
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
    },
  });

  const w = walletQ.data;
  const referral = referralQ.data;
  const loyalty = loyaltyQ.data;
  const amountNum = Number(amount) || 0;
  const fee = w?.withdrawFee ?? 3000;
  const min = w?.withdrawMin ?? 100000;

  const canWithdraw = canWithdrawRule(amountNum, w, min, bank);

  const shareReferral = () => {
    if (!referral) return;
    void shareWithFallback(
      {
        title: 'Tubu Tree — Trồng cây, nhận quà 🌳',
        description: `Dùng mã ${referral.referralCode} khi mua hàng ở Tubu Tree nhé!`,
        path: `/?ref=${referral.referralCode}`,
      },
      `Dùng mã ${referral.referralCode} khi mua hàng ở Tubu Tree nhé: ${WEB_BASE_URL}/?ref=${referral.referralCode}`,
    );
  };

  // Khách thường không có hoa hồng: hai thẻ 0đ chỉ khiến tiền hoàn bị hiểu thành hoa hồng.
  // Vẫn hiện khi còn khoản hoa hồng thật dù role chưa khớp (tiền của khách không được giấu).
  const showCommission = isCommissionRole || (w?.commissionPending ?? 0) > 0 || (w?.commissionApproved ?? 0) > 0;
  const balance = w?.walletBalance ?? 0;
  const points = loyalty ? pointsSummary(loyalty) : null;
  const convertedNote = convertedPointsNote(points?.converted);

  const pageSkeleton = (
    <div style={{ padding: 16, gap: 12, display: 'flex', flexDirection: 'column' }}>
      <Skeleton height={140} radius="var(--radius-card)" />
      <Skeleton height={110} radius="var(--radius-card)" />
      <Skeleton height={90} radius="var(--radius-card)" />
    </div>
  );

  return (
    <Page style={{ background: 'var(--color-bg-canvas)' }}>
      <PageHeader title={vi.profile.wallet} />
      {phase !== 'authenticated' ? (
        <AuthPhaseView phase={phase} loading={pageSkeleton} />
      ) : walletQ.isLoading ? (
        pageSkeleton
      ) : walletQ.isError && !w ? (
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
                <Button
                  variant="secondary"
                  icon={Landmark}
                  fullWidth
                  onPress={() => {
                    // Mỗi lần MỞ Sheet = 1 lệnh rút mới → key mới (double-tap trong cùng phiên giữ
                    // nguyên key = idempotent; mở lại với số khác = key khác, không bị BE trả payout cũ). Trừ khi lệnh trước chưa rõ kết quả.
                    if (!withdrawUnresolved.current) withdrawKey.current = newIdempotencyKey();
                    setWithdrawOpen(true);
                  }}
                >
                  Rút ngân hàng
                </Button>
              </div>
            </div>
            <Text variant="caption" tone="tertiary" as="div" style={CAPTION_BELOW}>
              {showCommission
                ? `Tiền thật từ hoa hồng${CASHBACK_ENABLED ? ' & hoàn tiền sàn ngoài' : ''} — rút về ngân hàng hoặc trả đơn hàng.`
                : 'Số dư dùng để thanh toán đơn'}
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
                  {formatPoints(points?.total ?? 0)}
                </Text>
                {convertedNote && (
                  <Text variant="caption" tone="secondary" as="div">
                    {convertedNote}
                  </Text>
                )}
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
            {convertedNote && (
              <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 2, paddingLeft: 4 }}>
                Điểm không hết hạn dùng trả đơn hàng tới 100% giá trị hàng và góp quỹ trồng cây. Không rút ra tiền.
              </Text>
            )}
          </div>

          {/* Giới thiệu bạn bè */}
          {referral && !isAffiliate && (
            <div style={{ padding: '0 16px 8px' }}>
              <div style={{ ...CARD, padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <Icon icon={Gift} size="md" tone="brand" />
                  <Text variant="body-lg" style={{ fontWeight: 600 }}>Mời bạn — nhận Điểm Xanh</Text>
                </div>
                <Text variant="caption" tone="secondary" as="div">
                  {vi.wallet.referralPromise(referral.minOrderAmount ?? 200_000, referral.windowDays ?? 30)}
                </Text>
                <div style={{ display: 'flex', gap: 16, marginTop: 12, marginBottom: 12 }}>
                  <div>
                    <Text variant="price-lg" tone="brand" as="div">{referral.successCount}</Text>
                    <Text variant="caption" tone="tertiary" as="div">bạn thành công</Text>
                  </div>
                  <div>
                    <Text variant="price-lg" as="div" style={{ color: 'var(--color-promo-fg)' }}>{formatPoints(referral.earnedPoints)}</Text>
                    <Text variant="caption" tone="tertiary" as="div">đã nhận từ giới thiệu</Text>
                  </div>
                </div>
                {/* Đã đủ hoặc vượt mốc (successCount cập nhật trước nextMilestone): không còn "Mời thêm 0/-2 bạn". */}
                {referral.nextMilestone && referral.nextMilestone.count > referral.successCount && (
                  <Text variant="caption" tone="brand" as="div" style={{ marginBottom: 12 }}>
                    {vi.wallet.referralMilestoneProgress(
                      referral.nextMilestone.count - referral.successCount,
                      formatPoints(referral.nextMilestone.bonusPoints),
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
                    <Text variant="body-lg" style={{ fontWeight: 600, letterSpacing: 1.5 }}>{referral.referralCode}</Text>
                  </div>
                  <Button onPress={() => void shareReferral()}>Chia sẻ</Button>
                </div>
              </div>
            </div>
          )}

          {/* Nguồn tiền chờ */}
          {showCommission && (
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
          )}

          {/* Khoản đã duyệt còn chờ về Ví là tiền của khách nên vẫn hiện dù lối vào Hoàn tiền sàn ngoài đã ẩn. */}
          {(CASHBACK_ENABLED || w.cashbackPending > 0) && (
            <div style={{ margin: '0 16px 12px', display: 'flex' }}>
              {/* Cùng lý do với màn Hoàn tiền: đây là khoản sàn ĐÃ duyệt, đang chờ về Ví —
                  không phải đơn đang chờ sàn duyệt. */}
              <SourceCard label="Hoàn tiền đã duyệt, chờ về Ví" value={w.cashbackPending} Icon={ShoppingBag} wide />
            </div>
          )}

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
            <Icon icon={Wallet} size="md" style={{ flex: '0 0 auto', color: 'var(--color-promo-fg)' }} />
            <Text variant="caption" as="div" style={{ color: 'var(--color-promo-fg)' }}>
              Mẹo: dùng Ví Tubu để <b>trả đơn hàng</b> — <b>miễn phí</b>, thay vì rút về ngân hàng (phí chuyển
              khoản {formatVnd(fee)}/lần).
            </Text>
          </div>

          <WalletHistory enabled={authed} />
        </>
      ) : null}

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
            <Input placeholder="VD: Techcombank" maxLength={120} value={bank.bankName} disabled={balance < min} onChange={(e) => setBank((b) => ({ ...b, bankName: e.target.value }))} />
          </Field>
          <Field label="Số tài khoản">
            <Input inputMode="numeric" maxLength={24} value={bank.accountNumber} disabled={balance < min} onChange={(e) => setBank((b) => ({ ...b, accountNumber: e.target.value }))} />
          </Field>
          <Field label="Chủ tài khoản">
            <Input placeholder="Tên in trên thẻ" maxLength={120} value={bank.accountName} disabled={balance < min} onChange={(e) => setBank((b) => ({ ...b, accountName: e.target.value }))} />
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

/** Ô tròn chứa biểu tượng ở đầu thẻ số dư. */
function IconBubble({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        width: 44,
        height: 44,
        borderRadius: '50%',
        background: 'var(--color-bg-subtle)',
        display: 'grid',
        placeItems: 'center',
        flex: '0 0 auto',
      }}
    >
      {children}
    </div>
  );
}

/** Khung cảnh báo trong sheet — biểu tượng + chữ cùng màu khuyến mãi/đất sét, thay emoji ⚠️ cũ. */
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
  // Khoá con của ['wallet'] → refreshAll() sau khi rút tiền làm mới luôn sao kê.
  const q = useInfiniteQuery({
    queryKey: ['wallet', 'transactions'],
    queryFn: ({ pageParam }) => getWalletTransactions(pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.meta.page * last.meta.limit < last.meta.total ? last.meta.page + 1 : undefined),
    enabled,
  });
  const rows = uniqueById(q.data?.pages.flatMap((p) => p.data) ?? []);

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
                <Text variant="body-sm" as="div">{walletTxLabel(t.type, t.reason)}</Text>
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
