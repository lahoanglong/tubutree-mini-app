import { useEffect } from 'react';
import { App, ZMPRouter, AnimationRoutes, SnackbarProvider } from 'zmp-ui';
import { Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import HomePage from '../pages/home';
import BrowsePage from '../pages/browse';
import ProductDetailPage from '../pages/product-detail';
import CartPage from '../pages/cart';
import CheckoutPage from '../pages/checkout';
import OrdersPage from '../pages/orders';
import OrderDetailPage from '../pages/order-detail';
import GamePage from '../pages/game';
import ProfilePage from '../pages/profile';
import BottomNav from './bottom-nav';
import { useAuthStore } from '../store/auth';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

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
            </AnimationRoutes>
            <BottomNav />
          </ZMPRouter>
        </SnackbarProvider>
      </App>
    </QueryClientProvider>
  );
}
