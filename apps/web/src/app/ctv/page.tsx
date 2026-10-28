'use client';

import { useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgePercent, ChevronRight, GraduationCap, Handshake, Landmark, Link2, Receipt, Store, TrendingUp, Wallet } from 'lucide-react';
import { createAffiliateLink, registerAffiliate, type AffiliatePayout, type Commission } from '@tubutree/app-core/api/affiliate';
import {
  affiliateCommissionsQuery,
  affiliateDashboardQuery,
  affiliateLinksQuery,
  affiliateCtvTiersQuery,
  affiliateMeQuery,
  affiliateMilestonesQuery,
  affiliatePayoutsQuery,
  affiliateProductBreakdownQuery,
  affiliateStorefrontAnalyticsQuery,
  affiliateTaxStatementQuery,
} from '@tubutree/app-core/queries/affiliate';
import { academyCoursesQuery } from '@tubutree/app-core/queries/academy';
import { walletQuery } from '@tubutree/app-core/queries/wallet';
import { COMMISSION_PENDING_NOTE, CTV_TAB_KEYS, CTV_TABS, ctvHeadline, ctvHeroAmount, hasFirstOrder, heroShowsWalletBalance, isAutoWalletTransfer, transferBlockedText, transferHeroNote } from '@tubutree/app-core/ctv-dashboard';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { platformBridge } from '@/lib/platform-bridge';
import { isWebRouteReady } from '@/lib/route-map';
import { SITE_URL } from '@/lib/site';
import { invalidateBalances } from '@/lib/balances';
import { formatDate } from '@/lib/format-date';
import { formatVnd } from '@/lib/format-vnd';
import { ui } from '@/lib/guest-ui';
import { phoneFlatCard, phoneSecondary } from '@/lib/phone-ui';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { Badge } from '@/components/ui/badge';
import { Sheet } from '@/components/ui/sheet';
import { SegmentedTabs, useTabParam } from '@/components/ui/segmented-tabs';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { CtvShortcuts, type CtvShortcut } from '@/components/affiliate/ctv-shortcuts';
import { MilestoneRewards } from '@/components/affiliate/milestone-rewards';
import { TierCard } from '@/components/affiliate/tier-card';
import {
  COMMISSION_META,
  COMMISSION_ORDER_STATUS,
  CTV_TERMS,
  PAYOUT_METHOD,
  PAYOUT_META,
  WITHDRAWING_META,
} from '@/components/affiliate/ctv-copy';
import BackLink from '@/components/back-link';
import { PageHeader } from '@/components/ui/page-header';
import { PAGE_NARROW, PAGE_WIDE } from '@/lib/page-frame';
import { actionErrorText, loadErrorText } from '@/lib/error-text';

const TITLE = 'Cộng tác viên';

const errText = loadErrorText;
const actErrText = actionErrorText;


async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function Shell({ children, narrow = false }: { children: ReactNode; narrow?: boolean }) {
  return (
    <main className={`${narrow ? PAGE_NARROW : PAGE_WIDE} py-6`}>
      <BackLink href="/tai-khoan">
        ← Tài khoản
      </BackLink>
      <PageHeader title={TITLE} parentHref="/tai-khoan" className="md:mt-1" />
      <div className="mt-4">{children}</div>
    </main>
  );
}

// Bảng chia sẻ chỉ cần khi bấm Chia sẻ: tách khỏi lượt tải đầu để First Load của trang không tăng.
const CtvOrderSheet = dynamic(() => import('@/components/affiliate/ctv-order-sheet').then((m) => m.CtvOrderSheet), { ssr: false });
const TransferSheet = dynamic(() => import('@/components/affiliate/transfer-sheet').then((m) => m.TransferSheet), { ssr: false });
const StorefrontShareSheet = dynamic(() => import('@/components/affiliate/storefront-share').then((m) => m.StorefrontShareSheet), { ssr: false });

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

  const reg = useMutation({
    mutationFn: () => registerAffiliate(coreHttp, CTV_TERMS.version),
    onSuccess: () => {
      setNotice({ text: 'Chào mừng CTV Tubu Tree! 🎉', error: false });
      void qc.invalidateQueries({ queryKey: affiliateMeQuery(coreHttp).queryKey });
      // Vai trò vừa đổi: tải lại Học viện (lần tải trước khi còn là khách bị từ chối và không thử lại), và về đầu trang.
      void qc.invalidateQueries({ queryKey: academyCoursesQuery(coreHttp).queryKey });
      window.scrollTo({ top: 0 });
    },
    onError: (e) => setNotice({ text: actErrText(e), error: true }),
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
    { Icon: Store, text: 'Gian hàng riêng với đường dẫn mang tên bạn để gửi cho khách' },
    { Icon: BadgePercent, text: 'Hoa hồng theo từng sản phẩm + thưởng bậc doanh số tháng' },
    { Icon: Link2, text: 'Tạo link chia sẻ riêng, theo dõi lượt bấm & chuyển đổi' },
    { Icon: Landmark, text: 'Hoa hồng vào Ví Tubu 1:1, dùng trả tiền hàng' },
    { Icon: TrendingUp, text: 'Bảng hoa hồng cập nhật liên tục, minh bạch' },
  ];

  return (
    <Shell narrow>
      <div>
        <section className="rounded-card bg-gradient-to-br from-forest-600 to-forest-700 p-5 text-center text-stone-0 shadow-card">
          <div className="mx-auto mb-3.5 grid h-16 w-16 place-items-center rounded-full bg-forest-700">
            <Handshake className="h-8 w-8" aria-hidden="true" />
          </div>
          <h2 className="font-display text-xl font-semibold">Trở thành CTV Tubu</h2>
          <p className="mt-1.5 text-sm">Chia sẻ sản phẩm sống xanh bạn yêu thích — nhận hoa hồng cho mỗi đơn thành công.</p>
        </section>

        <ul className="mt-4 space-y-3">
          {benefits.map(({ Icon, text }) => (
            <li key={text} className={`${ui.card} ${phoneFlatCard} flex items-center gap-3 p-4`}>
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-control bg-stone-100">
                <Icon className="h-5 w-5 text-forest-600" aria-hidden="true" />
              </span>
              <span className="text-sm text-stone-700">{text}</span>
            </li>
          ))}
        </ul>

        <section aria-label={CTV_TERMS.heading} className={`${ui.card} ${phoneFlatCard} mt-4 p-4`}>
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
    <section aria-label={title} className={`${ui.card} ${phoneFlatCard} p-4`}>
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
      {(p.taxWithheld > 0 || (p.taxRefunded ?? 0) > 0) && (
        <div className="text-xs text-stone-600">
          Hoa hồng {formatVnd(p.grossAmount ?? p.amount + p.taxWithheld)}
          {p.taxWithheld > 0 ? ` · đã khấu trừ thuế TNCN ${formatVnd(p.taxWithheld)}` : ''}
          {(p.taxRefunded ?? 0) > 0 ? ` · đã hoàn ${formatVnd(p.taxRefunded ?? 0)} thuế giữ dư vào Ví` : ''}
        </div>
      )}
      {p.status === 'REJECTED' && (
        <div className="text-xs text-danger-fg">
          Lý do: {p.rejectionReason ?? 'không ghi lý do'}. Hoa hồng đã trở lại mục Có thể chuyển vào Ví.
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
  // Mỗi tab chỉ tải dữ liệu của tab đó: mở trang CTV không còn gọi cả 15 request.
  const [tab, setTab] = useTabParam(CTV_TAB_KEYS, 'overview');
  const linksQ = useQuery({ ...affiliateLinksQuery(coreHttp), enabled: tab === 'share' });
  const commQ = useQuery({ ...affiliateCommissionsQuery(coreHttp), enabled: tab === 'commission' });
  const payoutsQ = useQuery({ ...affiliatePayoutsQuery(coreHttp), enabled: tab === 'commission' });
  const taxQ = useQuery({ ...affiliateTaxStatementQuery(coreHttp), enabled: tab === 'commission' });
  const sfQ = useQuery({ ...affiliateStorefrontAnalyticsQuery(coreHttp), enabled: tab === 'commission' });
  const pbQ = useQuery({ ...affiliateProductBreakdownQuery(coreHttp), enabled: tab === 'commission' });
  const tiersQ = useQuery({ ...affiliateCtvTiersQuery(coreHttp), enabled: tab === 'overview' });
  const milestonesQ = useQuery({ ...affiliateMilestonesQuery(coreHttp), enabled: tab === 'overview' });
  const walletQ = useQuery(walletQuery(coreHttp));
  // Lối vào Học viện chỉ hiện khi đã có khoá để học: vào mà thấy trống thì CTV mới tưởng sản phẩm chưa xong.
  const academyQ = useQuery({ ...academyCoursesQuery(coreHttp), retry: false });
  const hasCourses = (academyQ.data?.length ?? 0) > 0;
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const linkBusy = useRef(false);
  const [transferring, setTransferring] = useState(false);
  const [ctvOrdering, setCtvOrdering] = useState(false);
  const [sharing, setSharing] = useState(false);

  const createLink = useMutation({
    mutationFn: () => createAffiliateLink(coreHttp, 'HOMEPAGE'),
    onSuccess: () => {
      setNotice({ text: 'Đã tạo link chia sẻ mới', error: false });
      void qc.invalidateQueries({ queryKey: affiliateLinksQuery(coreHttp).queryKey });
    },
    onError: (e) => setNotice({ text: actErrText(e), error: true }),
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

  const head = ctvHeadline(d);
  const autoTransfer = isAutoWalletTransfer(d?.autoWalletTransfer);
  const hero = ctvHeroAmount(head.big, autoTransfer, walletQ.data?.walletBalance, walletQ.isLoading);
  const firstSteps: Array<{ key: string; label: string; Icon: typeof Link2; onPress?: () => void; href?: string }> = [
    { key: 'share', label: 'Chia sẻ mã giới thiệu', Icon: Link2, onPress: () => setSharing(true) },
    ...(me?.canOpenStorefront !== false && isWebRouteReady('/ctv/gian-hang')
      ? [{ key: 'store', label: 'Mở gian hàng của bạn', Icon: Store, href: '/ctv/gian-hang' }]
      : []),
    ...(hasCourses && isWebRouteReady('/hoc-vien') ? [{ key: 'learn', label: 'Học khoá đầu tiên', Icon: GraduationCap, href: '/hoc-vien' }] : []),
  ];
  const copyReferral = () => void copy(referral, 'Đã sao chép mã giới thiệu', 'Không sao chép được — hãy chọn và chép thủ công.');

  const copy = async (text: string, okText: string, failText: string) => {
    const ok = await copyToClipboard(text);
    setNotice({ text: ok ? okText : failText, error: !ok });
  };

  // Đại lý không có lối tắt Lên đơn hộ (API từ chối) và chỉ có Gian hàng khi còn gian hàng CTV (trình dựng trả 400 nếu không);
  // link Gian hàng chỉ hiện khi trang web của nó đã làm xong.
  const shortcuts: CtvShortcut[] = [
    { key: 'share', label: 'Chia sẻ', ariaLabel: 'Chia sẻ link và mã giới thiệu', icon: Link2, onPress: () => setSharing(true) },
    ...(me?.canOpenStorefront !== false && isWebRouteReady('/ctv/gian-hang')
      ? [{ key: 'store', label: 'Gian hàng', ariaLabel: 'Gian hàng của tôi', icon: Store, href: '/ctv/gian-hang' }]
      : []),
    ...(me?.canOrderForCustomer !== false
      ? [{ key: 'order', label: 'Lên đơn hộ', ariaLabel: 'Lên đơn hộ khách', icon: Receipt, onPress: () => setCtvOrdering(true) }]
      : []),
    {
      key: 'transfer',
      label: 'Chuyển vào Ví',
      ariaLabel: 'Chuyển vào Ví Tubu',
      icon: Wallet,
      // Luôn bấm được: ô mờ không nói lý do làm CTV tưởng bị chặn. Chưa có số dư thì sheet giải thích khi nào tiền vào Ví.
      onPress: () => setTransferring(true),
    },
  ];

  const transferDone = (message: string) => {
    setTransferring(false);
    setNotice({ text: message, error: false });
    for (const q of [affiliateDashboardQuery, affiliateCommissionsQuery, affiliatePayoutsQuery, affiliateTaxStatementQuery, affiliateMeQuery]) {
      void qc.invalidateQueries({ queryKey: q(coreHttp).queryKey });
    }
    // Chuyển vào Ví Tubu cộng thẳng vào ví: số dư đang cache ở trang Ví đã cũ.
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
      <div className="mx-auto max-w-2xl space-y-4">
        {dashQ.isError ? (
          // Không đưa "0đ" khi lỗi tải: CTV sẽ tưởng mình chưa có hoa hồng.
          <ErrorState message={errText(dashQ.error)} onRetry={() => void dashQ.refetch()} />
        ) : dashQ.isLoading || hero.waiting ? (
          <div role="status" aria-label="Đang tải hoa hồng">
            <Skeleton height={148} />
          </div>
        ) : (
          <section aria-label={heroShowsWalletBalance(hero) ? hero.label : 'Hoa hồng có thể chuyển vào Ví'} className="rounded-card bg-gradient-to-br from-forest-600 to-forest-700 p-5 text-stone-0 shadow-card">
            {/* Số to là tiền dùng được ngay; hoa hồng đang chờ và số tạm tính tháng là dòng phụ. */}
            <div className="text-sm">{hero.label}</div>
            <div className="mt-1 font-display text-3xl font-bold tabular-nums">{formatVnd(hero.amount)}</div>
            <div className="mt-1 text-xs">Đang chờ: {formatVnd(head.pending)} · {COMMISSION_PENDING_NOTE}</div>
            {head.big > 0 && <div className="mt-1 text-xs">{transferHeroNote(autoTransfer)}</div>}
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
              <MiniStat label="Tạm tính tháng này" value={formatVnd(head.monthEstimate)} />
              <MiniStat label="Lượt bấm" value={String(d?.totalClicks ?? 0)} />
              <MiniStat label="Chuyển đổi" value={String(d?.totalConversions ?? 0)} />
            </div>
          </section>
        )}

        <CtvShortcuts items={shortcuts} />

        <Link href="/tai-khoan/vi-tubu" className={`${ui.card} ${phoneFlatCard} flex min-h-12 items-center gap-2.5 px-4 py-2.5`}>
          <Wallet className="h-5 w-5 text-forest-600" aria-hidden="true" />
          <span className="flex-1 text-sm text-stone-900">
            {heroShowsWalletBalance(hero) ? (
              <b>Xem Ví Tubu</b>
            ) : (
              <>
                Số dư Ví: <b className="tabular-nums">{walletQ.data ? formatVnd(walletQ.data.walletBalance) : '—'}</b>
              </>
            )}
          </span>
          <ChevronRight className="h-4 w-4 text-stone-500" aria-hidden="true" />
        </Link>
        {(d?.withdrawingCommission ?? 0) > 0 && (
          <p className="text-xs text-stone-700">
            Còn {formatVnd(d!.withdrawingCommission!)} nằm trong lệnh rút ngân hàng cũ, đang chờ Tubu Tree xử lý.
          </p>
        )}

        <SegmentedTabs items={[...CTV_TABS]} value={tab} onChange={setTab} label="Mục của trang cộng tác viên" />

        {tab === 'overview' && (
          <>
            {d && !hasFirstOrder(d) && (
              <section aria-label="Việc đầu tiên" className={`${ui.card} ${phoneFlatCard} p-4`}>
                <h2 className={ui.sectionTitle}>Việc đầu tiên</h2>
                <p className="mb-1 mt-0.5 text-xs text-stone-700">Làm lần lượt để có đơn đầu tiên. Thẻ này tự ẩn khi bạn có đơn.</p>
                <ul>
                  {firstSteps.map((step, i) => {
                    const cls = 'flex min-h-12 w-full items-center gap-2.5 border-t border-stone-200 py-2 text-left';
                    const inner = (
                      <>
                        <step.Icon className="h-5 w-5 text-forest-600" aria-hidden="true" />
                        <span className="flex-1 text-sm font-semibold text-stone-900">
                          {i + 1}. {step.label}
                        </span>
                        <ChevronRight className="h-4 w-4 text-stone-500" aria-hidden="true" />
                      </>
                    );
                    return (
                      <li key={step.key}>
                        {step.href ? (
                          <Link href={step.href} className={cls}>
                            {inner}
                          </Link>
                        ) : (
                          <button type="button" onClick={step.onPress} className={cls}>
                            {inner}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          {d?.tier && <TierCard dash={d} tiers={tiersQ.data} />}

          {milestonesQ.isError ? (
            <div className={`${ui.card} ${phoneFlatCard} p-4`}>
              <ErrorState variant="inline" message={errText(milestonesQ.error)} onRetry={() => void milestonesQ.refetch()} />
            </div>
          ) : milestonesQ.isLoading ? (
            <div className={`${ui.card} ${phoneFlatCard} p-4`}>
              <SectionSkeleton />
            </div>
          ) : milestonesQ.data ? (
            <MilestoneRewards data={milestonesQ.data} />
          ) : null}

          {hasCourses && isWebRouteReady('/hoc-vien') && (
            <div>
              <Link href="/hoc-vien" className={`${ui.btnSecondary} ${phoneSecondary} w-full gap-2`}>
                <GraduationCap className="h-5 w-5" aria-hidden="true" />
                Học viện CTV
              </Link>
              <p className="mt-1 text-center text-xs text-stone-600 max-md:text-[length:var(--type-caption-size)] max-md:text-[var(--color-text-tertiary)]">Khoá học đào tạo dành cho CTV</p>
            </div>
          )}

          </>
        )}

        {tab === 'share' && (
          <>
          <Section title="Mã giới thiệu của bạn">
            <div className="flex items-center justify-between gap-2 rounded-control bg-forest-50 p-3">
              <span className="font-display text-xl font-semibold tracking-wide text-forest-700">{referral}</span>
              <button type="button" onClick={copyReferral} className={ui.btnPrimary}>
                Sao chép mã
              </button>
            </div>
            <div className="mb-1.5 mt-3 text-xs font-semibold text-stone-900">Lời đăng gợi ý (chạm để sao chép)</div>
            <ul className="space-y-1.5">
              {captions.map((cap) => (
                <li key={cap}>
                  <button
                    type="button"
                    onClick={() => void copy(cap, 'Đã sao chép lời đăng', 'Không sao chép được — hãy chọn và chép thủ công.')}
                    className="min-h-11 w-full rounded-control bg-stone-50 p-2 text-left text-xs text-stone-700 hover:bg-stone-100"
                  >
                    {cap}
                  </button>
                </li>
              ))}
            </ul>
          </Section>
          <Section
            title="Link chia sẻ"
            action={
              <button type="button" onClick={makeLink} disabled={createLink.isPending} className={ui.btnText}>
                + Tạo link
              </button>
            }
          >
            {linksQ.isError ? (
              <ErrorState variant="inline" message={errText(linksQ.error)} onRetry={() => void linksQ.refetch()} />
            ) : linksQ.data && linksQ.data.length > 0 ? (
              <ul>
                {linksQ.data.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2 border-b border-stone-200 py-2">
                    <div>
                      <div className="text-sm font-semibold text-stone-900">{l.targetType === 'HOMEPAGE' ? 'Trang chủ' : l.targetType}</div>
                      <div className="text-xs text-stone-600">{l.clicks} lượt bấm</div>
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

          </>
        )}

        {tab === 'commission' && (
          <>
          <Section title="Lịch sử hoa hồng">
            {commQ.isError ? (
              // Tránh "Chưa có hoa hồng" khi thực tế là API lỗi.
              <ErrorState variant="inline" message={errText(commQ.error)} onRetry={() => void commQ.refetch()} />
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

          <Section title="Lịch sử chuyển vào Ví">
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
              <ErrorState variant="inline" message={errText(payoutsQ.error)} onRetry={() => void payoutsQ.refetch()} />
            ) : payoutsQ.data && payoutsQ.data.length > 0 ? (
              <ul>
                {payoutsQ.data.map((p) => (
                  <PayoutRow key={p.id} p={p} />
                ))}
              </ul>
            ) : payoutsQ.isLoading ? (
              <SectionSkeleton />
            ) : (
              <p className="text-sm text-stone-600">Chưa có lần chuyển nào.</p>
            )}
          </Section>

          <Section title="Theo gian hàng">
            {sfQ.isError ? (
              <ErrorState variant="inline" message={errText(sfQ.error)} onRetry={() => void sfQ.refetch()} />
            ) : sfQ.data && sfQ.data.storefronts.length > 0 ? (
              <ul>
                {sfQ.data.storefronts.map((sf) => (
                  <li key={sf.slug} className="flex items-center justify-between gap-2 border-b border-stone-200 py-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-stone-900">{sf.title ?? sf.slug}</div>
                      <div className="text-xs text-stone-600">
                        {sf.orders} đơn · DS {formatVnd(sf.revenue)}
                      </div>
                    </div>
                    <span className="text-sm font-semibold tabular-nums text-forest-700">+{formatVnd(sf.commission)}</span>
                  </li>
                ))}
              </ul>
            ) : sfQ.isLoading ? (
              <SectionSkeleton />
            ) : (
              <div className="py-4 text-center">
                <div className="text-sm font-semibold text-stone-900">Chưa có đơn từ gian hàng nào</div>
                <div className="text-xs text-stone-600">Chia sẻ link gian hàng để nhận hoa hồng.</div>
              </div>
            )}
          </Section>

          <Section title="Theo sản phẩm">
            {pbQ.isError ? (
              <ErrorState variant="inline" message={errText(pbQ.error)} onRetry={() => void pbQ.refetch()} />
            ) : pbQ.data && pbQ.data.length > 0 ? (
              <ul>
                {pbQ.data.slice(0, 10).map((p, i) => (
                  <li key={`${p.productName}:${i}`} className="flex items-center justify-between gap-2 border-b border-stone-200 py-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-stone-900">{p.productName}</div>
                      <div className="text-xs text-stone-600">{p.orders} đơn</div>
                    </div>
                    <span className="text-sm font-semibold tabular-nums text-forest-700">+{formatVnd(p.commission)}</span>
                  </li>
                ))}
              </ul>
            ) : pbQ.isLoading ? (
              <SectionSkeleton />
            ) : (
              <div className="py-4 text-center">
                <div className="text-sm font-semibold text-stone-900">Chưa có hoa hồng theo sản phẩm</div>
                <div className="text-xs text-stone-600">Chia sẻ link sản phẩm để bắt đầu.</div>
              </div>
            )}
          </Section>
          </>
        )}
      </div>
      <CtvOrderSheet open={ctvOrdering} onClose={() => setCtvOrdering(false)} />
      <StorefrontShareSheet
        open={sharing}
        onClose={() => setSharing(false)}
        home
        title="Tubu Tree — Sống xanh An Lành"
        heading="Chia sẻ mã giới thiệu"
        referralCode={referral}
        captions={captions}
      />
      <Sheet open={transferring && !dashQ.isError && head.big <= 0} onClose={() => setTransferring(false)} title="Chuyển hoa hồng vào Ví">
        {dashQ.isLoading ? (
          // Chưa có số liệu: đừng nói "Đang chờ: 0đ" rồi đổi sang form khi dữ liệu về.
          <div className="space-y-2" aria-busy="true">
            <Skeleton height={16} />
            <Skeleton height={16} width="60%" />
          </div>
        ) : (
          <>
            <p className="text-sm text-stone-800">{transferBlockedText(formatVnd(head.pending), autoTransfer)}</p>
            <button type="button" onClick={() => setTransferring(false)} className={`${ui.btnSecondary} mt-4 w-full`}>
              Đã hiểu
            </button>
          </>
        )}
      </Sheet>
      <TransferSheet
        open={transferring && (dashQ.isError || head.big > 0)}
        onClose={() => setTransferring(false)}
        max={d?.withdrawableCommission ?? 0}
        knownMax={!dashQ.isError}
        taxIdOnFile={me?.personalTaxId ?? null}
        taxPreview={d?.withdrawTaxPreview}
        onDone={transferDone}
      />
    </Shell>
  );
}
