import { useState } from 'react';
import { Box, Page, Text, Button, Header, Spinner, useNavigate, useParams, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchProduct, addToCart, type VariationDetail } from '../services/shop-api';
import { useAuthStore } from '../store/auth';
import { formatVnd } from '../utils/format';

export default function ProductDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const queryClient = useQueryClient();
  const { status, login } = useAuthStore();
  const [selected, setSelected] = useState<VariationDetail | null>(null);

  const { data: product, isLoading } = useQuery({
    queryKey: ['product', slug],
    queryFn: () => fetchProduct(slug!),
    enabled: !!slug,
  });

  const addMutation = useMutation({
    mutationFn: (v: VariationDetail) => addToCart(v.id, 1),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['cart'] });
      openSnackbar({ text: 'Đã thêm vào giỏ 🛒', type: 'success' });
    },
    onError: (e: unknown) =>
      openSnackbar({ text: e instanceof Error ? e.message : 'Lỗi thêm giỏ', type: 'error' }),
  });

  if (isLoading || !product) {
    return (
      <Page>
        <Header title="Sản phẩm" />
        <Box flex justifyContent="center" p={6}>
          <Spinner />
        </Box>
      </Page>
    );
  }

  const variation = selected ?? product.variations[0];
  const price = variation?.salePrice ?? variation?.retailPrice ?? product.basePrice;

  const handleAdd = () => {
    if (status !== 'authenticated') return void login();
    if (variation) addMutation.mutate(variation);
  };

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)', paddingBottom: 80 }}>
      <Header title={product.brand} />
      <Box
        style={{
          aspectRatio: '1 / 1',
          background: product.thumbnail ? `center/cover url(${product.thumbnail})` : 'var(--green-50)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 72,
        }}
      >
        {!product.thumbnail && '🌿'}
      </Box>

      <Box p={4} style={{ background: 'var(--neutral-0)' }}>
        <Text.Title size="small">{product.name}</Text.Title>
        <Text bold style={{ color: 'var(--clay-700)', fontSize: 22, marginTop: 6 }}>
          {formatVnd(price)}
        </Text>
        {product.shortDesc && (
          <Text size="small" style={{ color: 'var(--neutral-600)', marginTop: 8 }}>
            {product.shortDesc}
          </Text>
        )}
        {product.certifications.length > 0 && (
          <Box flex style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            {product.certifications.map((c) => (
              <Text
                key={c}
                size="xSmall"
                style={{
                  background: 'var(--green-50)',
                  color: 'var(--green-700)',
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                ✓ {c}
              </Text>
            ))}
          </Box>
        )}
      </Box>

      {product.variations.length > 1 && (
        <Box p={4} mt={2} style={{ background: 'var(--neutral-0)' }}>
          <Text bold size="small">
            Phân loại
          </Text>
          <Box flex style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {product.variations.map((v) => (
              <Box
                key={v.id}
                onClick={() => setSelected(v)}
                style={{
                  padding: '8px 14px',
                  borderRadius: 'var(--radius-md)',
                  border: `1px solid ${variation?.id === v.id ? 'var(--green-600)' : 'var(--neutral-200)'}`,
                  color: variation?.id === v.id ? 'var(--green-700)' : 'var(--neutral-600)',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                {v.name}
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {product.description && (
        <Box p={4} mt={2} style={{ background: 'var(--neutral-0)' }}>
          <Text bold size="small">
            Mô tả
          </Text>
          <Text size="small" style={{ color: 'var(--neutral-600)', marginTop: 6 }}>
            {product.description}
          </Text>
        </Box>
      )}

      {/* Sticky CTA */}
      <Box
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          padding: 12,
          background: 'var(--neutral-0)',
          boxShadow: 'var(--shadow-lg)',
          display: 'flex',
          gap: 8,
        }}
      >
        <Button variant="secondary" onClick={() => navigate('/cart')} style={{ flex: '0 0 auto' }}>
          🛒
        </Button>
        <Button
          fullWidth
          loading={addMutation.isPending}
          disabled={!variation || variation.stock <= 0}
          onClick={handleAdd}
          style={{ background: 'var(--green-600)' }}
        >
          {variation && variation.stock > 0 ? 'Thêm vào giỏ' : 'Hết hàng'}
        </Button>
      </Box>
    </Page>
  );
}
