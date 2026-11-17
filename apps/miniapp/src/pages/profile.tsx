import { Page, useLocation, useNavigate, useSnackbar } from 'zmp-ui';
import { useSmartNavigate } from '../lib/smart-nav';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bell, Heart, MapPin, MessageCircle, Leaf, GraduationCap, Users, Store, Settings, Info, ChevronDown, ChevronRight, Copy, Share2, Sparkles, BookOpen, ShieldCheck, CalendarClock, Wallet, CreditCard, Package, Truck, PackageCheck, Recycle, Gift, Ticket, CircleHelp, type LucideIcon,
} from 'lucide-react';
import { orderRowLabel, profileCopy } from '@tubutree/app-core/account-copy';
import { STAT_VALUE_LINE_HEIGHT, STAT_VALUE_LOOKS, statValueFits, statValueStart } from '@tubutree/app-core/account-stat';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { inviteBody, inviteLandingOn, inviteProgressLine, inviteShareLink, inviteShareText } from '@tubutree/app-core/commerce/invite-card';
import { trackEvent } from '../services/analytics';
import { shareDescription, welcomeOfferOf } from '@tubutree/app-core/commerce/share-offer';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { buildProfileMenu, PROFILE_MENU_COPY, PROFILE_ORDER_ROW, type ProfileLinkKey, type ProfileMenuLink, type ProfileRowKey } from '@tubutree/app-core/profile-menu';
import { PROFILE_REFERRAL_SECTION } from '@tubutree/app-core/profile-sections';
import { useAuthStore } from '../store/auth';
import { getCoupons, getLoyalty, getReferral, getWallet } from '../services/account-api';
import { ProfileAvatar } from '../components/account/profile-avatar';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { EmptyState } from '../components/ui/empty-state';
import { AuthPhaseView, useBlockedMessage } from '../components/ui/auth-gate';
import { useAuthPhase } from '../hooks/use-auth-phase';
import { Icon } from '../components/ui/icon';
import { ListRow } from '../components/ui/list-row';
import { BadgeRow, useBadges } from '../components/game/badge-row';
import { rowKeyboardProps } from '../components/ui/row-keyboard';
import { Skeleton } from '../components/ui/skeleton';
import { SR_ONLY } from '../components/ui/sr-only';
import { Heading, Text } from '../components/ui/text';
import { GuestLinkCard } from '../components/home/guest-link-card';
import { useActionLock, useShareWithFallback } from '../components/share-sheet';
import { getAuthMeFlags, getOwnedBrand } from '../services/brand-owner-api';
import { isNotFoundError } from '../services/api';
import { getDealerMe } from '../services/dealer-api';
import { getDeskPoints, WASTE_QUERY_KEYS } from '../services/waste-api';
import { useMeSummary } from '../hooks/use-me-summary';
import { useRecycleOpenRequests } from '../hooks/use-recycle-open-requests';
import { getAffiliateMe } from '../services/affiliate-api';
import { supportChatSummaryQueryOptions } from '../services/support-chat-api';
import { useAiAdvisorEnabled, usePublicConfig } from '../hooks/use-public-config';
import { formatVnd, formatPoints } from '../utils/format';
import { haptic } from '../utils/haptic';
import { copyText } from '../utils/clipboard';
import { pointsSummary } from '../utils/points-lots';
import { miniAppLink } from '../utils/miniapp-link';

const PAGE_TITLE = 'Cá nhân';

const ROW_ICON: Record<ProfileRowKey, LucideIcon> = {
  notifications: Bell,
  offers: Ticket,
  invite: Gift,
  addresses: MapPin,
  wishlist: Heart,
  recycle: Recycle,
  support: CircleHelp,
  settings: Settings,
  partner: Store,
};

const LINK_ICON: Record<ProfileLinkKey, LucideIcon> = {
  chat: MessageCircle,
  ai: Sparkles,
  about: Info,
  brandStory: BookOpen,
  ctv: Users,
  academy: GraduationCap,
  dealer: Store,
  brandOwner: Store,
  staff: CalendarClock,
  payroll: Wallet,
  desk: Recycle,
  admin: ShieldCheck,
};

const ORDER_ROW_ICON: Record<string, LucideIcon> = {
  pending_payment: CreditCard,
  processing: Package,
  shipping: Truck,
  delivered: PackageCheck,
};

const DIVIDER = '1px solid var(--color-border-subtle)';

/** Mỗi lần khối mời mở và có dòng tiến độ (chỉ số đếm, không tên) thì báo `invite_progress_viewed`. */
function InviteProgressViewed() {
  useEffect(() => void trackEvent('invite_progress_viewed', 'miniapp', {}), []);
  return null;
}

function RowIcon({ icon }: { icon: LucideIcon }) {
  return (
    <span style={{ width: 34, height: 34, borderRadius: 'var(--radius-control)', background: 'var(--color-bg-subtle)', display: 'grid', placeItems: 'center', flex: '0 0 auto' }}>
      <Icon icon={icon} size="md" tone="brand" />
    </span>
  );
}

function UnreadDot({ testId, label }: { testId: string; label?: string }) {
  return (
    <span
      data-testid={testId}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ width: 10, height: 10, flex: '0 0 auto', borderRadius: 'var(--radius-pill)', background: 'var(--color-action-danger-bg)' }}
    />
  );
}

/** Trang Cá nhân: thẻ danh tính (không bấm), hai số dư, hàng đơn bốn ô, rồi một thẻ dòng gọn từ `buildProfileMenu` (cùng dòng với web `/tai-khoan`). */
export default function ProfilePage() {
  const navigate = useNavigate();
  const goSmart = useSmartNavigate();
  const location = useLocation();
  const { openSnackbar } = useSnackbar();
  const shareWithFallback = useShareWithFallback();
  // Chép và chia sẻ mã giới thiệu cùng một đối tượng nên chung một khoá; thử lại số đếm/hạng là khoá riêng. Cả hai là ref đồng bộ:
  // state `busy` chỉ đổi sau lần vẽ kế nên hai cú chạm cùng nhịp vẫn đều đi qua.
  const referralLock = useActionLock();
  const reloadLock = useActionLock();
  const { user, status } = useAuthStore();
  const phase = useAuthPhase();
  const blocked = useBlockedMessage();
  const authed = status === 'authenticated';
  const loyaltyQ = useQuery({ queryKey: ['loyalty'], queryFn: getLoyalty, enabled: authed });
  const summaryQ = useMeSummary();
  const walletQ = useQuery({ queryKey: ['wallet'], queryFn: getWallet, enabled: authed });
  const couponsQ = useQuery({ queryKey: ['coupons'], queryFn: getCoupons, enabled: authed });
  const referralQ = useQuery({ queryKey: ['referral'], queryFn: getReferral, enabled: authed });
  const badgesQ = useBadges();
  const referralRef = useRef<HTMLDivElement>(null);
  const wantsReferral = new URLSearchParams(location.search).get('section') === PROFILE_REFERRAL_SECTION;
  const referralReady = referralQ.isSuccess || referralQ.isError;
  const [open, setOpen] = useState<Partial<Record<ProfileRowKey, boolean>>>(() => (wantsReferral ? { invite: true } : {}));
  useEffect(() => {
    if (wantsReferral) setOpen((o) => (o.invite ? o : { ...o, invite: true }));
  }, [wantsReferral]);
  useEffect(() => {
    if (wantsReferral && referralReady) referralRef.current?.scrollIntoView?.({ block: 'start' });
  }, [wantsReferral, referralReady]);

  const ownsBrandQ = useQuery({ queryKey: ['auth-me', 'flags'], queryFn: getAuthMeFlags, select: (f) => f.ownsBrand, enabled: authed, retry: false });
  const hasDeskPointQ = useQuery({ queryKey: ['auth-me', 'flags'], queryFn: getAuthMeFlags, select: (f) => f.hasDeskPoint, enabled: authed, retry: false });
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
  const aiEnabled = useAiAdvisorEnabled();
  const cfg = usePublicConfig();
  const chatEnabled = cfg.chat?.enabled === true;
  const chatSummaryQ = useQuery({ ...supportChatSummaryQueryOptions(), enabled: authed && chatEnabled });
  const chatUnread = chatEnabled && (chatSummaryQ.data?.unreadCount ?? 0) > 0;
  const wasteEnabled = cfg.isLoaded && cfg.waste.enabled;
  const recycleOpenRequests = useRecycleOpenRequests(authed, cfg.isLoaded && !cfg.waste.enabled);
  // Chỉ hỏi quầy khi có lý do (nhân viên/admin kho, đại lý, hoặc cờ hasDeskPoint của /auth/me cho nhân viên điểm đối tác mang vai CUSTOMER)
  // để khách thường không bị gọi thêm API. Cờ chung một lần gọi /auth/me với ownsBrand; cờ đổi rác tắt thì điểm đối tác không mở quầy.
  const isStaffOrAdmin = user?.role === 'STAFF' || user?.role === 'ADMIN';
  const mayHaveDesk = isStaffOrAdmin || (user?.role === 'DEALER' && cfg.waste.enabled) || (hasDeskPointQ.data === true && cfg.waste.enabled);
  const deskQ = useQuery({ queryKey: WASTE_QUERY_KEYS.desk, queryFn: getDeskPoints, enabled: authed && mayHaveDesk, staleTime: 5 * 60_000, retry: false });
  const ownedBrand = ownsBrandQ.data === false ? null : ownedBrandQ.data;

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
                  body={blocked ?? 'Đăng nhập để xem tích điểm, đơn hàng và ưu đãi cá nhân của bạn.'}
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
  // CTV chỉ hưởng hoa hồng, không nhận Điểm Xanh giới thiệu: khối không hứa thưởng điểm cho họ.
  const earnsPoints = user.role !== 'AFFILIATE';
  const welcomeOffer = welcomeOfferOf(cfg);
  const referralRules = { referrerPoints: referral?.referrerRewardPoints, minOrderAmount: referral?.minOrderAmount, windowDays: referral?.windowDays };
  // Cờ referral.share_card_enabled: link chép và chữ chia sẻ trỏ trang đích tubutree.com/moi/<mã>; nút "Chia sẻ qua Zalo" vẫn mở thẳng Mini App.
  const landing = inviteLandingOn(cfg);
  const inviteUrl = code ? inviteShareLink({ landing, baseUrl: miniAppLink('/'), referralCode: code }) : '';
  const progress = landing ? inviteProgressLine(referral, earnsPoints) : null;

  const rows = buildProfileMenu({
    role: user.role,
    chatEnabled,
    aiEnabled,
    wasteEnabled,
    recycleOpenRequests,
    badgesEnabled: badgesQ.data?.enabled === true,
    hasReferralCode: !!code,
    couponCount: couponsQ.data?.length,
    unreadNotifications: summaryQ.data?.unreadNotifications,
    dealer: dealerQ.data,
    ownedBrandName: ownedBrand?.name,
    ctvAccess: ctvAccessQ.data,
    deskPointNames: deskQ.data?.map((p) => p.name),
  });

  const copyReferral = () => {
    if (!code) return;
    void referralLock.run('copy', async () => {
      haptic('light');
      const ok = await copyText(inviteUrl);
      openSnackbar(
        ok
          ? { text: fillCopy('invite.copied'), type: 'success' }
          : { text: fillCopy('invite.copyFailed', { code }), type: 'info', duration: 4000 },
      );
    });
  };
  const shareReferral = () => {
    if (!code) return;
    void referralLock.run('share', async () => {
      haptic('light');
      await shareWithFallback(
        { title: fillCopy('invite.shareTitle'), description: shareDescription(null, welcomeOffer), path: `/?ref=${code}` },
        inviteShareText(inviteUrl),
      );
    });
  };

  const countsFailed = summaryQ.isError;
  const reloadCounts = () => {
    void reloadLock.run('counts', () => summaryQ.refetch());
  };

  const countFor = (key: string): number | null => {
    if (!summaryQ.data) return null;
    return summaryQ.data.orders[key as keyof typeof summaryQ.data.orders] ?? null;
  };

  const go = (to: string) => {
    haptic('light');
    // Cá nhân → Ưu đãi là tab gốc sang tab gốc: thay mục hiện tại, tránh lịch sử [/, /profile, /offers] mà BottomNav sau đó nhân bản.
    if (to === '/offers') goSmart(to);
    else navigate(to);
  };

  const linkRows = (items: ProfileMenuLink[]) =>
    items.map((item) => (
      <ListRow
        key={item.key}
        icon={<RowIcon icon={LINK_ICON[item.key]} />}
        title={item.label}
        subtitle={item.hint}
        trailing={
          item.key === 'chat' && chatUnread ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <UnreadDot testId="chat-unread-dot" label={PROFILE_MENU_COPY.chatUnread} />
              <Icon icon={ChevronRight} size="sm" tone="muted" />
            </span>
          ) : (
            'chevron'
          )
        }
        onPress={() => go(item.mini)}
        style={{ padding: '12px 12px 12px 24px', borderTop: DIVIDER }}
      />
    ));

  const invitePanel = (
    <div style={{ padding: '0 12px 12px' }}>
      <Text variant="body-sm" tone="secondary" as="p">
        {inviteBody(welcomeOffer, referralRules, earnsPoints)}
      </Text>
      {(progress || (referral && earnsPoints && (referral.successCount > 0 || referral.earnedPoints > 0))) && (
        <Text variant="caption" tone="secondary" as="p" style={{ marginTop: 6 }} data-testid={progress ? 'invite-progress' : undefined}>
          {progress ?? (referral ? homeCopy.profile.referralStats(referral.successCount, formatPoints(referral.earnedPoints)) : null)}
        </Text>
      )}
      {progress && <InviteProgressViewed />}
      {/* Đã đủ hoặc vượt mốc (successCount cập nhật trước nextMilestone): không còn "Mời thêm 0/-2 bạn". */}
      {referral?.nextMilestone && earnsPoints && referral.nextMilestone.count > referral.successCount && (
        <Text variant="caption" tone="brand" as="p" style={{ marginTop: 4 }}>
          {homeCopy.profile.referralMilestone(referral.nextMilestone.count - referral.successCount, formatPoints(referral.nextMilestone.bonusPoints))}
        </Text>
      )}
      <Text variant="caption" as="p" style={{ marginTop: 10, color: 'var(--color-action-secondary-fg)' }}>
        {fillCopy('invite.codeLabel')}: <strong>{code}</strong>
      </Text>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
        <Button fullWidth icon={Share2} loading={referralLock.active === 'share'} aria-disabled={referralLock.busy || undefined} onPress={shareReferral}>
          {fillCopy('invite.shareZalo')}
        </Button>
        <Button fullWidth variant="secondary" icon={Copy} loading={referralLock.active === 'copy'} aria-disabled={referralLock.busy || undefined} onPress={copyReferral}>
          {fillCopy('invite.copyLink')}
        </Button>
      </div>
    </div>
  );

  return (
    <Page className="page tubu-nums" style={{ background: 'var(--color-bg-canvas)', paddingBottom: 100 }}>
      <h1 style={SR_ONLY}>{PAGE_TITLE}</h1>

      <div
        style={{
          background: 'linear-gradient(135deg, var(--color-action-primary-bg), var(--color-action-primary-bg-pressed))',
          color: 'var(--color-text-inverse)',
          padding: '16px 16px 28px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 44 }}>
          <ProfileAvatar size={56} name={user.fullName} src={user.avatarUrl} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <Heading variant="title-md" as="div" tone="inverse" style={{ lineHeight: 1.2 }}>
              {user.fullName ?? 'Khách Tubu'}
            </Heading>
            <div style={{ display: 'flex', alignItems: 'center', marginTop: 6 }}>
              {tierName ? (
                <Badge tone="brand" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, minWidth: TIER_SLOT_WIDTH }}>
                  <Icon icon={Leaf} size="sm" tone="brand" />
                  {tierName}
                </Badge>
              ) : !tierFailed ? (
                <span aria-hidden="true" style={{ display: 'inline-block', width: TIER_SLOT_WIDTH, height: 24, borderRadius: 'var(--radius-pill)', background: 'color-mix(in srgb, var(--color-text-inverse) 28%, transparent)' }} />
              ) : null}
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
              aria-busy={reloadLock.busy || undefined}
              onClick={() => {
                haptic('light');
                void reloadLock.run('counts', () => Promise.all([loyaltyQ.refetch(), summaryQ.refetch()]));
              }}
              style={{ minHeight: 44, margin: '-12px -6px', padding: '0 6px', border: 'none', background: 'transparent', color: 'var(--color-text-inverse)', fontFamily: 'inherit', fontSize: 'var(--type-caption-size)', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer' }}
            >
              {homeCopy.member.retry}
            </button>
          </div>
        )}
      </div>

      <div style={{ padding: '0 12px', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, marginTop: -20, position: 'relative' }}>
        <Stat label={homeCopy.profile.statPoints} value={formatPoints(pointsTotal)} onClick={() => navigate('/loyalty')} />
        <Stat label={homeCopy.profile.statWallet} value={formatVnd(walletQ.data?.walletBalance ?? user.walletBalance)} onClick={() => navigate('/wallet', { state: { from: '/profile' } })} />
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
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${PROFILE_ORDER_ROW.length}, minmax(0, 1fr))`, gap: 4 }}>
            {PROFILE_ORDER_ROW.map((r) => {
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
              <Button variant="ghost" size="md" loading={reloadLock.busy} onPress={reloadCounts}>
                {homeCopy.member.retry}
              </Button>
            </div>
          )}
        </Card>
      </section>

      <BadgeRow />

      <div style={{ margin: '12px 16px 0' }}>
        <Card padding={0} style={{ overflow: 'hidden' }}>
          {rows.map((row, i) => {
            const borderTop = i === 0 ? 'none' : DIVIDER;
            if (row.kind === 'link') {
              return (
                <ListRow
                  key={row.key}
                  icon={<RowIcon icon={ROW_ICON[row.key]} />}
                  title={row.label}
                  subtitle={row.hint}
                  trailing="chevron"
                  onPress={() => go(row.mini)}
                  style={{ padding: 12, borderTop }}
                />
              );
            }
            const expanded = open[row.key] === true;
            const panelId = `profile-${row.key}-panel`;
            const unreadHere = row.key === 'support' && chatUnread && !expanded;
            const isInvite = row.key === 'invite';
            return (
              <div key={row.key} id={isInvite ? PROFILE_REFERRAL_SECTION : undefined} ref={isInvite ? referralRef : undefined} style={{ borderTop }}>
                <AccordionButton
                  expanded={expanded}
                  controls={panelId}
                  ariaLabel={unreadHere ? PROFILE_MENU_COPY.unreadName(row.label) : undefined}
                  onToggle={() => {
                    haptic('light');
                    setOpen((o) => ({ ...o, [row.key]: !expanded }));
                  }}
                >
                  <ListRow
                    icon={<RowIcon icon={ROW_ICON[row.key]} />}
                    title={row.label}
                    subtitle={row.hint}
                    trailing={
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        {unreadHere && <UnreadDot testId="support-unread-dot" />}
                        <Icon icon={ChevronDown} size="sm" tone="muted" style={expanded ? { transform: 'rotate(180deg)' } : undefined} />
                      </span>
                    }
                    style={{ padding: 12 }}
                  />
                </AccordionButton>
                <div id={panelId} hidden={!expanded}>
                  {isInvite ? invitePanel : linkRows(row.children)}
                </div>
              </div>
            );
          })}
        </Card>
      </div>
    </Page>
  );
}

/** Nút mở/đóng một dòng gọn: nút thật (aria-expanded, aria-controls), bên trong là ListRow không tương tác để cùng hình với dòng liên kết. */
function AccordionButton({ expanded, controls, ariaLabel, onToggle, children }: { expanded: boolean; controls: string; ariaLabel?: string; onToggle: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-controls={controls}
      aria-label={ariaLabel}
      className="tubu-press"
      onClick={onToggle}
      style={{ display: 'block', width: '100%', minHeight: 44, padding: 0, border: 'none', background: 'none', fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer', color: 'inherit' }}
    >
      {children}
    </button>
  );
}

/** Bề ngang chung của chỗ hạng thành viên (khung chờ và nhãn thật): khung chờ hẹp hơn nhãn thật thì thẻ đầu đổi bề ngang dòng hạng khi hạng về. */
const TIER_SLOT_WIDTH = '6.5rem';

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

function Stat({ label, value, onClick }: { label: string; value: string; onClick?: () => void }) {
  const [cell, cellWidth] = useCellWidth<HTMLDivElement>();
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
    <div
      ref={cell}
      role="button"
      {...rowKeyboardProps()}
      className="tubu-press"
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
    </div>
  );
}
