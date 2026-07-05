import { useMemo } from 'react';
import { Box, Text, useNavigate } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchActiveFlashSales,
  fetchUpcomingFlashSales,
  setFlashReminder,
  cancelFlashReminder,
  type UpcomingFlashItem,
} from '../services/shop-api';
import { formatVnd } from '../utils/format';
import { haptic } from '../utils/haptic';
import { vi } from '../i18n/vi';
import { useCountdown } from '../hooks/use-countdown';
import { useAuthStore } from '../store/auth';

/**
 * Ưu đãi giờ vàng — flash sale thật từ backend. Countdown êm đến mốc kết thúc sớm nhất.
 */
export function FlashSale() {
  const navigate = useNavigate();

  const q = useQuery({
    queryKey: ['flash-sales', 'active'],
    queryFn: fetchActiveFlashSales,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const items = q.data ?? [];

  const soonestEndAt = useMemo(() => {
    if (items.length === 0) return null;
    return new Date(Math.min(...items.map((it) => new Date(it.endAt).getTime())));
  }, [items]);

  const timeLeft = useCountdown(soonestEndAt);

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
          const pct = item.retailPrice > 0 ? Math.round((1 - item.flashPrice / item.retailPrice) * 100) : 0;
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

/** 1 thẻ trong danh sách "Sắp diễn ra" — countdown riêng theo startAt của item. */
function UpcomingFlashCard({
  item,
  pending,
  onOpen,
  onToggleRemind,
}: {
  item: UpcomingFlashItem;
  pending: boolean;
  onOpen: () => void;
  onToggleRemind: () => void;
}) {
  const startsIn = useCountdown(item.startAt);
  const pct = item.retailPrice > 0 ? Math.round((1 - item.flashPrice / item.retailPrice) * 100) : 0;

  return (
    <Box
      className="tubu-press"
      onClick={onOpen}
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
        <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 2 }}>
          {vi.flashSale.startsIn(startsIn)}
        </Text>
        <Box
          mt={2}
          role="button"
          className="tubu-press"
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            onToggleRemind();
          }}
          style={{
            textAlign: 'center',
            padding: '6px 0',
            borderRadius: 'var(--radius-full)',
            fontSize: 12,
            fontWeight: 600,
            opacity: pending ? 0.6 : 1,
            background: item.reminded ? 'var(--leaf-50)' : 'var(--primary-600)',
            color: item.reminded ? 'var(--leaf-700)' : '#fff',
          }}
        >
          {item.reminded ? vi.flashSale.reminded : vi.flashSale.remindMe}
        </Box>
      </Box>
    </Box>
  );
}

/**
 * "Sắp diễn ra" — flash sale đã lên lịch nhưng chưa mở bán, cho user đặt nhắc.
 * Cần đăng nhập (BE lấy userId từ JWT để trả trạng thái reminded) → gate theo auth.
 */
export function UpcomingFlashSales() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const authed = useAuthStore((s) => s.status === 'authenticated');

  const q = useQuery({
    queryKey: ['flash-sales', 'upcoming'],
    queryFn: fetchUpcomingFlashSales,
    enabled: authed,
    staleTime: 30_000,
  });

  const remindMut = useMutation({
    mutationFn: ({ itemId, reminded }: { itemId: string; reminded: boolean }) =>
      reminded ? cancelFlashReminder(itemId) : setFlashReminder(itemId),
    onMutate: async ({ itemId, reminded }) => {
      await qc.cancelQueries({ queryKey: ['flash-sales', 'upcoming'] });
      const prev = qc.getQueryData<UpcomingFlashItem[]>(['flash-sales', 'upcoming']);
      qc.setQueryData<UpcomingFlashItem[]>(['flash-sales', 'upcoming'], (old) =>
        old?.map((it) => (it.itemId === itemId ? { ...it, reminded: !reminded } : it)),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['flash-sales', 'upcoming'], ctx.prev);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ['flash-sales', 'upcoming'] }),
  });

  const items = q.data ?? [];
  if (!authed || q.isLoading || items.length === 0) return null;

  return (
    <Box mt={4}>
      <Box px={4} mb={2}>
        <Text.Title className="t-h2" size="small" style={{ color: 'var(--clay-700)' }}>
          {vi.flashSale.upcomingTitle}
        </Text.Title>
      </Box>

      <Box
        px={4}
        style={{ display: 'flex', gap: 12, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}
      >
        {items.map((item) => (
          <UpcomingFlashCard
            key={item.itemId}
            item={item}
            pending={remindMut.isPending && remindMut.variables?.itemId === item.itemId}
            onOpen={() => {
              haptic('light');
              navigate(`/product/${item.productSlug}`);
            }}
            onToggleRemind={() => {
              haptic('light');
              remindMut.mutate({ itemId: item.itemId, reminded: item.reminded });
            }}
          />
        ))}
      </Box>
    </Box>
  );
}
