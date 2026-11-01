'use client';

import { COUPONS_LOAD_ERROR_TITLE } from '@tubutree/app-core/loyalty-tier-copy';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Gift, PackageOpen, Recycle, ScanLine, Sprout, Users, type LucideIcon } from 'lucide-react';
import { mineRows } from '@tubutree/app-core/commerce/voucher-center';
import { checkInCopy } from '@tubutree/app-core/daily-check-in-copy';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { isCouponExpiring, RECYCLE_REQUESTS_LABEL } from '@tubutree/app-core/home-layout';
import { couponsQuery, loyaltyQuery } from '@tubutree/app-core/queries/loyalty';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { useAuth } from '@/lib/auth-context';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { useMarkExpiringSeen } from '@/lib/use-offers-dot';
import { useRecycleOpenRequests } from '@/lib/use-recycle-open-requests';
import { usePublicConfig } from '@/lib/use-public-config';
import { useCouponUse } from '@/lib/use-coupon-use';
import { CampaignBanner } from '@/components/campaign/campaign-banner';
import { readStoredHomeKind } from '@/components/home/use-home-customer-kind';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { MiniAppOnlyNotice } from '@/components/mini-app-only-notice';
import { DailyCheckInCard } from '@/components/loyalty/daily-check-in-card';
import { OffersCollect } from '@/components/offers/offers-collect';
import { OffersFlash } from '@/components/offers/offers-flash';
import { OffersPointsStrip } from '@/components/offers/offers-points-strip';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { Card, EmptyState, Icon, ListRow, SectionHeader, Skeleton, Text, VoucherTicket } from '@/components/mini';
import { PAGE_WIDE } from '@/lib/page-frame';
import { loadErrorText } from '@/lib/error-text';

const errText = loadErrorText;

function IconTile({ icon }: { icon: LucideIcon }) {
  return (
    <span style={{ width: 34, height: 34, borderRadius: 'var(--radius-control)', background: 'var(--color-bg-subtle)', display: 'grid', placeItems: 'center', flex: '0 0 auto' }}>
      <Icon icon={icon} tone="brand" />
    </span>
  );
}

/**
 * Trang Ưu đãi (Q10), bản web của `pages/offers.tsx` ở Mini App: Banner chiến dịch, Giờ vàng hôm nay, Nhận mã, dải Điểm Xanh gọn và Điểm danh,
 * Mã của tôi, Đổi quà và tiện ích. Ba khối đầu là công khai (khách chưa đăng nhập xem được, "Lưu mã" đi tới đăng nhập); từ dải Điểm Xanh trở xuống
 * cần tài khoản. Khung rộng, không còn khung Tài khoản: từ lg hàng Điểm Xanh | Điểm danh chia hai cột, Nhận mã và Mã của tôi xếp lưới ba cột.
 * `?section=coupons` cuộn tới Mã của tôi. Dòng "Tích điểm đơn sàn" chỉ hiện khi cấu hình bật và mở thông báo "cần mở trên Zalo" (web không có màn quét).
 */
function OffersContent() {
  const router = useRouter();
  const params = useSearchParams();
  const phase = useAuthPhase();
  const authed = phase === 'authenticated';
  const { user } = useAuth();
  const cfg = usePublicConfig();
  const { use: applyCoupon, notice: couponNotice } = useCouponUse();
  const [claimNoticeOpen, setClaimNoticeOpen] = useState(false);
  const loyaltyQ = useQuery({ ...loyaltyQuery(coreHttp), enabled: authed });
  const couponsQ = useQuery({ ...couponsQuery(coreHttp), enabled: authed });
  const couponsRef = useRef<HTMLElement>(null);
  const wantsCoupons = params?.get('section') === 'coupons';
  const couponsReady = couponsQ.isSuccess || couponsQ.isError;

  useEffect(() => {
    if (wantsCoupons && couponsReady) couponsRef.current?.scrollIntoView?.({ block: 'start' });
  }, [wantsCoupons, couponsReady]);

  const coupons = couponsQ.data ?? [];
  const walletCodes = useMemo(() => new Set(coupons.map((c) => c.code)), [coupons]);
  const rows = useMemo(() => mineRows(coupons, Date.now()), [coupons]);
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

  const now = Date.now();
  const rest =
    phase === 'loading' ? (
      <div data-testid="offers-page-loading" aria-busy="true" className="flex flex-col gap-3">
        <Skeleton height={120} radius="var(--radius-card)" />
        <Skeleton height={140} radius="var(--radius-card)" />
        <Skeleton height={176} radius="var(--radius-card)" />
      </div>
    ) : phase === 'unavailable' ? (
      <SessionUnavailable />
    ) : !authed ? (
      <LoginRequired message={`${homeCopy.offers.loginTitle}. ${homeCopy.offers.loginBody}`} returnTo="/uu-dai" />
    ) : (
      <>
        <div data-testid="offers-points-row" className="grid grid-cols-1 gap-3 lg:grid-cols-2 lg:items-start">
          <OffersPointsStrip loyalty={loyaltyQ} />
          <section aria-label={checkInCopy.title}>
            <DailyCheckInCard authed={authed} />
          </section>
        </div>

        <section id="coupons" ref={couponsRef} aria-labelledby="offers-mine-title">
          <SectionHeader
            id="offers-mine-title"
            title={fillCopy('coupon.tabMine')}
            icon="ticket"
            trailing={
              rows.length > 0 ? (
                <Text variant="caption" tone="tertiary">
                  {homeCopy.offers.couponsCount(rows.length)}
                </Text>
              ) : undefined
            }
            action={{ onPress: () => router.push('/ma-giam-gia?tab=mine'), spoken: fillCopy('section.seeAllSpoken', { title: fillCopy('coupon.tabMine') }) }}
          />
          {couponNotice && (
            <p role={couponNotice.error ? 'alert' : 'status'} className={`mb-2 text-caption ${couponNotice.error ? 'text-danger-fg' : 'text-stone-700'}`}>
              {couponNotice.text}
            </p>
          )}
          {couponsQ.isLoading ? (
            <Skeleton height={88} radius="var(--radius-card)" />
          ) : couponsQ.isError ? (
            <ErrorState variant="inline" title={COUPONS_LOAD_ERROR_TITLE} message={errText(couponsQ.error)} onRetry={() => void couponsQ.refetch()} />
          ) : rows.length > 0 ? (
            <div data-testid="offers-mine-grid" className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {rows.map((row) => (
                <VoucherTicket
                  key={row.view.code}
                  voucher={row.view}
                  variant="ticket"
                  primary={{ label: fillCopy('coupon.use'), onClick: () => void applyCoupon(row.view.code) }}
                  expiring={isCouponExpiring(row.coupon, now)}
                />
              ))}
            </div>
          ) : (
            <EmptyState variant="inline" art="leaf" heading={homeCopy.offers.couponsEmptyHeading} body={homeCopy.offers.couponsEmptyBody} />
          )}
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
      </>
    );

  return (
    <>
      <PageHeader title={homeCopy.offers.title} />
      <div className="mt-3 flex flex-col gap-3">
        {/* Khách chưa đăng nhập là khách mới; đã đăng nhập mà máy chưa nhớ loại (hoặc đang khôi phục phiên) thì chưa biết: chỉ thấy chiến dịch cho mọi người. */}
        <CampaignBanner placement="OFFERS_TOP" kind={authed ? (readStoredHomeKind(user?.id) ?? 'unknown') : phase === 'guest' ? 'new' : 'unknown'} />
        <OffersFlash />
        <OffersCollect walletCodes={walletCodes} walletLoading={phase === 'loading' || (authed && couponsQ.isLoading)} />
        {rest}
      </div>
    </>
  );
}

// Trang đọc useSearchParams (?section=coupons): build tĩnh bắt buộc có Suspense bao ngoài. <main> đứng ngoài Suspense để khung chờ cũng nằm trong khung rộng;
// PageHeader vẫn là con trực tiếp của <main> (Suspense không thêm phần tử) nên dải tiêu đề tràn mép như các trang con khác.
export default function OffersPage() {
  return (
    <main className={`${PAGE_WIDE} py-6 max-md:pt-0`}>
      <Suspense fallback={<AuthLoading />}>
        <OffersContent />
      </Suspense>
    </main>
  );
}
