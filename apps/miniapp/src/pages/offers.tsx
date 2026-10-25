import { useEffect, useRef } from 'react';
import { Page, useLocation, useNavigate } from 'zmp-ui';
import { useQuery } from '@tanstack/react-query';
import { CalendarCheck, Check, ChevronRight, Gift, Leaf, PackageOpen, Recycle, ScanLine, Sprout, Users, type LucideIcon } from 'lucide-react';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { memberCardAriaLabel, memberCardView, RECYCLE_REQUESTS_LABEL } from '@tubutree/app-core/home-layout';
import { getCoupons, getLoyalty } from '../services/account-api';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { useAuthPhase } from '../hooks/use-auth-phase';
import { useCheckIn } from '../hooks/use-check-in';
import { useMarkExpiringSeen } from '../hooks/use-offers-dot';
import { useRecycleOpenRequests } from '../hooks/use-recycle-open-requests';
import { usePublicConfig } from '../hooks/use-public-config';
import { formatNumber } from '../utils/format';
import { haptic } from '../utils/haptic';
import { pointsSummary } from '../utils/points-lots';
import { AuthPhaseView } from '../components/ui/auth-gate';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { Icon } from '../components/ui/icon';
import { ListRow } from '../components/ui/list-row';
import { PageHeader } from '../components/ui/page-header';
import { Skeleton } from '../components/ui/skeleton';
import { Heading, Text } from '../components/ui/text';
import { CouponCard } from '../components/loyalty/coupon-card';
import { GuestLinkCard } from '../components/home/guest-link-card';

function IconTile({ icon }: { icon: LucideIcon }) {
  return (
    <span style={{ width: 34, height: 34, borderRadius: 'var(--radius-control)', background: 'var(--color-bg-subtle)', display: 'grid', placeItems: 'center', flex: '0 0 auto' }}>
      <Icon icon={icon} tone="brand" />
    </span>
  );
}

/**
 * Tab "Ưu đãi" (phương án A): mọi thứ về điểm và quà ở một chỗ. Thẻ Điểm Xanh và hạng, Điểm danh, Đổi quà và tiện ích
 * (Đổi rác, Tích điểm đơn sàn khi cờ bật, Mua chung), Mã giảm giá của tôi. `?section=coupons` cuộn tới danh sách mã.
 */
export default function OffersPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const phase = useAuthPhase();
  const authed = phase === 'authenticated';
  const user = useAuthStore((s) => s.user);
  const cfg = usePublicConfig();
  const loyaltyQ = useQuery({ queryKey: ['loyalty'], queryFn: getLoyalty, enabled: authed });
  const couponsQ = useQuery({ queryKey: ['coupons'], queryFn: getCoupons, enabled: authed });
  const { status: checkInStatus, statusQ: checkInQ, view: checkInView, pending, checkIn } = useCheckIn(authed);
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

  const card = user
    ? memberCardView({ overview: loyaltyQ.data, pointsTotal: pointsSummary(loyaltyQ.data ?? user).total, vndPerPointRedeem: cfg.loyalty?.vndPerPointRedeem })
    : null;
  const coupons = couponsQ.data ?? [];
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

  return (
    <Page className="page" style={{ background: 'var(--color-bg-canvas)', paddingBottom: 100 }}>
      <PageHeader title={homeCopy.offers.title} back={false} />
      {!authed ? (
        <AuthPhaseView
          phase={phase}
          loading={pageSkeleton}
          guest={<EmptyState art="sprout" heading={homeCopy.offers.loginTitle} body={homeCopy.offers.loginBody} ctaLabel="Đăng nhập ngay" onCta={() => void useAuthStore.getState().login()} />}
        />
      ) : (
        <>
          <GuestLinkCard title={homeCopy.offers.guestTitle} body={homeCopy.offers.guestBody} cta={homeCopy.profile.guestCta} />

          {/* Thẻ Điểm Xanh và hạng */}
          <section aria-label={homeCopy.offers.pointsTitle} style={{ padding: '12px 16px 0' }}>
            <div
              style={{
                padding: 16,
                color: 'var(--color-text-inverse)',
                background: 'linear-gradient(135deg, var(--color-action-primary-bg), var(--color-action-primary-bg-pressed))',
                borderRadius: 'var(--radius-card)',
                boxShadow: 'var(--elevation-1)',
              }}
            >
              <button
                type="button"
                aria-label={card ? memberCardAriaLabel(card, homeCopy.offers.pointsDetail) : homeCopy.offers.pointsDetail}
                className="tubu-press"
                onClick={() => go('/loyalty')}
                style={{ display: 'block', width: '100%', padding: 0, border: 'none', background: 'transparent', color: 'inherit', textAlign: 'left', fontFamily: 'inherit', cursor: 'pointer', minHeight: 44 }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <Text variant="body-sm" tone="inverse" style={{ fontWeight: 600 }}>
                    {card?.tierName ? (
                      <>
                        <Icon icon={Leaf} size="sm" tone="inverse" style={{ verticalAlign: '-3px', display: 'inline' }} /> {card.tierName}
                      </>
                    ) : null}
                  </Text>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                    <Text variant="caption" tone="inverse">
                      {homeCopy.offers.pointsDetail}
                    </Text>
                    <Icon icon={ChevronRight} size="sm" tone="inverse" />
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                  <Heading variant="title-lg" as="div" tone="inverse" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {card?.pointsLabel}
                  </Heading>
                  {card?.valueLabel && (
                    <Text variant="body-sm" tone="inverse" style={{ opacity: 0.9, fontVariantNumeric: 'tabular-nums' }}>
                      {card.valueLabel}
                    </Text>
                  )}
                </div>
              </button>
              <div style={{ marginTop: 10 }}>
                <div
                  role={loyaltyQ.data ? 'progressbar' : undefined}
                  aria-label={loyaltyQ.data ? 'Tiến độ lên hạng kế' : undefined}
                  aria-valuemin={loyaltyQ.data ? 0 : undefined}
                  aria-valuemax={loyaltyQ.data ? 100 : undefined}
                  aria-valuenow={loyaltyQ.data && card ? card.progressPct : undefined}
                  aria-hidden={loyaltyQ.data ? undefined : true}
                  style={{ height: 6, borderRadius: 'var(--radius-pill)', background: 'color-mix(in srgb, var(--color-text-inverse) 28%, transparent)', overflow: 'hidden' }}
                >
                  <div style={{ height: '100%', width: `${loyaltyQ.data && card ? card.progressPct : 0}%`, background: 'var(--color-text-inverse)', borderRadius: 'var(--radius-pill)' }} />
                </div>
                <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  {loyaltyQ.data && card ? (
                    <Text variant="caption" tone="inverse" as="div" style={{ opacity: 0.9 }}>
                      {card.toGoLine ?? homeCopy.member.topTier}
                    </Text>
                  ) : loyaltyQ.isError ? (
                    <>
                      <Text variant="caption" tone="inverse" as="div" style={{ opacity: 0.9, minWidth: 0 }}>
                        {homeCopy.member.tierFailed}
                      </Text>
                      <button
                        type="button"
                        className="tubu-press"
                        onClick={() => { haptic('light'); void loyaltyQ.refetch(); }}
                        style={{ flex: '0 0 auto', minHeight: 44, margin: '-14px -6px', padding: '0 6px', border: 'none', background: 'transparent', color: 'var(--color-text-inverse)', fontFamily: 'inherit', fontSize: 'var(--type-caption-size)', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer' }}
                      >
                        {homeCopy.member.retry}
                      </button>
                    </>
                  ) : (
                    <div aria-hidden="true" style={{ visibility: 'hidden' }}>
                      <Text variant="caption" tone="inverse" as="div">
                        {homeCopy.member.progressSpacer}
                      </Text>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Điểm danh */}
          <section aria-label={homeCopy.offers.checkInTitle} style={{ padding: '12px 16px 0' }}>
            {checkInQ.isLoading ? (
              <Skeleton height={112} radius="var(--radius-card)" />
            ) : checkInQ.isError ? (
              <Card padding={16}>
                <ErrorState variant="inline" message={`Chưa tải được lịch điểm danh: ${getErrorMessage(checkInQ.error)}`} onRetry={() => void checkInQ.refetch()} />
              </Card>
            ) : checkInStatus && checkInView ? (
              <Card padding={16}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                    <IconTile icon={CalendarCheck} />
                    <div style={{ minWidth: 0 }}>
                      <Heading variant="title-sm" as="h2">
                        {homeCopy.offers.checkInTitle}
                      </Heading>
                      <Text variant="caption" tone="tertiary" as="div">
                        {homeCopy.offers.streak(checkInStatus.streakDays)}
                      </Text>
                    </div>
                  </div>
                  <Button disabled={!checkInView.canCheckIn || pending} loading={pending} onPress={checkIn} style={{ flexShrink: 0 }}>
                    {checkInView.buttonLabel}
                  </Button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, textAlign: 'center', marginTop: 12 }}>
                  {checkInStatus.rewards.map((r) => (
                    <div
                      key={r.day}
                      style={{
                        padding: '6px 2px',
                        borderRadius: 'var(--radius-control)',
                        background: r.claimed ? 'var(--color-bg-subtle)' : r.isToday ? 'var(--color-action-secondary-bg)' : 'var(--color-bg-canvas)',
                        border: r.isToday ? '1px solid var(--color-border-selected)' : '1px solid transparent',
                      }}
                    >
                      <Text variant="caption" tone="tertiary" as="div">
                        N{r.day}
                      </Text>
                      <Text variant="label" tone={r.claimed ? 'brand' : 'primary'} as="div">
                        {r.claimed ? <Icon icon={Check} size="sm" tone="brand" /> : `+${formatNumber(r.points)}`}
                      </Text>
                    </div>
                  ))}
                </div>
              </Card>
            ) : null}
          </section>

          {/* Đổi quà và tiện ích */}
          <section aria-label={homeCopy.offers.rewardsTitle} style={{ padding: '12px 16px 0' }}>
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

          {/* Mã giảm giá của tôi */}
          <section id="coupons" ref={couponsRef} aria-label={homeCopy.offers.couponsTitle} style={{ padding: '16px 16px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
              <Heading variant="title-sm" as="h2">
                {homeCopy.offers.couponsTitle}
              </Heading>
              {coupons.length > 0 && (
                <Text variant="caption" tone="tertiary">
                  {homeCopy.offers.couponsCount(coupons.length)}
                </Text>
              )}
            </div>
            {couponsQ.isLoading ? (
              <Skeleton height={64} />
            ) : couponsQ.isError ? (
              <ErrorState variant="inline" message={`Chưa tải được mã giảm giá: ${getErrorMessage(couponsQ.error)}`} onRetry={() => void couponsQ.refetch()} />
            ) : coupons.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {coupons.map((c) => (
                  <CouponCard key={c.code} coupon={c} />
                ))}
              </div>
            ) : (
              <EmptyState variant="inline" art="leaf" heading={homeCopy.offers.couponsEmptyHeading} body={homeCopy.offers.couponsEmptyBody} />
            )}
          </section>
        </>
      )}
    </Page>
  );
}
