import { useId } from 'react';
import { useNavigate } from 'zmp-ui';
import { useRecentlyViewed } from '../../hooks/use-recently-viewed';
import { vi } from '../../i18n/vi';
import { haptic } from '../../utils/haptic';
import { PriceTag } from '../ui/price-tag';
import { Heading, Text } from '../ui/text';

const CARD_WIDTH = 120;

/**
 * "Đã xem gần đây" (spec 5b.4) — thẻ riêng gọn, KHÔNG dùng ProductTile: dữ liệu lưu ở máy không có
 * đánh giá/id sản phẩm, ProductTile sẽ in "★ Mới" sai và tim yêu thích không có id (plan 4b Ruling 11).
 * Hook đọc đồng bộ từ localStorage nên không có khung chờ và không nhảy bố cục khi mount.
 */
export function RecentlyViewedRail({ title = vi.browse.recentlyViewed }: { title?: string }) {
  const navigate = useNavigate();
  const items = useRecentlyViewed();
  const idPrefix = useId();
  if (items.length === 0) return null;
  return (
    <section aria-label={title} style={{ padding: '8px 0 12px' }}>
      <div style={{ padding: '0 16px 8px' }}>
        <Heading variant="title-sm" as="h2">
          {title}
        </Heading>
      </div>
      {/* Đệm dọc 4px: vùng cuộn ngang cắt cả bóng đổ lẫn viền focus của thẻ nếu sát mép. */}
      <div className="scroll-x" style={{ gap: 10, padding: '4px 16px' }}>
        {items.map((it, i) => {
          const priceId = `${idPrefix}-price-${i}`;
          return (
            <button
              key={it.slug}
              type="button"
              aria-label={it.name}
              aria-describedby={priceId}
              className="tubu-press"
              onClick={() => {
                haptic('light');
                navigate(`/product/${it.slug}`, { state: { listSource: 'recently_viewed' } });
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
                <div id={priceId}>
                  <PriceTag value={it.price} size="sm" />
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
