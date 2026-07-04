import { lazy, Suspense, useEffect } from 'react';
import { App, ZMPRouter, AnimationRoutes, SnackbarProvider, Box, Spinner } from 'zmp-ui';
import { Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { getStorage } from 'zmp-sdk/apis';
import HomePage from '../pages/home';
import BottomNav from './bottom-nav';
import BackButton from './back-button';
import { OnboardingGate } from './onboarding';
import { useAuthStore } from '../store/auth';
import { useStorefrontContext } from '../store/storefront-context';
import { recordReferralTouch } from '../services/affiliate-api';

const FONT_PX: Record<string, string> = { small: '15px', normal: '16px', large: '18px' };
/** Áp cỡ chữ đã lưu (Cài đặt) ngay khi mở app để giữ a11y qua các phiên. */
function applySavedFontScale(): void {
  void getStorage({ keys: ['tubu_prefs'] }).then((res) => {
    const raw = (res as Record<string, unknown>)['tubu_prefs'];
    if (typeof raw === 'string') {
      try {
        const scale = (JSON.parse(raw) as { fontScale?: string }).fontScale;
        if (scale && FONT_PX[scale]) document.documentElement.style.fontSize = FONT_PX[scale];
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
const PostDetailPage = lazy(() => import('../pages/post-detail'));
const AiAdvisorPage = lazy(() => import('../pages/ai-advisor'));
const GroupBuyPage = lazy(() => import('../pages/group-buy'));
const RefillPage = lazy(() => import('../pages/refill'));
const BetaPage = lazy(() => import('../pages/beta'));
const ProfilePage = lazy(() => import('../pages/profile'));
const LoyaltyPage = lazy(() => import('../pages/loyalty'));
const WalletPage = lazy(() => import('../pages/wallet'));
const AddressesPage = lazy(() => import('../pages/addresses'));
const NotificationsPage = lazy(() => import('../pages/notifications'));
const AffiliatePage = lazy(() => import('../pages/affiliate'));
const CashbackPage = lazy(() => import('../pages/cashback'));
const DealerPage = lazy(() => import('../pages/dealer'));
const AboutPage = lazy(() => import('../pages/about'));
const WishlistPage = lazy(() => import('../pages/wishlist'));
const EditProfilePage = lazy(() => import('../pages/edit-profile'));
const SettingsPage = lazy(() => import('../pages/settings'));
const BrandStoryPage = lazy(() => import('../pages/brand-story'));
const SubscriptionsPage = lazy(() => import('../pages/subscriptions'));
const StorefrontBuilderPage = lazy(() => import('../pages/storefront-builder'));
const StorefrontViewPage = lazy(() => import('../pages/storefront-view'));
const BrandViewPage = lazy(() => import('../pages/brand-view'));
const BrandOwnerPage = lazy(() => import('../pages/brand-owner'));
const AdminPage = lazy(() => import('../pages/admin'));
const StaffPage = lazy(() => import('../pages/staff'));
const MyPayrollPage = lazy(() => import('../pages/my-payroll'));
const NotFoundPage = lazy(() => import('../pages/not-found'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Không retry lỗi 4xx (nghiệp vụ/401) — 401 đã được interceptor tự refresh+retry;
      // retry thêm chỉ làm tăng churn. Chỉ retry 1 lần cho lỗi mạng/5xx.
      retry: (failureCount, error) => {
        const status = isAxiosError(error) ? error.response?.status : undefined;
        if (status && status >= 400 && status < 500) return false;
        return failureCount < 1;
      },
      refetchOnWindowFocus: false,
      // Default staleTime ngắn (10s) — money/auth/orders/wallet/notifications cần tươi
      // ngay sau action (vd thanh toán WALLET trừ tiền; nếu staleTime 60s mà thiếu
      // invalidate ở 1 nơi nào đó → user thấy số dư cũ).
      // Catalog/brands/categories chậm-đổi (~15p sync Pancake) nên override staleTime: 60_000
      // tại từng useQuery để giữ lợi ích cache (xem browse.tsx/home.tsx).
      staleTime: 10_000,
    },
  },
});

function RouteFallback() {
  return (
    <Box flex justifyContent="center" alignItems="center" style={{ minHeight: '60vh' }}>
      <Spinner />
    </Box>
  );
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
    <QueryClientProvider client={queryClient}>
      <App>
        <SnackbarProvider>
          <ZMPRouter>
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
                <Route path="/feed/:id" element={<PostDetailPage />} />
                <Route path="/ai-advisor" element={<AiAdvisorPage />} />
                <Route path="/group-buy" element={<GroupBuyPage />} />
                <Route path="/refill" element={<RefillPage />} />
                <Route path="/beta" element={<BetaPage />} />
                <Route path="/profile" element={<ProfilePage />} />
                <Route path="/loyalty" element={<LoyaltyPage />} />
                <Route path="/wallet" element={<WalletPage />} />
                <Route path="/addresses" element={<AddressesPage />} />
                <Route path="/notifications" element={<NotificationsPage />} />
                <Route path="/affiliate" element={<AffiliatePage />} />
                <Route path="/cashback" element={<CashbackPage />} />
                <Route path="/dealer" element={<DealerPage />} />
                <Route path="/about" element={<AboutPage />} />
                <Route path="/wishlist" element={<WishlistPage />} />
                <Route path="/edit-profile" element={<EditProfilePage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/brand-story" element={<BrandStoryPage />} />
                <Route path="/subscriptions" element={<SubscriptionsPage />} />
                <Route path="/storefront" element={<StorefrontBuilderPage />} />
                <Route path="/s/:slug" element={<StorefrontViewPage />} />
                <Route path="/brand/:slug" element={<BrandViewPage />} />
                <Route path="/brand-owner" element={<BrandOwnerPage />} />
                <Route path="/admin" element={<AdminPage />} />
                <Route path="/staff" element={<StaffPage />} />
                <Route path="/my-payroll" element={<MyPayrollPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </AnimationRoutes>
            </Suspense>
            <BottomNav />
            <BackButton />
            <OnboardingGate />
          </ZMPRouter>
        </SnackbarProvider>
      </App>
    </QueryClientProvider>
  );
}
