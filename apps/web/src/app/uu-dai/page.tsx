'use client';

import { COUPONS_LOAD_ERROR_TITLE } from '@tubutree/app-core/loyalty-tier-copy';
import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Leaf, Recycle, ScanLine, Users, type LucideIcon } from 'lucide-react';
import { mineRows } from '@tubutree/app-core/commerce/voucher-center';
import { OFFERS_TABS, offersTabHref, parseOffersTab, type OffersTab } from '@tubutree/app-core/commerce/offers-hub';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { isCouponExpiring, RECYCLE_REQUESTS_LABEL } from '@tubutree/app-core/home-layout';
import { couponsQuery, loyaltyQuery } from '@tubutree/app-core/queries/loyalty';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { useAuth } from '@/lib/auth-context';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { pushOrBack } from '@/lib/nav-depth';
import { useMarkExpiringSeen } from '@/lib/use-offers-dot';
import { useRecycleOpenRequests } from '@/lib/use-recycle-open-requests';
import { usePublicConfig } from '@/lib/use-public-config';
import { useCouponUse } from '@/lib/use-coupon-use';
import { isWebRootPath } from '@/lib/web-nav';
import { CampaignBanner } from '@/components/campaign/campaign-banner';
import { readStoredHomeKind } from '@/components/home/use-home-customer-kind';
import { AuthLoading, SessionUnavailable } from '@/components/login-required';
import { MiniAppOnlyNotice } from '@/components/mini-app-only-notice';
import { OffersCheckInStrip } from '@/components/offers/offers-check-in-strip';
import { OffersCollect } from '@/components/offers/offers-collect';
import { OffersFlash } from '@/components/offers/offers-flash';
import { OffersIconTile } from '@/components/offers/offers-icon-tile';
import { OffersPointsStrip } from '@/components/offers/offers-points-strip';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { Card, EmptyState, GuestLinkCard, ListRow, SegmentedTabs, Skeleton, VoucherTicket } from '@/components/mini';
import { PAGE_WIDE } from '@/lib/page-frame';
import { loadErrorText } from '@/lib/error-text';

const errText = loadErrorText;

// Kho quà (đổi quà, khung xác nhận, kết quả) nặng và chỉ cần khi khách mở tab Đổi quà: tách chunk, không kéo vào gói của tab gốc.
const RewardsView = lazy(() => import('@/components/rewards/rewards-view').then((m) => ({ default: m.RewardsView })));

/**
 * Trung tâm Ưu đãi (tab gốc), bản web của `pages/offers.tsx` ở Mini App: MỘT trang, ba phân mục đổi ngay tại chỗ bằng `?tab=` (replace, Back không tua từng tab).
 * Săn mã: Banner, Giờ vàng, Nhận mã, dải Điểm Xanh và dải điểm danh mỏng (điểm danh làm ở Vườn Xanh), Mua chung. Mã của tôi: cả ví mã, "Dùng ngay" vào thẳng Giỏ
 * hoặc Sản phẩm. Đổi quà: Kho quà ngay tại chỗ kèm số dư, và một thẻ sang Điểm Xanh (hạng, lịch sử điểm) và Đổi rác. Phân mục công khai (Giờ vàng, Nhận mã, quà) khách
 * chưa đăng nhập xem được. Link cũ `?section=coupons` mở Mã của tôi; `/kho-qua` và `/ma-giam-gia` vẫn là trang riêng.
 * Khung rộng, không còn khung Tài khoản: từ lg hàng Điểm Xanh | Điểm danh chia hai cột, ví mã xếp lưới ba cột.
 * Dòng "Tích điểm đơn sàn" chỉ hiện khi cấu hình bật và mở thông báo "cần mở trên Zalo" (web không có màn quét).
 */
function OffersContent() {
  const router = useRouter();
  const params = useSearchParams();
  const phase = useAuthPhase();
  const authed = phase === 'authenticated';
  const { user } = useAuth();
  const cfg = usePublicConfig();
  const { use: applyCoupon, notice: couponNotice, usingCode } = useCouponUse();
  const [claimNoticeOpen, setClaimNoticeOpen] = useState(false);
  const loyaltyQ = useQuery({ ...loyaltyQuery(coreHttp), enabled: authed });
  const couponsQ = useQuery({ ...couponsQuery(coreHttp), enabled: authed });
  const tab = parseOffersTab(params?.get('tab'), params?.get('section'));

  // Tab gốc kế bên (Vườn Xanh) thay mục hiện tại như thanh đáy, còn lại đẩy trang mới hoặc lùi thật nếu đích chính là trang ngay trước.
  const go = (to: string) => {
    if (isWebRootPath(to)) router.replace(to);
    else pushOrBack(router, to);
  };

  const pickTab = (key: string) => {
    if (key === tab) return;
    // Về đầu trang trước khi ghi URL: nội dung mới ngắn hơn có thể kẹp vị trí cuộn về giữa trang.
    window.scrollTo({ top: 0 });
    router.replace(offersTabHref('/uu-dai', key as OffersTab), { scroll: false });
  };

  const coupons = useMemo(() => couponsQ.data ?? [], [couponsQ.data]);
  const walletCodes = useMemo(() => new Set(coupons.map((c) => c.code)), [coupons]);
  const rows = useMemo(() => mineRows(coupons, Date.now()), [coupons]);
  // Ghi "đã xem" mã sắp hết hạn chỉ khi khách thật sự thấy cả ví (tab Mã của tôi), để chấm đỏ tắt đúng lúc.
  const walletCoupons = useMemo(() => rows.map((r) => r.coupon), [rows]);
  useMarkExpiringSeen(authed && tab === 'wallet' ? walletCoupons : undefined);
  const wasteEnabled = cfg.isLoaded && cfg.waste.enabled;
  const recycleOpen = useRecycleOpenRequests(authed, cfg.isLoaded && !cfg.waste.enabled);

  const pageSkeleton = (
    <div data-testid="offers-page-loading" aria-busy="true" className="flex flex-col gap-3">
      <Skeleton height={120} radius="var(--radius-card)" />
      <Skeleton height={140} radius="var(--radius-card)" />
      <Skeleton height={176} radius="var(--radius-card)" />
    </div>
  );

  const utilities: { icon: LucideIcon; title: string; subtitle: string; to: string; show: boolean; miniAppOnly?: boolean }[] = [
    { icon: Users, title: 'Mua chung nhóm', subtitle: homeCopy.offers.groupBuyHint, to: '/mua-chung', show: true },
    { icon: ScanLine, title: 'Tích điểm đơn sàn', subtitle: homeCopy.offers.claimHint, to: '/points/scan', show: cfg.isLoaded && cfg.loyalty?.marketplaceClaimEnabled === true, miniAppOnly: true },
  ];
  const shownUtilities = utilities.filter((s) => s.show);

  const now = Date.now();
  let panel: ReactNode;
  if (tab === 'deals') {
    panel = (
      <>
        {/* Khách chưa đăng nhập là khách mới; đã đăng nhập mà máy chưa nhớ loại (hoặc đang khôi phục phiên) thì chưa biết: chỉ thấy chiến dịch cho mọi người. */}
        <CampaignBanner placement="OFFERS_TOP" kind={authed ? (readStoredHomeKind(user?.id) ?? 'unknown') : phase === 'guest' ? 'new' : 'unknown'} />
        <OffersFlash />
        <OffersCollect walletCodes={walletCodes} walletLoading={phase === 'loading' || (authed && couponsQ.isLoading)} />
        {phase === 'loading' && pageSkeleton}
        {phase === 'unavailable' && <SessionUnavailable />}
        {phase === 'guest' && <GuestLinkCard title={fillCopy('offers.guestPointsTitle')} body={fillCopy('offers.guestPointsBody')} cta={fillCopy('login.cta')} />}
        {authed && (
          <div data-testid="offers-points-row" className="grid grid-cols-1 gap-3 lg:grid-cols-2 lg:items-start">
            <OffersPointsStrip loyalty={loyaltyQ} />
            <OffersCheckInStrip authed={authed} onOpenGarden={() => go('/vuon-xanh')} />
          </div>
        )}
        {(authed || phase === 'guest') && shownUtilities.length > 0 && (
          <section aria-label="Tiện ích">
            <Card variant="outline" padding={0} style={{ overflow: 'hidden' }}>
              {shownUtilities.map((s, i) => (
                <ListRow
                  key={s.to}
                  icon={<OffersIconTile icon={s.icon} />}
                  title={s.title}
                  subtitle={s.subtitle}
                  trailing="chevron"
                  onPress={() => (s.miniAppOnly ? setClaimNoticeOpen((o) => !o) : go(s.to))}
                  style={{ padding: 'var(--space-inset-card)', borderTop: i === 0 ? 'none' : '1px solid var(--color-border-subtle)' }}
                />
              ))}
              {claimNoticeOpen && shownUtilities.some((s) => s.miniAppOnly) && (
                <div id="claim-notice">
                  <MiniAppOnlyNotice compact miniappPath="/points/scan" />
                </div>
              )}
            </Card>
          </section>
        )}
      </>
    );
  } else if (tab === 'wallet') {
    panel =
      phase === 'loading' ? (
        pageSkeleton
      ) : phase === 'unavailable' ? (
        <SessionUnavailable />
      ) : !authed ? (
        <GuestLinkCard title={fillCopy('coupon.tabMine')} body={fillCopy('offers.guestMineBody')} cta={fillCopy('login.cta')} />
      ) : (
        <section aria-labelledby="offers-mine-title" className="flex flex-col gap-3">
          <h2 id="offers-mine-title" className="sr-only">
            {fillCopy('coupon.tabMine')}
          </h2>
          {couponNotice && (
            <p role={couponNotice.error ? 'alert' : 'status'} className={`text-caption ${couponNotice.error ? 'text-danger-fg' : 'text-[color:var(--color-text-secondary)]'}`}>
              {couponNotice.text}
            </p>
          )}
          {couponsQ.isLoading ? (
            <Skeleton height={88} radius="var(--radius-card)" />
          ) : couponsQ.isError && !couponsQ.data ? (
            <ErrorState variant="inline" title={COUPONS_LOAD_ERROR_TITLE} message={errText(couponsQ.error)} onRetry={() => couponsQ.refetch()} />
          ) : rows.length > 0 ? (
            <div data-testid="offers-mine-grid" className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {rows.map((row) => (
                <VoucherTicket
                  key={row.view.code}
                  voucher={row.view}
                  variant="ticket"
                  primary={{
                    label: fillCopy('coupon.use'),
                    onClick: () => void applyCoupon(row.view.code),
                    busy: usingCode === row.view.code,
                    disabled: Boolean(usingCode) && usingCode !== row.view.code,
                  }}
                  expiring={isCouponExpiring(row.coupon, now)}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              variant="inline"
              art="leaf"
              heading={homeCopy.offers.couponsEmptyHeading}
              body={homeCopy.offers.couponsEmptyBody}
              ctaLabel={fillCopy('offers.walletMore')}
              onCta={() => pickTab('deals')}
            />
          )}
          <Card variant="outline" padding={0} style={{ overflow: 'hidden' }}>
            <ListRow title={fillCopy('offers.walletHistory')} trailing="chevron" onPress={() => go('/ma-giam-gia?tab=history')} style={{ padding: 'var(--space-inset-card)' }} />
          </Card>
        </section>
      );
  } else {
    panel = (
      <>
        <Suspense fallback={<Skeleton height={120} radius="var(--radius-card)" />}>
          <RewardsView />
        </Suspense>
        {authed && (
          <section aria-label={homeCopy.offers.pointsTitle}>
            <Card variant="outline" padding={0} style={{ overflow: 'hidden' }}>
              <ListRow
                icon={<OffersIconTile icon={Leaf} />}
                title={homeCopy.offers.pointsTitle}
                subtitle={homeCopy.offers.pointsDetail}
                trailing="chevron"
                onPress={() => go('/tai-khoan/diem-xanh')}
                style={{ padding: 'var(--space-inset-card)' }}
              />
              {(wasteEnabled || recycleOpen) && (
                <ListRow
                  icon={<OffersIconTile icon={Recycle} />}
                  title={wasteEnabled ? 'Đổi rác lấy quà' : RECYCLE_REQUESTS_LABEL}
                  subtitle={wasteEnabled ? homeCopy.offers.recycleHint : homeCopy.offers.recyclePausedHint}
                  trailing="chevron"
                  onPress={() => go('/doi-rac')}
                  style={{ padding: 'var(--space-inset-card)', borderTop: '1px solid var(--color-border-subtle)' }}
                />
              )}
            </Card>
          </section>
        )}
      </>
    );
  }

  const activeLabel = OFFERS_TABS.find((t) => t.key === tab)!.label;
  return (
    <>
      <PageHeader title={homeCopy.offers.title} />
      {/* Dính dưới đầu trang (Ưu đãi là tab gốc nên không có nút lùi; `sticky-below-back` chỉ có tác dụng ở trang con có nút lùi). Cùng khuôn với Mã giảm giá. */}
      <div className="tubu-bleed sticky-below-back sticky top-[var(--safe-top)] z-[2] bg-[var(--color-bg-canvas)] px-4 pb-1 pt-2 md:top-[var(--header-h)] md:px-0">
        <div className="md:max-w-md">
          <SegmentedTabs label={fillCopy('offers.tabsLabel')} items={[...OFFERS_TABS]} value={tab} onChange={pickTab} />
        </div>
      </div>
      <div role="tabpanel" aria-label={activeLabel} className="mt-3 flex flex-col gap-3">
        {panel}
      </div>
    </>
  );
}

// Trang đọc useSearchParams (?tab=, ?section=): build tĩnh bắt buộc có Suspense bao ngoài. <main> đứng ngoài Suspense để khung chờ cũng nằm trong khung rộng;
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
