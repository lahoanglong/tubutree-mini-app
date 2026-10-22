import { useId } from 'react';
import { useNavigate } from 'zmp-ui';
import { useQuery } from '@tanstack/react-query';
import { useRecentlyViewed } from '../../hooks/use-recently-viewed';
import { fetchActiveFlashSales, fetchProductsBySlugs } from '../../services/shop-api';
import { tilePricing } from './catalog-pricing';
import { vi } from '../../i18n/vi';
import { haptic } from '../../utils/haptic';
import { PriceTag } from '../ui/price-tag';
import { Heading, Text } from '../ui/text';

const CARD_WIDTH = 120;

/**
 * "Đã xem gần đây" (spec 5b.4) — thẻ riêng gọn, KHÔNG dùng ProductTile: dữ liệu lưu ở máy không có
 * đánh giá/id sản phẩm, ProductTile sẽ in "★ Mới" sai và tim yêu thích không có id (plan 4b Ruling 11).
 * Tên + ảnh đọc đồng bộ từ localStorage nên thẻ hiện ngay và không nhảy bố cục khi mount. GIÁ thì KHÔNG lưu (R4-BUYER-5): hỏi giá hiện
 * hành theo slug và tính giờ vàng như thẻ ở lưới (tilePricing), nên hai nơi cùng màn hình không bao giờ lệch giá. Chưa có giá (đang tải,
 * lỗi mạng, API cũ) thì thẻ không hiện giá thay vì hiện giá cũ; sản phẩm đã ẩn/chưa duyệt thì thẻ biến mất.
 */
export function RecentlyViewedRail({ title = vi.browse.recentlyViewed }: { title?: string }) {
  const navigate = useNavigate();
  const stored = useRecentlyViewed();
  const idPrefix = useId();
  const slugs = stored.map((it) => it.slug);
  const productsQ = useQuery({
    queryKey: ['recently-viewed-products', slugs.join(',')],
    queryFn: () => fetchProductsBySlugs(slugs),
    enabled: slugs.length > 0,
    staleTime: 30_000,
  });
  const flashQ = useQuery({
    queryKey: ['flash-sales', 'active'],
    queryFn: fetchActiveFlashSales,
    enabled: slugs.length > 0,
    staleTime: 30_000,
  });
  const live = new Map((productsQ.data ?? []).map((p) => [p.slug, p]));
  const items = productsQ.isSuccess ? stored.filter((it) => live.has(it.slug)) : stored;
  if (items.length === 0) return null;
  return (
    <section aria-label={title} style={{ padding: '8px 0 4px' }}>
      <div style={{ padding: '0 16px 8px' }}>
        <Heading variant="title-sm" as="h2">
          {title}
        </Heading>
      </div>
      {/* Đệm dọc: vùng cuộn ngang cắt cả bóng đổ lẫn viền focus của thẻ nếu sát mép — 4px trên, 12px dưới (bóng đổ xuống dưới). */}
      <div className="scroll-x" style={{ gap: 10, padding: '4px 16px 12px' }}>
        {items.map((it, i) => {
          const priceId = `${idPrefix}-price-${i}`;
          const product = live.get(it.slug);
          const pricing = product ? tilePricing(product, flashQ.data ?? []) : null;
          return (
            <button
              key={it.slug}
              type="button"
              aria-label={it.name}
              aria-describedby={priceId}
              className="tubu-press"
              onClick={() => {
                haptic('light');
                navigate(`/product/${encodeURIComponent(it.slug)}`, { state: { listSource: 'recently_viewed' } });
              }}
              style={{
                flex: `0 0 ${CARD_WIDTH}px`,
                width: CARD_WIDTH,
                padding: 0,
                border: 'none',
                textAlign: 'left',
                fontFamily: 'inherit',
                cursor: 'pointer',
                background: 'var(--color-bg-surface)',
                borderRadius: 'var(--radius-card)',
                boxShadow: 'var(--elevation-1)',
                overflow: 'hidden',
              }}
            >
              <div style={{ width: CARD_WIDTH, height: CARD_WIDTH, background: 'var(--stone-100)' }}>
                {it.thumbnail && (
                  <img
                    src={it.thumbnail}
                    alt=""
                    width={CARD_WIDTH}
                    height={CARD_WIDTH}
                    loading="lazy"
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                )}
              </div>
              <div style={{ padding: 8 }}>
                <Text
                  variant="caption"
                  as="div"
                  style={{
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    minHeight: 'calc(2 * var(--type-caption-lh) * 1em)',
                  }}
                >
                  {it.name}
                </Text>
                <div id={priceId} style={{ minHeight: 22 }}>
                  {product && pricing && (
                    <PriceTag
                      value={pricing.price}
                      compareAt={pricing.compareAt}
                      flash={pricing.isFlash ? { price: pricing.price } : null}
                      size="sm"
                      style={{ flexWrap: 'wrap' }}
                    />
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
