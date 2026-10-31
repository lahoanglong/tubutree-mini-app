import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent } from 'react';
import { Bell, CheckCircle2, Clock, Zap } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchActiveFlashSales,
  fetchUpcomingFlashSales,
  setFlashReminder,
  cancelFlashReminder,
  type FlashSaleActiveItem,
  type UpcomingFlashItem,
} from '../services/shop-api';
import type { ProductCard as ProductCardData } from '@tubutree/app-core/api/catalog';
import { productCardView } from '@tubutree/app-core/commerce/product-card-view';
import { soldPercent } from '../utils/flash-display';
import { haptic } from '../utils/haptic';
import { serverNow } from '../utils/server-clock';
import { vi } from '../i18n/vi';
import { useCountdown } from '../hooks/use-countdown';
import { useFlashExpiry } from '../hooks/use-flash-expiry';
import { useAuthStore } from '../store/auth';
import { browserStorage } from '../utils/recently-viewed';
import { FLASH_SKELETON_HEIGHT, readFlashHint, writeFlashHint } from '@tubutree/app-core/home-layout';
import { Skeleton } from './ui/skeleton';
import { HomeBlockError } from './home/home-block-error';
import { useBlockQuery } from './home/use-block-query';
import { Badge } from './ui/badge';
import { Icon } from './ui/icon';
import { ProductTile } from './ui/product-tile';
import { ProgressBar } from './ui/progress-bar';
import { RailCell, RailShell } from './ui/product-rail';
import { rowKeyboardProps } from './ui/row-keyboard';
import { Heading, Text } from './ui/text';

const PROMO_TITLE_STYLE: CSSProperties = { color: 'var(--color-promo-fg)', display: 'flex', alignItems: 'center', gap: 6 };

/** Cuối thẻ Giờ vàng: 4 (cách giá) + 6 (thanh) + 2 + 16 (chữ đã bán). Luôn giữ chỗ để thẻ chưa bán được suất nào vẫn cao bằng thẻ khác. */
const SOLD_FOOTER_HEIGHT = 28;
/** Cuối thẻ "Sắp diễn ra": 8 (cách giá) + 44 (nút nhắc). */
const REMIND_FOOTER_HEIGHT = 52;

function FlashSkeleton() {
  return (
    <div data-testid="flash-sale-loading" aria-hidden="true" style={{ marginTop: 16, padding: '0 16px' }}>
      <Skeleton height={FLASH_SKELETON_HEIGHT - 16} radius="var(--radius-card)" />
    </div>
  );
}

/**
 * Ưu đãi giờ vàng — flash sale thật từ backend. Countdown êm đến mốc kết thúc sớm nhất.
 */
export function FlashSale() {
  const q = useBlockQuery(
    useQuery({
      queryKey: ['flash-sales', 'active'],
      queryFn: fetchActiveFlashSales,
      staleTime: 30_000,
    }),
  );

  const items = q.data ?? [];
  // Một dòng phân loại dưới giá chỉ khi có thẻ cần; có thẻ cần thì mọi thẻ giữ chỗ để giá cùng kệ thẳng hàng.
  const hasVariation = items.some((it) => Boolean(it.variationName));

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

  // Lần mở trước có Giờ vàng thì giữ chỗ lúc tải (khối nằm sát màn đầu, chen vào sẽ đẩy cả trang); chưa nhớ thì chờ im lặng.
  const [hadFlash] = useState(() => readFlashHint(browserStorage()));
  const settledWithFlash = q.data !== undefined && !q.isLoading ? soonestEndAt !== null : null;
  useEffect(() => {
    if (settledWithFlash !== null) writeFlashHint(browserStorage(), settledWithFlash);
  }, [settledWithFlash]);

  if (q.isLoading) return hadFlash ? <FlashSkeleton /> : null;
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

      <RailShell label={vi.flashSale.sectionName}>
        {items.map((item) => (
          <RailCell key={item.itemId} variant="flash">
            <ActiveFlashCard item={item} reserveVariation={hasVariation} />
          </RailCell>
        ))}
      </RailShell>
    </div>
  );
}

/** Thẻ sản phẩm của một suất Giờ vàng: giá của đúng phân loại có suất (ghim phân loại để thẻ chỉ xét suất này). */
function flashCardProduct(item: {
  itemId: string;
  productSlug: string;
  productName: string;
  thumbnail: string | null;
  variationId: string;
  retailPrice: number;
  salePrice?: number | null;
}): ProductCardData {
  return {
    id: item.itemId,
    slug: item.productSlug,
    name: item.productName,
    brand: '',
    thumbnail: item.thumbnail,
    basePrice: item.retailPrice,
    salePrice: item.salePrice ?? null,
    repVariationId: item.variationId,
    pinnedVariationId: item.variationId,
    isFeatured: false,
    inStock: true,
  };
}

/** Thẻ Giờ vàng đang chạy: thẻ `flash` chung, thanh "đã bán" ở cuối. Về giá thường đúng mốc `endAt` dù danh sách chưa tải lại. */
function ActiveFlashCard({ item, reserveVariation }: { item: FlashSaleActiveItem; reserveVariation: boolean }) {
  useFlashExpiry(item.endAt);
  const view = productCardView({ product: flashCardProduct(item), flash: item, variant: 'flash', now: serverNow() });
  const soldPct = soldPercent(item.soldCount, item.quota);
  return (
    <ProductTile
      view={view}
      variant="flash"
      href={`/product/${encodeURIComponent(item.productSlug)}`}
      // variationId: sản phẩm nhiều phân loại thì flash chỉ gắn vào MỘT phân loại, mà PDP mặc định chọn phân loại đầu còn hàng,
      // mở ra là giá thường, không nhãn, không đếm ngược. Khách tưởng bị treo giá (P1-3 audit mạch lạc).
      navState={{ variationId: item.variationId }}
      note={reserveVariation ? (item.variationName ?? '') : undefined}
      footerHeight={SOLD_FOOTER_HEIGHT}
      footer={
        <div style={{ height: SOLD_FOOTER_HEIGHT, paddingTop: 4, boxSizing: 'border-box' }}>
          {soldPct > 0 && (
            <>
              <ProgressBar value={soldPct} max={100} tone="flash" ariaLabel="Tỉ lệ đã bán" />
              <Text variant="label" tone="tertiary" as="div" style={{ marginTop: 2, height: 16, lineHeight: '16px' }}>
                {vi.flashSale.soldPct(soldPct)}
              </Text>
            </>
          )}
        </div>
      }
    />
  );
}

/** 1 thẻ trong danh sách "Sắp diễn ra" — countdown riêng theo startAt của item. */
function UpcomingFlashCard({ item, pending, onToggleRemind }: { item: UpcomingFlashItem; pending: boolean; onToggleRemind: () => void }) {
  const startsIn = useCountdown(item.startAt);
  const view = productCardView({ product: flashCardProduct(item), flash: item, variant: 'flash', now: serverNow() });

  return (
    <ProductTile
      view={view}
      variant="flash"
      href={`/product/${encodeURIComponent(item.productSlug)}`}
      // Đã tới giờ mở bán mà danh sách chưa tải lại: không còn gì để nhắc, chạm thẻ là vào xem.
      note={startsIn ? vi.flashSale.startsIn(startsIn) : vi.flashSale.live}
      footerHeight={startsIn ? REMIND_FOOTER_HEIGHT : undefined}
      footer={
        startsIn ? (
          // Anh em của nút tên, nổi trên lớp phủ của nó (z-index 1): chạm nút nhắc không mở sản phẩm.
          <div style={{ position: 'relative', zIndex: 1, marginTop: 8 }}>
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
          </div>
        ) : undefined
      }
    />
  );
}

/**
 * "Sắp diễn ra" — flash sale đã lên lịch nhưng chưa mở bán, cho user đặt nhắc.
 * Cần đăng nhập (BE lấy userId từ JWT để trả trạng thái reminded) → gate theo auth.
 */
export function UpcomingFlashSales() {
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

      <RailShell label="Sắp diễn ra">
        {items.map((item) => (
          <RailCell key={item.itemId} variant="flash">
            <UpcomingFlashCard
              item={item}
              pending={remindMut.isPending && remindMut.variables?.itemId === item.itemId}
              onToggleRemind={() => {
                haptic('light');
                remindMut.mutate({ itemId: item.itemId, reminded: item.reminded });
              }}
            />
          </RailCell>
        ))}
      </RailShell>
    </div>
  );
}
