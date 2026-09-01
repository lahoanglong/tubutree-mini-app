import { Box, Page, useNavigate } from 'zmp-ui';
import { useQuery } from '@tanstack/react-query';
import { getWishlist } from '../services/wishlist-api';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import ProductCard from '../components/product-card';
import { ProductGridSkeleton } from '../components/ui/skeleton';
import { EmptyState, ErrorState } from '../components/ui/empty-state';

export default function WishlistPage() {
  const navigate = useNavigate();
  const status = useAuthStore((s) => s.status);
  // Gate auth: tránh gọi /me/wishlist khi chưa login → 401 → màn lỗi (đáng lẽ là empty).
  const wishQ = useQuery({ queryKey: ['wishlist'], queryFn: getWishlist, enabled: status === 'authenticated' });

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)' }}>

      <Box p={4}>
        {status === 'loading' || wishQ.isLoading ? (
          <ProductGridSkeleton count={4} />
        ) : wishQ.isError ? (
          <ErrorState message={getErrorMessage(wishQ.error)} onRetry={() => void wishQ.refetch()} />
        ) : wishQ.data && wishQ.data.length > 0 ? (
          <Box style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {wishQ.data.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </Box>
        ) : (
          <EmptyState
            art="sprout"
            heading="Chưa có sản phẩm yêu thích"
            body="Chạm ♡ trên sản phẩm để lưu lại xem sau."
            ctaLabel="Khám phá sản phẩm"
            onCta={() => navigate('/browse')}
          />
        )}
      </Box>
    </Page>
  );
}
