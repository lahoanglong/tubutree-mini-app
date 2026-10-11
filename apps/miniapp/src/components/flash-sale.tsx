import { useMemo, type CSSProperties, type MouseEvent } from 'react';
import { useNavigate } from 'zmp-ui';
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
import { HomeBlockError } from './home/home-block-error';
import { Badge } from './ui/badge';
import { PriceTag } from './ui/price-tag';
import { ProgressBar } from './ui/progress-bar';
import { ScrollRow } from './ui/scroll-row';
import { Heading, Text } from './ui/text';

const CARD_STYLE: CSSProperties = {
  flex: '0 0 132px',
  background: 'var(--color-bg-surface)',
  borderRadius: 'var(--radius-card)',
  overflow: 'hidden',
  boxShadow: 'var(--elevation-1)',
};

const DISCOUNT_BADGE_STYLE: CSSProperties = {
  position: 'absolute',
  top: 6,
  left: 6,
  background: 'var(--color-flash-solid-bg)',
  color: 'var(--color-flash-solid-fg)',
};

/** Tên SP tối đa 2 dòng; minHeight bằng đúng 2 dòng caption để thẻ 1 dòng và 2 dòng cao bằng nhau. */
const NAME_CLAMP_STYLE: CSSProperties = {
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  minHeight: 40,
};

const CARD_ROW_STYLE: CSSProperties = { gap: 12, padding: '0 16px' };

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

  if (q.isLoading) return null;
  if (items.length === 0) {
    return q.isError ? (
      <HomeBlockError title={vi.flashSale.sectionName} error={q.error} onRetry={q.refetch} retrying={q.isFetching} />
    ) : null;
  }

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ padding: '0 16px', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Heading variant="title-sm" as="h2" style={{ color: 'var(--color-promo-fg)' }}>
          {vi.flashSale.sectionTitle}
        </Heading>
        <span role="timer" aria-label={vi.flashSale.endsIn(timeLeft)}>
          <Badge tone="promo">{vi.flashSale.endsIn(timeLeft)}</Badge>
        </span>
      </div>

      <ScrollRow label={vi.flashSale.sectionName} style={CARD_ROW_STYLE}>
        {items.map((item) => {
          const pct = item.retailPrice > 0 ? Math.round((1 - item.flashPrice / item.retailPrice) * 100) : 0;
          const soldPct = item.quota > 0 ? Math.round((item.soldCount / item.quota) * 100) : 0;
          return (
            <div
              key={item.itemId}
              className="tubu-press"
              onClick={() => {
                haptic('light');
                // Truyền variationId: sản phẩm nhiều phân loại thì flash chỉ gắn vào MỘT phân
                // loại, mà PDP mặc định chọn phân loại đầu còn hàng → mở ra là giá thường,
                // không badge, không đếm ngược. Khách tưởng bị treo giá (P1-3 audit mạch lạc).
                navigate(`/product/${item.productSlug}`, { state: { variationId: item.variationId } });
              }}
              style={CARD_STYLE}
            >
              <div style={{ position: 'relative', aspectRatio: '1 / 1', background: 'var(--stone-100)' }}>
                {item.thumbnail && (
                  <img
                    src={item.thumbnail}
                    alt={item.productName}
                    loading="lazy"
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                )}
                <Badge tone="promo" size="sm" style={DISCOUNT_BADGE_STYLE}>
                  -{pct}%
                </Badge>
              </div>
              <div style={{ padding: 8 }}>
                <Text variant="caption" style={NAME_CLAMP_STYLE}>
                  {item.productName}
                </Text>
                <div style={{ marginTop: 2 }}>
                  <PriceTag value={item.flashPrice} flash={{ price: item.flashPrice }} size="sm" />
                </div>
                <Text variant="caption" tone="tertiary" as="div" style={{ textDecoration: 'line-through' }}>
                  {formatVnd(item.retailPrice)}
                </Text>
                <div style={{ marginTop: 4 }}>
                  <ProgressBar value={soldPct} max={100} tone="flash" />
                </div>
                <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 2 }}>
                  {vi.flashSale.soldPct(soldPct)}
                </Text>
              </div>
            </div>
          );
        })}
      </ScrollRow>
    </div>
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
    <div className="tubu-press" onClick={onOpen} style={CARD_STYLE}>
      <div style={{ position: 'relative', aspectRatio: '1 / 1', background: 'var(--stone-100)' }}>
        {item.thumbnail && (
          <img
            src={item.thumbnail}
            alt={item.productName}
            loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        )}
        <Badge tone="promo" size="sm" style={DISCOUNT_BADGE_STYLE}>
          -{pct}%
        </Badge>
      </div>
      <div style={{ padding: 8 }}>
        <Text variant="caption" style={NAME_CLAMP_STYLE}>
          {item.productName}
        </Text>
        <div style={{ marginTop: 2 }}>
          <PriceTag value={item.flashPrice} flash={{ price: item.flashPrice }} size="sm" />
        </div>
        <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 2 }}>
          {vi.flashSale.startsIn(startsIn)}
        </Text>
        <div
          role="button"
          className="tubu-press"
          onClick={(e: MouseEvent) => {
            e.stopPropagation();
            if (pending) return;
            onToggleRemind();
          }}
          style={{
            marginTop: 8,
            textAlign: 'center',
            minHeight: 44,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 'var(--radius-pill)',
            fontSize: 'var(--type-label-size)',
            fontWeight: 600,
            opacity: pending ? 0.6 : 1,
            background: item.reminded ? 'var(--color-action-secondary-bg)' : 'var(--color-action-primary-bg)',
            color: item.reminded ? 'var(--color-action-secondary-fg)' : 'var(--color-action-primary-fg)',
          }}
        >
          {item.reminded ? vi.flashSale.reminded : vi.flashSale.remindMe}
        </div>
      </div>
    </div>
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
    <div style={{ marginTop: 16 }}>
      <div style={{ padding: '0 16px', marginBottom: 8 }}>
        <Heading variant="title-sm" as="h2" style={{ color: 'var(--color-promo-fg)' }}>
          {vi.flashSale.upcomingTitle}
        </Heading>
      </div>

      <ScrollRow label="Sắp diễn ra" style={CARD_ROW_STYLE}>
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
      </ScrollRow>
    </div>
  );
}
