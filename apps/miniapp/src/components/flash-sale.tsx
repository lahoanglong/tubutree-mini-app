import { useEffect, useMemo, useState } from 'react';
import { Box, Text, useNavigate } from 'zmp-ui';
import { useQuery } from '@tanstack/react-query';
import { fetchProducts, type ProductCard as ProductCardType } from '../services/shop-api';
import { formatVnd } from '../utils/format';
import { haptic } from '../utils/haptic';

/**
 * Đếm ngược ÊM đến hết ngày (giờ:phút) — thoả màn design #76 "đếm ngược realtime"
 * NHƯNG giữ tông calm theo Design Brief §3.2 (không nhấp nháy giây/FOMO).
 * Cập nhật mỗi 30s, hiển thị "Xh Ym".
 */
function useTimeToEndOfDay(): string {
  const compute = () => {
    const now = new Date();
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    const ms = Math.max(0, end.getTime() - now.getTime());
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    return `${h}h ${m.toString().padStart(2, '0')}m`;
  };
  const [label, setLabel] = useState(compute);
  useEffect(() => {
    const id = setInterval(() => setLabel(compute()), 30_000);
    return () => clearInterval(id);
  }, []);
  return label;
}

/**
 * Ưu đãi hôm nay — sản phẩm đang giảm giá thật. Countdown êm đến hết ngày.
 */
export function FlashSale() {
  const navigate = useNavigate();
  const timeLeft = useTimeToEndOfDay();

  const q = useQuery({
    queryKey: ['products', 'flash-sale'],
    queryFn: () => fetchProducts({ limit: 20 }),
  });

  const onSale = useMemo<ProductCardType[]>(
    () =>
      (q.data?.data ?? [])
        .filter((p) => p.salePrice != null && p.salePrice < p.basePrice && p.inStock)
        .slice(0, 10),
    [q.data],
  );

  if (q.isLoading || onSale.length === 0) return null;

  return (
    <Box mt={4}>
      <Box px={4} flex alignItems="center" justifyContent="space-between" mb={2}>
        <Text.Title className="t-h2" size="small" style={{ color: 'var(--clay-700)' }}>
          🌿 Ưu đãi hôm nay
        </Text.Title>
        <Text
          size="xSmall"
          bold
          aria-label={`Kết thúc sau ${timeLeft}`}
          style={{
            color: 'var(--clay-700)',
            background: 'var(--clay-50)',
            padding: '2px 10px',
            borderRadius: 'var(--radius-full)',
          }}
        >
          ⏳ Còn {timeLeft}
        </Text>
      </Box>

      <Box
        px={4}
        style={{ display: 'flex', gap: 12, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}
      >
        {onSale.map((p) => {
          const price = p.salePrice!;
          const pct = Math.round((1 - price / p.basePrice) * 100);
          return (
            <Box
              key={p.id}
              className="tubu-press"
              onClick={() => {
                haptic('light');
                navigate(`/product/${p.slug}`);
              }}
              style={{
                flex: '0 0 132px',
                background: 'var(--neutral-0)',
                borderRadius: 'var(--radius-lg)',
                overflow: 'hidden',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              <Box style={{ position: 'relative', aspectRatio: '1 / 1', background: 'var(--neutral-100)' }}>
                {p.thumbnail && (
                  <img
                    src={p.thumbnail}
                    alt={p.name}
                    loading="lazy"
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                )}
                <Text
                  size="xSmall"
                  bold
                  style={{
                    position: 'absolute',
                    top: 6,
                    left: 6,
                    background: 'var(--clay-500)',
                    color: '#fff',
                    padding: '1px 6px',
                    borderRadius: 'var(--radius-full)',
                  }}
                >
                  -{pct}%
                </Text>
              </Box>
              <Box p={2}>
                <Text
                  size="xSmall"
                  style={{
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    minHeight: 32,
                  }}
                >
                  {p.name}
                </Text>
                <Text bold size="small" style={{ color: 'var(--clay-700)', marginTop: 2 }}>
                  {formatVnd(price)}
                </Text>
                <Text size="xSmall" style={{ color: 'var(--neutral-400)', textDecoration: 'line-through' }}>
                  {formatVnd(p.basePrice)}
                </Text>
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
