import { lazy, Suspense, useEffect } from 'react';
import { App, ZMPRouter, AnimationRoutes, SnackbarProvider, Box, Spinner } from 'zmp-ui';
import { Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import HomePage from '../pages/home';
import BottomNav from './bottom-nav';
import { useAuthStore } from '../store/auth';

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
              </AnimationRoutes>
            </Suspense>
            <BottomNav />
          </ZMPRouter>
        </SnackbarProvider>
      </App>
    </QueryClientProvider>
  );
}
