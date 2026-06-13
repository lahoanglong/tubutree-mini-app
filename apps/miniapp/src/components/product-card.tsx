import { useNavigate } from 'zmp-ui';
import { Box, Text } from 'zmp-ui';
import type { ProductCard as ProductCardType } from '../services/shop-api';
import { formatVnd } from '../utils/format';
import { brandAccent } from '../utils/brands';
import { vi } from '../i18n/vi';
import { haptic } from '../utils/haptic';
import { WishlistHeart } from './wishlist-heart';

/** Fallback khi sản phẩm chưa có ảnh — lá brand thay vì ô trống. */
function LeafPlaceholder() {
  return (
    <svg width="44" height="44" viewBox="0 0 48 48" fill="none" aria-hidden>
      <path
        d="M14 36c-1.5-14 8-26 24-27 1 16-7 27-20 28-2 .2-3.4-.4-4-1z"
        fill="var(--leaf-200)"
      />
      <path d="M17 34c4-10 12-18 19-22" stroke="var(--leaf-600)" strokeWidth="1.6" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export default function ProductCard({ product }: { product: ProductCardType }) {
  const navigate = useNavigate();
  const price = product.salePrice ?? product.basePrice;
  const hasSale = product.salePrice != null && product.salePrice < product.basePrice;
  const salePct = hasSale ? Math.round((1 - price / product.basePrice) * 100) : 0;

  return (
    <Box
      role="button"
      aria-label={product.name}
      className="tubu-press"
      onClick={() => {
        haptic('light');
        navigate(`/product/${product.slug}`);
      }}
      style={{
        background: 'var(--neutral-0)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-sm)',
        overflow: 'hidden',
      }}
    >
      <Box style={{ position: 'relative', aspectRatio: '1 / 1', background: 'var(--neutral-100)' }}>
        {product.thumbnail ? (
          <img
            src={product.thumbnail}
            alt={product.name}
            loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <Box
            style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <LeafPlaceholder />
          </Box>
        )}

        {/* Badge sale tone đất sét mềm — không đỏ gắt (nguyên tắc "tử tế hơn khẩn cấp") */}
        {hasSale && product.inStock && (
          <Text
            size="xSmall"
            bold
            style={{
              position: 'absolute',
              top: 8,
              left: 8,
              background: 'var(--clay-500)',
              color: 'white',
              padding: '2px 8px',
              borderRadius: 'var(--radius-full)',
            }}
          >
            -{salePct}%
          </Text>
        )}

        <WishlistHeart productId={product.id} floating size={18} />

        {!product.inStock && (
          <Box
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(250, 250, 248, 0.72)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text
              size="xSmall"
              bold
              style={{
                background: 'var(--neutral-0)',
                color: 'var(--neutral-600)',
                padding: '4px 12px',
                borderRadius: 'var(--radius-full)',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              {vi.product.outOfStock}
            </Text>
          </Box>
        )}
      </Box>

      <Box p={2}>
        <Box flex alignItems="center" style={{ gap: 5 }}>
          <span
            aria-hidden
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: brandAccent(product.brand),
              flex: '0 0 auto',
            }}
          />
          <Text size="xSmall" style={{ color: 'var(--neutral-600)', fontWeight: 600 }}>
            {product.brand}
          </Text>
        </Box>
        <Text
          size="small"
          style={{
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            minHeight: 40,
            marginTop: 2,
          }}
        >
          {product.name}
        </Text>
        {(product.reviewCount ?? 0) > 0 && (
          <Box flex alignItems="center" style={{ gap: 3, marginTop: 2 }}>
            <span style={{ color: 'var(--sun-500)', fontSize: 11 }}>★</span>
            <Text size="xSmall" style={{ color: 'var(--neutral-600)' }}>
              {product.ratingAvg?.toFixed(1)}
            </Text>
            <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
              ({product.reviewCount})
            </Text>
          </Box>
        )}
        <Box flex alignItems="baseline" style={{ gap: 6, marginTop: 4 }}>
          <Text bold style={{ color: 'var(--primary-700)', fontSize: 15 }}>
            {formatVnd(price)}
          </Text>
          {hasSale && (
            <Text size="xSmall" style={{ color: 'var(--neutral-400)', textDecoration: 'line-through' }}>
              {formatVnd(product.basePrice)}
            </Text>
          )}
        </Box>
      </Box>
    </Box>
  );
}
