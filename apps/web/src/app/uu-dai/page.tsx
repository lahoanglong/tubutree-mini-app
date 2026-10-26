'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Gift, Leaf, PackageOpen, Recycle, ScanLine, Sprout, Users, type LucideIcon } from 'lucide-react';
import type { CouponDTO } from '@tubutree/app-core/api/loyalty';
import { checkInCopy } from '@tubutree/app-core/daily-check-in-copy';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { isCouponExpiring, memberCardAriaLabel, memberCardView, RECYCLE_REQUESTS_LABEL } from '@tubutree/app-core/home-layout';
import { couponsQuery, loyaltyQuery } from '@tubutree/app-core/queries/loyalty';
import { useAuth } from '@/lib/auth-context';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { pointsSummary } from '@/lib/checkout-points';
import { autoCouponName } from '@/lib/coupon-name';
import { formatDate } from '@/lib/format-date';
import { formatVnd } from '@/lib/format-vnd';
import { useMarkExpiringSeen } from '@/lib/use-offers-dot';
import { useRecycleOpenRequests } from '@/lib/use-recycle-open-requests';
import { usePublicConfig } from '@/lib/use-public-config';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { MiniAppOnlyNotice } from '@/components/mini-app-only-notice';
import { CouponActions } from '@/components/loyalty/coupon-actions';
import { DailyCheckInCard } from '@/components/loyalty/daily-check-in-card';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { Card, EmptyState, Heading, Icon, ListRow, Skeleton, Text } from '@/components/mini';

const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Đã có lỗi xảy ra — Vui lòng thử lại');

function couponLabel(c: CouponDTO): string {
  if (c.type === 'FREESHIP') return 'Miễn phí giao hàng';
  if (c.type === 'PERCENT') return `Giảm ${c.value}%${c.maxDiscount ? ` (tối đa ${formatVnd(c.maxDiscount)})` : ''}`;
  return `Giảm ${formatVnd(c.value)}`;
}

function IconTile({ icon }: { icon: LucideIcon }) {
  return (
    <span style={{ width: 34, height: 34, borderRadius: 'var(--radius-control)', background: 'var(--color-bg-subtle)', display: 'grid', placeItems: 'center', flex: '0 0 auto' }}>
      <Icon icon={icon} tone="brand" />
    </span>
  );
}

function CouponCard({ coupon: c }: { coupon: CouponDTO }) {
  return (
    <div
      style={{
        padding: 12,
        background: 'var(--color-promo-bg)',
        borderRadius: 'var(--radius-control)',
        border: '1px dashed var(--clay-100)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <Text variant="body-sm" as="div" style={{ color: 'var(--color-promo-fg)', fontWeight: 700 }}>
            {couponLabel(c)}
          </Text>
          <Text variant="caption" tone="secondary" as="div">
            {autoCouponName(c.code) ?? `Mã ${c.code}`}
            {c.minOrder ? ` · đơn từ ${formatVnd(c.minOrder)}` : ''}
          </Text>
        </div>
        <div style={{ textAlign: 'right', flex: '0 0 auto' }}>
          <Text variant="caption" tone="tertiary" as="div">
            HSD {formatDate(c.endAt)}
          </Text>
          {isCouponExpiring(c, Date.now()) && (
            <Text variant="caption" as="div" style={{ color: 'var(--color-text-warning)', fontWeight: 700 }}>
              {homeCopy.offers.couponExpiring}
            </Text>
          )}
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        <CouponActions code={c.code} />
      </div>
    </div>
  );
}

/**
 * Trang Ưu đãi (phương án A), bản web của `pages/offers.tsx` ở Mini App: thẻ Điểm Xanh và hạng, Điểm danh, Đổi quà và tiện ích,
 * Mã giảm giá của tôi. `?section=coupons` cuộn tới danh sách mã. Dòng "Tích điểm đơn sàn" chỉ hiện khi cấu hình bật và mở thông báo "cần mở trên Zalo" (web không có màn quét).
 */
function OffersContent() {
  const router = useRouter();
  const params = useSearchParams();
  const phase = useAuthPhase();
  const authed = phase === 'authenticated';
  const { user } = useAuth();
  const cfg = usePublicConfig();
  const [claimNoticeOpen, setClaimNoticeOpen] = useState(false);
  const loyaltyQ = useQuery({ ...loyaltyQuery(coreHttp), enabled: authed });
  const couponsQ = useQuery({ ...couponsQuery(coreHttp), enabled: authed });
  const couponsRef = useRef<HTMLElement>(null);
  const wantsCoupons = params?.get('section') === 'coupons';
  const couponsReady = couponsQ.isSuccess || couponsQ.isError;

  useEffect(() => {
    if (wantsCoupons && couponsReady) couponsRef.current?.scrollIntoView?.({ block: 'start' });
  }, [wantsCoupons, couponsReady]);

  const card = user
    ? memberCardView({ overview: loyaltyQ.data, pointsTotal: pointsSummary(loyaltyQ.data ?? user).total, vndPerPointRedeem: cfg.loyalty?.vndPerPointRedeem })
    : null;
  const coupons = couponsQ.data ?? [];
  useMarkExpiringSeen(couponsQ.data);
  const wasteEnabled = cfg.isLoaded && cfg.waste.enabled;
  const recycleOpen = useRecycleOpenRequests(authed, cfg.isLoaded && !cfg.waste.enabled);

  const shortcuts: { icon: LucideIcon; title: string; subtitle: string; to: string; show: boolean; miniAppOnly?: boolean }[] = [
    { icon: Gift, title: homeCopy.offers.rewardsTitle, subtitle: homeCopy.offers.rewardsHint, to: '/kho-qua', show: true },
    { icon: PackageOpen, title: homeCopy.offers.myRewards, subtitle: homeCopy.offers.myRewardsHint, to: '/kho-qua/cua-toi', show: true },
    {
      icon: Recycle,
      title: wasteEnabled ? 'Đổi rác lấy quà' : RECYCLE_REQUESTS_LABEL,
      subtitle: wasteEnabled ? homeCopy.offers.recycleHint : homeCopy.offers.recyclePausedHint,
      to: '/doi-rac',
      show: wasteEnabled || recycleOpen,
    },
    { icon: ScanLine, title: 'Tích điểm đơn sàn', subtitle: homeCopy.offers.claimHint, to: '/points/scan', show: cfg.isLoaded && cfg.loyalty?.marketplaceClaimEnabled === true, miniAppOnly: true },
    { icon: Users, title: 'Mua chung nhóm', subtitle: homeCopy.offers.groupBuyHint, to: '/mua-chung', show: true },
    { icon: Sprout, title: 'Vườn Xanh', subtitle: 'Chăm cây nhận quà', to: '/vuon-xanh', show: true },
  ];

  let body: React.ReactNode;
  if (phase === 'loading') body = <AuthLoading />;
  else if (phase === 'unavailable') body = <SessionUnavailable />;
  else if (!authed) body = <LoginRequired message={`${homeCopy.offers.loginTitle}. ${homeCopy.offers.loginBody}`} returnTo="/uu-dai" />;
  else
    body = (
      <div className="flex flex-col gap-3 md:max-w-xl">
        <section aria-label={homeCopy.offers.pointsTitle}>
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
                onClick={() => router.push('/tai-khoan/diem-xanh')}
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
                        onClick={() => void loyaltyQ.refetch()}
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

        <section aria-label={checkInCopy.title}>
          <DailyCheckInCard authed={authed} />
        </section>

        <section aria-label={homeCopy.offers.rewardsTitle}>
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
                  onPress={() => (s.miniAppOnly ? setClaimNoticeOpen((o) => !o) : router.push(s.to))}
                  style={{ padding: 12, borderTop: i === 0 ? 'none' : '1px solid var(--color-border-subtle)' }}
                />
              ))}
            {claimNoticeOpen && shortcuts.some((s) => s.miniAppOnly && s.show) && (
              <div id="claim-notice">
                <MiniAppOnlyNotice compact miniappPath="/points/scan" />
              </div>
            )}
          </Card>
        </section>

        <section id="coupons" ref={couponsRef} aria-label={homeCopy.offers.couponsTitle} style={{ paddingTop: 4 }}>
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
            <ErrorState message={`Chưa tải được mã giảm giá: ${errText(couponsQ.error)}`} onRetry={() => void couponsQ.refetch()} />
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
      </div>
    );

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 max-md:pt-0">
      <PageHeader title={homeCopy.offers.title} />
      <div className="mt-3">{body}</div>
    </main>
  );
}

// Trang đọc useSearchParams (?section=coupons): build tĩnh bắt buộc có Suspense bao ngoài.
export default function OffersPage() {
  return (
    <Suspense fallback={<AuthLoading />}>
      <OffersContent />
    </Suspense>
  );
}
