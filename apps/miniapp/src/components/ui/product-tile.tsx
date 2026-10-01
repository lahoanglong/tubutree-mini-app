import { useId, type KeyboardEvent, type ReactNode } from 'react';
import { brandAccent } from '../../utils/brands';
import { vi } from '../../i18n/vi';
import { formatSold } from '../../utils/format';
import { WishlistHeart } from '../wishlist-heart';
import { PriceTag } from './price-tag';
import { Text } from './text';
import { Button } from './button';

export interface ProductTileProduct {
  id: string;
  slug: string;
  name: string;
  brand: string;
  thumbnail?: string | null;
  basePrice: number;
  salePrice?: number | null;
  inStock: boolean;
  reviewCount?: number;
  ratingAvg?: number;
  sold?: number;
}

/** Chiều cao tối thiểu ô tên (2 dòng) — skeleton của CatalogGrid dựng từ cùng hằng số này. */
export const TILE_NAME_MIN_HEIGHT = 44;

export interface ProductTileProps {
  product: ProductTileProduct;
  variant?: 'grid' | 'rail' | 'list' | 'line' | 'compact';
  mode?: 'b2c' | 'ctv' | 'dealer';
  priceOverride?: { price: number } | null;
  showWishlist?: boolean;
  action?: 'add' | 'rebuy' | 'subscribe' | 'none';
  onAction?: () => void;
  badge?: ReactNode;
  onPress: () => void;
}

/**
 * Thẻ sản phẩm dùng chung — thay `ProductCard` + 4 bản chép (flash-sale.tsx x2, storefront-view,
 * brand-view) + ~9 dòng hàng khác đang tự vẽ card riêng (audit A4-06/A4-19). Overlay "tạm hết
 * hàng" và khối giá giờ nằm Ở MỘT CHỖ DUY NHẤT — trước đây chỉ `product-card.tsx` có, storefront/
 * brand grid không, nên hàng hết vẫn hiện mua được ở đó (A4-06).
 *
 * Quy tắc giá flash>sale>base tính Ở CALLER (giữ đúng nơi mỗi trang đã tính hôm nay — tile không
 * tự fetch flash-sale), `priceOverride` chỉ là kết quả cuối cùng caller đưa xuống để hiển thị.
 * Tương tự, `badge` là ReactNode caller tự dựng (badge giờ vàng/sale% hôm nay mỗi nơi hiển thị
 * hơi khác nhau — không gói cứng logic đó vào tile để tránh phải đoán ý từng trang).
 *
 * `mode` chưa rẽ nhánh style gì trong bản này — giữ trong props để Task 24-28 (storefront/brand/
 * dealer) truyền xuống ngay từ đầu mà không phải đổi chữ ký component sau này.
 */
export function ProductTile({
  product: p,
  variant = 'grid',
  priceOverride,
  showWishlist = true,
  action = 'none',
  onAction,
  badge,
  onPress,
}: ProductTileProps) {
  const standing = p.salePrice ?? p.basePrice;
  const price = priceOverride ? priceOverride.price : standing;
  const hasSale = price < p.basePrice;
  const isLine = variant === 'line' || variant === 'list';
  // Tên truy cập = tên sản phẩm; giá (và giá gốc gạch) là mô tả truy cập của thẻ.
  const priceId = useId();
  // Thẻ là div role=button → tự làm bàn phím: Enter/Space. Chỉ khi phím bấm TRÊN thẻ (không phải nút lồng bên trong như tim/Mua lại).
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onPress();
    }
  };

  return (
    <div
      role="button"
      aria-label={p.name}
      aria-describedby={priceId}
      tabIndex={0}
      className="tubu-press"
      onClick={onPress}
      onKeyDown={onKeyDown}
      style={{
        display: isLine ? 'flex' : 'block',
        gap: isLine ? 12 : 0,
        background: 'var(--color-bg-surface)',
        borderRadius: 'var(--radius-card)',
        boxShadow: 'var(--elevation-1)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: isLine ? 64 : undefined,
          aspectRatio: isLine ? undefined : '1 / 1',
          height: isLine ? 64 : undefined,
          background: 'var(--stone-100)',
          flex: isLine ? '0 0 auto' : undefined,
        }}
      >
        {p.thumbnail && (
          <img
            src={p.thumbnail}
            alt={p.name}
            loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        )}
        {badge && <div style={{ position: 'absolute', top: 8, left: 8 }}>{badge}</div>}
        {showWishlist && !isLine && <WishlistHeart productId={p.id} floating size={18} />}
        {p.inStock === false && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'var(--color-bg-scrim-light)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text
              variant="caption"
              as="span"
              style={{
                background: 'var(--color-bg-surface)',
                padding: '4px 12px',
                borderRadius: 'var(--radius-pill)',
                boxShadow: 'var(--elevation-1)',
                fontWeight: 700,
              }}
            >
              {vi.product.outOfStock}
            </Text>
          </div>
        )}
      </div>
      <div style={{ padding: isLine ? 0 : 10, flex: isLine ? 1 : undefined, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span
            aria-hidden
            style={{ width: 7, height: 7, borderRadius: '50%', background: brandAccent(p.brand), flex: '0 0 auto' }}
          />
          <Text variant="caption" tone="secondary" style={{ fontWeight: 600 }}>
            {p.brand}
          </Text>
        </div>
        <Text
          variant="body-sm"
          as="div"
          style={{
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            minHeight: TILE_NAME_MIN_HEIGHT,
            marginTop: 2,
          }}
        >
          {p.name}
        </Text>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3, minHeight: 16 }}>
          {(p.reviewCount ?? 0) > 0 ? (
            <>
              <span style={{ color: 'var(--color-rating)', fontSize: 11 }}>★</span>
              <Text variant="caption" tone="secondary" style={{ fontWeight: 600 }}>
                {p.ratingAvg?.toFixed(1)}
              </Text>
              <Text variant="caption" tone="disabled">
                ({p.reviewCount})
              </Text>
            </>
          ) : (
            <Text variant="caption" tone="disabled">
              ★ Mới
            </Text>
          )}
          {formatSold(p.sold) && (
            <Text variant="caption" tone="tertiary" style={{ fontWeight: 600 }}>
              · {formatSold(p.sold)}
            </Text>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6, marginTop: 4 }}>
          <span id={priceId}>
            <PriceTag value={price} compareAt={hasSale ? p.basePrice : undefined} size="sm" />
          </span>
          {action === 'rebuy' && isLine && <RebuyButton onAction={onAction} />}
        </div>
        {/* Thẻ dạng khối (kệ Mua lại 148px): nút xuống hàng riêng dưới giá, full width. */}
        {action === 'rebuy' && !isLine && <RebuyButton block onAction={onAction} />}
      </div>
    </div>
  );
}

/**
 * Nút "Mua lại" của thẻ — dùng chung cho dạng dòng (cùng hàng với giá) và dạng khối (hàng riêng).
 *
 * Cô lập click: Button.onPress là `() => void` — KHÔNG nhận native event, nên không thể tự
 * stopPropagation từ bên trong onPress. Bọc một div riêng chặn click ở đây trước khi nó nổi bọt
 * lên div ngoài cùng (role=button, onClick=onPress) — nếu không, tap "Mua lại" sẽ đồng thời điều
 * hướng đi (đã verify empirically bằng test).
 *
 * `block`: `.zaui-btn` có min-width 120px nên không vừa thẻ 148px → full width và bỏ min-width.
 */
function RebuyButton({ block = false, onAction }: { block?: boolean; onAction?: () => void }) {
  return (
    <div onClick={(e) => e.stopPropagation()} style={block ? { marginTop: 8 } : undefined}>
      <Button
        size="md"
        variant="secondary"
        fullWidth={block}
        style={block ? { minWidth: 0 } : undefined}
        onPress={() => onAction?.()}
      >
        {vi.reorder.cardCta}
      </Button>
    </div>
  );
}
