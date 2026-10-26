'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQueries, useQuery } from '@tanstack/react-query';
import { ChevronRight, Copy, Leaf, Pencil, User } from 'lucide-react';
import { fetchOrders } from '@tubutree/app-core/api/orders';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { ORDER_STATUS_ROW } from '@tubutree/app-core/home-layout';
import { notificationsQuery } from '@tubutree/app-core/queries/account';
import { dealerMeQuery } from '@tubutree/app-core/queries/dealer';
import { affiliateMeQuery } from '@tubutree/app-core/queries/affiliate';
import { couponsQuery, loyaltyQuery, referralQuery } from '@tubutree/app-core/queries/loyalty';
import { ownedBrandProfileQuery, ownsBrandQuery } from '@tubutree/app-core/queries/brand-owner';
import { publicConfigQuery } from '@tubutree/app-core/queries/config';
import { subscriptionsQuery } from '@tubutree/app-core/queries/subscriptions';
import { supportChatSummaryQuery } from '@tubutree/app-core/queries/support-chat';
import { useAuth } from '@/lib/auth-context';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { isWebRouteReady } from '@/lib/route-map';
import { formatVnd, getMe } from '@/lib/shop-client';
import { ui } from '@/lib/guest-ui';
import { pointsSummary } from '@/lib/checkout-points';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { buildAccountMenu, type AccountMenuItem } from '@/components/account/account-menu';
import { ORDERS_TABS } from '@/components/orders/orders-tabs';
import { Button, Card, Heading, Text } from '@/components/mini';
import { OrdersSection } from './orders-section';
import BackLink from '@/components/back-link';

const ORDER_ROW_TARGETS = ORDER_STATUS_ROW.filter((r) => r.counted && r.key !== 'subscriptions');
const ROW =
  'flex min-h-11 w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest-600';

function RowBody({ item, unread = 0, dot = false }: { item: AccountMenuItem; unread?: number; dot?: boolean }) {
  const Icon = item.icon;
  return (
    <>
      <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-control bg-[var(--color-bg-subtle)] text-forest-600">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-stone-900">{item.label}</span>
        {item.hint && <span className="block text-xs text-stone-600">{item.hint}</span>}
      </span>
      {unread > 0 && (
        <span aria-hidden="true" className="flex h-[18px] min-w-[18px] flex-none items-center justify-center rounded-full bg-forest-600 px-1.5 text-xs font-bold text-stone-0">
          {unread}
        </span>
      )}
      {dot && <span data-testid="chat-unread-dot" aria-hidden="true" className="h-2.5 w-2.5 flex-none rounded-full bg-[var(--color-action-danger-bg)]" />}
      <ChevronRight className="h-4 w-4 flex-none text-stone-600" aria-hidden="true" />
    </>
  );
}

function Stat({ label, value, href }: { label: string; value: string; href: string }) {
  return (
    <Link
      href={href}
      aria-label={`${label}: ${value}`}
      className="tubu-press block min-h-11 rounded-card bg-[var(--color-bg-surface)] px-1 py-2.5 text-center shadow-[var(--elevation-1)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest-600"
    >
      <Text variant="price-md" as="div" tone="brand" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Text>
      <Text variant="caption" tone="tertiary" as="div">
        {label}
      </Text>
    </Link>
  );
}

/**
 * Trang Cá nhân, bản web của `pages/profile.tsx` ở Mini App: hồ sơ, ba số (Điểm Xanh, Ví, Mã giảm giá), hàng trạng thái đơn mở danh sách
 * đã lọc, mã giới thiệu, rồi ba nhóm Kiếm tiền cùng Tubu / Tài khoản / Hỗ trợ. Dưới md giống Mini App; từ md giữ khung giữa trang và khối đơn có ô tìm.
 */
export default function AccountPage() {
  const { user, logout } = useAuth();
  const phase = useAuthPhase();
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const authed = phase === 'authenticated';
  // Hồ sơ trong phiên đăng nhập là ảnh chụp lúc đăng nhập: số điểm/ví phải đổi ngay sau khi đặt đơn hay huỷ đơn, nên lấy lại mỗi lần vào trang và quay lại tab.
  const meQ = useQuery({ queryKey: ['me'], queryFn: getMe, enabled: authed, refetchOnWindowFocus: true });
  const loyaltyQ = useQuery({ ...loyaltyQuery(coreHttp), enabled: authed });
  const couponsQ = useQuery({ ...couponsQuery(coreHttp), enabled: authed });
  const notifQ = useQuery({ ...notificationsQuery(coreHttp), enabled: authed });
  const referralQ = useQuery({ ...referralQuery(coreHttp), enabled: authed });
  const subsQ = useQuery({ ...subscriptionsQuery(coreHttp), enabled: authed });
  const orderCounts = useQueries({
    queries: ORDER_ROW_TARGETS.map((r) => {
      const filter = ORDERS_TABS.find((t) => t.key === r.key)?.filter ?? {};
      return {
        queryKey: ['orders', 'count', r.key],
        queryFn: () => fetchOrders(coreHttp, filter, 1, 1).then((res) => res.meta.total),
        enabled: authed,
      };
    }),
  });
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
  // Chỉ vai không rõ quyền CTV (đại lý, nhân viên, admin) mới cần hỏi; CTV và khách thường suy được từ vai trò.
  const needsCtvProbe = authed && !!user?.role && user.role !== 'CUSTOMER' && user.role !== 'AFFILIATE';
  const ctvAccessQ = useQuery({ ...affiliateMeQuery(coreHttp), enabled: needsCtvProbe, retry: false });

  if (phase === 'loading') {
    return (
      <main className="mx-auto max-w-5xl px-4 py-20 text-center">
        <h1 className="sr-only">Cá nhân</h1>
        <AuthLoading />
      </main>
    );
  }

  if (phase === 'unavailable') {
    return (
      <main className="mx-auto max-w-5xl px-4 py-6">
        <h1 className={ui.pageTitle}>Cá nhân</h1>
        <SessionUnavailable />
      </main>
    );
  }

  if (phase === 'guest' || !user) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-6">
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
  const unread = notifQ.data?.filter((n) => n.status !== 'READ').length ?? 0;
  const referral = referralQ.data;
  const code = referral?.referralCode ?? user.referralCode;
  const minOrder = referral?.minOrderAmount ? formatVnd(referral.minOrderAmount) : null;

  const menu = buildAccountMenu({
    role: user.role,
    aiEnabled: cfgQ.data?.aiAdvisorEnabled === true,
    chatEnabled,
    dealer: dealerQ.data,
    ctvAccess: ctvAccessQ.data,
    ownedBrandName: ownsBrandQ.data === false ? undefined : ownedBrandQ.data?.name,
    isReady: isWebRouteReady,
  });

  const countFor = (key: string): number | null => {
    if (key === 'subscriptions') return subsQ.data ? subsQ.data.filter((x) => x.status === 'ACTIVE' || x.status === 'PAUSED').length : null;
    const i = ORDER_ROW_TARGETS.findIndex((r) => r.key === key);
    return i >= 0 ? (orderCounts[i]?.data ?? null) : null;
  };

  const copyReferral = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopyMsg('Đã sao chép mã giới thiệu');
    } catch {
      setCopyMsg(`Không sao chép được — mã của bạn: ${code}`);
    }
  };
  const shareReferral = async () => {
    if (!code) return;
    const url = `${window.location.origin}/?ref=${encodeURIComponent(code)}`;
    const text = `Dùng mã ${code} khi mua hàng ở Tubu Tree nhé: ${url}`;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'Tubu Tree — Trồng cây, nhận quà', text, url });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopyMsg('Đã sao chép lời mời kèm liên kết');
    } catch {
      setCopyMsg(`Không chia sẻ được — mã của bạn: ${code}`);
    }
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 max-md:max-w-none max-md:px-0 max-md:py-0 max-md:pb-4">
      <div className="max-md:hidden">
        <BackLink href="/">← Trang chủ</BackLink>
      </div>
      <h1 className="sr-only">Cá nhân</h1>

      <div className="md:mx-auto md:mt-3 md:max-w-2xl">
        <div className="bg-[linear-gradient(135deg,var(--color-action-primary-bg),var(--color-action-primary-bg-pressed))] p-4 pb-7 text-[color:var(--color-text-inverse)] md:rounded-card">
          <Link href="/tai-khoan/ho-so" className="tubu-press flex min-h-11 items-center gap-3 rounded-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-stone-0">
            {user.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- URL Cloudinary, domain không cố định
              <img src={user.avatarUrl} alt="" className="h-14 w-14 flex-none rounded-full bg-forest-700 object-cover" />
            ) : (
              <span className="flex h-14 w-14 flex-none items-center justify-center rounded-full bg-forest-700 text-forest-100">
                <User className="h-7 w-7" aria-hidden="true" />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <Heading variant="title-md" as="span" tone="inverse" style={{ display: 'block', lineHeight: 1.2 }}>
                {fullName ?? 'Khách Tubu'}
              </Heading>
              <span className="mt-1.5 flex flex-wrap items-center gap-2">
                {tierName ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-forest-50 px-2 py-0.5 text-xs font-semibold text-forest-800">
                    <Leaf className="h-3.5 w-3.5" aria-hidden="true" />
                    {tierName}
                  </span>
                ) : !tierFailed ? (
                  <span aria-hidden="true" className="inline-block h-6 w-[76px] rounded-full" style={{ background: 'color-mix(in srgb, var(--color-text-inverse) 28%, transparent)' }} />
                ) : null}
                <span className="inline-flex items-center gap-1 rounded-full border border-stone-0 px-2 py-0.5 text-xs font-semibold">
                  <Pencil className="h-3 w-3" aria-hidden="true" />
                  {homeCopy.profile.editProfile}
                  <ChevronRight className="h-3 w-3" aria-hidden="true" />
                </span>
              </span>
            </span>
          </Link>
          {tierFailed && (
            <div role="alert" className="mt-2 flex items-center justify-between gap-2">
              <span className="text-xs">{homeCopy.member.tierFailed}</span>
              <button
                type="button"
                onClick={() => void loyaltyQ.refetch()}
                className="tubu-press -my-3 -mx-1.5 min-h-11 px-1.5 text-xs font-bold underline"
              >
                {homeCopy.member.retry}
              </button>
            </div>
          )}
        </div>

        <div className="relative -mt-5 grid grid-cols-3 gap-2 px-3">
          <Stat label={homeCopy.profile.statPoints} value={`${points.total.toLocaleString('vi-VN')} điểm`} href="/tai-khoan/diem-xanh" />
          <Stat label={homeCopy.profile.statWallet} value={formatVnd(balances.walletBalance)} href="/tai-khoan/vi-tubu" />
          <Stat label={homeCopy.profile.statCoupons} value={couponsQ.data ? homeCopy.profile.couponsCount(couponsQ.data.length) : '—'} href="/uu-dai?section=coupons" />
        </div>

        <section aria-label={homeCopy.profile.ordersTitle} className="px-4 pt-3">
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
            <div className="grid grid-cols-5 gap-1">
              {ORDER_STATUS_ROW.map((r) => {
                const n = r.counted ? countFor(r.key) : null;
                return (
                  <Link
                    key={r.key}
                    href={`/tai-khoan/don-hang?tab=${r.key}`}
                    aria-label={homeCopy.profile.orderStatusLabel(r.label, n ?? 0)}
                    className="tubu-press flex min-h-14 flex-col items-center justify-center gap-0.5 py-1"
                  >
                    <Text variant="price-md" as="div" tone={n ? 'brand' : 'tertiary'} style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {n ?? '·'}
                    </Text>
                    <Text variant="caption" tone="secondary" as="div" style={{ textAlign: 'center', lineHeight: 1.2 }}>
                      {r.label}
                    </Text>
                  </Link>
                );
              })}
            </div>
          </Card>
        </section>

        {code && (
          <section aria-label={homeCopy.profile.referralTitle} className="px-4 pt-3">
            <Card padding={12}>
              <Heading variant="title-sm" as="h2">
                {homeCopy.profile.referralTitle}
              </Heading>
              <Text variant="body-sm" tone="secondary" as="p" style={{ marginTop: 4 }}>
                {homeCopy.profile.referralBody(minOrder, referral?.windowDays ?? null)}
              </Text>
              <div className="mt-2.5 flex items-center gap-2">
                <button
                  type="button"
                  aria-label={`${homeCopy.profile.referralCopy} mã ${code}`}
                  onClick={() => void copyReferral()}
                  className="tubu-press flex min-h-11 min-w-0 flex-1 items-center justify-between gap-2 rounded-control bg-[var(--color-action-secondary-bg)] px-3 py-2 text-left"
                >
                  <Text variant="caption" style={{ color: 'var(--color-action-secondary-fg)' }}>
                    {homeCopy.profile.referralCode}: <strong>{code}</strong>
                  </Text>
                  <Copy className="h-4 w-4 flex-none text-forest-600" aria-hidden="true" />
                </button>
                <button type="button" onClick={() => void shareReferral()} className={`${ui.btnPrimary} flex-none`}>
                  {homeCopy.profile.referralShare}
                </button>
              </div>
              <p role="status" className={copyMsg ? 'mt-1.5 text-xs text-stone-600' : 'sr-only'}>
                {copyMsg ?? ''}
              </p>
            </Card>
          </section>
        )}

        {menu.map((section, gi) => (
          <section key={section.group} aria-labelledby={`account-g${gi}`} className="mx-4 mt-3">
            <h2 id={`account-g${gi}`} className="mb-1.5 ml-1 text-xs font-semibold uppercase tracking-wide text-[color:var(--color-text-tertiary)]">
              {section.group}
            </h2>
            <ul className="divide-y divide-[var(--color-border-subtle)] overflow-hidden rounded-card bg-[var(--color-bg-surface)] shadow-[var(--elevation-1)]">
              {section.items.map((item) => {
                const isNotif = item.to === '/tai-khoan/thong-bao';
                const isChat = item.to === '/ho-tro/chat';
                return (
                  <li key={item.to}>
                    <Link href={item.to} aria-label={isNotif && unread > 0 ? `${item.label}, ${unread} chưa đọc` : isChat && chatUnread ? `${item.label}, có tin mới` : undefined} className={ROW}>
                      <RowBody item={item} unread={isNotif ? unread : 0} dot={isChat && chatUnread} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        <div className="max-md:hidden">
          <OrdersSection />
        </div>

        <div className="p-4">
          <Button fullWidth variant="secondary" onPress={() => void logout()}>
            Đăng xuất
          </Button>
        </div>
      </div>
    </main>
  );
}
