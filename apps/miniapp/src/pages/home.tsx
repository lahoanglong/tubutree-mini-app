import { Box, Page, Text, Spinner } from 'zmp-ui';
import { useQuery } from '@tanstack/react-query';
import { fetchProducts } from '../services/shop-api';
import { useAuthStore } from '../store/auth';
import ProductCard from '../components/product-card';

export default function HomePage() {
  const { user, status, login } = useAuthStore();
  const { data, isLoading } = useQuery({
    queryKey: ['products', 'home'],
    queryFn: () => fetchProducts({ limit: 20 }),
  });

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)' }}>
      {/* Hero */}
      <Box
        p={4}
        style={{
          background: 'linear-gradient(135deg, var(--green-600), var(--green-700))',
          color: 'white',
        }}
      >
        <Text.Title style={{ color: 'white' }}>🌿 Tubu Tree</Text.Title>
        <Text size="small" style={{ color: 'var(--green-100)' }}>
          Sống xanh An Lành
        </Text>
        {status !== 'authenticated' && (
          <Text
            size="xSmall"
            onClick={() => void login()}
            style={{ color: 'white', marginTop: 8, textDecoration: 'underline' }}
          >
            Đăng nhập với Zalo →
          </Text>
        )}
        {user && (
          <Text size="xSmall" style={{ color: 'white', marginTop: 8 }}>
            Chào {user.fullName ?? 'bạn'} · {user.pointsBalance} điểm Xanh
          </Text>
        )}
      </Box>

      <Box p={4}>
        <Text.Title size="small">Sản phẩm nổi bật</Text.Title>
      </Box>

      {isLoading ? (
        <Box flex justifyContent="center" p={6}>
          <Spinner />
        </Box>
      ) : (
        <Box
          px={4}
          pb={6}
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}
        >
          {data?.data.map((p) => <ProductCard key={p.id} product={p} />)}
        </Box>
      )}
    </Page>
  );
}
