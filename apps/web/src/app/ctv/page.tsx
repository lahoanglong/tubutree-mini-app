'use client';

import { useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgePercent, GraduationCap, Handshake, Landmark, Link2, Receipt, Store, TrendingUp, Wallet } from 'lucide-react';
import { createAffiliateLink, registerAffiliate, type AffiliatePayout, type Commission } from '@tubutree/app-core/api/affiliate';
import {
  affiliateCommissionsQuery,
  affiliateDashboardQuery,
  affiliateLinksQuery,
  affiliateMeQuery,
  affiliatePayoutsQuery,
  affiliateTaxStatementQuery,
} from '@tubutree/app-core/queries/affiliate';
import { publicConfigQuery } from '@tubutree/app-core/queries/config';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { platformBridge } from '@/lib/platform-bridge';
import { isWebRouteReady } from '@/lib/route-map';
import { SITE_URL } from '@/lib/site';
import { invalidateBalances } from '@/lib/balances';
import { formatDate } from '@/lib/format-date';
import { formatVnd } from '@/lib/format-vnd';
import { formatVndShort } from '@/components/affiliate/vnd-short';
import { ui } from '@/lib/guest-ui';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { Badge } from '@/components/ui/badge';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { CtvShortcuts, type CtvShortcut } from '@/components/affiliate/ctv-shortcuts';
import { WithdrawSheet } from '@/components/affiliate/withdraw-sheet';
import {
  COMMISSION_META,
  COMMISSION_ORDER_STATUS,
  CTV_TERMS,
  PAYOUT_METHOD,
  PAYOUT_META,
  WITHDRAWING_META,
} from '@/components/affiliate/ctv-copy';

const TITLE = 'Cộng tác viên';
const DEFAULT_MIN_WITHDRAW_BANK = 50_000;

const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Đã có lỗi xảy ra — Vui lòng thử lại');


async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <Link href="/tai-khoan" className={ui.backLink}>
        ← Tài khoản
      </Link>
      <h1 className={`mt-1 ${ui.pageTitle}`}>{TITLE}</h1>
      <div className="mt-4">{children}</div>
    </main>
  );
}

export default function CtvPage() {
  const phase = useAuthPhase();
  const meQ = useQuery({ ...affiliateMeQuery(coreHttp), enabled: phase === 'authenticated' });

  if (phase === 'loading') {
    return (
      <Shell>
        <AuthLoading />
      </Shell>
    );
  }
  if (phase === 'unavailable') {
    return (
      <Shell>
        <SessionUnavailable />
      </Shell>
    );
  }
  if (phase === 'guest') {
    return (
      <Shell>
        <LoginRequired message="Đăng nhập để xem trang cộng tác viên của bạn." returnTo="/ctv" />
      </Shell>
    );
  }
  if (meQ.isLoading) {
    return (
      <Shell>
        <div className="space-y-3">
          <Skeleton height={120} />
          <Skeleton height={80} />
        </div>
      </Shell>
    );
  }
  if (meQ.isError && !meQ.data) {
    return (
      <Shell>
        <ErrorState message={errText(meQ.error)} onRetry={() => void meQ.refetch()} />
      </Shell>
    );
  }
  if (meQ.data?.isAffiliate) return <Dashboard />;
  // Đại lý/nhân viên không đăng ký CTV một chạm được (API từ chối): đưa form đăng ký là ngõ cụt.
  return meQ.data?.canRegister === false ? <CannotRegister /> : <RegisterGate />;
}

function CannotRegister() {
  return (
    <Shell>
      <div className="rounded-card border border-stone-200 bg-stone-0 p-8 text-center shadow-card">
        <h2 className="font-display text-base font-semibold text-stone-900">Tài khoản này không đăng ký CTV được</h2>
        <p className="mx-auto mt-1 max-w-sm text-sm text-stone-600">
          Màn hoa hồng CTV hiện khi tài khoản đã có gian hàng CTV hoặc đã có hoa hồng.
        </p>
        <Link href="/tai-khoan" className={`${ui.btnPrimary} mt-4`}>
          Về Hồ sơ
        </Link>
      </div>
    </Shell>
  );
}

function RegisterGate() {
  const qc = useQueryClient();
  const [agreed, setAgreed] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  // `disabled={isPending}` chỉ có hiệu lực sau lần render kế: hai cú bấm trong cùng khung hình vẫn gọi mutate hai lần.
  const busy = useRef(false);
  const cfgQ = useQuery({ ...publicConfigQuery(coreHttp), staleTime: 5 * 60_000 });
  const minBank = cfgQ.data?.affiliateMinWithdrawBank ?? DEFAULT_MIN_WITHDRAW_BANK;

  const reg = useMutation({
    mutationFn: () => registerAffiliate(coreHttp, CTV_TERMS.version),
    onSuccess: () => {
      setNotice({ text: 'Chào mừng CTV Tubu Tree! 🎉', error: false });
      void qc.invalidateQueries({ queryKey: affiliateMeQuery(coreHttp).queryKey });
    },
    onError: (e) => setNotice({ text: errText(e), error: true }),
    onSettled: () => {
      busy.current = false;
    },
  });
  const submit = () => {
    if (busy.current || !agreed) return;
    busy.current = true;
    setNotice(null);
    reg.mutate();
  };

  const benefits = [
    { Icon: BadgePercent, text: 'Hoa hồng theo từng sản phẩm + thưởng bậc doanh số tháng' },
    { Icon: Link2, text: 'Tạo link chia sẻ riêng, theo dõi click & chuyển đổi' },
    { Icon: Landmark, text: `Rút về ngân hàng (tối thiểu ${formatVndShort(minBank)}) hoặc quy đổi 1:1 vào Ví Tubu` },
    { Icon: TrendingUp, text: 'Dashboard hoa hồng realtime, minh bạch' },
  ];

  return (
    <Shell>
      <div className="mx-auto max-w-2xl">
        <section className="rounded-card bg-gradient-to-br from-forest-600 to-forest-700 p-5 text-center text-stone-0 shadow-card">
          <div className="mx-auto mb-3.5 grid h-16 w-16 place-items-center rounded-full bg-forest-700">
            <Handshake className="h-8 w-8" aria-hidden="true" />
          </div>
          <h2 className="font-display text-xl font-semibold">Trở thành CTV Tubu</h2>
          <p className="mt-1.5 text-sm">Chia sẻ sản phẩm sống xanh bạn yêu thích — nhận hoa hồng cho mỗi đơn thành công.</p>
        </section>

        <ul className="mt-4 space-y-3">
          {benefits.map(({ Icon, text }) => (
            <li key={text} className={`${ui.card} flex items-center gap-3 p-4`}>
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-control bg-stone-100">
                <Icon className="h-5 w-5 text-forest-600" aria-hidden="true" />
              </span>
              <span className="text-sm text-stone-700">{text}</span>
            </li>
          ))}
        </ul>

        <section aria-label={CTV_TERMS.heading} className={`${ui.card} mt-4 p-4`}>
          <h2 className="text-sm font-semibold text-stone-900">{CTV_TERMS.heading}</h2>
          <ul className="mt-2 list-disc space-y-1.5 pl-5">
            {CTV_TERMS.items.map((item) => (
              <li key={item} className="text-xs text-stone-700">
                {item}
              </li>
            ))}
          </ul>
          <label className="mt-3 flex min-h-11 cursor-pointer items-start gap-2 text-sm text-stone-800">
            <input type="checkbox" checked={agreed} onChange={() => setAgreed((v) => !v)} className="mt-1 h-5 w-5 shrink-0 accent-forest-600" />
            <span>{CTV_TERMS.agree}</span>
          </label>
        </section>

        <div role="status" aria-live="polite">
          {notice && <p className={`mt-3 text-sm ${notice.error ? 'text-danger-fg' : 'font-medium text-success-fg'}`}>{notice.text}</p>}
        </div>
        <button type="button" onClick={submit} disabled={!agreed || reg.isPending} className={`${ui.btnPrimary} mt-4 w-full`}>
          {reg.isPending ? 'Đang đăng ký…' : 'Đăng ký miễn phí ngay'}
        </button>
        {!agreed && <p className="mt-1.5 text-center text-xs text-stone-600">{CTV_TERMS.mustAgree}</p>}
      </div>
    </Shell>
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className={`${ui.card} p-4`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className={ui.sectionTitle}>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function SectionSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton height={16} />
      <Skeleton height={16} width="60%" />
    </div>
  );
}

function Kpi({ label, value, hint, highlight }: { label: string; value: string; hint?: string; highlight?: boolean }) {
  return (
    <div className={`${ui.card} flex-1 p-4`}>
      <div className={`text-lg font-bold tabular-nums ${highlight ? 'text-forest-700' : 'text-stone-900'}`}>{value}</div>
      <div className="text-xs text-stone-700">{label}</div>
      {hint && <div className="text-xs text-stone-600">{hint}</div>}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-base font-semibold tabular-nums">{value}</div>
      <div className="text-xs">{label}</div>
    </div>
  );
}

function PayoutRow({ p }: { p: AffiliatePayout }) {
  const m = PAYOUT_META[p.status];
  return (
    <li className="border-b border-stone-200 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold tabular-nums text-stone-900">{formatVnd(p.amount)}</div>
          <div className="text-xs text-stone-600">
            {PAYOUT_METHOD[p.method]} · {formatDate(p.requestedAt)}
          </div>
        </div>
        <Badge tone={m.tone}>{m.label}</Badge>
      </div>
      {p.taxWithheld > 0 && (
        <div className="text-xs text-stone-600">
          Hoa hồng {formatVnd(p.grossAmount ?? p.amount + p.taxWithheld)} · đã khấu trừ thuế TNCN {formatVnd(p.taxWithheld)}
        </div>
      )}
      {p.status === 'REJECTED' && (
        <div className="text-xs text-danger-fg">
          Lý do: {p.rejectionReason ?? 'không ghi lý do'}. Hoa hồng đã trở lại mục Có thể rút.
        </div>
      )}
      {p.bankRef && <div className="text-xs text-stone-600">Mã giao dịch: {p.bankRef}</div>}
    </li>
  );
}

function CommissionRow({ c }: { c: Commission }) {
  const m = c.withdrawing ? WITHDRAWING_META : COMMISSION_META[c.status];
  return (
    <li className="flex items-center justify-between gap-2 border-b border-stone-200 py-2">
      <div className="min-w-0">
        <div className="text-sm font-semibold tabular-nums text-forest-700">+{formatVnd(c.amount)}</div>
        <div className="text-xs text-stone-600">
          {c.orderCode ? `Đơn ${c.orderCode} · ` : 'Đơn '}
          {formatVnd(c.orderTotal)} · {formatDate(c.createdAt)}
        </div>
        {c.orderStatus && <div className="text-xs text-stone-600">{COMMISSION_ORDER_STATUS[c.orderStatus] ?? c.orderStatus}</div>}
      </div>
      <Badge tone={m.tone}>{m.label}</Badge>
    </li>
  );
}

function Dashboard() {
  const qc = useQueryClient();
  const meQ = useQuery(affiliateMeQuery(coreHttp));
  const dashQ = useQuery(affiliateDashboardQuery(coreHttp));
  const linksQ = useQuery(affiliateLinksQuery(coreHttp));
  const commQ = useQuery(affiliateCommissionsQuery(coreHttp));
  const payoutsQ = useQuery(affiliatePayoutsQuery(coreHttp));
  const taxQ = useQuery(affiliateTaxStatementQuery(coreHttp));
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const linkBusy = useRef(false);
  const [withdrawing, setWithdrawing] = useState(false);

  const createLink = useMutation({
    mutationFn: () => createAffiliateLink(coreHttp, 'HOMEPAGE'),
    onSuccess: () => {
      setNotice({ text: 'Đã tạo link chia sẻ mới', error: false });
      void qc.invalidateQueries({ queryKey: affiliateLinksQuery(coreHttp).queryKey });
    },
    onError: (e) => setNotice({ text: errText(e), error: true }),
    onSettled: () => {
      linkBusy.current = false;
    },
  });
  const makeLink = () => {
    if (linkBusy.current) return;
    linkBusy.current = true;
    setNotice(null);
    createLink.mutate();
  };

  const d = dashQ.data;
  const me = meQ.data;
  const referral = me?.referralCode ?? '';

  const shareReferral = async () => {
    setNotice(null);
    const text = `Mua sắm sản phẩm thiên nhiên cùng mình, dùng mã ${referral} nhé!`;
    const result = await platformBridge.share({ title: 'Tubu Tree — Sống xanh An Lành', text, path: `/?ref=${referral}` });
    if (result === 'copied') setNotice({ text: 'Đã chép liên kết giới thiệu', error: false });
    else if (result === 'failed') setNotice({ text: `Chưa chia sẻ được. Bạn gửi mã ${referral} cho bạn bè nhé.`, error: true });
  };

  const copy = async (text: string, okText: string, failText: string) => {
    const ok = await copyToClipboard(text);
    setNotice({ text: ok ? okText : failText, error: !ok });
  };

  // Lên đơn hộ chưa mở trên web: không gọi API, chỉ báo cách làm ở Mini App.
  const notYet = (what: string) => setNotice({ text: `${what} chưa mở trên web, bạn dùng Mini App Tubu Tree để làm việc này nhé.`, error: false });

  // Đại lý không có lối tắt Lên đơn hộ (API từ chối) và chỉ có Gian hàng khi còn gian hàng CTV (trình dựng trả 400 nếu không);
  // link Gian hàng chỉ hiện khi trang web của nó đã làm xong.
  const shortcuts: CtvShortcut[] = [
    { key: 'share', label: 'Chia sẻ', ariaLabel: 'Chia sẻ link và mã giới thiệu', icon: Link2, onPress: () => void shareReferral() },
    ...(me?.canOpenStorefront !== false && isWebRouteReady('/ctv/gian-hang')
      ? [{ key: 'store', label: 'Gian hàng', ariaLabel: 'Gian hàng của tôi', icon: Store, href: '/ctv/gian-hang' }]
      : []),
    ...(me?.canOrderForCustomer !== false
      ? [{ key: 'order', label: 'Lên đơn hộ', ariaLabel: 'Lên đơn hộ khách', icon: Receipt, onPress: () => notYet('Lên đơn hộ') }]
      : []),
    {
      key: 'withdraw',
      label: 'Rút tiền',
      ariaLabel: 'Rút tiền hoa hồng',
      icon: Wallet,
      // Khi dashboard lỗi vẫn cho bấm để máy chủ tự kiểm số dư, CTV không bị kẹt vì lỗi tạm thời.
      disabled: !dashQ.isError && (d?.withdrawableCommission ?? 0) <= 0,
      onPress: () => setWithdrawing(true),
    },
  ];

  const withdrawDone = (message: string) => {
    setWithdrawing(false);
    setNotice({ text: message, error: false });
    for (const q of [affiliateDashboardQuery, affiliateCommissionsQuery, affiliatePayoutsQuery, affiliateTaxStatementQuery, affiliateMeQuery]) {
      void qc.invalidateQueries({ queryKey: q(coreHttp).queryKey });
    }
    // Rút về Ví Tubu cộng thẳng vào ví: số dư đang cache ở trang Ví đã cũ.
    invalidateBalances(qc);
  };

  const captions = [
    `Mình đang dùng sản phẩm sống xanh của Tubu Tree, ưng lắm! Mua qua mã ${referral} nhé 🌿`,
    `Sống xanh an lành cùng Tubu Tree 🌱 Nhập mã ${referral} khi mua để ủng hộ mình nha!`,
    `Đồ thiên nhiên, lành cho da & nhẹ với đất. Săn deal Tubu Tree với mã ${referral} 💚`,
  ];

  return (
    <Shell>
      <div role="status" aria-live="polite">
        {notice && <p className={`mb-3 text-sm ${notice.error ? 'text-danger-fg' : 'font-medium text-success-fg'}`}>{notice.text}</p>}
      </div>
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <div className="space-y-4">
          {dashQ.isError ? (
            // Không đưa "0đ" khi lỗi tải: CTV sẽ tưởng mình chưa có hoa hồng.
            <ErrorState message={errText(dashQ.error)} onRetry={() => void dashQ.refetch()} />
          ) : (
            <section aria-label="Hoa hồng tháng này" className="rounded-card bg-gradient-to-br from-forest-600 to-forest-700 p-5 text-stone-0 shadow-card">
              <div className="text-sm">Hoa hồng tháng này</div>
              <div className="mt-1 font-display text-3xl font-bold tabular-nums">{formatVnd(d?.monthCommission ?? 0)}</div>
              <div className="mt-3 flex gap-4">
                <MiniStat label="Hôm nay" value={formatVnd(d?.todayCommission ?? 0)} />
                <MiniStat label="Click" value={String(d?.totalClicks ?? 0)} />
                <MiniStat label="Chuyển đổi" value={String(d?.totalConversions ?? 0)} />
              </div>
            </section>
          )}

          <CtvShortcuts items={shortcuts} />

          <div className="flex gap-2.5">
            <Kpi label="Đang chờ" hint="đơn chưa giao hoặc đang giữ" value={dashQ.isError ? '—' : formatVnd(d?.pendingCommission ?? 0)} />
            <Kpi label="Có thể rút" value={dashQ.isError ? '—' : formatVnd(d?.withdrawableCommission ?? 0)} highlight />
          </div>
          {(d?.withdrawingCommission ?? 0) > 0 && (
            <p className="text-xs text-stone-700">
              Đang rút {formatVnd(d!.withdrawingCommission!)} về ngân hàng — chờ Tubu Tree duyệt và chuyển khoản.
            </p>
          )}

          {isWebRouteReady('/hoc-vien') && (
            <div>
              <Link href="/hoc-vien" className={`${ui.btnSecondary} w-full gap-2`}>
                <GraduationCap className="h-5 w-5" aria-hidden="true" />
                Học viện Tubu
              </Link>
              <p className="mt-1 text-center text-xs text-stone-600">Học cách bán hàng và nhận hoa hồng hiệu quả hơn.</p>
            </div>
          )}

          <Section title="Mã giới thiệu của bạn">
            <div className="flex items-center justify-between gap-2 rounded-control bg-forest-50 p-3">
              <span className="font-display text-xl font-semibold tracking-wide text-forest-700">{referral}</span>
              <button type="button" onClick={() => void shareReferral()} className={ui.btnPrimary}>
                Chia sẻ
              </button>
            </div>
            <div className="mb-1.5 mt-3 text-xs font-semibold text-stone-900">Caption gợi ý (chạm để sao chép)</div>
            <ul className="space-y-1.5">
              {captions.map((cap) => (
                <li key={cap}>
                  <button
                    type="button"
                    onClick={() => void copy(cap, 'Đã sao chép caption', 'Không sao chép được — hãy chọn và chép thủ công.')}
                    className="min-h-11 w-full rounded-control bg-stone-50 p-2 text-left text-xs text-stone-700 hover:bg-stone-100"
                  >
                    {cap}
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        </div>

        <div className="space-y-4">
          <Section
            title="Link chia sẻ"
            action={
              <button type="button" onClick={makeLink} disabled={createLink.isPending} className={ui.btnText}>
                + Tạo link
              </button>
            }
          >
            {linksQ.isError ? (
              <ErrorState message={errText(linksQ.error)} onRetry={() => void linksQ.refetch()} />
            ) : linksQ.data && linksQ.data.length > 0 ? (
              <ul>
                {linksQ.data.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2 border-b border-stone-200 py-2">
                    <div>
                      <div className="text-sm font-semibold text-stone-900">{l.targetType === 'HOMEPAGE' ? 'Trang chủ' : l.targetType}</div>
                      <div className="text-xs text-stone-600">
                        {l.clicks} click · {l.conversions} đơn
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        void copy(`${SITE_URL}/?ref=${referral}&l=${l.shortCode}`, 'Đã sao chép link', 'Không sao chép được — hãy chép link thủ công.')
                      }
                      className={ui.btnText}
                    >
                      Sao chép
                    </button>
                  </li>
                ))}
              </ul>
            ) : linksQ.isLoading ? (
              <SectionSkeleton />
            ) : (
              <div className="py-4 text-center">
                <div className="text-sm font-semibold text-stone-900">Chưa có link</div>
                <div className="text-xs text-stone-600">Tạo link đầu tiên để bắt đầu chia sẻ.</div>
              </div>
            )}
          </Section>

          <Section title="Lịch sử hoa hồng">
            {commQ.isError ? (
              // Tránh "Chưa có hoa hồng" khi thực tế là API lỗi.
              <ErrorState message={errText(commQ.error)} onRetry={() => void commQ.refetch()} />
            ) : commQ.data && commQ.data.length > 0 ? (
              <ul>
                {commQ.data.slice(0, 30).map((c) => (
                  <CommissionRow key={c.id} c={c} />
                ))}
              </ul>
            ) : commQ.isLoading ? (
              <SectionSkeleton />
            ) : (
              <div className="py-4 text-center">
                <div className="text-sm font-semibold text-stone-900">Chưa có hoa hồng</div>
                <div className="text-xs text-stone-600">Chia sẻ link để nhận hoa hồng từ đơn của bạn bè.</div>
              </div>
            )}
          </Section>

          <Section title="Lệnh rút">
            {taxQ.data && taxQ.data.totals.taxWithheld > 0 && (
              <div className="mb-2">
                <div className="text-sm text-stone-900">
                  Năm {taxQ.data.year}: thu nhập hoa hồng {formatVnd(taxQ.data.totals.grossAmount)} · đã khấu trừ thuế TNCN{' '}
                  {formatVnd(taxQ.data.totals.taxWithheld)}
                </div>
                <div className="text-xs text-stone-600">
                  Cần chứng từ khấu trừ thuế TNCN để quyết toán thuế? Liên hệ CSKH Tubu Tree, kế toán cấp theo bảng kê năm này.
                </div>
              </div>
            )}
            {payoutsQ.isError ? (
              <ErrorState message={errText(payoutsQ.error)} onRetry={() => void payoutsQ.refetch()} />
            ) : payoutsQ.data && payoutsQ.data.length > 0 ? (
              <ul>
                {payoutsQ.data.map((p) => (
                  <PayoutRow key={p.id} p={p} />
                ))}
              </ul>
            ) : payoutsQ.isLoading ? (
              <SectionSkeleton />
            ) : (
              <p className="text-sm text-stone-600">Chưa có lệnh rút nào.</p>
            )}
          </Section>
        </div>
      </div>
      <WithdrawSheet
        open={withdrawing}
        onClose={() => setWithdrawing(false)}
        max={d?.withdrawableCommission ?? 0}
        knownMax={!dashQ.isError}
        taxIdOnFile={me?.personalTaxId ?? null}
        onDone={withdrawDone}
      />
    </Shell>
  );
}
