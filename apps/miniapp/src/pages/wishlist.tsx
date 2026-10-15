import { Page, useNavigate } from 'zmp-ui';
import { useQuery } from '@tanstack/react-query';
import { getWishlist } from '../services/wishlist-api';
import { getErrorMessage } from '../services/api';
import { AuthGate } from '../components/ui/auth-gate';
import { useAuthPhase } from '../hooks/use-auth-phase';
import ProductCard from '../components/product-card';
import { PageHeader } from '../components/ui/page-header';
import { ProductGridSkeleton } from '../components/ui/skeleton';
import { EmptyState, ErrorState } from '../components/ui/empty-state';

export default function WishlistPage() {
  const navigate = useNavigate();
  const phase = useAuthPhase();
  // Gate auth: tránh gọi /me/wishlist khi chưa login → 401 → màn lỗi (đáng lẽ là empty).
  const wishQ = useQuery({ queryKey: ['wishlist'], queryFn: getWishlist, enabled: phase === 'authenticated' });

  return (
    <Page style={{ background: 'var(--color-bg-canvas)' }}>
      <PageHeader title="Sản phẩm yêu thích" />

      <AuthGate
        loading={
          <div style={{ padding: 16 }}>
            <ProductGridSkeleton count={4} />
          </div>
        }
      >
        <div style={{ padding: 16 }}>
          {wishQ.isLoading ? (
            <ProductGridSkeleton count={4} />
          ) : wishQ.isError && !wishQ.data ? (
            <ErrorState message={getErrorMessage(wishQ.error)} onRetry={() => void wishQ.refetch()} />
          ) : wishQ.data && wishQ.data.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {wishQ.data.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          ) : (
            <EmptyState
              art="sprout"
              heading="Chưa có sản phẩm yêu thích"
              body="Chạm biểu tượng trái tim trên sản phẩm để lưu lại xem sau."
              ctaLabel="Khám phá sản phẩm"
              onCta={() => navigate('/browse')}
            />
          )}
        </div>
      </AuthGate>
    </Page>
  );
}
