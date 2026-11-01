import { COUPONS_LOAD_ERROR_TITLE } from '@tubutree/app-core/loyalty-tier-copy';
import { useEffect, useMemo, useRef } from 'react';
import { Page, useLocation, useNavigate } from 'zmp-ui';
import { useQuery } from '@tanstack/react-query';
import { Gift, PackageOpen, Recycle, ScanLine, Sprout, Users, type LucideIcon } from 'lucide-react';
import { mineRows, minePreview } from '@tubutree/app-core/commerce/voucher-center';
import { checkInCopy } from '@tubutree/app-core/daily-check-in-copy';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { isCouponExpiring, RECYCLE_REQUESTS_LABEL } from '@tubutree/app-core/home-layout';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { getCoupons, getLoyalty } from '../services/account-api';
import { getLoadErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { useAuthPhase } from '../hooks/use-auth-phase';
import { useCouponUse } from '../hooks/use-coupon-use';
import { readStoredHomeKind } from '../hooks/use-home-customer-kind';
import { useMarkExpiringSeen } from '../hooks/use-offers-dot';
import { useRecycleOpenRequests } from '../hooks/use-recycle-open-requests';
import { usePublicConfig } from '../hooks/use-public-config';
import { haptic } from '../utils/haptic';
import { AuthPhaseView, useBlockedMessage } from '../components/ui/auth-gate';
import { Card } from '../components/ui/card';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { Icon } from '../components/ui/icon';
import { ListRow } from '../components/ui/list-row';
import { PageHeader } from '../components/ui/page-header';
import { SectionHeader } from '../components/ui/section-header';
import { Skeleton } from '../components/ui/skeleton';
import { VoucherTicket } from '../components/ui/voucher-ticket';
import { DailyCheckInCard } from '../components/loyalty/daily-check-in-card';
import { GuestLinkCard } from '../components/home/guest-link-card';
import { CampaignBanner } from '../components/campaign/campaign-banner';
import { OffersCollect } from '../components/offers/offers-collect';
import { OffersFlash } from '../components/offers/offers-flash';
import { OffersPointsStrip } from '../components/offers/offers-points-strip';

function IconTile({ icon }: { icon: LucideIcon }) {
  return (
    <span style={{ width: 34, height: 34, borderRadius: 'var(--radius-control)', background: 'var(--color-bg-subtle)', display: 'grid', placeItems: 'center', flex: '0 0 auto' }}>
      <Icon icon={icon} tone="brand" />
    </span>
  );
}

/**
 * Tab "Ưu đãi" (Q10): Banner, Giờ vàng hôm nay, Nhận mã, dải Điểm Xanh gọn và Điểm danh, Mã của tôi, Đổi quà và tiện ích. Ba khối đầu là
 * công khai (khách chưa đăng nhập xem được, "Lưu mã" mở đăng nhập); từ dải Điểm Xanh trở xuống cần tài khoản. `?section=coupons` cuộn tới Mã của tôi.
 */
export default function OffersPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const phase = useAuthPhase();
  const authed = phase === 'authenticated';
  const user = useAuthStore((s) => s.user);
  const blocked = useBlockedMessage();
  const cfg = usePublicConfig();
  const { use } = useCouponUse();
  const loyaltyQ = useQuery({ queryKey: ['loyalty'], queryFn: getLoyalty, enabled: authed });
  const couponsQ = useQuery({ queryKey: ['coupons'], queryFn: getCoupons, enabled: authed });
  const couponsRef = useRef<HTMLElement>(null);
  const wantsCoupons = new URLSearchParams(location.search).get('section') === 'coupons';
  const couponsReady = couponsQ.isSuccess || couponsQ.isError;

  useEffect(() => {
    if (wantsCoupons && couponsReady) couponsRef.current?.scrollIntoView?.({ block: 'start' });
  }, [wantsCoupons, couponsReady]);

  const go = (to: string) => {
    haptic('light');
    navigate(to);
  };

  const pageSkeleton = (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Skeleton height={140} radius="var(--radius-card)" />
      <Skeleton height={120} radius="var(--radius-card)" />
      <Skeleton height={176} radius="var(--radius-card)" />
    </div>
  );

  const coupons = useMemo(() => couponsQ.data ?? [], [couponsQ.data]);
  const walletCodes = useMemo(() => new Set(coupons.map((c) => c.code)), [coupons]);
  const rows = useMemo(() => mineRows(coupons, Date.now()), [coupons]);
  const mine = minePreview(rows);
  useMarkExpiringSeen(couponsQ.data);
  const wasteEnabled = cfg.isLoaded && cfg.waste.enabled;
  const recycleOpen = useRecycleOpenRequests(authed, cfg.isLoaded && !cfg.waste.enabled);

  const shortcuts: { icon: LucideIcon; title: string; subtitle: string; to: string; show: boolean }[] = [
    { icon: Gift, title: homeCopy.offers.rewardsTitle, subtitle: homeCopy.offers.rewardsHint, to: '/rewards', show: true },
    { icon: PackageOpen, title: homeCopy.offers.myRewards, subtitle: homeCopy.offers.myRewardsHint, to: '/rewards/mine', show: true },
    {
      icon: Recycle,
      title: wasteEnabled ? 'Đổi rác lấy quà' : RECYCLE_REQUESTS_LABEL,
      subtitle: wasteEnabled ? homeCopy.offers.recycleHint : homeCopy.offers.recyclePausedHint,
      to: '/recycle',
      show: wasteEnabled || recycleOpen,
    },
    { icon: ScanLine, title: 'Tích điểm đơn sàn', subtitle: homeCopy.offers.claimHint, to: '/points/scan', show: cfg.isLoaded && cfg.loyalty?.marketplaceClaimEnabled === true },
    { icon: Users, title: 'Mua chung nhóm', subtitle: homeCopy.offers.groupBuyHint, to: '/group-buy', show: true },
  ];

  const now = Date.now();
  return (
    <Page className="page" style={{ background: 'var(--color-bg-canvas)', paddingBottom: 100 }}>
      <PageHeader title={homeCopy.offers.title} back={false} />
      {/* Khách chưa đăng nhập là khách mới; đã đăng nhập mà máy chưa nhớ loại thì chưa biết (chỉ thấy chiến dịch cho mọi người). */}
      <CampaignBanner placement="OFFERS_TOP" kind={authed ? (readStoredHomeKind(user?.id) ?? 'unknown') : 'new'} />
      <OffersFlash />
      <OffersCollect walletCodes={walletCodes} walletLoading={phase === 'loading' || (authed && couponsQ.isLoading)} />
      {!authed ? (
        <AuthPhaseView
          phase={phase}
          loading={pageSkeleton}
          guest={<EmptyState art="sprout" heading={homeCopy.offers.loginTitle} body={blocked ?? homeCopy.offers.loginBody} ctaLabel="Đăng nhập ngay" onCta={() => void useAuthStore.getState().login()} />}
        />
      ) : (
        <>
          <GuestLinkCard title={homeCopy.offers.guestTitle} body={homeCopy.offers.guestBody} cta={homeCopy.profile.guestCta} />

          <OffersPointsStrip loyalty={loyaltyQ} />

          {/* Điểm danh */}
          <section aria-label={checkInCopy.title} style={{ padding: '12px 16px 0' }}>
            <DailyCheckInCard authed={authed} compact />
          </section>

          {/* Mã của tôi */}
          <section id="coupons" ref={couponsRef} aria-labelledby="offers-mine-title" style={{ padding: '12px 16px 0' }}>
            <SectionHeader
              id="offers-mine-title"
              title={fillCopy('coupon.tabMine')}
              icon="ticket"
              action={{
                onPress: () => navigate('/vouchers?tab=mine'),
                label: mine.hasMore ? fillCopy('section.seeAllCount', { n: mine.total }) : undefined,
                spoken: fillCopy('section.seeAllSpoken', { title: fillCopy('coupon.tabMine') }),
              }}
            />
            {couponsQ.isLoading ? (
              <Skeleton height={88} radius="var(--radius-card)" />
            ) : couponsQ.isError ? (
              <ErrorState variant="inline" title={COUPONS_LOAD_ERROR_TITLE} message={getLoadErrorMessage(couponsQ.error)} onRetry={() => void couponsQ.refetch()} />
            ) : mine.total > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {mine.shown.map((row) => (
                  <VoucherTicket
                    key={row.view.code}
                    voucher={row.view}
                    variant="ticket"
                    primary={{ label: fillCopy('coupon.use'), onClick: () => void use(row.view.code) }}
                    expiring={isCouponExpiring(row.coupon, now)}
                  />
                ))}
              </div>
            ) : (
              <EmptyState variant="inline" art="leaf" heading={homeCopy.offers.couponsEmptyHeading} body={homeCopy.offers.couponsEmptyBody} />
            )}
          </section>

          {/* Đổi quà và tiện ích */}
          <section aria-label={homeCopy.offers.rewardsTitle} style={{ padding: '16px 16px 0' }}>
            <Card variant="outline" padding={0} style={{ overflow: 'hidden' }}>
              {shortcuts
                .filter((s) => s.show)
                .map((s, i) => (
                  <ListRow
                    key={s.to}
                    icon={<IconTile icon={s.icon} />}
                    title={s.title}
                    subtitle={s.subtitle}
                    trailing="chevron"
                    onPress={() => go(s.to)}
                    style={{ padding: 12, borderTop: i === 0 ? 'none' : '1px solid var(--color-border-subtle)' }}
                  />
                ))}
              <ListRow
                icon={<IconTile icon={Sprout} />}
                title="Vườn Xanh"
                subtitle="Chăm cây nhận quà"
                trailing="chevron"
                onPress={() => go('/game')}
                style={{ padding: 12, borderTop: '1px solid var(--color-border-subtle)' }}
              />
            </Card>
          </section>
        </>
      )}
    </Page>
  );
}
