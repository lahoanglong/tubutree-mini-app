import { Box, Page, Text, Button, useNavigate } from 'zmp-ui';
import { useQuery } from '@tanstack/react-query';
import { getWishlist } from '../services/wishlist-api';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import ProductCard from '../components/product-card';
import { ProductGridSkeleton } from '../components/ui/skeleton';

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
          <Box style={{ textAlign: 'center', padding: '24px 0' }}>
            <Text style={{ color: 'var(--danger)' }}>{getErrorMessage(wishQ.error)}</Text>
          </Box>
        ) : wishQ.data && wishQ.data.length > 0 ? (
          <Box style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {wishQ.data.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </Box>
        ) : (
          <Box style={{ textAlign: 'center', padding: '48px 24px' }}>
            <Box style={{ marginBottom: 14 }}>
              <Text style={{ fontSize: 48, lineHeight: '1.2', display: 'inline-block' }}>🤍</Text>
            </Box>
            <Text style={{ color: 'var(--neutral-600)' }}>
              Chưa có sản phẩm yêu thích
            </Text>
            <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 4 }}>
              Chạm ♡ trên sản phẩm để lưu lại xem sau.
            </Text>
            <Button
              onClick={() => navigate('/browse')}
              style={{ marginTop: 16, background: 'var(--leaf-600)' }}
            >
              Khám phá sản phẩm
            </Button>
          </Box>
        )}
      </Box>
    </Page>
  );
}
