import { lazy, Suspense, useEffect, type ComponentType } from 'react';
import { App, ZMPRouter, AnimationRoutes, SnackbarProvider } from 'zmp-ui';
import { Navigate, Route } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { getStorage } from 'zmp-sdk/apis';
import HomePage from '../pages/home';
import BottomNav from './bottom-nav';
import BackButton from './back-button';
import { ONBOARDING_SURVEY_ENABLED } from './onboarding-flag';
import { OpenAppRouter } from './open-app-router';
import { SiteSnowGate } from './season/site-snow-gate';
import { MainLandmark } from './ui/main-landmark';
import { NotifyRegion } from './notify-region';
import { RouteShell, RouteSkeleton, SilentBoundary } from './route-shell';
import ErrorBoundary, { hashMessage } from './error-boundary';
import { useAuthStore, setLogoutCleanup } from '../store/auth';
import { useStorefrontContext } from '../store/storefront-context';
import { reportLaunchLinkClick } from '../services/affiliate-api';
import { hasPartnerLinkParams } from './onboarding-rules';
import { readClaimParam, savePendingClaim } from '../services/coupon-claim';
import { createQueryClient } from '../services/query-client';
import { useScreenTracker } from '../hooks/use-screen-tracker';
import { useFlashSalesPoller } from '../hooks/use-flash-sales-poller';
import { useReferralTouch } from '../hooks/use-referral-touch';
import { useSessionRecovery } from '../hooks/use-auth-phase';
import { NavigationTypeProvider } from '../hooks/use-navigation-type';
import { LivePathnameProvider } from '../hooks/use-live-pathname';
import { trackEvent, trackAppOpened, flushEventQueueOnHide } from '../services/analytics';
import { useLegacyNotifyPrefsSync } from '../pages/settings-legacy-sync';

import { applyFontScale } from '../utils/font-scale';
import { getSessionAttribution } from '../utils/entry-source';
import { installPressFeedback } from '../utils/press-feedback';
import { CASHBACK_ENABLED } from '../utils/features';
import { LegacyRewardsRedirect, LegacyVouchersRedirect } from './offers/legacy-redirects';

const FONT_PX: Record<string, string> = { small: '15px', normal: '16px', large: '18px' };
/** Áp cỡ chữ đã lưu (Cài đặt) ngay khi mở app để giữ a11y qua các phiên. */
function applySavedFontScale(): void {
  void getStorage({ keys: ['tubu_prefs'] }).then((res) => {
    const raw = (res as Record<string, unknown>)['tubu_prefs'];
    if (typeof raw === 'string') {
      try {
        const scale = (JSON.parse(raw) as { fontScale?: 'small' | 'normal' | 'large' }).fontScale;
        if (scale && FONT_PX[scale]) applyFontScale(scale);
      } catch {
        /* ignore */
      }
    }
  });
}

// Đọc một lần lúc mở app: khách vào bằng link CTV/gian hàng thì cả phiên không bị quiz chặn.
const OPENED_FROM_PARTNER_LINK =
  typeof window !== 'undefined' && hasPartnerLinkParams(window.location.search, window.location.hash);

// Mã `?claim=` đã lưu ở entry (useEffect bên dưới) nên chunk này tải chậm hay lỗi cũng không mất mã.
const CouponClaimGate = lazy(() => import('./coupon-claim-gate').then((m) => ({ default: m.CouponClaimGate })));

// Code-split: Home eager (first paint), các trang khác lazy để giữ initial bundle nhỏ (§13.4).
// Khảo sát đang tắt: cờ là hằng nên nhánh import bị bỏ lúc build, bản build không có chunk khảo sát.
const OnboardingGate: ComponentType<{ openedFromPartnerLink?: boolean }> = ONBOARDING_SURVEY_ENABLED
  ? lazy(() => import('./onboarding').then((m) => ({ default: m.OnboardingGate })))
  : () => null;
const loadBrowse = () => import('../pages/browse');
const CampaignPage = lazy(() => import('../pages/campaign'));
const BrowsePage = lazy(loadBrowse);
const BestSellersPage = lazy(() => import('../pages/best-sellers'));
const GiftCombosPage = lazy(() => import('../pages/gift-combos'));
const RefillDealsPage = lazy(() => import('../pages/refill-deals'));
const GreenBoxPage = lazy(() => import('../pages/green-box'));
const loadProductDetail = () => import('../pages/product-detail');
const ProductDetailPage = lazy(loadProductDetail);
const loadCart = () => import('../pages/cart');
const CartPage = lazy(loadCart);
const loadCheckout = () => import('../pages/checkout');
const CheckoutPage = lazy(loadCheckout);
const BankPaymentPage = lazy(() => import('../pages/bank-payment'));
const OrdersPage = lazy(() => import('../pages/orders'));
const SubscriptionsPage = lazy(() => import('../pages/subscriptions'));
const OrderDetailPage = lazy(() => import('../pages/order-detail'));
const GamePage = lazy(() => import('../pages/game'));
const GamePlayPage = lazy(() => import('../pages/game-play'));
const GameMatcherPage = lazy(() => import('../pages/game-matcher'));
const GameAlbumPage = lazy(() => import('../pages/game-album'));
const FeedPage = lazy(() => import('../pages/feed'));
const CommunityEventsPage = lazy(() => import('../pages/community-events'));
const PostDetailPage = lazy(() => import('../pages/post-detail'));
const AiAdvisorPage = lazy(() => import('../pages/ai-advisor'));
const GroupBuyPage = lazy(() => import('../pages/group-buy'));
const RecyclePage = lazy(() => import('../pages/recycle'));
const RecycleRulesPage = lazy(() => import('../pages/recycle-rules'));
const RecycleNewPage = lazy(() => import('../pages/recycle-new'));
const RecyclePointsPage = lazy(() => import('../pages/recycle-points'));
const RecycleRequestPage = lazy(() => import('../pages/recycle-request'));
const RecycleEditPage = lazy(() => import('../pages/recycle-edit'));
const RecycleRequestsPage = lazy(() => import('../pages/recycle-requests'));
const RecycleDonePage = lazy(() => import('../pages/recycle-done'));
const RewardsMinePage = lazy(() => import('../pages/rewards-mine'));
const ProfilePage = lazy(() => import('../pages/profile'));
const LoyaltyPage = lazy(() => import('../pages/loyalty'));
const OffersPage = lazy(() => import('../pages/offers'));
const FlashSalePage = lazy(() => import('../pages/flash-sale'));
const WalletPage = lazy(() => import('../pages/wallet'));
const ExternalPointsPage = lazy(() => import('../pages/external-points'));
const AddressesPage = lazy(() => import('../pages/addresses'));
const NotificationsPage = lazy(() => import('../pages/notifications'));
const AffiliatePage = lazy(() => import('../pages/affiliate'));
const AcademyPage = lazy(() => import('../pages/academy'));
// Hoàn tiền sàn ngoài đang tắt: cờ là hằng nên nhánh import bị bỏ lúc build, bản build không có chunk trang hoàn tiền (mã trang giữ để bật lại).
const CashbackPage: ComponentType = CASHBACK_ENABLED ? lazy(() => import('../pages/cashback')) : () => null;
const AboutPage = lazy(() => import('../pages/about'));
const WishlistPage = lazy(() => import('../pages/wishlist'));
const SupportChatPage = lazy(() => import('../pages/support-chat'));
const EditProfilePage = lazy(() => import('../pages/edit-profile'));
const SettingsPage = lazy(() => import('../pages/settings'));
const BrandStoryPage = lazy(() => import('../pages/brand-story'));
const StorefrontViewPage = lazy(() => import('../pages/storefront-view'));
const BrandViewPage = lazy(() => import('../pages/brand-view'));
// Quản trị, đối tác và nhân sự làm đầy đủ trên website (W177): 8 đường dẫn giữ nguyên, cùng một thẻ chuyển sang web.
const WebPortalRedirectPage = lazy(() => import('../pages/web-portal-redirect'));
const StaffPortalPage = lazy(() => import('../pages/staff-portal'));
const NotFoundPage = lazy(() => import('../pages/not-found'));
// Chỉ bản dev: `import.meta.env.DEV` là hằng lúc build nên nhánh import bị bỏ, bản build không có chunk ds-gallery (ds-gallery-guard.spec).
const DsGalleryPage: ComponentType = import.meta.env.DEV ? lazy(() => import('../pages/ds-gallery')) : () => null;

/** Trang chủ rảnh thì tải sẵn mã các màn trên luồng mua hàng, để bấm thẻ SP không phải chờ tải mã. Lỗi mạng bỏ qua: lúc bấm sẽ tải lại. */
function prefetchShoppingRoutes(): void {
  const run = () => {
    for (const load of [loadBrowse, loadProductDetail, loadCart, loadCheckout]) void load().catch(() => {});
  };
  const idle = (window as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
  if (idle) idle.call(window, run, { timeout: 4000 });
  else setTimeout(run, 2000);
}

const queryClient = createQueryClient();
// Xoá sạch cache (ví, lương, hoa hồng...) khi logout — tránh lộ dữ liệu tài chính của
// user vừa đăng xuất cho user kế tiếp trên cùng thiết bị dùng chung (VD tablet chấm công).
setLogoutCleanup(() => queryClient.clear());

/** Phát `screen_viewed` mỗi khi route đổi. Phải render BÊN TRONG `<ZMPRouter>` vì
 * `useScreenTracker()` dùng `useLocation()`, cần Router context — không gọi được ở `MyApp`. */
function ScreenTracker() {
  useScreenTracker();
  return null;
}

/** Gắn nhịp tải lại Giờ vàng (chủ duy nhất) bên trong QueryClientProvider. */
function FlashSalesPoller() {
  useFlashSalesPoller();
  return null;
}

export default function MyApp() {
  const restore = useAuthStore((s) => s.restore);
  const authed = useAuthStore((s) => s.status === 'authenticated');
  const setSfContext = useStorefrontContext((s) => s.setContext);

  useEffect(() => {
    void restore(); // silent login từ refresh token đã lưu
    applySavedFontScale();
    prefetchShoppingRoutes();
    // Mã `?claim=` từ thẻ QR lưu ngay ở entry: chunk của cổng nhận mã tải chậm/lỗi hay khách chuyển màn trước khi nó lên thì mã vẫn còn.
    const claim = readClaimParam(window.location.search, window.location.hash);
    if (claim) void savePendingClaim(claim);
  }, [restore]);
  // iOS chỉ áp :active (.tubu-press) khi có listener touchstart ở tổ tiên: gắn một lần cho cả app.
  useEffect(() => installPressFeedback(), []);
  useLegacyNotifyPrefsSync(authed);
  // Mở app lúc mất mạng: phiên ở trạng thái lỗi thì tự khôi phục khi có mạng/quay lại app, không chờ khách bấm Thử lại.
  useSessionRecovery();

  // Phát đúng 1 lần lúc mở app (deps rỗng — không phụ thuộc state nào nên không chạy lại
  // khi re-render). Cùng effect này gắn luôn global error handler (window.onerror +
  // unhandledrejection) — chỉ đăng ký 1 lần cho suốt vòng đời app, KHÔNG tạo effect thứ 2.
  useEffect(() => {
    trackAppOpened();
    reportLaunchLinkClick();
    // addEventListener('error', ...) chứ KHÔNG gán window.onerror = ... — gán trực tiếp GHI ĐÈ
    // bất kỳ handler nào khác đã/sẽ gán vào window.onerror (kể cả của thư viện bên thứ 3),
    // addEventListener cho phép nhiều listener cùng tồn tại (phát hiện ở review Task 19).
    window.addEventListener('error', (e) => {
      void trackEvent('client_error', 'miniapp', { kind: 'render', messageHash: hashMessage(String(e.message)) });
    });
    window.addEventListener('unhandledrejection', (e) => {
      void trackEvent('client_error', 'miniapp', { kind: 'api', messageHash: hashMessage(String(e.reason)) });
    });
    // Xả nốt hàng đợi sự kiện khi app bị ẩn (chuyển app/khoá màn hình) — trước đây hàm này tồn
    // tại nhưng không có listener nào gọi tới, là dead code (phát hiện ở review cuối).
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushEventQueueOnHide();
    });
  }, []);

  useReferralTouch(authed);

  useEffect(() => {
    const parse = (qs: string) => new URLSearchParams(qs);
    const search = parse(window.location.search);
    const hash = window.location.hash.includes('?')
      ? parse(window.location.hash.slice(window.location.hash.indexOf('?') + 1))
      : new URLSearchParams();
    const slug = search.get('s') ?? hash.get('s');
    const ref = search.get('ref') ?? hash.get('ref');
    // ?s= = link gian hàng CTV → kind 'ctv'. (Trang nhãn /brand tự set kind 'brand' khi mở.) ?l= (mã link CTV, đã lọc khuôn) đi kèm đơn.
    const link = getSessionAttribution()?.linkCode ?? null;
    if (slug || ref) setSfContext({ slug: slug ?? null, referralCode: ref ?? null, clickedAt: Date.now(), linkCode: link, ...(slug ? { kind: 'ctv' as const } : {}) });
  }, [setSfContext]);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <FlashSalesPoller />
        <App>
          <SnackbarProvider>
            <NotifyRegion />
            <ZMPRouter>
              <ScreenTracker />
              {/* Thứ tự Tab theo DOM: nút lùi (fixed, góc trên trái) đứng trước nội dung chính và thanh dưới để bàn phím và trình đọc màn hình gặp nó đầu tiên. */}
              <BackButton />
              {/* Loại điều hướng thật cho trang con — useNavigationType của react-router luôn là POP trong AnimationRoutes. */}
              <LivePathnameProvider>
              <NavigationTypeProvider>
                <MainLandmark>
                <Suspense fallback={<RouteSkeleton />}>
                  <AnimationRoutes>
                    <Route path="/" element={<RouteShell><HomePage /></RouteShell>} />
                    <Route path="/browse" element={<RouteShell skeleton="grid"><BrowsePage /></RouteShell>} />
                    <Route path="/best-sellers" element={<RouteShell skeleton="grid"><BestSellersPage /></RouteShell>} />
                    <Route path="/gift-combos" element={<RouteShell skeleton="grid"><GiftCombosPage /></RouteShell>} />
                    <Route path="/refill-deals" element={<RouteShell><RefillDealsPage /></RouteShell>} />
                    <Route path="/green-box" element={<RouteShell skeleton="grid"><GreenBoxPage /></RouteShell>} />
                    <Route path="/vouchers" element={<LegacyVouchersRedirect />} />
                    <Route path="/campaign/:slug" element={<RouteShell skeleton="grid"><CampaignPage /></RouteShell>} />
                    <Route path="/product/:slug" element={<RouteShell skeleton="detail"><ProductDetailPage /></RouteShell>} />
                    <Route path="/cart" element={<RouteShell><CartPage /></RouteShell>} />
                    <Route path="/checkout" element={<RouteShell><CheckoutPage /></RouteShell>} />
                    <Route path="/bank-payment/:code" element={<RouteShell><BankPaymentPage /></RouteShell>} />
                    <Route path="/orders" element={<RouteShell><OrdersPage /></RouteShell>} />
                    <Route path="/order/:code" element={<RouteShell><OrderDetailPage /></RouteShell>} />
                    <Route path="/game" element={<RouteShell><GamePage /></RouteShell>} />
                    <Route path="/game/play/:game" element={<RouteShell><GamePlayPage /></RouteShell>} />
                    <Route path="/game/matcher" element={<RouteShell><GameMatcherPage /></RouteShell>} />
                    <Route path="/game/album" element={<RouteShell><GameAlbumPage /></RouteShell>} />
                    <Route path="/feed" element={<RouteShell><FeedPage /></RouteShell>} />
                    <Route path="/feed/leaderboard" element={<Navigate to="/feed" replace />} />
                    <Route path="/feed/events" element={<RouteShell><CommunityEventsPage /></RouteShell>} />
                    <Route path="/feed/:id" element={<RouteShell><PostDetailPage /></RouteShell>} />
                    <Route path="/ai-advisor" element={<RouteShell><AiAdvisorPage /></RouteShell>} />
                    <Route path="/group-buy" element={<RouteShell><GroupBuyPage /></RouteShell>} />
                    <Route path="/group-buy/:id" element={<RouteShell><GroupBuyPage /></RouteShell>} />
                    <Route path="/refill" element={<Navigate to="/recycle" replace />} />
                    <Route path="/recycle" element={<RouteShell skeleton="recycle"><RecyclePage /></RouteShell>} />
                    <Route path="/recycle/rules" element={<RouteShell><RecycleRulesPage /></RouteShell>} />
                    <Route path="/recycle/new" element={<RouteShell><RecycleNewPage /></RouteShell>} />
                    <Route path="/recycle/points" element={<RouteShell><RecyclePointsPage /></RouteShell>} />
                    <Route path="/recycle/r/:id" element={<RouteShell><RecycleRequestPage /></RouteShell>} />
                    <Route path="/recycle/r/:id/edit" element={<RouteShell><RecycleEditPage /></RouteShell>} />
                    <Route path="/recycle/requests" element={<RouteShell><RecycleRequestsPage /></RouteShell>} />
                    <Route path="/recycle/done/:id" element={<RouteShell><RecycleDonePage /></RouteShell>} />
                    <Route path="/recycle/desk" element={<RouteShell><WebPortalRedirectPage screen="/recycle/desk" /></RouteShell>} />
                    <Route path="/rewards" element={<LegacyRewardsRedirect />} />
                    <Route path="/rewards/mine" element={<RouteShell><RewardsMinePage /></RouteShell>} />
                    <Route path="/profile" element={<RouteShell><ProfilePage /></RouteShell>} />
                    <Route path="/loyalty" element={<RouteShell><LoyaltyPage /></RouteShell>} />
                    <Route path="/offers" element={<RouteShell><OffersPage /></RouteShell>} />
                    <Route path="/flash-sale" element={<RouteShell><FlashSalePage /></RouteShell>} />
                    <Route path="/wallet" element={<RouteShell><WalletPage /></RouteShell>} />
                    <Route path="/points/scan" element={<RouteShell><ExternalPointsPage /></RouteShell>} />
                    <Route path="/addresses" element={<RouteShell><AddressesPage /></RouteShell>} />
                    <Route path="/notifications" element={<RouteShell><NotificationsPage /></RouteShell>} />
                    <Route path="/affiliate" element={<RouteShell><AffiliatePage /></RouteShell>} />
                    <Route path="/academy" element={<RouteShell><AcademyPage /></RouteShell>} />
                    {/* Khoá học có URL riêng: nút back của Zalo quay về danh sách thay vì thoát
                        hẳn Học viện, và CTV gửi được link thẳng tới một khoá cho đội của mình. */}
                    <Route path="/academy/:courseId" element={<RouteShell><AcademyPage /></RouteShell>} />
                    <Route path="/cashback" element={CASHBACK_ENABLED ? <RouteShell><CashbackPage /></RouteShell> : <Navigate to="/profile" replace />} />
                    <Route path="/dealer" element={<RouteShell><WebPortalRedirectPage screen="/dealer" /></RouteShell>} />
                    <Route path="/about" element={<RouteShell><AboutPage /></RouteShell>} />
                    <Route path="/wishlist" element={<RouteShell><WishlistPage /></RouteShell>} />
                    <Route path="/chat" element={<RouteShell><SupportChatPage /></RouteShell>} />
                    <Route path="/edit-profile" element={<RouteShell><EditProfilePage /></RouteShell>} />
                    <Route path="/settings" element={<RouteShell><SettingsPage /></RouteShell>} />
                    <Route path="/brand-story" element={<RouteShell><BrandStoryPage /></RouteShell>} />
                    {/* Trang đích Mua xoay vòng (W171): khách vãng lai xem ngay quyền lợi + sản phẩm đặt định kỳ; quản lý gói vẫn ở cả đây và /orders?tab=subscriptions. */}
                    <Route path="/subscriptions" element={<RouteShell><SubscriptionsPage /></RouteShell>} />
                    <Route path="/storefront" element={<RouteShell><WebPortalRedirectPage screen="/storefront" /></RouteShell>} />
                    <Route path="/s/:slug" element={<RouteShell><StorefrontViewPage /></RouteShell>} />
                    <Route path="/brand/:slug" element={<RouteShell><BrandViewPage /></RouteShell>} />
                    <Route path="/brand-owner" element={<RouteShell><WebPortalRedirectPage screen="/brand-owner" /></RouteShell>} />
                    <Route path="/admin" element={<RouteShell><WebPortalRedirectPage screen="/admin" /></RouteShell>} />
                    <Route path="/admin/community" element={<RouteShell><WebPortalRedirectPage screen="/admin/community" /></RouteShell>} />
                    <Route path="/staff" element={<RouteShell><StaffPortalPage /></RouteShell>} />
                    <Route path="/my-payroll" element={<RouteShell><WebPortalRedirectPage screen="/my-payroll" /></RouteShell>} />
                    {import.meta.env.DEV && <Route path="/ds-gallery" element={<RouteShell><DsGalleryPage /></RouteShell>} />}
                    <Route path="*" element={<RouteShell><NotFoundPage /></RouteShell>} />
                  </AnimationRoutes>
                </Suspense>
                </MainLandmark>
              </NavigationTypeProvider>
              </LivePathnameProvider>
              <BottomNav />
              <SiteSnowGate />
              {ONBOARDING_SURVEY_ENABLED && (
                <SilentBoundary>
                  <Suspense fallback={null}>
                    <OnboardingGate openedFromPartnerLink={OPENED_FROM_PARTNER_LINK} />
                  </Suspense>
                </SilentBoundary>
              )}
              <SilentBoundary>
                <Suspense fallback={null}>
                  <CouponClaimGate />
                </Suspense>
              </SilentBoundary>
              <OpenAppRouter />
            </ZMPRouter>
          </SnackbarProvider>
        </App>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
