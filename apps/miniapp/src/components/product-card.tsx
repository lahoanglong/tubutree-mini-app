import { useNavigate } from 'zmp-ui';
import { Box, Text } from 'zmp-ui';
import { useQuery } from '@tanstack/react-query';
import { fetchActiveFlashSales, type ProductCard as ProductCardType } from '../services/shop-api';
import { formatVnd, formatSold } from '../utils/format';
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
  // Giá giờ vàng phải hiện ở ĐÂY nữa, không chỉ ở dải "Ưu đãi giờ vàng": trước đây trang chủ
  // hiện SP X giá flash 99.000đ ở dải trên, rồi chính SP X giá 165.000đ ở lưới bên dưới —
  // cùng một màn hình, hai giá, khách không biết giá nào thật (P1-4 audit mạch lạc).
  // Dùng chung queryKey với dải flash nên không phát sinh request mới.
  const flashQ = useQuery({
    queryKey: ['flash-sales', 'active'],
    queryFn: fetchActiveFlashSales,
    staleTime: 30_000,
  });
  const flash = (flashQ.data ?? []).find((f) => f.productSlug === product.slug);

  const standing = product.salePrice ?? product.basePrice;
  // Giá flash chỉ thắng khi thực sự rẻ hơn giá đang bán (đúng quy tắc BE dùng ở giỏ hàng).
  const price = flash && flash.flashPrice < standing ? flash.flashPrice : standing;
  const isFlash = price !== standing;
  const hasSale = price < product.basePrice;
  const salePct = hasSale ? Math.round((1 - price / product.basePrice) * 100) : 0;

  return (
    <Box
      role="button"
      aria-label={product.name}
      className="tubu-press"
      onClick={() => {
        haptic('light');
        // Mở đúng phân loại đang giảm giờ vàng (SP nhiều phân loại: flash chỉ gắn vào một).
        navigate(`/product/${product.slug}`, flash ? { state: { variationId: flash.variationId } } : undefined);
      }}
      style={{
        background: 'var(--neutral-0)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-card)',
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
              background: isFlash ? 'var(--primary-600)' : 'var(--clay-500)',
              color: 'var(--neutral-0)',
              padding: '2px 8px',
              borderRadius: 'var(--radius-full)',
            }}
          >
            {isFlash ? `${vi.flashSale.badge} -${salePct}%` : `-${salePct}%`}
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
        {/* Dòng social-proof LUÔN render (chiều cao cố định) → thẻ đều nhau, không nhảy layout.
            Chưa có đánh giá → "★ Mới" (thay vì ẩn cả dòng làm thẻ cao thấp khác nhau). */}
        <Box flex alignItems="center" style={{ gap: 4, marginTop: 3, minHeight: 16 }}>
          {(product.reviewCount ?? 0) > 0 ? (
            <>
              <span style={{ color: 'var(--sun-500)', fontSize: 11 }}>★</span>
              <Text size="xSmall" style={{ color: 'var(--neutral-600)', fontWeight: 600 }}>
                {product.ratingAvg?.toFixed(1)}
              </Text>
              <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
                ({product.reviewCount})
              </Text>
            </>
          ) : (
            <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>★ Mới</Text>
          )}
          {formatSold(product.sold) && (
            <Text size="xSmall" style={{ color: 'var(--neutral-500)', fontWeight: 600 }}>
              · {formatSold(product.sold)}
            </Text>
          )}
        </Box>
        <Box flex alignItems="baseline" style={{ gap: 6, marginTop: 4 }}>
          <Text bold style={{ color: 'var(--primary-700)', fontSize: 15, fontFamily: 'var(--font-display)' }}>
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
