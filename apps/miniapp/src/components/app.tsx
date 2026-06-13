import { lazy, Suspense, useEffect } from 'react';
import { App, ZMPRouter, AnimationRoutes, SnackbarProvider, Box, Spinner } from 'zmp-ui';
import { Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getStorage } from 'zmp-sdk/apis';
import HomePage from '../pages/home';
import BottomNav from './bottom-nav';
import { OnboardingGate } from './onboarding';
import { useAuthStore } from '../store/auth';

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
const OrdersPage = lazy(() => import('../pages/orders'));
const OrderDetailPage = lazy(() => import('../pages/order-detail'));
const GamePage = lazy(() => import('../pages/game'));
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

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
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

  useEffect(() => {
    void restore(); // silent login từ refresh token đã lưu
    applySavedFontScale();
  }, [restore]);

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
                <Route path="/orders" element={<OrdersPage />} />
                <Route path="/order/:code" element={<OrderDetailPage />} />
                <Route path="/game" element={<GamePage />} />
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
              </AnimationRoutes>
            </Suspense>
            <BottomNav />
            <OnboardingGate />
          </ZMPRouter>
        </SnackbarProvider>
      </App>
    </QueryClientProvider>
  );
}
