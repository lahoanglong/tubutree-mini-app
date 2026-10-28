import { ctvMenuEntry } from '@tubutree/app-core/storefront-signup';
import { Page, useNavigate, useSnackbar } from 'zmp-ui';
import { useQueries, useQuery } from '@tanstack/react-query';
import {
  Heart, MapPin, MessageCircle, Leaf, GraduationCap, Users, Pencil, Bell, Store, Settings, Info, ChevronRight, Copy, Sparkles, BookOpen, ShieldCheck, CalendarClock, Wallet, BadgeDollarSign, CreditCard, Package, Truck, PackageCheck, Repeat, type LucideIcon,
} from 'lucide-react';
import { canSeeAcademy, orderRowLabel, profileCopy } from '@tubutree/app-core/account-copy';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { CASHBACK_ENABLED } from '../utils/features';
import { ORDER_STATUS_ROW } from '@tubutree/app-core/home-layout';
import { useAuthStore } from '../store/auth';
import { getCoupons, getLoyalty, getNotifications, getReferral, getWallet } from '../services/account-api';
import { ProfileAvatar } from '../components/account/profile-avatar';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { EmptyState } from '../components/ui/empty-state';
import { AuthPhaseView } from '../components/ui/auth-gate';
import { useAuthPhase } from '../hooks/use-auth-phase';
import { Icon } from '../components/ui/icon';
import { ListRow } from '../components/ui/list-row';
import { rowKeyboardProps } from '../components/ui/row-keyboard';
import { Skeleton } from '../components/ui/skeleton';
import { SR_ONLY } from '../components/ui/sr-only';
import { Heading, Text } from '../components/ui/text';
import { GuestLinkCard } from '../components/home/guest-link-card';
import { useShareWithFallback } from '../components/share-sheet';
import { ORDERS_TABS } from '../components/orders/orders-tabs';
import { getOwnedBrand, getOwnsBrand } from '../services/brand-owner-api';
import { isNotFoundError } from '../services/api';
import { getDealerMe } from '../services/dealer-api';
import { fetchOrders } from '../services/shop-api';
import { getSubscriptions } from '../services/subscriptions-api';
import { getAffiliateMe } from '../services/affiliate-api';
import { supportChatSummaryQueryOptions } from '../services/support-chat-api';
import { useAiAdvisorEnabled, usePublicConfig } from '../hooks/use-public-config';
import { formatVnd, formatPoints } from '../utils/format';
import { haptic } from '../utils/haptic';
import { copyText } from '../utils/clipboard';
import { pointsSummary } from '../utils/points-lots';
import { WEB_BASE_URL } from '../utils/web-base-url';

interface MenuItem {
  Icon: LucideIcon;
  label: string;
  to: string;
  hint?: string;
}

const PAGE_TITLE = 'Cá nhân';

/** Trang Cá nhân gọn (KP mục 3): Đơn, Điểm, Ví, Mã giảm giá và mọi thứ về tiền/quà đã chuyển sang Ưu đãi hoặc dải trạng thái đơn. */
export const MENU: { group: string; items: MenuItem[] }[] = [
  {
    group: homeCopy.profile.groupEarn,
    items: [
      { Icon: Users, label: homeCopy.earn.affiliate.label, to: '/affiliate', hint: homeCopy.earn.affiliate.hint },
      { Icon: GraduationCap, label: homeCopy.earn.academy.label, to: '/academy', hint: homeCopy.earn.academy.hint },
      { Icon: Store, label: homeCopy.earn.dealer.label, to: '/dealer', hint: homeCopy.earn.dealer.hint },
    ],
  },
  {
    group: homeCopy.profile.groupAccount,
    items: [
      { Icon: Heart, label: 'Sản phẩm yêu thích', to: '/wishlist' },
      { Icon: MapPin, label: 'Sổ địa chỉ', to: '/addresses' },
      { Icon: Bell, label: 'Thông báo', to: '/notifications' },
      { Icon: Settings, label: 'Cài đặt', to: '/settings' },
    ],
  },
  {
    group: homeCopy.profile.groupSupport,
    items: [
      { Icon: MessageCircle, label: 'Chat với Tubu Tree', to: '/chat' },
      { Icon: Sparkles, label: 'Trợ lý AI 24/7', to: '/ai-advisor', hint: 'Tư vấn sản phẩm' },
      { Icon: BookOpen, label: 'Câu chuyện thương hiệu', to: '/brand-story' },
      { Icon: Info, label: 'Về Tubu Tree & Hỗ trợ', to: '/about' },
    ],
  },
];

const ORDER_ROW_ICON: Record<string, LucideIcon> = {
  pending_payment: CreditCard,
  processing: Package,
  shipping: Truck,
  delivered: PackageCheck,
  subscriptions: Repeat,
};

const ORDER_ROW_TARGETS = ORDER_STATUS_ROW.filter((r) => r.counted && r.key !== 'subscriptions');

export default function ProfilePage() {
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const shareWithFallback = useShareWithFallback();
  const { user, status } = useAuthStore();
  const phase = useAuthPhase();
  const authed = status === 'authenticated';
  const loyaltyQ = useQuery({ queryKey: ['loyalty'], queryFn: getLoyalty, enabled: authed });
  const notifQ = useQuery({ queryKey: ['notifications'], queryFn: getNotifications, enabled: authed });
  const unreadCount = notifQ.data?.filter((n) => n.status !== 'READ').length ?? 0;
  const walletQ = useQuery({ queryKey: ['wallet'], queryFn: getWallet, enabled: authed });
  const couponsQ = useQuery({ queryKey: ['coupons'], queryFn: getCoupons, enabled: authed });
  const referralQ = useQuery({ queryKey: ['referral'], queryFn: getReferral, enabled: authed });
  const subsQ = useQuery({ queryKey: ['subscriptions'], queryFn: getSubscriptions, enabled: authed });
  const orderCounts = useQueries({
    queries: ORDER_ROW_TARGETS.map((r) => {
      const filter = ORDERS_TABS.find((t) => t.key === r.key)?.filter ?? {};
      return {
        queryKey: ['orders', 'count', r.key],
        queryFn: () => fetchOrders(filter, 1, 1).then((res) => res.meta.total),
        enabled: authed,
      };
    }),
  });

  const ownsBrandQ = useQuery({ queryKey: ['auth-me', 'owns-brand'], queryFn: getOwnsBrand, enabled: authed, retry: false });
  const ownedBrandQ = useQuery({
    queryKey: ['owned-brand', 'profile'],
    queryFn: () =>
      getOwnedBrand().catch((e: unknown) => {
        if (isNotFoundError(e)) return null;
        throw e;
      }),
    enabled: authed && !ownsBrandQ.isPending && ownsBrandQ.data !== false,
    retry: false,
  });
  const dealerQ = useQuery({ queryKey: ['dealer-me'], queryFn: getDealerMe, enabled: authed, retry: false });
  // Chỉ vai không rõ quyền CTV (đại lý, nhân viên, admin) mới cần hỏi; CTV và khách thường suy được từ vai trò.
  const needsCtvProbe = status === 'authenticated' && !!user?.role && user.role !== 'CUSTOMER' && user.role !== 'AFFILIATE';
  const ctvAccessQ = useQuery({ queryKey: ['affiliate-me'], queryFn: getAffiliateMe, enabled: needsCtvProbe, retry: false });
  const dealerItem: MenuItem = dealerQ.data?.isDealer || dealerQ.data?.status === 'APPROVED'
    ? { Icon: Store, label: 'Kênh đại lý', to: '/dealer', hint: dealerQ.data?.tier?.name ?? homeCopy.earn.dealer.hint }
    : dealerQ.data?.status === 'PENDING'
      ? { Icon: Store, label: 'Hồ sơ đại lý', to: '/dealer', hint: 'Đang chờ duyệt' }
      : { Icon: Store, label: homeCopy.earn.dealer.label, to: '/dealer', hint: homeCopy.earn.dealer.hint };
  const aiEnabled = useAiAdvisorEnabled();
  const cfg = usePublicConfig();
  const chatEnabled = cfg.chat?.enabled === true;
  const chatSummaryQ = useQuery({ ...supportChatSummaryQueryOptions(), enabled: authed && chatEnabled });
  const chatUnread = chatEnabled && (chatSummaryQ.data?.unreadCount ?? 0) > 0;
  const ownedBrand = ownsBrandQ.data === false ? null : ownedBrandQ.data;
  const ctvEntry = ctvMenuEntry(user?.role, ctvAccessQ.data);

  const baseMenu = MENU.map((s) => ({
    ...s,
    items: s.items
      .filter((it) => (aiEnabled || it.to !== '/ai-advisor') && (chatEnabled || it.to !== '/chat') && (canSeeAcademy(user?.role) || it.to !== '/academy'))
      .map((it) => {
        if (it.to === '/dealer') return dealerItem;
        if (it.to === '/affiliate') return ctvEntry ? { ...it, label: ctvEntry.label, hint: ctvEntry.hint } : null;
        return it;
      })
      .filter((it): it is MenuItem => it !== null),
  })).map((s) =>
    CASHBACK_ENABLED && s.group === homeCopy.profile.groupAccount
      ? { ...s, items: [...s.items.slice(0, 3), { Icon: BadgeDollarSign, label: 'Hoàn tiền sàn ngoài', to: '/cashback' }, ...s.items.slice(3)] }
      : s,
  ).map((s) =>
    ownedBrand && s.group === homeCopy.profile.groupEarn
      ? { ...s, items: [...s.items, { Icon: Store, label: 'Quản lý nhãn hàng', to: '/brand-owner', hint: ownedBrand.name }] }
      : s,
  );
  const isStaffOrAdmin = user?.role === 'STAFF' || user?.role === 'ADMIN';
  const workItems: MenuItem[] = [];
  if (isStaffOrAdmin) {
    workItems.push({ Icon: CalendarClock, label: 'Ca làm & chấm công', to: '/staff', hint: 'Đăng ký ca, chấm công' });
    workItems.push({ Icon: Wallet, label: 'Lương của tôi', to: '/my-payroll', hint: 'Xem lương & thông tin nhận' });
  }
  if (user?.role === 'ADMIN') {
    workItems.push({ Icon: ShieldCheck, label: 'Quản trị nhân sự', to: '/admin', hint: 'Cấp quyền, duyệt ca, lương' });
  }
  const menu = workItems.length > 0 ? [...baseMenu, { group: homeCopy.profile.groupWork, items: workItems }] : baseMenu;

  if (phase !== 'authenticated' || !user) {
    return (
      <Page className="page" style={{ background: 'var(--color-bg-canvas)' }}>
        <h1 style={SR_ONLY}>{PAGE_TITLE}</h1>
        {phase === 'loading' ? (
          <ProfileSkeleton />
        ) : (
          <div style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <AuthPhaseView
              phase={phase === 'authenticated' ? 'loading' : phase}
              guest={
                <EmptyState
                  art="sprout"
                  heading="Đã đăng xuất"
                  body="Đăng nhập để xem tích điểm, đơn hàng và ưu đãi cá nhân của bạn."
                  ctaLabel="Đăng nhập ngay"
                  onCta={() => void useAuthStore.getState().login()}
                />
              }
            />
          </div>
        )}
      </Page>
    );
  }

  const tierName = loyaltyQ.data?.tier?.name ?? null;
  const tierFailed = loyaltyQ.isError && !loyaltyQ.data;
  const pointsTotal = pointsSummary(loyaltyQ.data ?? user).total;
  const referral = referralQ.data;
  const code = referral?.referralCode ?? user.referralCode;
  const minOrder = referral?.minOrderAmount ? formatVnd(referral.minOrderAmount) : null;

  const copyReferral = () => {
    haptic('light');
    if (!code) return;
    void copyText(code).then((ok) =>
      openSnackbar(
        ok
          ? { text: 'Đã sao chép mã giới thiệu', type: 'success' }
          : { text: `Không sao chép được — mã của bạn: ${code}`, type: 'info', duration: 4000 },
      ),
    );
  };
  const shareReferral = () => {
    if (!code) return;
    haptic('light');
    void shareWithFallback(
      { title: 'Tubu Tree — Trồng cây, nhận quà', description: `Dùng mã ${code} khi mua hàng ở Tubu Tree nhé!`, path: `/?ref=${code}` },
      `Dùng mã ${code} khi mua hàng ở Tubu Tree nhé: ${WEB_BASE_URL}/?ref=${code}`,
    );
  };

  const countsFailed = orderCounts.some((q) => q.isError) || (subsQ.isError && !subsQ.data);
  const reloadCounts = () => {
    orderCounts.forEach((q) => void q.refetch());
    void subsQ.refetch();
  };

  const countFor = (key: string): number | null => {
    if (key === 'subscriptions') return subsQ.data ? subsQ.data.filter((x) => x.status === 'ACTIVE' || x.status === 'PAUSED').length : null;
    const i = ORDER_ROW_TARGETS.findIndex((r) => r.key === key);
    return i >= 0 ? (orderCounts[i]?.data ?? null) : null;
  };

  return (
    <Page className="page" style={{ background: 'var(--color-bg-canvas)', paddingBottom: 100 }}>
      <h1 style={SR_ONLY}>{PAGE_TITLE}</h1>

      <div
        style={{
          background: 'linear-gradient(135deg, var(--color-action-primary-bg), var(--color-action-primary-bg-pressed))',
          color: 'var(--color-text-inverse)',
          padding: '16px 16px 28px',
          position: 'relative',
        }}
      >
        {chatEnabled && (
          <button
            type="button"
            aria-label={chatUnread ? 'Chat với Tubu Tree, có tin mới' : 'Chat với Tubu Tree'}
            className="tubu-press"
            onClick={() => {
              haptic('light');
              navigate('/chat');
            }}
            style={{ position: 'absolute', top: 8, right: 8, width: 44, height: 44, border: 'none', borderRadius: 'var(--radius-pill)', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
          >
            <Icon icon={MessageCircle} size="lg" tone="inverse" />
            {chatUnread && (
              <span data-testid="profile-chat-dot" aria-hidden style={{ position: 'absolute', top: 8, right: 8, width: 10, height: 10, borderRadius: 'var(--radius-pill)', background: 'var(--color-action-danger-bg)', border: '1.5px solid var(--color-action-primary-bg)' }} />
            )}
          </button>
        )}
        <div
          role="button"
          {...rowKeyboardProps()}
          className="tubu-press"
          onClick={() => {
            haptic('light');
            navigate('/edit-profile');
          }}
          style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 44, paddingRight: chatEnabled ? 44 : 0 }}
        >
          <ProfileAvatar size={56} name={user.fullName} src={user.avatarUrl} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <Heading variant="title-md" as="div" tone="inverse" style={{ lineHeight: 1.2 }}>
              {user.fullName ?? 'Khách Tubu'}
            </Heading>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
              {tierName ? (
                <Badge tone="brand" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Icon icon={Leaf} size="sm" tone="brand" />
                  {tierName}
                </Badge>
              ) : !tierFailed ? (
                <span aria-hidden="true" style={{ display: 'inline-block', width: 76, height: 24, borderRadius: 'var(--radius-pill)', background: 'color-mix(in srgb, var(--color-text-inverse) 28%, transparent)' }} />
              ) : null}
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--color-text-inverse)' }}>
                <Icon icon={Pencil} size="sm" tone="inverse" />
                <Text variant="label" tone="inverse">
                  {homeCopy.profile.editProfile}
                </Text>
                <Icon icon={ChevronRight} size="sm" tone="inverse" />
              </span>
            </div>
          </div>
        </div>
        {tierFailed && (
          <div role="alert" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 8 }}>
            <Text variant="caption" tone="inverse">
              {homeCopy.member.tierFailed}
            </Text>
            <button
              type="button"
              className="tubu-press"
              onClick={() => {
                haptic('light');
                void loyaltyQ.refetch();
                reloadCounts();
              }}
              style={{ minHeight: 44, margin: '-12px -6px', padding: '0 6px', border: 'none', background: 'transparent', color: 'var(--color-text-inverse)', fontFamily: 'inherit', fontSize: 'var(--type-caption-size)', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer' }}
            >
              {homeCopy.member.retry}
            </button>
          </div>
        )}
      </div>

      <div style={{ padding: '0 12px', display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, marginTop: -20, position: 'relative' }}>
        <Stat label={homeCopy.profile.statPoints} value={formatPoints(pointsTotal)} onClick={() => navigate('/loyalty')} />
        <Stat label={homeCopy.profile.statWallet} value={formatVnd(walletQ.data?.walletBalance ?? user.walletBalance)} onClick={() => navigate('/wallet', { state: { from: '/profile' } })} />
        <Stat label={homeCopy.profile.statCoupons} value={couponsQ.data ? homeCopy.profile.couponsCount(couponsQ.data.length) : '—'} onClick={() => navigate('/offers?section=coupons')} />
      </div>

      <GuestLinkCard title={homeCopy.profile.guestTitle} body={homeCopy.profile.guestBody} cta={homeCopy.profile.guestCta} />

      <section aria-label={homeCopy.profile.ordersTitle} style={{ padding: '12px 16px 0' }}>
        <Card padding={12}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <Heading variant="title-sm" as="h2">
              {homeCopy.profile.ordersTitle}
            </Heading>
            <button
              type="button"
              aria-label={homeCopy.profile.ordersAllLabel}
              className="tubu-press"
              onClick={() => {
                haptic('light');
                navigate('/orders');
              }}
              style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, border: 'none', background: 'none', fontFamily: 'inherit', cursor: 'pointer', color: 'var(--color-text-brand)' }}
            >
              <Text variant="caption" tone="brand">
                {homeCopy.profile.ordersAll}
              </Text>
              <Icon icon={ChevronRight} size="sm" tone="brand" />
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 4 }}>
            {ORDER_STATUS_ROW.map((r) => {
              const n = r.counted ? countFor(r.key) : null;
              return (
                <button
                  key={r.key}
                  type="button"
                  aria-label={homeCopy.profile.orderStatusLabel(r.label, n ?? 0)}
                  className="tubu-press"
                  onClick={() => {
                    haptic('light');
                    navigate(`/orders?tab=${r.key}`);
                  }}
                  style={{ minHeight: 64, padding: '4px 0', border: 'none', background: 'none', fontFamily: 'inherit', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', gap: 6 }}
                >
                  <span style={{ position: 'relative', display: 'inline-flex', marginTop: 4 }}>
                    <Icon icon={ORDER_ROW_ICON[r.key] ?? Package} size="lg" tone="brand" />
                    {n != null && n > 0 && (
                      <span
                        data-testid="order-count-badge"
                        aria-hidden
                        style={{ position: 'absolute', top: -6, right: -10, minWidth: 16, height: 16, padding: '0 4px', boxSizing: 'border-box', borderRadius: 'var(--radius-pill)', background: 'var(--color-action-primary-bg)', color: 'var(--color-action-primary-fg)', fontSize: 12, fontWeight: 700, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontVariantNumeric: 'tabular-nums' }}
                      >
                        {n > 99 ? '99+' : n}
                      </span>
                    )}
                  </span>
                  <Text variant="caption" tone="secondary" as="div" style={{ textAlign: 'center', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
                    {orderRowLabel(r.key, r.label)}
                  </Text>
                </button>
              );
            })}
          </div>
          {countsFailed && (
            <div role="alert" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 4 }}>
              <Text variant="caption" tone="secondary">
                {profileCopy.ordersFailed}
              </Text>
              <Button variant="ghost" size="md" onPress={reloadCounts}>
                {homeCopy.member.retry}
              </Button>
            </div>
          )}
        </Card>
      </section>

      {code && (
        <section aria-label={homeCopy.profile.referralTitle} style={{ padding: '12px 16px 0' }}>
          <Card padding={12}>
            <Heading variant="title-sm" as="h2">
              {homeCopy.profile.referralTitle}
            </Heading>
            <Text variant="body-sm" tone="secondary" as="p" style={{ marginTop: 4 }}>
              {homeCopy.profile.referralBody(minOrder, referral?.windowDays ?? null)}
            </Text>
            {referral && user.role !== 'AFFILIATE' && (referral.successCount > 0 || referral.earnedPoints > 0) && (
              <Text variant="caption" tone="secondary" as="p" style={{ marginTop: 6 }}>
                {homeCopy.profile.referralStats(referral.successCount, formatPoints(referral.earnedPoints))}
              </Text>
            )}
            {/* Đã đủ hoặc vượt mốc (successCount cập nhật trước nextMilestone): không còn "Mời thêm 0/-2 bạn". */}
            {referral?.nextMilestone && user.role !== 'AFFILIATE' && referral.nextMilestone.count > referral.successCount && (
              <Text variant="caption" tone="brand" as="p" style={{ marginTop: 4 }}>
                {homeCopy.profile.referralMilestone(referral.nextMilestone.count - referral.successCount, formatPoints(referral.nextMilestone.bonusPoints))}
              </Text>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
              <button
                type="button"
                className="tubu-press"
                aria-label={`${homeCopy.profile.referralCopy} mã ${code}`}
                onClick={copyReferral}
                style={{ flex: 1, minWidth: 0, minHeight: 44, boxSizing: 'border-box', padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, border: 'none', borderRadius: 'var(--radius-control)', background: 'var(--color-action-secondary-bg)', textAlign: 'left', fontFamily: 'inherit', cursor: 'pointer' }}
              >
                <Text variant="caption" style={{ color: 'var(--color-action-secondary-fg)' }}>
                  {homeCopy.profile.referralCode}: <strong>{code}</strong>
                </Text>
                <Icon icon={Copy} size="sm" tone="brand" />
              </button>
              <Button onPress={shareReferral} style={{ flexShrink: 0 }}>
                {homeCopy.profile.referralShare}
              </Button>
            </div>
          </Card>
        </section>
      )}

      {menu.map((section) => (
        <div key={section.group} style={{ margin: '12px 16px 0' }}>
          <Text variant="label" tone="tertiary" as="h2" style={{ marginBottom: 6, marginLeft: 4 }}>
            {section.group.toUpperCase()}
          </Text>
          <Card padding={0} style={{ overflow: 'hidden' }}>
            {section.items.map((item, i) => (
              <ListRow
                key={item.to}
                icon={
                  <span style={{ width: 34, height: 34, borderRadius: 'var(--radius-control)', background: 'var(--color-bg-subtle)', display: 'grid', placeItems: 'center', flex: '0 0 auto' }}>
                    <Icon icon={item.Icon} size="md" tone="brand" />
                  </span>
                }
                title={item.label}
                subtitle={item.hint}
                trailing={
                  item.to === '/notifications' && unreadCount > 0 ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <UnreadCount count={unreadCount} />
                      <Icon icon={ChevronRight} size="sm" tone="muted" />
                    </span>
                  ) : item.to === '/chat' && chatUnread ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <span data-testid="chat-unread-dot" role="img" aria-label="Có tin nhắn mới" style={{ width: 10, height: 10, borderRadius: 'var(--radius-pill)', background: 'var(--color-action-danger-bg)' }} />
                      <Icon icon={ChevronRight} size="sm" tone="muted" />
                    </span>
                  ) : (
                    'chevron'
                  )
                }
                onPress={() => {
                  haptic('light');
                  navigate(item.to);
                }}
                style={{ padding: '12px 12px', borderTop: i === 0 ? 'none' : '1px solid var(--color-border-subtle)' }}
              />
            ))}
          </Card>
        </div>
      ))}
    </Page>
  );
}

function ProfileSkeleton() {
  return (
    <div role="status" aria-label="Đang tải" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Skeleton height={104} radius="var(--radius-card)" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} height={64} radius="var(--radius-card)" />
        ))}
      </div>
      <Skeleton height={176} radius="var(--radius-card)" />
    </div>
  );
}

function UnreadCount({ count }: { count: number }) {
  return (
    <span
      style={{
        minWidth: 18,
        height: 18,
        padding: '0 5px',
        boxSizing: 'border-box',
        borderRadius: 'var(--radius-pill)',
        background: 'var(--color-action-primary-bg)',
        color: 'var(--color-action-primary-fg)',
        fontSize: 'var(--type-label-size)',
        fontWeight: 700,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {count}
    </span>
  );
}

function Stat({ label, value, onClick }: { label: string; value: string; onClick?: () => void }) {
  return (
    <div
      role="button"
      {...rowKeyboardProps()}
      className="tubu-press"
      aria-label={`${label}: ${value}`}
      onClick={onClick}
      style={{
        minHeight: 44,
        boxSizing: 'border-box',
        padding: '10px 4px',
        background: 'var(--color-bg-surface)',
        borderRadius: 'var(--radius-card)',
        textAlign: 'center',
        boxShadow: 'var(--elevation-1)',
      }}
    >
      <Text variant="price-md" as="div" tone="brand" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Text>
      <Text variant="caption" tone="tertiary" as="div">
        {label}
      </Text>
    </div>
  );
}
