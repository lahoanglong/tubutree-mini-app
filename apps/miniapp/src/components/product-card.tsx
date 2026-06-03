import { useNavigate } from 'zmp-ui';
import { Box, Text } from 'zmp-ui';
import type { ProductCard as ProductCardType } from '../services/shop-api';
import { formatVnd } from '../utils/format';

export default function ProductCard({ product }: { product: ProductCardType }) {
  const navigate = useNavigate();
  const price = product.salePrice ?? product.basePrice;
  const hasSale = product.salePrice != null && product.salePrice < product.basePrice;

  return (
    <Box
      onClick={() => navigate(`/product/${product.slug}`)}
      style={{
        background: 'var(--neutral-0)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-sm)',
        overflow: 'hidden',
        cursor: 'pointer',
      }}
    >
      <Box
        style={{
          aspectRatio: '1 / 1',
          background: product.thumbnail ? `center/cover url(${product.thumbnail})` : 'var(--green-50)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 40,
        }}
      >
        {!product.thumbnail && '🌿'}
      </Box>
      <Box p={2}>
        <Text size="xSmall" style={{ color: 'var(--green-600)', fontWeight: 600 }}>
          {product.brand}
        </Text>
        <Text
          size="small"
          style={{
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            minHeight: 38,
          }}
        >
          {product.name}
        </Text>
        <Box flex alignItems="center" style={{ gap: 6, marginTop: 4 }}>
          <Text bold style={{ color: 'var(--clay-700)' }}>
            {formatVnd(price)}
          </Text>
          {hasSale && (
            <Text size="xSmall" style={{ color: 'var(--neutral-400)', textDecoration: 'line-through' }}>
              {formatVnd(product.basePrice)}
            </Text>
          )}
        </Box>
        {!product.inStock && (
          <Text size="xSmall" style={{ color: 'var(--danger)' }}>
            Hết hàng
          </Text>
        )}
      </Box>
    </Box>
  );
}
