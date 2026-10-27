import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent } from 'react';
import { useNavigate } from 'zmp-ui';
import { Bell, CheckCircle2, Clock, Zap } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchActiveFlashSales,
  fetchUpcomingFlashSales,
  setFlashReminder,
  cancelFlashReminder,
  type UpcomingFlashItem,
} from '../services/shop-api';
import { formatVnd } from '../utils/format';
import { soldPercent } from '../utils/flash-display';
import { haptic } from '../utils/haptic';
import { serverNow } from '../utils/server-clock';
import { vi } from '../i18n/vi';
import { useCountdown } from '../hooks/use-countdown';
import { useAuthStore } from '../store/auth';
import { HomeBlockError } from './home/home-block-error';
import { useBlockQuery } from './home/use-block-query';
import { flashDisplay } from './catalog/catalog-pricing';
import { Badge } from './ui/badge';
import { Icon } from './ui/icon';
import { PriceTag } from './ui/price-tag';
import { ProgressBar } from './ui/progress-bar';
import { ScrollRow } from './ui/scroll-row';
import { linkKeyboardProps, rowKeyboardProps } from './ui/row-keyboard';
import { Heading, Text } from './ui/text';
import { ProductImage } from './ui/product-image';

const PROMO_TITLE_STYLE: CSSProperties = { color: 'var(--color-promo-fg)', display: 'flex', alignItems: 'center', gap: 6 };

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

const VARIATION_LINE_STYLE: CSSProperties = { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

const CARD_ROW_STYLE: CSSProperties = { gap: 12, padding: '0 16px' };

/**
 * Ưu đãi giờ vàng — flash sale thật từ backend. Countdown êm đến mốc kết thúc sớm nhất.
 */
export function FlashSale() {
  const navigate = useNavigate();

  const q = useBlockQuery(
    useQuery({
      queryKey: ['flash-sales', 'active'],
      queryFn: fetchActiveFlashSales,
      staleTime: 30_000,
    }),
  );

  const items = q.data ?? [];

  // Chỉ tính suất còn giờ: suất sớm nhất có thể đã hết mà danh sách chưa kịp tải lại (poll 60s) trong khi các suất khác còn chạy.
  // `expiredTick` tính lại ngay khi suất đang đếm về 0 để đồng hồ chuyển sang suất kế tiếp thay vì biến mất.
  const [expiredTick, setExpiredTick] = useState(0);
  const soonestEndAt = useMemo(() => {
    const now = serverNow();
    const live = items.map((it) => new Date(it.endAt).getTime()).filter((ms) => ms > now);
    return live.length > 0 ? new Date(Math.min(...live)) : null;
  }, [items, expiredTick]);

  const timeLeft = useCountdown(soonestEndAt);
  useEffect(() => {
    if (soonestEndAt && timeLeft === '') setExpiredTick((n) => n + 1);
  }, [soonestEndAt, timeLeft]);

  if (q.isLoading) return null;
  if (items.length === 0) {
    return q.isError ? (
      <HomeBlockError title={vi.flashSale.sectionName} error={q.error} onRetry={q.refetch} retrying={q.isFetching} />
    ) : null;
  }

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ padding: '0 16px', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Heading variant="title-sm" as="h2" style={PROMO_TITLE_STYLE}>
          <Icon icon={Zap} size="sm" tone="current" />
          {vi.flashSale.sectionTitle}
        </Heading>
        {/* Hết giờ mà danh sách chưa kịp tải lại (poll 60s): không hiện đồng hồ về 0. */}
        {timeLeft && (
          <span role="timer" aria-label={vi.flashSale.endsIn(timeLeft)}>
            <Badge tone="promo" icon={Clock}>
              {vi.flashSale.endsIn(timeLeft)}
            </Badge>
          </span>
        )}
      </div>

      <ScrollRow label={vi.flashSale.sectionName} style={CARD_ROW_STYLE}>
        {items.map((item) => {
          const { price, was, pct } = flashDisplay(item);
          const soldPct = soldPercent(item.soldCount, item.quota);
          return (
            <div
              key={item.itemId}
              className="tubu-press"
              // role=link (không phải button): thẻ mở trang sản phẩm; thẻ "Sắp diễn ra" chứa nút nhắc bên trong nên role=button sẽ lồng nút.
              role="link"
              {...linkKeyboardProps()}
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
                <ProductImage src={item.thumbnail} brand="" />
                {pct > 0 && (
                  <Badge tone="promo" size="sm" style={DISCOUNT_BADGE_STYLE}>
                    -{pct}%
                  </Badge>
                )}
              </div>
              <div style={{ padding: 8 }}>
                <Text variant="caption" style={NAME_CLAMP_STYLE}>
                  {item.productName}
                </Text>
                {item.variationName && (
                  <Text variant="caption" tone="secondary" style={VARIATION_LINE_STYLE}>
                    {item.variationName}
                  </Text>
                )}
                <div style={{ marginTop: 2 }}>
                  <PriceTag value={price} flash={{ price }} size="sm" />
                </div>
                {was > price && (
                  <Text variant="caption" tone="tertiary" as="div" style={{ textDecoration: 'line-through' }}>
                    {formatVnd(was)}
                  </Text>
                )}
                {soldPct > 0 && (
                  <>
                    <div style={{ marginTop: 4 }}>
                      <ProgressBar value={soldPct} max={100} tone="flash" ariaLabel="Tỉ lệ đã bán" />
                    </div>
                    <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 2 }}>
                      {vi.flashSale.soldPct(soldPct)}
                    </Text>
                  </>
                )}
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
  const { price, pct } = flashDisplay(item);

  return (
    <div className="tubu-press" role="link" {...linkKeyboardProps()} onClick={onOpen} style={CARD_STYLE}>
      <div style={{ position: 'relative', aspectRatio: '1 / 1', background: 'var(--stone-100)' }}>
        <ProductImage src={item.thumbnail} brand="" />
        {pct > 0 && (
          <Badge tone="promo" size="sm" style={DISCOUNT_BADGE_STYLE}>
            -{pct}%
          </Badge>
        )}
      </div>
      <div style={{ padding: 8 }}>
        <Text variant="caption" style={NAME_CLAMP_STYLE}>
          {item.productName}
        </Text>
        <div style={{ marginTop: 2 }}>
          <PriceTag value={price} flash={{ price }} size="sm" />
        </div>
        {/* Đã tới giờ mở bán mà danh sách chưa tải lại: không còn gì để nhắc, chạm thẻ là vào xem. */}
        <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 2 }}>
          {startsIn ? vi.flashSale.startsIn(startsIn) : vi.flashSale.live}
        </Text>
        {startsIn && (
          <div
            role="button"
            {...rowKeyboardProps()}
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
              gap: 6,
              borderRadius: 'var(--radius-pill)',
              fontSize: 'var(--type-label-size)',
              fontWeight: 600,
              opacity: pending ? 0.6 : 1,
              background: item.reminded ? 'var(--color-action-secondary-bg)' : 'var(--color-action-primary-bg)',
              color: item.reminded ? 'var(--color-action-secondary-fg)' : 'var(--color-action-primary-fg)',
            }}
          >
            <Icon icon={item.reminded ? CheckCircle2 : Bell} size="sm" tone="current" />
            {item.reminded ? vi.flashSale.reminded : vi.flashSale.remindMe}
          </div>
        )}
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
        <Heading variant="title-sm" as="h2" style={PROMO_TITLE_STYLE}>
          <Icon icon={Bell} size="sm" tone="current" />
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
