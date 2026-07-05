import { useEffect, useMemo, useState } from 'react';
import { Box, Text, useNavigate } from 'zmp-ui';
import { useQuery } from '@tanstack/react-query';
import { fetchActiveFlashSales } from '../services/shop-api';
import { formatVnd } from '../utils/format';
import { haptic } from '../utils/haptic';
import { vi } from '../i18n/vi';

/**
 * Đếm ngược ÊM đến một mốc thời gian (giờ:phút) — thoả màn design #76 "đếm ngược realtime"
 * NHƯNG giữ tông calm theo Design Brief §3.2 (không nhấp nháy giây/FOMO).
 * Cập nhật mỗi 30s, hiển thị "Xh Ym".
 */
function useTimeTo(target: Date): string {
  const compute = () => {
    const now = new Date();
    const ms = Math.max(0, target.getTime() - now.getTime());
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    return `${h}h ${m.toString().padStart(2, '0')}m`;
  };
  const [label, setLabel] = useState(compute);
  useEffect(() => {
    setLabel(compute());
    const id = setInterval(() => setLabel(compute()), 30_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.getTime()]);
  return label;
}

/**
 * Ưu đãi giờ vàng — flash sale thật từ backend. Countdown êm đến mốc kết thúc sớm nhất.
 */
export function FlashSale() {
  const navigate = useNavigate();

  const q = useQuery({
    queryKey: ['flash-sales', 'active'],
    queryFn: fetchActiveFlashSales,
  });

  const items = q.data ?? [];

  const soonestEndAt = useMemo(() => {
    if (items.length === 0) return new Date();
    return new Date(Math.min(...items.map((it) => new Date(it.endAt).getTime())));
  }, [items]);

  const timeLeft = useTimeTo(soonestEndAt);

  if (q.isLoading || items.length === 0) return null;

  return (
    <Box mt={4}>
      <Box px={4} flex alignItems="center" justifyContent="space-between" mb={2}>
        <Text.Title className="t-h2" size="small" style={{ color: 'var(--clay-700)' }}>
          {vi.flashSale.sectionTitle}
        </Text.Title>
        <Text
          size="xSmall"
          bold
          aria-label={vi.flashSale.endsIn(timeLeft)}
          style={{
            color: 'var(--clay-700)',
            background: 'var(--clay-50)',
            padding: '2px 10px',
            borderRadius: 'var(--radius-full)',
          }}
        >
          {vi.flashSale.endsIn(timeLeft)}
        </Text>
      </Box>

      <Box
        px={4}
        style={{ display: 'flex', gap: 12, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}
      >
        {items.map((item) => {
          const pct = Math.round((1 - item.flashPrice / item.retailPrice) * 100);
          const soldPct = item.quota > 0 ? Math.round((item.soldCount / item.quota) * 100) : 0;
          return (
            <Box
              key={item.itemId}
              className="tubu-press"
              onClick={() => {
                haptic('light');
                navigate(`/product/${item.productSlug}`);
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
                {item.thumbnail && (
                  <img
                    src={item.thumbnail}
                    alt={item.productName}
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
                  {item.productName}
                </Text>
                <Text bold size="small" style={{ color: 'var(--primary-700)', marginTop: 2 }}>
                  {formatVnd(item.flashPrice)}
                </Text>
                <Text size="xSmall" style={{ color: 'var(--neutral-400)', textDecoration: 'line-through' }}>
                  {formatVnd(item.retailPrice)}
                </Text>
                <Box
                  mt={1}
                  style={{
                    height: 4,
                    borderRadius: 'var(--radius-full)',
                    background: 'var(--neutral-100)',
                    overflow: 'hidden',
                  }}
                >
                  <Box
                    style={{
                      height: '100%',
                      width: `${Math.min(100, soldPct)}%`,
                      background: 'var(--clay-500)',
                      borderRadius: 'var(--radius-full)',
                    }}
                  />
                </Box>
                <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 2 }}>
                  {vi.flashSale.soldPct(soldPct)}
                </Text>
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
