'use client';

import { useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCircle2, ChevronRight } from 'lucide-react';
import { cancelFlashReminder, setFlashReminder, type FlashSaleActiveItem, type UpcomingFlashItem } from '@tubutree/app-core/api/flash-sale';
import { productCardView } from '@tubutree/app-core/commerce/product-card-view';
import { nextFlashSlot, slotClock, type NextFlashSlot } from '@tubutree/app-core/merch/flash-next-slot';
import { seeAllHref } from '@tubutree/app-core/merch/home-shelves';
import { shelf } from '@tubutree/app-core/merch/shelves';
import { flashUpcomingQuery } from '@tubutree/app-core/queries/flash-sale';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { serverNow } from '@tubutree/app-core/server-clock';
import { FLASH_NEXT_SLOT_HEIGHT, FLASH_SKELETON_HEIGHT, readFlashHint, readFlashSlotHint, writeFlashHint } from '@tubutree/app-core/home-layout';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { flashCardProduct, soldPercent } from '@/lib/flash-display';
import { productHref } from '@/lib/product-href';
import { flashSaleText } from '@/lib/home-text';
import { useCountdown } from '@/lib/use-countdown';
import { useFlashExpiry } from '@/lib/use-flash-expiry';
import { useHydrated } from '@/lib/use-hydrated';
import { browserStorage } from '@/lib/recently-viewed';
import { Icon, SectionHeader, Skeleton, Text } from '@/components/mini';
import { Countdown } from '@/components/mini/countdown';
import { FlashSoldBar } from '@/components/mini/flash-sold-bar';
import { ProductTile } from '@/components/mini/product-tile';
import { RailCell, RailShell } from '@/components/mini/product-rail';
import { HomeBlockError } from './home-block-error';

const TITLE = 'flex items-center gap-1.5 font-display text-lg font-semibold text-promo-fg';

/** Cuối thẻ Giờ vàng: 4 (cách giá) + 16 (thanh đã bán có chữ). Luôn giữ chỗ để mọi thẻ cùng kệ cao bằng nhau. */
const SOLD_FOOTER_HEIGHT = 20;
/** Cuối thẻ "Sắp diễn ra": 8 (cách giá) + 44 (nút nhắc). */
const REMIND_FOOTER_HEIGHT = 52;
const FLASH_SHELF = shelf('home.flash');

const subscribeNothing = () => () => {};

export function FlashSkeleton({ withNextSlot }: { withNextSlot: boolean }) {
  return (
    <div data-testid="flash-sale-loading" aria-hidden="true">
      <Skeleton height={FLASH_SKELETON_HEIGHT + (withNextSlot ? FLASH_NEXT_SLOT_HEIGHT : 0)} radius="var(--radius-card)" />
    </div>
  );
}

export interface FlashSaleProps {
  /** Suất đang chạy đã qua `composeHomeShelves` (chống trùng, tối đa 8); khối vẫn tự cắt theo `SHELVES` để dùng đúng cả khi gọi thẳng. */
  items: FlashSaleActiveItem[];
  /** Lần tải đầu của danh sách suất (không tính lúc tải lại sau lỗi). */
  loading: boolean;
  error?: unknown;
  onRetry?: () => unknown;
  /** Đang có request bay (tải lại sau lỗi, nhịp nền, hỏi lại dữ liệu dựng sẵn): chưa chốt thì chưa ghi dấu nhớ. */
  retrying?: boolean;
  /** Gọi khi đồng hồ về 0 (suất sớm nhất hết giờ): chỗ nối dữ liệu tính lại chống trùng để món hết giờ trở lại kệ khác. */
  onExpire?: () => void;
}

/**
 * Giờ vàng ở Trang chủ (Q3, bản web của `flash-sale.tsx` ở Mini App): tiêu đề promo + MỘT đồng hồ HH:MM:SS của suất sớm nhất còn giờ + "Xem tất cả",
 * kệ ≤8 thẻ với thanh đã bán có chữ, dòng "suất kế" khi suất sau mở trong 6 giờ. Chỉ tính suất còn giờ: suất sớm nhất hết thì đồng hồ chuyển sang suất
 * kế, hết mọi suất thì khối ẩn (không hiện 00:00:00). Dưới `minItems` thì ẩn cả khối.
 *
 * Khác Mini: kệ có trong HTML server (dữ liệu dựng sẵn) nên KHÔNG chờ suất sắp mở tải xong mới hiện, mà dòng "suất kế" vào sau; lần mở trước có dòng đó
 * thì chỗ của nó được giữ sẵn. Trước hydrate mọi suất coi là còn giờ (đúng như HTML máy chủ đã vẽ), sau hydrate mới tính theo giờ máy chủ thật.
 */
export function FlashSale({ items, loading, error, onRetry, retrying = false, onExpire }: FlashSaleProps) {
  const titleId = useId();
  const hydrated = useHydrated();
  // Chờ biết phiên xong rồi mới hỏi: hỏi sớm thì đi request lẻ dù khách đã đăng nhập. Không dùng `useAuthRestoring`: ở lượt hydrate đầu nó là `false`
  // (ảnh chụp phía server) cả với khách có cờ phiên, nên câu hỏi sớm vẫn lọt ra trước khi phiên khôi phục xong.
  const sessionReady = useAuthPhase() !== 'loading';
  const upcoming = useQuery({ ...flashUpcomingQuery(coreHttp), enabled: sessionReady, staleTime: 30_000 });

  // `expiredTick` tính lại ngay khi suất đang đếm về 0 (Countdown.onEnd): đồng hồ chuyển sang suất kế tiếp thay vì biến mất, thẻ hết giờ rời kệ.
  const [expiredTick, setExpiredTick] = useState(0);
  const live = useMemo(() => {
    if (!hydrated) return items.slice(0, FLASH_SHELF.maxItems);
    const now = serverNow();
    return items.filter((it) => Date.parse(it.endAt) > now).slice(0, FLASH_SHELF.maxItems);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, hydrated, expiredTick]);
  const soonestEndAt = useMemo(() => live.reduce<string | null>((a, it) => (a === null || Date.parse(it.endAt) < Date.parse(a) ? it.endAt : a), null), [live]);
  const visible = live.length >= FLASH_SHELF.minItems && soonestEndAt !== null;
  const slot = useMemo(
    () => (hydrated ? nextFlashSlot(upcoming.data ?? [], serverNow()) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [upcoming.data, hydrated, expiredTick],
  );

  // Lần mở trước có Giờ vàng thì giữ chỗ lúc tải (khối nằm sát màn đầu, chen vào sẽ đẩy cả trang); chưa nhớ thì chờ im lặng.
  // Đọc bằng useSyncExternalStore: HTML server không có kho nên bản server là "chưa nhớ", sau hydrate mới đọc thật.
  const hadFlash = useSyncExternalStore(subscribeNothing, () => readFlashHint(browserStorage()), () => false);
  const hadNextSlot = useSyncExternalStore(subscribeNothing, () => readFlashSlotHint(browserStorage()), () => false);
  // Đang tải lại thì chưa chốt: dữ liệu dựng sẵn có thể cũ, ghi "không có" lúc này sẽ xoá dấu nhớ trước khi biết kết quả thật.
  const settled = !loading && !error && !retrying && hydrated;
  const hasSlot = slot !== null;
  const slotKnown = !upcoming.isPending;
  useEffect(() => {
    if (settled && (!visible || slotKnown)) writeFlashHint(browserStorage(), visible, hasSlot);
  }, [settled, visible, slotKnown, hasSlot]);

  if (loading) return hadFlash ? <FlashSkeleton withNextSlot={hadNextSlot} /> : null;
  if (items.length === 0 && error) {
    return <HomeBlockError title={fillCopy('flash.title')} error={error} onRetry={() => onRetry?.()} retrying={retrying} />;
  }
  if (!visible) return null;

  const title = fillCopy('flash.title');
  const seeAll = seeAllHref('home.flash', 'web');
  return (
    <section aria-labelledby={titleId}>
      <SectionHeader
        id={titleId}
        title={title}
        icon="zap"
        tone="promo"
        trailing={
          <Countdown
            endAt={soonestEndAt}
            mode="clock"
            onEnd={() => {
              setExpiredTick((n) => n + 1);
              onExpire?.();
            }}
          />
        }
        action={seeAll ? { to: seeAll } : undefined}
      />
      <RailShell label={`${title}, vuốt ngang để xem thêm`}>
        {live.map((item) => (
          <RailCell key={item.itemId} variant="flash">
            <ActiveFlashCard item={item} reserveVariation={live.some((it) => Boolean(it.variationName))} />
          </RailCell>
        ))}
      </RailShell>
      {slot ? (
        <NextSlotLine slot={slot} href={seeAll} />
      ) : !slotKnown && hadNextSlot ? (
        <div aria-hidden="true" style={{ height: FLASH_NEXT_SLOT_HEIGHT }} />
      ) : null}
    </section>
  );
}

/**
 * Một dòng dưới kệ: suất kế mở lúc mấy giờ, có mấy món; bấm sang trang Giờ vàng, nơi đặt nhắc từng suất. `href` null (kệ không khai lối xem
 * tất cả) thì chỉ là dòng thông tin, không hứa "Nhắc tôi": nút dẫn tới nơi không có gì để nhắc là lạc.
 */
function NextSlotLine({ slot, href }: { slot: NextFlashSlot; href: string | null }) {
  const label = (
    <Text variant="body-sm" tone="secondary">
      {fillCopy('flash.nextSlot', { time: slotClock(slot.startAt), n: slot.count })}
    </Text>
  );
  const style = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    boxSizing: 'border-box',
    width: '100%',
    minHeight: FLASH_NEXT_SLOT_HEIGHT,
    padding: 0,
    textDecoration: 'none',
  } as const;
  if (!href) {
    return (
      <div data-testid="flash-next-slot" style={style}>
        {label}
      </div>
    );
  }
  return (
    <Link href={href} className="tubu-press" data-testid="flash-next-slot" style={style}>
      {label}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, color: 'var(--color-text-brand)', fontSize: 'var(--type-label-size)', fontWeight: 600, flex: '0 0 auto' }}>
        {fillCopy('flash.remind')}
        <Icon icon={ChevronRight} size="sm" tone="current" />
      </span>
    </Link>
  );
}

/**
 * Thẻ Giờ vàng đang chạy: thẻ `flash` chung, thanh "đã bán" có chữ ở cuối (luôn có, kể cả chưa bán suất nào: "Vừa mở bán"). Về giá thường đúng mốc `endAt`
 * dù danh sách chưa tải lại. Danh sách dựng sẵn (ISR) có thể cũ hơn giờ trình duyệt: trước hydrate coi suất còn giờ (đúng như HTML máy chủ đã vẽ),
 * sau hydrate tính theo giờ máy chủ thật.
 */
export function ActiveFlashCard({ item, reserveVariation }: { item: FlashSaleActiveItem; reserveVariation: boolean }) {
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
          <FlashSoldBar soldPct={soldPct} soldOut={item.quota > 0 && item.soldCount >= item.quota} />
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
 * trạng thái reminded) → chỉ chạy khi đã đăng nhập. Đặt/huỷ nhắc cập nhật ngay, lỗi thì hoàn lại. Trang Giờ vàng (`app/gio-vang`) có
 * nút nhắc riêng theo từng suất; Trang chủ chỉ còn dòng "suất kế" dưới kệ Giờ vàng.
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
    <section aria-label={flashSaleText.upcomingTitle} className="pt-4">
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
