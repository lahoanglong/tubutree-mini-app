'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCircle2, Clock, Zap } from 'lucide-react';
import { cancelFlashReminder, setFlashReminder, type FlashSaleActiveItem, type UpcomingFlashItem } from '@tubutree/app-core/api/flash-sale';
import type { ProductCard as ProductCardData } from '@tubutree/app-core/api/catalog';
import { productCardView } from '@tubutree/app-core/commerce/product-card-view';
import { flashActiveQuery, flashUpcomingQuery } from '@tubutree/app-core/queries/flash-sale';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { soldPercent } from '@/lib/flash-display';
import { productHref } from '@/lib/product-href';
import { flashSaleText } from '@/lib/home-text';
import { useCountdown } from '@/lib/use-countdown';
import { useFlashExpiry } from '@/lib/use-flash-expiry';
import { useHydrated } from '@/lib/use-hydrated';
import { loadActiveFlashSales } from '@/lib/use-flash-sales';
import { serverNow } from '@tubutree/app-core/server-clock';
import { FLASH_SKELETON_HEIGHT, readFlashHint, writeFlashHint } from '@tubutree/app-core/home-layout';
import { browserStorage } from '@/lib/recently-viewed';
import { Skeleton } from '@/components/mini';
import { Badge } from '@/components/ui/badge';
import { ProductTile } from '@/components/mini/product-tile';
import { RailCell, RailShell } from '@/components/mini/product-rail';
import { ProgressBar } from '@/components/ui/progress-bar';
import { HomeBlockError } from './home-block-error';
import { useBlockQuery } from './use-block-query';

const TITLE = 'flex items-center gap-1.5 font-display text-lg font-semibold text-promo-fg';

/** Cuối thẻ Giờ vàng: 4 (cách giá) + 6 (thanh) + 2 + 16 (chữ đã bán). Luôn giữ chỗ để thẻ chưa bán được suất nào vẫn cao bằng thẻ khác. */
const SOLD_FOOTER_HEIGHT = 28;
/** Cuối thẻ "Sắp diễn ra": 8 (cách giá) + 44 (nút nhắc). */
const REMIND_FOOTER_HEIGHT = 52;

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

const subscribeNothing = () => () => {};

function FlashSkeleton() {
  return (
    <div data-testid="flash-sale-loading" aria-hidden="true" className="py-2">
      <Skeleton height={FLASH_SKELETON_HEIGHT - 16} radius="var(--radius-card)" />
    </div>
  );
}

/** Ưu đãi giờ vàng — flash sale thật từ backend. Countdown êm đến mốc kết thúc sớm nhất. */
export function FlashSale({ initial }: { initial?: FlashSaleActiveItem[] }) {
  // initialDataUpdatedAt 0: dữ liệu dựng sẵn chỉ để HTML đầu có khối, trình duyệt vẫn hỏi lại ngay (giá và số suất còn là của lúc dựng trang).
  const q = useBlockQuery(
    useQuery({
      queryKey: flashActiveQuery(coreHttp).queryKey,
      queryFn: loadActiveFlashSales,
      staleTime: 30_000,
      refetchInterval: 60_000,
      ...(initial ? { initialData: initial, initialDataUpdatedAt: 0 } : {}),
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, expiredTick]);

  const timeLeft = useCountdown(soonestEndAt);
  const [afterMount, setAfterMount] = useState(false);
  useEffect(() => setAfterMount(true), []);
  useEffect(() => {
    if (soonestEndAt && timeLeft === '') setExpiredTick((n) => n + 1);
  }, [soonestEndAt, timeLeft]);

  // Lần mở trước có Giờ vàng thì giữ chỗ lúc tải (khối nằm sát màn đầu, chen vào sẽ đẩy cả trang); chưa nhớ thì chờ im lặng.
  // Đọc bằng useSyncExternalStore: HTML server không có kho nên bản server là "chưa nhớ", sau hydrate mới đọc thật.
  const hadFlash = useSyncExternalStore(subscribeNothing, () => readFlashHint(browserStorage()), () => false);
  // Đang tải lại thì chưa chốt: dữ liệu dựng sẵn có thể cũ, ghi "không có" lúc này sẽ xoá dấu nhớ trước khi biết kết quả thật.
  const settledWithFlash = q.data !== undefined && !q.isLoading && !q.isFetching ? soonestEndAt !== null : null;
  useEffect(() => {
    if (settledWithFlash !== null) writeFlashHint(browserStorage(), settledWithFlash);
  }, [settledWithFlash]);

  if (q.isLoading) return hadFlash ? <FlashSkeleton /> : null;
  if (items.length === 0) {
    return q.isError ? <HomeBlockError title={flashSaleText.sectionName} error={q.error} onRetry={q.refetch} retrying={q.isFetching} /> : null;
  }

  return (
    <section aria-label={flashSaleText.sectionName} className="py-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className={TITLE}>
          <Zap className="h-4 w-4" aria-hidden="true" />
          {flashSaleText.sectionTitle}
        </h2>
        {/* Khung đồng hồ luôn có trong cây: HTML ISR cũ có thể được trả sau giờ hết suất (hoặc đồng hồ máy khách chạy trước máy chủ),
            khi đó máy chủ vẽ đồng hồ mà trình duyệt tính ra rỗng; khác cấu trúc phần tử thì hydrate hỏng. Hết giờ thì ẩn, không hiện về 0.
            React không sửa thuộc tính/chữ lệch khi hydrate, nên sau mount đổi key để vẽ lại đúng theo giờ trình duyệt. */}
        <span
          key={afterMount ? 'live' : 'ssr'}
          role="timer"
          suppressHydrationWarning
          aria-label={timeLeft ? flashSaleText.endsIn(timeLeft) : undefined}
          aria-hidden={timeLeft ? undefined : true}
          className={timeLeft ? undefined : 'invisible'}
        >
          <Badge tone="promo" icon={Clock}>
            {/* Chữ phút lệch giữa HTML ISR và trình duyệt là bình thường, chỉ che đúng phần tử chứa chữ. */}
            <span suppressHydrationWarning>{timeLeft ? flashSaleText.endsIn(timeLeft) : ''}</span>
          </Badge>
        </span>
      </div>
      <RailShell label={flashSaleText.sectionName}>
        {items.map((item: FlashSaleActiveItem) => (
          <RailCell key={item.itemId} variant="flash">
            <ActiveFlashCard item={item} reserveVariation={hasVariation} />
          </RailCell>
        ))}
      </RailShell>
    </section>
  );
}

/**
 * Thẻ Giờ vàng đang chạy: thẻ `flash` chung, thanh "đã bán" ở cuối. Về giá thường đúng mốc `endAt` dù danh sách chưa tải lại.
 * Danh sách dựng sẵn (ISR) có thể cũ hơn giờ trình duyệt: trước hydrate coi suất còn giờ (đúng như HTML máy chủ đã vẽ), sau hydrate tính theo giờ máy chủ thật.
 */
function ActiveFlashCard({ item, reserveVariation }: { item: FlashSaleActiveItem; reserveVariation: boolean }) {
  const hydrated = useHydrated();
  useFlashExpiry(item.endAt);
  const end = Date.parse(item.endAt);
  const now = hydrated || !Number.isFinite(end) ? serverNow() : end - 1;
  const view = productCardView({ product: flashCardProduct(item), flash: item, variant: 'flash', now });
  const soldPct = soldPercent(item.soldCount, item.quota);
  return (
    <ProductTile
      view={view}
      variant="flash"
      // Sản phẩm nhiều phân loại thì flash chỉ gắn vào MỘT phân loại, mà trang chi tiết mặc định chọn phân loại đầu còn hàng:
      // mở ra là giá thường, không nhãn, không đếm ngược. `?v=` mở đúng phân loại có suất (chỉ khi suất thật sự rẻ hơn).
      href={productHref(encodeURIComponent(item.productSlug), view.isFlash ? item.variationId : null)}
      note={reserveVariation ? (item.variationName ?? '') : undefined}
      footerHeight={SOLD_FOOTER_HEIGHT}
      footer={
        <div style={{ height: SOLD_FOOTER_HEIGHT, paddingTop: 4, boxSizing: 'border-box' }}>
          {soldPct > 0 && (
            <>
              <ProgressBar value={soldPct} max={100} tone="flash" ariaLabel={flashSaleText.soldPct(soldPct)} />
              <p className="mt-0.5 h-4 text-xs leading-4 text-stone-600">{flashSaleText.soldPct(soldPct)}</p>
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
      href={productHref(encodeURIComponent(item.productSlug))}
      // Đã tới giờ mở bán mà danh sách chưa tải lại: không còn gì để nhắc, chạm thẻ là vào xem.
      note={startsIn ? flashSaleText.startsIn(startsIn) : flashSaleText.live}
      footerHeight={startsIn ? REMIND_FOOTER_HEIGHT : undefined}
      footer={
        startsIn ? (
          // Anh em của liên kết tên, nổi trên lớp phủ của nó (z-index 1): chạm nút nhắc không mở sản phẩm.
          <div style={{ position: 'relative', zIndex: 1, marginTop: 8 }}>
            <button
              type="button"
              disabled={pending}
              onClick={onToggleRemind}
              className={`inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-full text-xs font-semibold transition disabled:opacity-60 ${
                item.reminded ? 'bg-forest-50 text-forest-700' : 'bg-forest-600 text-stone-0 hover:bg-forest-700'
              }`}
            >
              {item.reminded ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <Bell className="h-4 w-4" aria-hidden="true" />}
              {item.reminded ? flashSaleText.reminded : flashSaleText.remindMe}
            </button>
          </div>
        ) : undefined
      }
    />
  );
}

/**
 * "Sắp diễn ra" — flash sale đã lên lịch nhưng chưa mở bán, cho khách đặt nhắc. Cần đăng nhập (API lấy userId từ phiên để trả
 * trạng thái reminded) → chỉ chạy khi đã đăng nhập. Đặt/huỷ nhắc cập nhật ngay, lỗi thì hoàn lại.
 */
export function UpcomingFlashSales() {
  const qc = useQueryClient();
  const authed = useAuthPhase() === 'authenticated';
  const key = flashUpcomingQuery(coreHttp).queryKey;
  const q = useQuery({ ...flashUpcomingQuery(coreHttp), enabled: authed, staleTime: 30_000 });

  const remind = useMutation({
    mutationFn: ({ itemId, reminded }: { itemId: string; reminded: boolean }) =>
      reminded ? cancelFlashReminder(coreHttp, itemId) : setFlashReminder(coreHttp, itemId),
    onMutate: async ({ itemId, reminded }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<UpcomingFlashItem[]>(key);
      qc.setQueryData<UpcomingFlashItem[]>(key, (old) => old?.map((it) => (it.itemId === itemId ? { ...it, reminded: !reminded } : it)));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: key }),
  });

  const items = q.data ?? [];
  if (!authed || q.isLoading || items.length === 0) return null;

  return (
    <section aria-label={flashSaleText.upcomingTitle} className="py-2">
      <h2 className={`mb-2 ${TITLE}`}>
        <Bell className="h-4 w-4" aria-hidden="true" />
        {flashSaleText.upcomingTitle}
      </h2>
      <RailShell label={flashSaleText.upcomingTitle}>
        {items.map((item) => (
          <RailCell key={item.itemId} variant="flash">
            <UpcomingFlashCard
              item={item}
              pending={remind.isPending && remind.variables?.itemId === item.itemId}
              onToggleRemind={() => remind.mutate({ itemId: item.itemId, reminded: item.reminded })}
            />
          </RailCell>
        ))}
      </RailShell>
    </section>
  );
}
