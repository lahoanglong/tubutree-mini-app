'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ChevronRight, Clock, Gift, History, Landmark, Leaf, ShoppingBag, Wallet, type LucideIcon } from 'lucide-react';
import { withdraw, type BankInfo } from '@tubutree/app-core/api/wallet';
import { loyaltyQuery, referralQuery } from '@tubutree/app-core/queries/loyalty';
import { walletQuery, walletTransactionsQuery } from '@tubutree/app-core/queries/wallet';
import { CASHBACK_ENABLED } from '@tubutree/app-core/features';
import { canWithdraw as canWithdrawRule, walletTxLabel } from '@tubutree/app-core/wallet-rules';
import { uniqueById } from '@tubutree/app-core/unique-by-id';
import { useAuth } from '@/lib/auth-context';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { platformBridge } from '@/lib/platform-bridge';
import { newIdempotencyKey } from '@/lib/idempotency-key';
import { formatCount, pointsSummary } from '@/lib/checkout-points';
import { formatDateTime } from '@/lib/format-date';
import { formatVnd } from '@/lib/format-vnd';
import { ui } from '@/lib/guest-ui';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { Badge } from '@/components/ui/badge';
import { ErrorState } from '@/components/ui/error-state';
import { Field } from '@/components/ui/field';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { LedgerShell, SignedAmount } from '../ledger-shell';

const TITLE = 'Ví Tubu';
const DEFAULT_FEE = 3000;
const DEFAULT_MIN = 100000;

const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Đã có lỗi xảy ra — Vui lòng thử lại');

const referralPromise = (minOrder: number, windowDays: number) =>
  `Bạn bè vào app bằng mã của bạn và có đơn thứ hai từ ${formatVnd(minOrder)} giao thành công trong ${windowDays} ngày kể từ đơn đầu → bạn nhận Điểm Xanh thưởng.`;

export default function WalletPage() {
  const phase = useAuthPhase();
  const authed = phase === 'authenticated';
  const qc = useQueryClient();
  const { user } = useAuth();
  // CTV chỉ hưởng hoa hồng; API không bao giờ thưởng Điểm Xanh giới thiệu cho role này.
  const isAffiliate = user?.role === 'AFFILIATE';
  const isCommissionRole = user?.role === 'AFFILIATE' || user?.role === 'DEALER';
  const walletQ = useQuery({ ...walletQuery(coreHttp), enabled: authed, refetchOnWindowFocus: true });
  // Thống kê giới thiệu và điểm là phần phụ: lỗi chỉ làm ẩn khối đó, không chặn cả màn Ví.
  const referralQ = useQuery({ ...referralQuery(coreHttp), enabled: authed });
  const loyaltyQ = useQuery({ ...loyaltyQuery(coreHttp), enabled: authed });

  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [bank, setBank] = useState<BankInfo>({ bankName: '', accountNumber: '', accountName: '' });
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  // Lỗi rút hiện ngay trong sheet: vùng status của trang nằm sau lớp phủ modal nên khách không thấy và đọc màn hình không đọc ra.
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [shareMsg, setShareMsg] = useState('');

  // Key giữ nguyên qua các lần bấm lại của CÙNG một lệnh rút (bấm đúp/timeout) để API không trừ ví hai lần;
  // đổi key khi mở sheet, sau khi rút xong và sau mỗi lỗi, để lệnh sau (có thể đã sửa số tiền) là lệnh mới.
  const withdrawKey = useRef(newIdempotencyKey());
  // `disabled={isPending}` chỉ có hiệu lực sau lần render kế: hai cú bấm trong cùng khung hình vẫn gọi mutate hai lần.
  const withdrawBusy = useRef(false);
  const withdrawMut = useMutation({
    mutationFn: () => withdraw(coreHttp, Number(amount), bank, withdrawKey.current),
    onSuccess: (r) => {
      setNotice({ text: `Đã gửi yêu cầu rút. Thực nhận ${formatVnd(r.net)} trong 1-3 ngày làm việc.`, error: false });
      withdrawKey.current = newIdempotencyKey();
      setWithdrawOpen(false);
      setAmount('');
      void qc.invalidateQueries({ queryKey: walletQuery(coreHttp).queryKey });
    },
    onError: (e) => {
      withdrawKey.current = newIdempotencyKey();
      setWithdrawError(errText(e));
    },
    onSettled: () => {
      withdrawBusy.current = false;
    },
  });
  const submitWithdraw = () => {
    if (withdrawBusy.current) return;
    withdrawBusy.current = true;
    setNotice(null);
    setWithdrawError(null);
    withdrawMut.mutate();
  };

  const w = walletQ.data;
  const referral = referralQ.data;
  const loyalty = loyaltyQ.data;
  const amountNum = Number(amount) || 0;
  const fee = w?.withdrawFee ?? DEFAULT_FEE;
  const min = w?.withdrawMin ?? DEFAULT_MIN;
  const balance = w?.walletBalance ?? 0;
  const canWithdraw = canWithdrawRule(amountNum, w, min, bank);

  const shareReferral = async () => {
    if (!referral) return;
    setShareMsg('');
    const code = referral.referralCode;
    const result = await platformBridge.share({
      title: 'Tubu Tree — Trồng cây, nhận quà 🌳',
      text: `Dùng mã ${code} khi mua hàng ở Tubu Tree nhé!`,
      path: `/?ref=${code}`,
    });
    if (result === 'copied') setShareMsg('Đã chép liên kết giới thiệu');
    else if (result === 'failed') setShareMsg(`Chưa chia sẻ được. Bạn gửi mã ${code} cho bạn bè nhé.`);
  };

  if (phase === 'loading') {
    return (
      <LedgerShell title={TITLE} wide>
        <AuthLoading />
      </LedgerShell>
    );
  }
  if (phase === 'unavailable') {
    return (
      <LedgerShell title={TITLE} wide>
        <SessionUnavailable />
      </LedgerShell>
    );
  }
  if (phase === 'guest') {
    return (
      <LedgerShell title={TITLE} wide>
        <LoginRequired message="Đăng nhập để xem Ví Tubu của bạn." returnTo="/tai-khoan/vi-tubu" />
      </LedgerShell>
    );
  }
  if (walletQ.isLoading) {
    return (
      <LedgerShell title={TITLE} wide>
        <div className="space-y-3">
          <Skeleton height={140} />
          <Skeleton height={110} />
          <Skeleton height={90} />
        </div>
      </LedgerShell>
    );
  }
  if (!w) {
    return (
      <LedgerShell title={TITLE} wide>
        <ErrorState message={errText(walletQ.error)} onRetry={() => void walletQ.refetch()} />
      </LedgerShell>
    );
  }

  // Khách thường không có hoa hồng: hai thẻ 0đ chỉ khiến tiền hoàn bị hiểu thành hoa hồng.
  // Vẫn hiện khi còn khoản hoa hồng thật dù role chưa khớp (tiền của khách không được giấu).
  const showCommission = isCommissionRole || w.commissionPending > 0 || w.commissionApproved > 0;
  const points = loyalty ? pointsSummary(loyalty) : null;
  const tierName = (loyalty?.tier as { name?: string } | null | undefined)?.name;

  return (
    <LedgerShell title={TITLE} wide>
      <div role="status" aria-live="polite">
        {notice && <p className={`mb-3 text-sm ${notice.error ? 'text-danger-fg' : 'font-medium text-success-fg'}`}>{notice.text}</p>}
      </div>
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <div className="space-y-4">
          <section aria-label="Số dư Ví Tubu" className="rounded-card bg-gradient-to-br from-forest-600 to-forest-700 p-5 text-stone-0 shadow-card">
            <div className="text-sm">Ví Tubu (số dư khả dụng)</div>
            <div className="mt-1 text-3xl font-bold tabular-nums">{formatVnd(w.walletBalance)}</div>
            <button
              type="button"
              onClick={() => {
                // Mỗi lần MỞ sheet là một lệnh rút mới: mở lại với số khác thì key khác, không bị API trả lại lệnh cũ.
                withdrawKey.current = newIdempotencyKey();
                setNotice(null);
                setWithdrawError(null);
                setWithdrawOpen(true);
              }}
              className={`${ui.btnSecondary} mt-4 w-full gap-2`}
            >
              <Landmark className="h-4 w-4" aria-hidden="true" />
              Rút ngân hàng
            </button>
          </section>
          <p className="-mt-2 px-1 text-xs text-stone-600">
            {showCommission
              ? `Tiền thật từ hoa hồng${CASHBACK_ENABLED ? ' & hoàn tiền sàn ngoài' : ''} — rút về ngân hàng hoặc trả đơn hàng.`
              : 'Số dư dùng để thanh toán đơn'}
          </p>

          <div>
            <Link href="/tai-khoan/diem-xanh" className={`flex min-h-11 items-center gap-3 p-4 hover:bg-stone-50 ${ui.card}`}>
              <span className="grid h-11 w-11 flex-none place-items-center rounded-full bg-stone-100">
                <Leaf className="h-5 w-5 text-forest-600" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-stone-600">Điểm Xanh (đổi giảm giá)</span>
                <span className="block text-xl font-bold tabular-nums text-stone-900">{formatCount(points?.total ?? 0)} điểm</span>
                {points?.convertedNote && <span className="block text-xs text-stone-700">{points.convertedNote}</span>}
              </span>
              {tierName && <Badge tone="brand">{tierName}</Badge>}
              <ChevronRight className="h-4 w-4 flex-none text-stone-500" aria-hidden="true" />
            </Link>
            <p className="mt-1.5 px-1 text-xs text-stone-600">Tích từ mỗi đơn đã giao — đổi giảm giá cho đơn sau &amp; lên hạng thành viên.</p>
            {points?.convertedNote && (
              <p className="mt-0.5 px-1 text-xs text-stone-600">
                Điểm không hết hạn dùng trả đơn hàng tới 100% giá trị hàng và góp quỹ trồng cây. Không rút ra tiền.
              </p>
            )}
          </div>

          {showCommission && (
            <div className="flex gap-2.5">
              <SourceCard label="Hoa hồng chờ duyệt" value={w.commissionPending} icon={Clock} />
              {/* Hoa hồng đã duyệt KHÔNG tự vào Ví: phải bấm "Nhận về ví" ở trang Cộng tác viên, nên thẻ chỉ dẫn khi có tiền. */}
              <SourceCard
                label="Hoa hồng có thể rút"
                value={w.commissionApproved}
                icon={CheckCircle2}
                hint={w.commissionApproved > 0 ? 'Nhận về Ví →' : undefined}
                href={w.commissionApproved > 0 ? '/ctv' : undefined}
              />
            </div>
          )}

          {/* Khoản đã duyệt còn chờ về Ví là tiền của khách nên vẫn hiện dù lối vào Hoàn tiền sàn ngoài đã ẩn. */}
          {(CASHBACK_ENABLED || w.cashbackPending > 0) && (
            <SourceCard label="Hoàn tiền đã duyệt, chờ về Ví" value={w.cashbackPending} icon={ShoppingBag} wide />
          )}

          <div className="flex gap-2 rounded-card bg-promo-bg p-4">
            <Wallet className="h-5 w-5 flex-none text-promo-fg" aria-hidden="true" />
            <p className="text-xs text-promo-fg">
              Mẹo: dùng Ví Tubu để <b>trả đơn hàng</b> — <b>miễn phí</b>, thay vì rút về ngân hàng (phí chuyển khoản {formatVnd(fee)}/lần).
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {referral && !isAffiliate && (
            <section aria-label="Mời bạn bè" className={`p-4 ${ui.card}`}>
              <div className="mb-2 flex items-center gap-2">
                <Gift className="h-5 w-5 text-forest-600" aria-hidden="true" />
                <h2 className="text-base font-semibold text-stone-900">Mời bạn — nhận Điểm Xanh</h2>
              </div>
              <p className="text-xs text-stone-700">{referralPromise(referral.minOrderAmount ?? 200_000, referral.windowDays ?? 30)}</p>
              <div className="my-3 flex gap-6">
                <div>
                  <div className="text-lg font-bold tabular-nums text-forest-700">{referral.successCount}</div>
                  <div className="text-xs text-stone-600">bạn thành công</div>
                </div>
                <div>
                  <div className="text-lg font-bold tabular-nums text-promo-fg">{formatCount(referral.earnedPoints)} điểm</div>
                  <div className="text-xs text-stone-600">đã nhận từ giới thiệu</div>
                </div>
              </div>
              {/* Đã đủ hoặc vượt mốc (successCount cập nhật trước nextMilestone): không còn "Mời thêm 0/-2 bạn". */}
              {referral.nextMilestone && referral.nextMilestone.count > referral.successCount && (
                <p className="mb-3 text-xs font-medium text-forest-700">
                  Mời thêm {referral.nextMilestone.count - referral.successCount} bạn để nhận {formatCount(referral.nextMilestone.bonusPoints)} điểm
                </p>
              )}
              <div className="flex items-center gap-2">
                <div className="flex min-h-11 flex-1 items-center justify-center rounded-control bg-stone-100 font-semibold tracking-widest text-stone-900">
                  {referral.referralCode}
                </div>
                <button type="button" onClick={() => void shareReferral()} className={ui.btnPrimary}>
                  Chia sẻ
                </button>
              </div>
              <p role="status" className="mt-2 text-xs text-stone-700">
                {shareMsg}
              </p>
            </section>
          )}

          <WalletHistory enabled={authed} />
        </div>
      </div>

      <Sheet
        open={withdrawOpen}
        onClose={() => {
          setWithdrawOpen(false);
          setAmount('');
        }}
        title="Rút tiền về ngân hàng"
        description={`Khả dụng: ${formatVnd(balance)} • Tối thiểu: ${formatVnd(min)}`}
        footer={
          <button type="button" disabled={!canWithdraw || withdrawMut.isPending} onClick={submitWithdraw} className={`${ui.btnPrimary} w-full`}>
            {withdrawMut.isPending ? 'Đang gửi...' : `Rút ${amountNum > 0 ? formatVnd(amountNum) : ''}`}
          </button>
        }
      >
        {balance < min && (
          <div className="mb-3 flex items-start gap-2 rounded-control border border-promo-fg/20 bg-promo-bg p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-promo-fg" aria-hidden="true" />
            <p className="text-xs text-promo-fg">
              Số dư Ví Tubu của bạn ({formatVnd(balance)}) chưa đủ mốc tối thiểu {formatVnd(min)} để rút về ngân hàng.
            </p>
          </div>
        )}
        <div className="flex flex-col gap-3">
          <Field label="Số tiền rút">
            <input
              type="number"
              inputMode="numeric"
              className={ui.field}
              placeholder={`Tối thiểu ${formatVnd(min)}`}
              value={amount}
              disabled={balance < min}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field label="Tên ngân hàng">
            <input
              className={ui.field}
              placeholder="VD: Techcombank"
              maxLength={120}
              value={bank.bankName}
              disabled={balance < min}
              onChange={(e) => setBank((b) => ({ ...b, bankName: e.target.value }))}
            />
          </Field>
          <Field label="Số tài khoản">
            <input
              className={ui.field}
              inputMode="numeric"
              maxLength={24}
              value={bank.accountNumber}
              disabled={balance < min}
              onChange={(e) => setBank((b) => ({ ...b, accountNumber: e.target.value }))}
            />
          </Field>
          <Field label="Chủ tài khoản">
            <input
              className={ui.field}
              placeholder="Tên in trên thẻ"
              maxLength={120}
              value={bank.accountName}
              disabled={balance < min}
              onChange={(e) => setBank((b) => ({ ...b, accountName: e.target.value }))}
            />
          </Field>
        </div>
        {withdrawError && (
          <p role="alert" className={`mb-3 ${ui.error}`}>
            {withdrawError}
          </p>
        )}
        {amountNum >= min && (
          <p className="mt-2 rounded-control bg-stone-100 p-3 text-xs text-stone-700">
            Phí chuyển khoản ngân hàng: {formatVnd(fee)} • Thực nhận: <b>{formatVnd(Math.max(0, amountNum - fee))}</b>
          </p>
        )}
      </Sheet>
    </LedgerShell>
  );
}

/** Thẻ một nguồn tiền; có `href` thì cả thẻ là liên kết. */
function SourceCard({ label, value, icon: SourceIcon, wide, hint, href }: { label: string; value: number; icon: LucideIcon; wide?: boolean; hint?: string; href?: string }) {
  const body = (
    <>
      <span className="grid h-8 w-8 place-items-center rounded-full bg-stone-100">
        <SourceIcon className="h-4 w-4 text-forest-600" aria-hidden="true" />
      </span>
      <span className={`mt-1 block font-bold tabular-nums text-stone-900 ${wide ? 'text-lg' : 'text-base'}`}>{formatVnd(value)}</span>
      <span className="block text-xs text-stone-600">{label}</span>
      {hint && <span className="mt-1 block text-xs font-semibold text-forest-700">{hint}</span>}
    </>
  );
  const cls = `block min-w-0 flex-1 p-3 ${ui.card}`;
  return href ? (
    <Link href={href} className={`${cls} min-h-11 hover:bg-stone-50`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Sao kê Ví Tubu từ sổ cái: mỗi biến động một dòng kèm số dư sau giao dịch. */
function WalletHistory({ enabled }: { enabled: boolean }) {
  // Khoá con của ['wallet'] nên làm mới ví sau khi rút cũng làm mới luôn sao kê.
  const q = useInfiniteQuery({
    ...walletTransactionsQuery(coreHttp),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.meta.page * last.meta.limit < last.meta.total ? last.meta.page + 1 : undefined),
    enabled,
  });
  const rows = uniqueById(q.data?.pages.flatMap((p) => p.data) ?? []);

  return (
    <section aria-label="Lịch sử Ví" className={`p-4 ${ui.card}`}>
      <div className="mb-1 flex items-center gap-2">
        <History className="h-5 w-5 text-forest-600" aria-hidden="true" />
        <h2 className="text-base font-semibold text-stone-900">Lịch sử Ví</h2>
      </div>
      {q.isLoading ? (
        <div className="mt-2 space-y-2">
          <Skeleton height={44} />
          <Skeleton height={44} />
        </div>
      ) : q.isError && rows.length === 0 ? (
        <ErrorState message={errText(q.error)} onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <p className="mt-1 text-sm text-stone-600">Chưa có biến động nào trong Ví.</p>
      ) : (
        <>
          <ul className="divide-y divide-stone-200">
            {rows.map((t) => (
              <li key={t.id} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="break-words text-sm font-medium text-stone-900">{walletTxLabel(t.type, t.reason)}</div>
                  <div className="break-words text-xs text-stone-600">
                    {formatDateTime(t.createdAt)}
                    {t.reason ? ` · ${t.reason}` : ''}
                  </div>
                </div>
                <div className="flex-none text-right">
                  <div className="text-sm">
                    <SignedAmount delta={t.delta} text={formatVnd(Math.abs(t.delta))} />
                  </div>
                  <div className="text-xs text-stone-600">Số dư {formatVnd(t.balanceAfter)}</div>
                </div>
              </li>
            ))}
          </ul>
          {q.hasNextPage && (
            <div className="mt-3 text-center">
              <button type="button" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage} className={ui.btnSecondary}>
                {q.isFetchingNextPage ? 'Đang tải…' : 'Xem thêm'}
              </button>
              {q.isFetchNextPageError && (
                <p role="alert" className={`mt-2 ${ui.error}`}>
                  Không tải thêm được lịch sử. Vui lòng thử lại.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
