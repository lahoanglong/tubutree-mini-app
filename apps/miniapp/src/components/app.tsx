import { lazy, Suspense, useEffect } from 'react';
import { App, ZMPRouter, AnimationRoutes, SnackbarProvider, Box, Spinner } from 'zmp-ui';
import { Navigate, Route } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { getStorage } from 'zmp-sdk/apis';
import HomePage from '../pages/home';
import BottomNav from './bottom-nav';
import BackButton from './back-button';
import { OnboardingGate } from './onboarding';
import { CouponClaimGate } from './coupon-claim-gate';
import { MainLandmark } from './ui/main-landmark';
import ErrorBoundary, { hashMessage } from './error-boundary';
import { useAuthStore, setLogoutCleanup } from '../store/auth';
import { useStorefrontContext } from '../store/storefront-context';
import { recordReferralTouch, reportLaunchLinkClick } from '../services/affiliate-api';
import { createQueryClient } from '../services/query-client';
import { useScreenTracker } from '../hooks/use-screen-tracker';
import { useSessionRecovery } from '../hooks/use-auth-phase';
import { NavigationTypeProvider } from '../hooks/use-navigation-type';
import { LivePathnameProvider } from '../hooks/use-live-pathname';
import { trackEvent, trackAppOpened, flushEventQueueOnHide } from '../services/analytics';
import { useLegacyNotifyPrefsSync } from '../pages/settings-legacy-sync';

import { applyFontScale } from '../utils/font-scale';

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

// Code-split: Home eager (first paint), các trang khác lazy để giữ initial bundle nhỏ (§13.4).
const BrowsePage = lazy(() => import('../pages/browse'));
const ProductDetailPage = lazy(() => import('../pages/product-detail'));
const CartPage = lazy(() => import('../pages/cart'));
const CheckoutPage = lazy(() => import('../pages/checkout'));
const BankPaymentPage = lazy(() => import('../pages/bank-payment'));
const OrdersPage = lazy(() => import('../pages/orders'));
const OrderDetailPage = lazy(() => import('../pages/order-detail'));
const GamePage = lazy(() => import('../pages/game'));
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
const RecycleDeskPage = lazy(() => import('../pages/recycle-desk'));
const RewardsPage = lazy(() => import('../pages/rewards'));
const RewardsMinePage = lazy(() => import('../pages/rewards-mine'));
const ProfilePage = lazy(() => import('../pages/profile'));
const LoyaltyPage = lazy(() => import('../pages/loyalty'));
const OffersPage = lazy(() => import('../pages/offers'));
const WalletPage = lazy(() => import('../pages/wallet'));
const ExternalPointsPage = lazy(() => import('../pages/external-points'));
const AddressesPage = lazy(() => import('../pages/addresses'));
const NotificationsPage = lazy(() => import('../pages/notifications'));
const AffiliatePage = lazy(() => import('../pages/affiliate'));
const AcademyPage = lazy(() => import('../pages/academy'));
const CashbackPage = lazy(() => import('../pages/cashback'));
const DealerPage = lazy(() => import('../pages/dealer'));
const AboutPage = lazy(() => import('../pages/about'));
const WishlistPage = lazy(() => import('../pages/wishlist'));
const SupportChatPage = lazy(() => import('../pages/support-chat'));
const EditProfilePage = lazy(() => import('../pages/edit-profile'));
const SettingsPage = lazy(() => import('../pages/settings'));
const BrandStoryPage = lazy(() => import('../pages/brand-story'));
const StorefrontBuilderPage = lazy(() => import('../pages/storefront-builder'));
const StorefrontViewPage = lazy(() => import('../pages/storefront-view'));
const BrandViewPage = lazy(() => import('../pages/brand-view'));
const BrandOwnerPage = lazy(() => import('../pages/brand-owner'));
const AdminPage = lazy(() => import('../pages/admin'));
const CommunityModerationPage = lazy(() => import('../pages/community-moderation'));
const StaffPage = lazy(() => import('../pages/staff'));
const MyPayrollPage = lazy(() => import('../pages/my-payroll'));
const NotFoundPage = lazy(() => import('../pages/not-found'));

const queryClient = createQueryClient();
// Xoá sạch cache (ví, lương, hoa hồng...) khi logout — tránh lộ dữ liệu tài chính của
// user vừa đăng xuất cho user kế tiếp trên cùng thiết bị dùng chung (VD tablet chấm công).
setLogoutCleanup(() => queryClient.clear());

function RouteFallback() {
  return (
    <Box flex justifyContent="center" alignItems="center" style={{ minHeight: '60vh' }}>
      <Spinner />
    </Box>
  );
}

/** Phát `screen_viewed` mỗi khi route đổi. Phải render BÊN TRONG `<ZMPRouter>` vì
 * `useScreenTracker()` dùng `useLocation()`, cần Router context — không gọi được ở `MyApp`. */
function ScreenTracker() {
  useScreenTracker();
  return null;
}

export default function MyApp() {
  const restore = useAuthStore((s) => s.restore);
  const authed = useAuthStore((s) => s.status === 'authenticated');
  const setSfContext = useStorefrontContext((s) => s.setContext);
  const sfReferralCode = useStorefrontContext((s) => s.referralCode);
  const sfSlug = useStorefrontContext((s) => s.slug);
  const sfKind = useStorefrontContext((s) => s.kind);

  useEffect(() => {
    void restore(); // silent login từ refresh token đã lưu
    applySavedFontScale();
  }, [restore]);
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

  // Attribution 3 ngày: khi đã đăng nhập + có ngữ cảnh giới thiệu (ref/slug từ link),
  // ghi "chạm" server-side (fire-and-forget). Mọi đường vào (/, /s/:slug, /brand/:slug) đều
  // set storefront-context nên 1 effect tập trung ở đây cover tất cả; upsert làm mới hạn.
  useEffect(() => {
    if (!authed) return;
    const referralCode = sfReferralCode ?? sfSlug;
    if (!referralCode) return;
    void recordReferralTouch({
      referralCode,
      storefrontSlug: sfKind === 'ctv' ? (sfSlug ?? undefined) : undefined,
      kind: sfKind,
    }).catch(() => {});
  }, [authed, sfReferralCode, sfSlug, sfKind]);

  useEffect(() => {
    const parse = (qs: string) => new URLSearchParams(qs);
    const search = parse(window.location.search);
    const hash = window.location.hash.includes('?')
      ? parse(window.location.hash.slice(window.location.hash.indexOf('?') + 1))
      : new URLSearchParams();
    const slug = search.get('s') ?? hash.get('s');
    const ref = search.get('ref') ?? hash.get('ref');
    // ?s= = link gian hàng CTV → kind 'ctv'. (Trang nhãn /brand tự set kind 'brand' khi mở.)
    if (slug || ref) setSfContext({ slug: slug ?? null, referralCode: ref ?? null, ...(slug ? { kind: 'ctv' as const } : {}) });
  }, [setSfContext]);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App>
          <SnackbarProvider>
            <ZMPRouter>
              <ScreenTracker />
              {/* Loại điều hướng thật cho trang con — useNavigationType của react-router luôn là POP trong AnimationRoutes. */}
              <LivePathnameProvider>
              <NavigationTypeProvider>
                <MainLandmark>
                <Suspense fallback={<RouteFallback />}>
                  <AnimationRoutes>
                    <Route path="/" element={<HomePage />} />
                    <Route path="/browse" element={<BrowsePage />} />
                    <Route path="/product/:slug" element={<ProductDetailPage />} />
                    <Route path="/cart" element={<CartPage />} />
                    <Route path="/checkout" element={<CheckoutPage />} />
                    <Route path="/bank-payment/:code" element={<BankPaymentPage />} />
                    <Route path="/orders" element={<OrdersPage />} />
                    <Route path="/order/:code" element={<OrderDetailPage />} />
                    <Route path="/game" element={<GamePage />} />
                    <Route path="/feed" element={<FeedPage />} />
                    <Route path="/feed/leaderboard" element={<Navigate to="/feed" replace />} />
                    <Route path="/feed/events" element={<CommunityEventsPage />} />
                    <Route path="/feed/:id" element={<PostDetailPage />} />
                    <Route path="/ai-advisor" element={<AiAdvisorPage />} />
                    <Route path="/group-buy" element={<GroupBuyPage />} />
                    <Route path="/group-buy/:id" element={<GroupBuyPage />} />
                    <Route path="/refill" element={<Navigate to="/recycle" replace />} />
                    <Route path="/recycle" element={<RecyclePage />} />
                    <Route path="/recycle/rules" element={<RecycleRulesPage />} />
                    <Route path="/recycle/new" element={<RecycleNewPage />} />
                    <Route path="/recycle/points" element={<RecyclePointsPage />} />
                    <Route path="/recycle/r/:id" element={<RecycleRequestPage />} />
                    <Route path="/recycle/r/:id/edit" element={<RecycleEditPage />} />
                    <Route path="/recycle/requests" element={<RecycleRequestsPage />} />
                    <Route path="/recycle/done/:id" element={<RecycleDonePage />} />
                    <Route path="/recycle/desk" element={<RecycleDeskPage />} />
                    <Route path="/rewards" element={<RewardsPage />} />
                    <Route path="/rewards/mine" element={<RewardsMinePage />} />
                    <Route path="/profile" element={<ProfilePage />} />
                    <Route path="/loyalty" element={<LoyaltyPage />} />
                    <Route path="/offers" element={<OffersPage />} />
                    <Route path="/wallet" element={<WalletPage />} />
                    <Route path="/points/scan" element={<ExternalPointsPage />} />
                    <Route path="/addresses" element={<AddressesPage />} />
                    <Route path="/notifications" element={<NotificationsPage />} />
                    <Route path="/affiliate" element={<AffiliatePage />} />
                    <Route path="/academy" element={<AcademyPage />} />
                    {/* Khoá học có URL riêng: nút back của Zalo quay về danh sách thay vì thoát
                        hẳn Học viện, và CTV gửi được link thẳng tới một khoá cho đội của mình. */}
                    <Route path="/academy/:courseId" element={<AcademyPage />} />
                    <Route path="/cashback" element={<CashbackPage />} />
                    <Route path="/dealer" element={<DealerPage />} />
                    <Route path="/about" element={<AboutPage />} />
                    <Route path="/wishlist" element={<WishlistPage />} />
                    <Route path="/chat" element={<SupportChatPage />} />
                    <Route path="/edit-profile" element={<EditProfilePage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                    <Route path="/brand-story" element={<BrandStoryPage />} />
                    {/* "Đặt định kỳ" nay là tab "Định kỳ" của trang Đơn hàng (spec 4a.2) — giữ route cũ cho link đã lưu. */}
                    <Route path="/subscriptions" element={<Navigate to="/orders?tab=subscriptions" replace />} />
                    <Route path="/storefront" element={<StorefrontBuilderPage />} />
                    <Route path="/s/:slug" element={<StorefrontViewPage />} />
                    <Route path="/brand/:slug" element={<BrandViewPage />} />
                    <Route path="/brand-owner" element={<BrandOwnerPage />} />
                    <Route path="/admin" element={<AdminPage />} />
                    <Route path="/admin/community" element={<CommunityModerationPage />} />
                    <Route path="/staff" element={<StaffPage />} />
                    <Route path="/my-payroll" element={<MyPayrollPage />} />
                    <Route path="*" element={<NotFoundPage />} />
                  </AnimationRoutes>
                </Suspense>
                </MainLandmark>
              </NavigationTypeProvider>
              </LivePathnameProvider>
              <BottomNav />
              <BackButton />
              <OnboardingGate />
              <CouponClaimGate />
            </ZMPRouter>
          </SnackbarProvider>
        </App>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
