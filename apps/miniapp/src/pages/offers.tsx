import { COUPONS_LOAD_ERROR_TITLE } from '@tubutree/app-core/loyalty-tier-copy';
import { lazy, Suspense, useMemo, useRef, type CSSProperties, type ReactNode } from 'react';
import { Page, useLocation, useNavigate } from 'zmp-ui';
import { useQuery } from '@tanstack/react-query';
import { Leaf, Recycle, ScanLine, Users, type LucideIcon } from 'lucide-react';
import { mineRows } from '@tubutree/app-core/commerce/voucher-center';
import {
  OFFERS_CODES_PARAM,
  OFFERS_HISTORY_PARAM,
  OFFERS_TABS,
  offersCodesOpen,
  offersHistoryOpen,
  offersTabHref,
  parseOffersTab,
  type OffersTab,
} from '@tubutree/app-core/commerce/offers-hub';
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
import { useSmartNavigate } from '../lib/smart-nav';
import { haptic } from '../utils/haptic';
import { AuthPhaseView, useBlockedMessage } from '../components/ui/auth-gate';
import { Card } from '../components/ui/card';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { Icon } from '../components/ui/icon';
import { ListRow } from '../components/ui/list-row';
import { PageHeader } from '../components/ui/page-header';
import { SegmentedTabs } from '../components/ui/segmented-tabs';
import { SR_ONLY } from '../components/ui/sr-only';
import { Skeleton } from '../components/ui/skeleton';
import { VoucherTicket } from '../components/ui/voucher-ticket';
import { GuestLinkCard } from '../components/home/guest-link-card';
import { CampaignBanner } from '../components/campaign/campaign-banner';
import { OffersCheckInStrip } from '../components/offers/offers-check-in-strip';
import { OffersCollect } from '../components/offers/offers-collect';
import { OffersFlash } from '../components/offers/offers-flash';
import { OffersHistory } from '../components/offers/offers-history';
import { OffersPointsStrip } from '../components/offers/offers-points-strip';

// Kho quà (đổi quà, khung xác nhận, kết quả) nặng và chỉ cần khi khách mở tab Đổi quà: tách chunk, không kéo vào gói của tab gốc.
const RewardsView = lazy(() => import('./rewards').then((m) => ({ default: m.RewardsView })));

/**
 * Hai hàng tab dính ngay dưới đầu trang. Ưu đãi là tab gốc (không có nút lùi) nên `top` là vùng an toàn; lớp `sticky-below-back` chỉ có tác dụng ở trang con có nút lùi.
 * Cùng khuôn với trang Mã giảm giá.
 */
const STICKY_BAR: CSSProperties = { position: 'sticky', top: 'var(--safe-top)', zIndex: 2, padding: 'var(--space-stack-sm) var(--space-gutter) var(--space-stack-xs)', background: 'var(--color-bg-canvas)' };

function IconTile({ icon }: { icon: LucideIcon }) {
  return (
    <span style={{ width: 34, height: 34, borderRadius: 'var(--radius-control)', background: 'var(--color-bg-subtle)', display: 'grid', placeItems: 'center', flex: '0 0 auto' }}>
      <Icon icon={icon} tone="brand" />
    </span>
  );
}

/**
 * Trung tâm Ưu đãi (tab gốc): MỘT trang, ba phân mục đổi ngay tại chỗ bằng `?tab=` (replace, Back không tua từng tab). Săn mã: Banner, Giờ vàng, Nhận mã,
 * dải Điểm Xanh và dải điểm danh mỏng (điểm danh làm ở Vườn Xanh), Mua chung; "Tất cả (n)" của Nhận mã mở cả kho mã tại chỗ (`?codes=all` mở sẵn). Mã của tôi:
 * cả ví mã, "Dùng ngay" vào thẳng Giỏ hoặc Sản phẩm, cuối ví mục "Mã đã dùng, hết hạn" mở tại chỗ (`?history=1` mở sẵn). Đổi quà: Kho quà ngay tại chỗ kèm
 * số dư, và một dải sang Điểm Xanh (hạng, lịch sử điểm) và Đổi rác. Phân mục công khai (Giờ vàng, Nhận mã, quà) khách chưa đăng nhập xem được.
 * Link cũ `?section=coupons` mở Mã của tôi; `/vouchers` và `/rewards` cũ chuyển hướng vào đây (`components/offers/legacy-redirects.tsx`).
 */
export default function OffersPage() {
  const navigate = useNavigate();
  const goSmart = useSmartNavigate();
  const location = useLocation();
  const phase = useAuthPhase();
  const authed = phase === 'authenticated';
  const user = useAuthStore((s) => s.user);
  const blocked = useBlockedMessage();
  const cfg = usePublicConfig();
  const { apply } = useCouponUse();
  const anchorRef = useRef<HTMLDivElement>(null);
  const loyaltyQ = useQuery({ queryKey: ['loyalty'], queryFn: getLoyalty, enabled: authed });
  const couponsQ = useQuery({ queryKey: ['coupons'], queryFn: getCoupons, enabled: authed });
  const query = new URLSearchParams(location.search);
  const tab = parseOffersTab(query.get('tab'), query.get('section'));

  const go = (to: string) => {
    haptic('light');
    goSmart(to);
  };

  const pickTab = (key: string) => {
    if (key === tab) return;
    // Về đầu trang trước khi ghi URL: nội dung mới ngắn hơn có thể kẹp vị trí cuộn về giữa trang.
    const scroller = anchorRef.current?.closest<HTMLElement>('.zaui-page');
    if (scroller) scroller.scrollTop = 0;
    navigate(offersTabHref('/offers', key as OffersTab), { replace: true });
  };

  const coupons = useMemo(() => couponsQ.data ?? [], [couponsQ.data]);
  const rows = useMemo(() => mineRows(coupons, Date.now()), [coupons]);
  // Ghi "đã xem" mã sắp hết hạn chỉ khi khách thật sự thấy cả ví (tab Mã của tôi), để chấm đỏ tắt đúng lúc.
  const walletCoupons = useMemo(() => rows.map((r) => r.coupon), [rows]);
  useMarkExpiringSeen(authed && tab === 'wallet' ? walletCoupons : undefined);
  const wasteEnabled = cfg.isLoaded && cfg.waste.enabled;
  const recycleOpen = useRecycleOpenRequests(authed, cfg.isLoaded && !cfg.waste.enabled);

  const pageSkeleton = (
    <div style={{ padding: 'var(--space-gutter)', display: 'flex', flexDirection: 'column', gap: 'var(--space-inset-card)' }}>
      <Skeleton height={140} radius="var(--radius-card)" />
      <Skeleton height={120} radius="var(--radius-card)" />
      <Skeleton height={176} radius="var(--radius-card)" />
    </div>
  );

  const utilities: { icon: LucideIcon; title: string; subtitle: string; to: string; show: boolean }[] = [
    { icon: Users, title: 'Mua chung nhóm', subtitle: homeCopy.offers.groupBuyHint, to: '/group-buy', show: true },
    { icon: ScanLine, title: 'Tích điểm đơn sàn', subtitle: homeCopy.offers.claimHint, to: '/points/scan', show: cfg.isLoaded && cfg.loyalty?.marketplaceClaimEnabled === true },
  ];
  const shownUtilities = utilities.filter((s) => s.show);

  const now = Date.now();
  let panel: ReactNode;
  if (tab === 'deals') {
    panel = (
      <>
        {/* Khách chưa đăng nhập là khách mới; đã đăng nhập mà máy chưa nhớ loại thì chưa biết (chỉ thấy chiến dịch cho mọi người). */}
        <CampaignBanner placement="OFFERS_TOP" kind={authed ? (readStoredHomeKind(user?.id) ?? 'unknown') : 'new'} />
        <OffersFlash />
        <OffersCollect wallet={couponsQ} openAll={offersCodesOpen(query.get(OFFERS_CODES_PARAM))} />
        {phase === 'guest' && <GuestLinkCard title={fillCopy('offers.guestPointsTitle')} body={blocked ?? fillCopy('offers.guestPointsBody')} cta={fillCopy('login.cta')} />}
        {authed && (
          <>
            <GuestLinkCard title={homeCopy.offers.guestTitle} body={homeCopy.offers.guestBody} cta={homeCopy.profile.guestCta} />
            <OffersPointsStrip loyalty={loyaltyQ} />
            <OffersCheckInStrip authed={authed} onOpenGarden={() => go('/game')} />
          </>
        )}
        {(authed || phase === 'guest') && shownUtilities.length > 0 && (
          <section aria-label="Tiện ích" style={{ padding: 'var(--space-gutter) var(--space-gutter) 0' }}>
            <Card variant="outline" padding={0} style={{ overflow: 'hidden' }}>
              {shownUtilities.map((s, i) => (
                <ListRow
                  key={s.to}
                  icon={<IconTile icon={s.icon} />}
                  title={s.title}
                  subtitle={s.subtitle}
                  trailing="chevron"
                  onPress={() => go(s.to)}
                  style={{ padding: 'var(--space-inset-card)', borderTop: i === 0 ? 'none' : '1px solid var(--color-border-subtle)' }}
                />
              ))}
            </Card>
          </section>
        )}
      </>
    );
  } else if (tab === 'wallet') {
    panel =
      phase === 'guest' || !authed ? (
        phase === 'guest' ? (
          <GuestLinkCard title={fillCopy('coupon.tabMine')} body={blocked ?? fillCopy('offers.guestMineBody')} cta={fillCopy('login.cta')} />
        ) : (
          <AuthPhaseView phase={phase} loading={pageSkeleton} />
        )
      ) : (
        <section aria-labelledby="offers-mine-title" style={{ padding: 'var(--space-inset-card) var(--space-gutter) 0' }}>
          <h2 id="offers-mine-title" style={SR_ONLY}>{fillCopy('coupon.tabMine')}</h2>
          {couponsQ.isLoading ? (
            <Skeleton height={88} radius="var(--radius-card)" />
          ) : couponsQ.isError ? (
            <ErrorState variant="inline" title={COUPONS_LOAD_ERROR_TITLE} message={getLoadErrorMessage(couponsQ.error)} onRetry={() => couponsQ.refetch()} />
          ) : rows.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-inset-card)' }}>
              {rows.map((row) => (
                <VoucherTicket
                  key={row.view.code}
                  voucher={row.view}
                  variant="ticket"
                  primary={{ label: fillCopy('coupon.use'), onClick: () => void apply(row.view.code) }}
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
          <OffersHistory initialOpen={offersHistoryOpen(query.get(OFFERS_HISTORY_PARAM))} scrollReady={!couponsQ.isLoading} />
        </section>
      );
  } else {
    panel = (
      <>
        <Suspense fallback={<div style={{ padding: 'var(--space-gutter)' }}><Skeleton height={120} radius="var(--radius-card)" /></div>}>
          <RewardsView />
        </Suspense>
        {authed && (
          <section aria-label={homeCopy.offers.pointsTitle} style={{ padding: '0 var(--space-gutter) var(--space-section)' }}>
            <Card variant="outline" padding={0} style={{ overflow: 'hidden' }}>
              <ListRow icon={<IconTile icon={Leaf} />} title={homeCopy.offers.pointsTitle} subtitle={homeCopy.offers.pointsDetail} trailing="chevron" onPress={() => go('/loyalty')} style={{ padding: 'var(--space-inset-card)' }} />
              {(wasteEnabled || recycleOpen) && (
                <ListRow
                  icon={<IconTile icon={Recycle} />}
                  title={wasteEnabled ? 'Đổi rác lấy quà' : RECYCLE_REQUESTS_LABEL}
                  subtitle={wasteEnabled ? homeCopy.offers.recycleHint : homeCopy.offers.recyclePausedHint}
                  trailing="chevron"
                  onPress={() => go('/recycle')}
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
    // Không dùng class "page": PageHeader đã cộng vùng an toàn, thêm .page sẽ cộng lần hai (như ghi ở bank-payment.tsx).
    <Page style={{ background: 'var(--color-bg-canvas)', paddingBottom: 100 }}>
      <div ref={anchorRef} />
      <PageHeader title={homeCopy.offers.title} back={false} />
      <div className="sticky-below-back" style={STICKY_BAR}>
        <SegmentedTabs label={fillCopy('offers.tabsLabel')} items={[...OFFERS_TABS]} value={tab} onChange={pickTab} />
      </div>
      {/* Số đều cho cả ba phân mục (mệnh giá, mã, hạn trên phiếu; điểm ở Kho quà), như trang Mã giảm giá cũ đặt ở gốc trang. */}
      <div role="tabpanel" aria-label={activeLabel} className="tubu-nums">
        {panel}
      </div>
    </Page>
  );
}
