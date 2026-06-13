import { useEffect, useMemo, useState } from 'react';
import { Box, Text, useNavigate } from 'zmp-ui';
import { useQuery } from '@tanstack/react-query';
import { fetchProducts, type ProductCard as ProductCardType } from '../services/shop-api';
import { formatVnd } from '../utils/format';
import { haptic } from '../utils/haptic';

function msToMidnight(): number {
  const now = new Date();
  const mid = new Date(now);
  mid.setHours(24, 0, 0, 0);
  return mid.getTime() - now.getTime();
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Flash Sale hôm nay — sản phẩm đang giảm giá thật + đếm ngược tới nửa đêm. */
export function FlashSale() {
  const navigate = useNavigate();
  const [remaining, setRemaining] = useState(msToMidnight());

  useEffect(() => {
    const t = setInterval(() => setRemaining(msToMidnight()), 1000);
    return () => clearInterval(t);
  }, []);

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

  const h = Math.floor(remaining / 3_600_000);
  const m = Math.floor((remaining % 3_600_000) / 60_000);
  const s = Math.floor((remaining % 60_000) / 1000);

  return (
    <Box mt={4}>
      <Box px={4} flex alignItems="center" justifyContent="space-between" mb={2}>
        <Box flex alignItems="center" style={{ gap: 8 }}>
          <Text.Title size="small" style={{ color: 'var(--clay-700)' }}>
            ⚡ Flash Sale hôm nay
          </Text.Title>
          <Box flex style={{ gap: 3 }}>
            {[pad(h), pad(m), pad(s)].map((v, i) => (
              <span
                key={i}
                style={{
                  background: 'var(--clay-700)',
                  color: '#fff',
                  fontSize: 11,
                  fontWeight: 700,
                  borderRadius: 4,
                  padding: '2px 5px',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {v}
              </span>
            ))}
          </Box>
        </Box>
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
