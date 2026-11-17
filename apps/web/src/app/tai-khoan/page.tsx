'use client';

import { Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Copy, CreditCard, Leaf, Package, PackageCheck, Share2, Truck, type LucideIcon } from 'lucide-react';
import { orderRowLabel, profileCopy } from '@tubutree/app-core/account-copy';
import { STAT_VALUE_LINE_HEIGHT, STAT_VALUE_LOOKS, statValueFits, statValueStart } from '@tubutree/app-core/account-stat';
import { inviteBody, inviteLink, inviteShareText } from '@tubutree/app-core/commerce/invite-card';
import { shareDescription, welcomeOfferOf } from '@tubutree/app-core/commerce/share-offer';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { PROFILE_MENU_COPY, PROFILE_ORDER_ROW, type ProfileRowKey } from '@tubutree/app-core/profile-menu';
import { PROFILE_REFERRAL_SECTION } from '@tubutree/app-core/profile-sections';
import { dealerMeQuery } from '@tubutree/app-core/queries/dealer';
import { affiliateMeQuery } from '@tubutree/app-core/queries/affiliate';
import { couponsQuery, loyaltyQuery, referralQuery } from '@tubutree/app-core/queries/loyalty';
import { hasDeskPointQuery, ownedBrandProfileQuery, ownsBrandQuery } from '@tubutree/app-core/queries/brand-owner';
import { publicConfigQuery } from '@tubutree/app-core/queries/config';
import { supportChatSummaryQuery } from '@tubutree/app-core/queries/support-chat';
import { deskPointsQuery } from '@tubutree/app-core/queries/waste';
import { useAuth } from '@/lib/auth-context';
import { useAuthPhase } from '@/lib/auth-phase';
import { useActionLock } from '@/lib/use-action-lock';
import { useMeSummary } from '@/lib/use-me-summary';
import { useRecycleOpenRequests } from '@/lib/use-recycle-open-requests';
import { coreHttp } from '@/lib/core-http';
import { isWebRouteReady } from '@/lib/route-map';
import { formatVnd, getMe } from '@/lib/shop-client';
import { ui } from '@/lib/guest-ui';
import { formatCount, pointsSummary } from '@/lib/checkout-points';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { ProfileAvatar } from '@/components/account/profile-avatar';
import { buildAccountMenu, IN_ACCOUNT_SHELL } from '@/components/account/account-menu';
import { Button, Card, Heading, Text } from '@/components/mini';
import { OrdersSection } from './orders-section';
import { BadgeRow, useBadges } from '@/components/game/badge-row';
import BackLink from '@/components/back-link';
import { PAGE_WIDE } from '@/lib/page-frame';

const ORDER_ROW_ICON: Record<string, LucideIcon> = {
  pending_payment: CreditCard,
  processing: Package,
  shipping: Truck,
  delivered: PackageCheck,
};

const ROW_BOX =
  'tubu-press flex min-h-11 w-full items-center gap-[10px] py-3 text-left hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest-600';
const ROW = `${ROW_BOX} px-3`;
// Mục con của dòng mở tại chỗ thụt vào để đọc ra là thuộc dòng trên.
const CHILD_ROW = `${ROW_BOX} border-t border-[var(--color-border-subtle)] pl-6 pr-3`;

function RowBody({ icon: Icon, label, hint, dot, expanded }: { icon: LucideIcon; label: string; hint?: string; dot?: 'chat' | 'support'; expanded?: boolean }) {
  return (
    <>
      <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-control bg-[var(--color-bg-subtle)] text-forest-600">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[length:var(--type-body-sm-size)] font-semibold leading-[var(--type-body-sm-lh)] text-stone-900">{label}</span>
        {hint && <span className="mt-0.5 block text-caption text-[color:var(--color-text-tertiary)]">{hint}</span>}
      </span>
      {dot && <span data-testid={dot === 'chat' ? 'chat-unread-dot' : 'support-unread-dot'} aria-hidden="true" className="h-2.5 w-2.5 flex-none rounded-full bg-[var(--color-action-danger-bg)]" />}
      {expanded === undefined ? (
        <ChevronRight className="h-4 w-4 flex-none text-stone-600" aria-hidden="true" />
      ) : (
        <ChevronDown className={`h-4 w-4 flex-none text-stone-600 ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
      )}
    </>
  );
}

/** Bề ngang thật của ô (đổi theo màn, xoay máy), đo trước khi vẽ: chọn cỡ chữ lớn nhất còn vừa. Chưa đo được thì undefined, app-core coi như ô 320px. */
function useCellWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState<number>();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setWidth(el.getBoundingClientRect().width || undefined);
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Phông Inter nạp kiểu swap: lần đo đầu có thể đang ở phông dự phòng, nạp xong thì đo lại. */
function useFontsReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    void document.fonts?.ready.then(() => {
      if (live) setReady(true);
    });
    return () => {
      live = false;
    };
  }, []);
  return ready;
}

function Stat({ label, value, href }: { label: string; value: string; href: string }) {
  const [cell, cellWidth] = useCellWidth<HTMLAnchorElement>();
  const text = useRef<HTMLSpanElement>(null);
  // Bước đã lùi sau khi đo chữ thật, gắn với đúng số, bề ngang ô và phông lúc đo; đổi một trong ba thì đo lại từ bước ước lượng.
  const [fit, setFit] = useState<{ key: string; step: number } | null>(null);
  const fontsReady = useFontsReady();
  const key = `${value}|${cellWidth ?? ''}|${fontsReady}`;
  const step = fit?.key === key ? fit.step : statValueStart(value, cellWidth);
  const last = STAT_VALUE_LOOKS.length - 1;
  useLayoutEffect(() => {
    const width = text.current?.getBoundingClientRect().width;
    if (!cellWidth || !width || step >= last || statValueFits(width, cellWidth)) return;
    setFit({ key, step: step + 1 });
  }, [key, step, cellWidth, last]);
  const look = STAT_VALUE_LOOKS[step]!;
  return (
    <Link
      ref={cell}
      href={href}
      className="tubu-press block min-h-11 rounded-card bg-[var(--color-bg-surface)] px-1 py-2.5 text-center shadow-e1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest-600"
    >
      <Text
        variant={look.variant}
        as="div"
        tone="brand"
        style={{ fontVariantNumeric: 'tabular-nums', lineHeight: STAT_VALUE_LINE_HEIGHT, letterSpacing: look.letterSpacing, overflowWrap: 'anywhere' }}
      >
        <span ref={text} style={step < last ? { whiteSpace: 'nowrap' } : undefined}>
          {value}
        </span>
      </Text>
      <Text variant="caption" tone="tertiary" as="div">
        {label}
      </Text>
    </Link>
  );
}

/**
 * Trang Cá nhân, bản web của `pages/profile.tsx` ở Mini App: thẻ danh tính (không bấm), hai số dư (Điểm Xanh, Ví), hàng bốn trạng thái đơn
 * mở danh sách đã lọc, rồi một thẻ dòng gọn từ `buildAccountMenu` (cùng dòng với Mini App). Dưới md giống Mini App; từ md bỏ dòng đã có ở
 * cột trái AccountShell và thêm khối đơn có ô tìm.
 */
function AccountContent() {
  const { user } = useAuth();
  const phase = useAuthPhase();
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  // Chép và chia sẻ mã giới thiệu cùng một đối tượng nên chung một khoá; tải lại số đếm/hạng là khoá riêng (hai nút Thử lại dùng chung).
  const referralLock = useActionLock();
  const reloadLock = useActionLock();
  const authed = phase === 'authenticated';
  // Hồ sơ trong phiên đăng nhập là ảnh chụp lúc đăng nhập: số điểm/ví phải đổi ngay sau khi đặt đơn hay huỷ đơn, nên lấy lại mỗi lần vào trang và quay lại tab.
  const meQ = useQuery({ queryKey: ['me'], queryFn: getMe, enabled: authed, refetchOnWindowFocus: true });
  const loyaltyQ = useQuery({ ...loyaltyQuery(coreHttp), enabled: authed });
  const couponsQ = useQuery({ ...couponsQuery(coreHttp), enabled: authed });
  const summaryQ = useMeSummary();
  const referralQ = useQuery({ ...referralQuery(coreHttp), enabled: authed });
  const badgesQ = useBadges();
  const referralRef = useRef<HTMLLIElement>(null);
  const wantsReferral = useSearchParams()?.get('section') === PROFILE_REFERRAL_SECTION;
  const referralReady = referralQ.isSuccess || referralQ.isError;
  const [open, setOpen] = useState<Partial<Record<ProfileRowKey, boolean>>>(() => (wantsReferral ? { invite: true } : {}));
  useEffect(() => {
    if (wantsReferral) setOpen((o) => (o.invite ? o : { ...o, invite: true }));
  }, [wantsReferral]);
  useEffect(() => {
    if (wantsReferral && referralReady) referralRef.current?.scrollIntoView?.({ block: 'start' });
  }, [wantsReferral, referralReady]);
  const cfgQ = useQuery({ ...publicConfigQuery(coreHttp), enabled: authed });
  const chatEnabled = cfgQ.data?.chat?.enabled === true;
  const chatSummaryQ = useQuery({ ...supportChatSummaryQuery(coreHttp), enabled: authed && chatEnabled });
  const chatUnread = chatEnabled && (chatSummaryQ.data?.unreadCount ?? 0) > 0;
  // 404 nghĩa là không sở hữu nhãn / chưa có hồ sơ đại lý (bình thường), nên không thử lại và giữ kết quả 5 phút.
  const ownsBrandQ = useQuery({ ...ownsBrandQuery(coreHttp), enabled: authed, retry: false });
  const ownedBrandQ = useQuery({
    ...ownedBrandProfileQuery(coreHttp),
    enabled: authed && !ownsBrandQ.isPending && ownsBrandQ.data !== false,
    retry: false,
    staleTime: 5 * 60_000,
  });
  const dealerQ = useQuery({ ...dealerMeQuery(coreHttp), enabled: authed, retry: false });
  // Chỉ hỏi quầy khi có lý do (nhân viên/admin kho, đại lý, hoặc cờ hasDeskPoint của /auth/me cho nhân viên điểm đối tác mang vai CUSTOMER)
  // để khách thường không bị gọi thêm API. Cờ chung một lần gọi /auth/me với ownsBrand; cờ đổi rác tắt thì điểm đối tác không mở quầy.
  const hasDeskPointQ = useQuery({ ...hasDeskPointQuery(coreHttp), enabled: authed, retry: false });
  const wasteOn = cfgQ.data?.waste?.enabled === true;
  const recycleOpenRequests = useRecycleOpenRequests(authed, cfgQ.isSuccess && !wasteOn);
  const mayHaveDesk = user?.role === 'STAFF' || user?.role === 'ADMIN' || (user?.role === 'DEALER' && wasteOn) || (hasDeskPointQ.data === true && wasteOn);
  const deskQ = useQuery({ ...deskPointsQuery(coreHttp), enabled: authed && mayHaveDesk, staleTime: 5 * 60_000, retry: false });
  // Chỉ vai không rõ quyền CTV (đại lý, nhân viên, admin) mới cần hỏi; CTV và khách thường suy được từ vai trò.
  const needsCtvProbe = authed && !!user?.role && user.role !== 'CUSTOMER' && user.role !== 'AFFILIATE';
  const ctvAccessQ = useQuery({ ...affiliateMeQuery(coreHttp), enabled: needsCtvProbe, retry: false });

  if (phase === 'loading') {
    return (
      <main className={`${PAGE_WIDE} py-20 text-center`}>
        <h1 className="sr-only">Cá nhân</h1>
        <AuthLoading />
      </main>
    );
  }

  if (phase === 'unavailable') {
    return (
      <main className={`${PAGE_WIDE} py-6`}>
        <h1 className={ui.pageTitle}>Cá nhân</h1>
        <SessionUnavailable />
      </main>
    );
  }

  if (phase === 'guest' || !user) {
    return (
      <main className={`${PAGE_WIDE} py-6`}>
        <h1 className={ui.pageTitle}>Cá nhân</h1>
        <LoginRequired message="Đăng nhập để xem tích điểm, đơn hàng và ưu đãi cá nhân của bạn." returnTo="/tai-khoan" />
      </main>
    );
  }

  const balances = meQ.data ?? user;
  const points = pointsSummary(balances);
  const fullName = meQ.data?.fullName !== undefined ? meQ.data.fullName : user.fullName;
  const tierName = loyaltyQ.data?.tier?.name ?? null;
  const tierFailed = loyaltyQ.isError && !loyaltyQ.data;
  const referral = referralQ.data;
  const code = referral?.referralCode ?? user.referralCode;
  // CTV chỉ hưởng hoa hồng, không nhận Điểm Xanh giới thiệu: khối không hứa thưởng điểm cho họ.
  const earnsPoints = user.role !== 'AFFILIATE';
  const welcomeOffer = welcomeOfferOf(cfgQ.data);
  const referralRules = { referrerPoints: referral?.referrerRewardPoints, minOrderAmount: referral?.minOrderAmount, windowDays: referral?.windowDays };

  const menu = buildAccountMenu({
    role: user.role,
    chatEnabled,
    aiEnabled: cfgQ.data?.aiAdvisorEnabled === true,
    wasteEnabled: wasteOn,
    recycleOpenRequests,
    badgesEnabled: badgesQ.data?.enabled === true,
    hasReferralCode: !!code,
    couponCount: couponsQ.data?.length,
    unreadNotifications: summaryQ.data?.unreadNotifications,
    dealer: dealerQ.data,
    ctvAccess: ctvAccessQ.data,
    ownedBrandName: ownsBrandQ.data === false ? undefined : ownedBrandQ.data?.name,
    deskPointNames: deskQ.data?.map((p) => p.name),
    isReady: isWebRouteReady,
  });

  const countsFailed = summaryQ.isError;
  const reloadCounts = () => {
    void reloadLock.run('counts', () => summaryQ.refetch());
  };

  const countFor = (key: string): number | null => {
    if (!summaryQ.data) return null;
    return summaryQ.data.orders[key as keyof typeof summaryQ.data.orders] ?? null;
  };

  const copyReferral = () => {
    if (!code) return;
    void referralLock.run('copy', async () => {
      try {
        await navigator.clipboard.writeText(inviteLink(window.location.origin, code));
        setCopyMsg(fillCopy('invite.copied'));
      } catch {
        setCopyMsg(fillCopy('invite.copyFailed', { code }));
      }
    });
  };
  const shareReferral = () => {
    if (!code) return;
    void referralLock.run('share', async () => {
      const url = inviteLink(window.location.origin, code);
      if (typeof navigator.share === 'function') {
        try {
          await navigator.share({ title: fillCopy('invite.shareTitle'), text: shareDescription(null, welcomeOffer), url });
          return;
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') return;
        }
      }
      try {
        await navigator.clipboard.writeText(inviteShareText(url));
        setCopyMsg(fillCopy('invite.copied'));
      } catch {
        setCopyMsg(fillCopy('invite.copyFailed', { code }));
      }
    });
  };

  return (
    <main className={`${PAGE_WIDE} py-6 max-md:px-0 max-md:py-0 max-md:pb-4 tabular-nums`}>
      <div className="max-md:hidden">
        <BackLink href="/" crumbs={[{ label: 'Trang chủ', href: '/' }, { label: 'Tài khoản' }]}>
          ← Trang chủ
        </BackLink>
      </div>
      <h1 className="sr-only">Cá nhân</h1>

      <div className="md:mt-3 md:items-start lg:grid lg:grid-cols-2 lg:gap-4 xl:grid-cols-3">
       <div className="lg:col-span-full">
        <div data-surface="inverse" className="bg-[linear-gradient(135deg,var(--color-action-primary-bg),var(--color-action-primary-bg-pressed))] p-4 pb-7 text-[color:var(--color-text-inverse)] md:rounded-card">
          <div className="flex min-h-11 items-center gap-3">
            <ProfileAvatar size={56} name={fullName} src={user.avatarUrl} />
            <span className="min-w-0 flex-1">
              <Heading variant="title-md" as="span" tone="inverse" style={{ display: 'block', lineHeight: 1.2 }}>
                {fullName ?? 'Khách Tubu'}
              </Heading>
              <span className="mt-1.5 flex items-center">
                {tierName ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-forest-50 px-2 py-0.5 text-caption font-semibold text-forest-800">
                    <Leaf className="h-3.5 w-3.5" aria-hidden="true" />
                    {tierName}
                  </span>
                ) : !tierFailed ? (
                  <span aria-hidden="true" className="inline-block h-6 w-[76px] rounded-full" style={{ background: 'color-mix(in srgb, var(--color-text-inverse) 28%, transparent)' }} />
                ) : null}
              </span>
            </span>
          </div>
          {tierFailed && (
            <div role="alert" className="mt-2 flex items-center justify-between gap-2">
              <span className="text-caption">{homeCopy.member.tierFailed}</span>
              <button
                type="button"
                aria-busy={reloadLock.busy || undefined}
                aria-disabled={reloadLock.busy || undefined}
                onClick={() => {
                  void reloadLock.run('counts', () => Promise.all([loyaltyQ.refetch(), summaryQ.refetch()]));
                }}
                className="tubu-press -my-3 -mx-1.5 min-h-11 px-1.5 text-caption font-bold underline"
              >
                {homeCopy.member.retry}
              </button>
            </div>
          )}
        </div>

        <div className="relative -mt-5 grid grid-cols-2 gap-2 px-3">
          <Stat label={homeCopy.profile.statPoints} value={`${points.total.toLocaleString('vi-VN')} điểm`} href="/tai-khoan/diem-xanh" />
          <Stat label={homeCopy.profile.statWallet} value={formatVnd(balances.walletBalance)} href="/tai-khoan/vi-tubu" />
        </div>
       </div>

        <section aria-label={homeCopy.profile.ordersTitle} className="px-4 pt-3 md:px-0 lg:col-span-full lg:pt-0 xl:col-span-2">
          <Card padding={12}>
            <div className="mb-2 flex items-center justify-between">
              <Heading variant="title-sm" as="h2">
                {homeCopy.profile.ordersTitle}
              </Heading>
              <Link
                href="/tai-khoan/don-hang"
                aria-label={homeCopy.profile.ordersAllLabel}
                className="tubu-press inline-flex min-h-11 items-center text-[color:var(--color-text-brand)]"
              >
                <Text variant="caption" tone="brand">
                  {homeCopy.profile.ordersAll}
                </Text>
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
            <div className="grid grid-cols-4 gap-1">
              {PROFILE_ORDER_ROW.map((r) => {
                const n = r.counted ? countFor(r.key) : null;
                const RowIcon = ORDER_ROW_ICON[r.key] ?? Package;
                return (
                  <Link
                    key={r.key}
                    href={`/tai-khoan/don-hang?tab=${r.key}`}
                    aria-label={homeCopy.profile.orderStatusLabel(r.label, n ?? 0)}
                    className="tubu-press flex min-h-16 flex-col items-center justify-start gap-1.5 py-1"
                  >
                    <span className="relative mt-1 inline-flex">
                      <RowIcon className="h-6 w-6 text-[color:var(--color-text-brand)]" strokeWidth={1.75} aria-hidden="true" />
                      {n != null && n > 0 && (
                        <span
                          data-testid="order-count-badge"
                          aria-hidden="true"
                          className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-action-primary-bg)] px-1 text-xs font-bold leading-none tabular-nums text-[color:var(--color-action-primary-fg)]"
                        >
                          {n > 99 ? '99+' : n}
                        </span>
                      )}
                    </span>
                    <Text variant="caption" tone="secondary" as="div" style={{ textAlign: 'center', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
                      {orderRowLabel(r.key, r.label)}
                    </Text>
                  </Link>
                );
              })}
            </div>
            {countsFailed && (
              <div role="alert" className="mt-1 flex items-center justify-between gap-2">
                <Text variant="caption" tone="secondary">
                  {profileCopy.ordersFailed}
                </Text>
                <Button variant="ghost" loading={reloadLock.busy} onPress={reloadCounts}>
                  {homeCopy.member.retry}
                </Button>
              </div>
            )}
          </Card>
        </section>

        <BadgeRow />

        <div className="mx-4 mt-3 md:mx-0 lg:col-span-full lg:mt-0 xl:col-span-1 xl:col-start-3 xl:row-start-2">
          <ul className="divide-y divide-[var(--color-border-subtle)] overflow-hidden rounded-card bg-[var(--color-bg-surface)] shadow-e1">
            {menu.map((row) => {
              // Từ md, dòng đã có ở cột trái AccountShell thì ẩn để hai bên không lặp.
              const shellDup = IN_ACCOUNT_SHELL.has(row.key) ? 'md:hidden' : undefined;
              if (row.kind === 'link') {
                return (
                  <li key={row.key} className={shellDup}>
                    <Link href={row.to} className={ROW}>
                      <RowBody icon={row.icon} label={row.label} hint={row.hint} />
                    </Link>
                  </li>
                );
              }
              const expanded = open[row.key] === true;
              const panelId = `account-${row.key}-panel`;
              const unreadHere = row.key === 'support' && chatUnread && !expanded;
              const isInvite = row.key === 'invite';
              return (
                <li key={row.key} id={isInvite ? PROFILE_REFERRAL_SECTION : undefined} ref={isInvite ? referralRef : undefined} className={shellDup}>
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={panelId}
                    aria-label={unreadHere ? PROFILE_MENU_COPY.unreadName(row.label) : undefined}
                    onClick={() => setOpen((o) => ({ ...o, [row.key]: !expanded }))}
                    className={ROW}
                  >
                    <RowBody icon={row.icon} label={row.label} hint={row.hint} dot={unreadHere ? 'support' : undefined} expanded={expanded} />
                  </button>
                  <div id={panelId} hidden={!expanded}>
                    {isInvite ? (
                      <div className="px-3 pb-3">
                        <Text variant="body-sm" tone="secondary" as="p">
                          {inviteBody(welcomeOffer, referralRules, earnsPoints)}
                        </Text>
                        {referral && earnsPoints && (referral.successCount > 0 || referral.earnedPoints > 0) && (
                          <Text variant="caption" tone="secondary" as="p" style={{ marginTop: 6 }}>
                            {homeCopy.profile.referralStats(referral.successCount, `${formatCount(referral.earnedPoints)} điểm`)}
                          </Text>
                        )}
                        {/* Đã đủ hoặc vượt mốc (successCount cập nhật trước nextMilestone): không còn "Mời thêm 0/-2 bạn". */}
                        {referral?.nextMilestone && earnsPoints && referral.nextMilestone.count > referral.successCount && (
                          <Text variant="caption" tone="brand" as="p" style={{ marginTop: 4 }}>
                            {homeCopy.profile.referralMilestone(referral.nextMilestone.count - referral.successCount, `${formatCount(referral.nextMilestone.bonusPoints)} điểm`)}
                          </Text>
                        )}
                        <p className="mt-2.5 text-caption tabular-nums text-[color:var(--color-action-secondary-fg)]">
                          {fillCopy('invite.codeLabel')}: <strong>{code}</strong>
                        </p>
                        <div className="mt-2 flex flex-col gap-2">
                          <button
                            type="button"
                            aria-busy={referralLock.active === 'share' || undefined}
                            aria-disabled={referralLock.busy || undefined}
                            onClick={shareReferral}
                            className={`${ui.btnPrimary} w-full gap-2`}
                          >
                            <Share2 className="h-4 w-4" aria-hidden="true" />
                            {fillCopy('invite.shareZalo')}
                          </button>
                          <button
                            type="button"
                            aria-busy={referralLock.active === 'copy' || undefined}
                            aria-disabled={referralLock.busy || undefined}
                            onClick={copyReferral}
                            className={`${ui.btnSecondary} w-full gap-2`}
                          >
                            <Copy className="h-4 w-4" aria-hidden="true" />
                            {fillCopy('invite.copyLink')}
                          </button>
                        </div>
                        <p role="status" className={copyMsg ? 'mt-1.5 text-caption text-stone-600' : 'sr-only'}>
                          {copyMsg ?? ''}
                        </p>
                      </div>
                    ) : (
                      <ul>
                        {row.children.map((item) => {
                          const chatDot = item.key === 'chat' && chatUnread;
                          return (
                            <li key={item.key}>
                              <Link href={item.to} aria-label={chatDot ? PROFILE_MENU_COPY.unreadName(item.label) : undefined} className={CHILD_ROW}>
                                <RowBody icon={item.icon} label={item.label} hint={item.hint} dot={chatDot ? 'chat' : undefined} />
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div data-testid="account-orders-section" className="max-md:hidden lg:col-span-full">
          <OrdersSection />
        </div>

        <div className="h-4" />
      </div>
    </main>
  );
}

// Trang đọc useSearchParams (?section=referral): build tĩnh bắt buộc có Suspense bao ngoài.
export default function AccountPage() {
  return (
    <Suspense
      fallback={
        <main className={`${PAGE_WIDE} py-20 text-center`}>
          <h1 className="sr-only">Cá nhân</h1>
          <AuthLoading />
        </main>
      }
    >
      <AccountContent />
    </Suspense>
  );
}
