import { useEffect, useId, useMemo, useState, type CSSProperties, type MouseEvent } from 'react';
import { Bell, CheckCircle2, ChevronRight } from 'lucide-react';
import { useNavigate } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchUpcomingFlashSales,
  setFlashReminder,
  cancelFlashReminder,
  type FlashSaleActiveItem,
  type UpcomingFlashItem,
} from '../services/shop-api';
import { productCardView } from '@tubutree/app-core/commerce/product-card-view';
import { nextFlashSlot, slotClock, type NextFlashSlot } from '@tubutree/app-core/merch/flash-next-slot';
import { seeAllHref } from '@tubutree/app-core/merch/home-shelves';
import { shelf } from '@tubutree/app-core/merch/shelves';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { flashCardProduct, soldPercent } from '../utils/flash-display';
import { haptic } from '../utils/haptic';
import { serverNow } from '../utils/server-clock';
import { vi } from '../i18n/vi';
import { useCountdown } from '../hooks/use-countdown';
import { useAuthStore } from '../store/auth';
import { browserStorage } from '../utils/recently-viewed';
import { FLASH_NEXT_SLOT_HEIGHT, FLASH_SKELETON_HEIGHT, readFlashHint, readFlashSlotHint, writeFlashHint } from '@tubutree/app-core/home-layout';
import { Skeleton } from './ui/skeleton';
import { HomeBlockError } from './home/home-block-error';
import { Countdown } from './ui/countdown';
import { FlashSoldBar } from './ui/flash-sold-bar';
import { Icon } from './ui/icon';
import { ProductTile } from './ui/product-tile';
import { RailCell, RailShell } from './ui/product-rail';
import { rowKeyboardProps } from './ui/row-keyboard';
import { SectionHeader } from './ui/section-header';
import { Heading, Text } from './ui/text';

const PROMO_TITLE_STYLE: CSSProperties = { color: 'var(--color-promo-fg)', display: 'flex', alignItems: 'center', gap: 6 };

/** Cuối thẻ Giờ vàng: 4 (cách giá) + 16 (thanh đã bán có chữ). Luôn giữ chỗ để mọi thẻ cùng kệ cao bằng nhau. */
const SOLD_FOOTER_HEIGHT = 20;
/** Cuối thẻ "Sắp diễn ra": 8 (cách giá) + 44 (nút nhắc). */
const REMIND_FOOTER_HEIGHT = 52;
const FLASH_SHELF = shelf('home.flash');

export function FlashSkeleton({ withNextSlot }: { withNextSlot: boolean }) {
  return (
    <div data-testid="flash-sale-loading" aria-hidden="true" style={{ padding: '0 16px' }}>
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
  retrying?: boolean;
  /** Gọi khi đồng hồ về 0 (suất sớm nhất hết giờ): chỗ nối dữ liệu tính lại chống trùng để món hết giờ trở lại kệ khác. */
  onExpire?: () => void;
}

/**
 * Giờ vàng ở Trang chủ (Q3): tiêu đề promo + MỘT đồng hồ HH:MM:SS của suất sớm nhất còn giờ + "Xem tất cả", kệ ≤8 thẻ với thanh đã bán có chữ,
 * dòng "suất kế" khi suất sau mở trong 6 giờ. Chỉ tính suất còn giờ: suất sớm nhất hết thì đồng hồ chuyển sang suất kế, hết mọi suất thì khối ẩn
 * (không hiện 00:00:00). Dưới `minItems` thì ẩn cả khối (kệ mỏng không đáng một khối).
 * Khối chờ suất sắp mở tải xong rồi mới hiện để dòng "suất kế" không đẩy khối bên dưới giữa chừng; lỗi tải suất sắp mở thì bỏ dòng, không báo lỗi.
 */
export function FlashSale({ items, loading, error, onRetry, retrying, onExpire }: FlashSaleProps) {
  const navigate = useNavigate();
  const titleId = useId();
  // Chờ khôi phục phiên xong rồi mới hỏi: hỏi sớm thì chưa có token nên đi request lẻ dù khách đã đăng nhập, trong khi khối gộp /home/me đã có sẵn.
  const sessionReady = useAuthStore((s) => s.status !== 'loading');
  const upcoming = useQuery({ queryKey: ['flash-sales', 'upcoming'], queryFn: fetchUpcomingFlashSales, staleTime: 30_000, enabled: sessionReady });

  // `expiredTick` tính lại ngay khi suất đang đếm về 0 (Countdown.onEnd): đồng hồ chuyển sang suất kế tiếp thay vì biến mất, thẻ hết giờ rời kệ.
  const [expiredTick, setExpiredTick] = useState(0);
  const live = useMemo(() => {
    const now = serverNow();
    return items.filter((it) => Date.parse(it.endAt) > now).slice(0, FLASH_SHELF.maxItems);
  }, [items, expiredTick]);
  const soonestEndAt = useMemo(() => live.reduce<string | null>((a, it) => (a === null || Date.parse(it.endAt) < Date.parse(a) ? it.endAt : a), null), [live]);
  const visible = live.length >= FLASH_SHELF.minItems && soonestEndAt !== null;
  const slot = useMemo(() => nextFlashSlot(upcoming.data ?? [], serverNow()), [upcoming.data, expiredTick]);

  // Lần mở trước có Giờ vàng thì giữ chỗ lúc tải (khối nằm sát màn đầu, chen vào sẽ đẩy cả trang); chưa nhớ thì chờ im lặng.
  const [hint] = useState(() => ({ had: readFlashHint(browserStorage()), nextSlot: readFlashSlotHint(browserStorage()) }));
  const settled = !loading && !error;
  const hasSlot = slot !== null;
  const slotKnown = !upcoming.isPending;
  useEffect(() => {
    if (settled && (!visible || slotKnown)) writeFlashHint(browserStorage(), visible, hasSlot);
  }, [settled, visible, slotKnown, hasSlot]);

  if (loading || (visible && (!sessionReady || upcoming.isLoading))) return hint.had ? <FlashSkeleton withNextSlot={hint.nextSlot} /> : null;
  if (items.length === 0 && error) {
    return <HomeBlockError title={fillCopy('flash.title')} error={error} onRetry={() => onRetry?.()} retrying={retrying} />;
  }
  if (!visible) return null;

  const title = fillCopy('flash.title');
  const seeAll = seeAllHref('home.flash');
  return (
    <section aria-labelledby={titleId}>
      <div style={{ padding: '0 16px' }}>
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
      </div>
      <RailShell label={`${title}, vuốt ngang để xem thêm`}>
        {live.map((item) => (
          <RailCell key={item.itemId} variant="flash">
            <ActiveFlashCard item={item} reserveVariation={live.some((it) => Boolean(it.variationName))} />
          </RailCell>
        ))}
      </RailShell>
      {slot && <NextSlotLine slot={slot} onOpen={seeAll ? () => navigate(seeAll) : undefined} />}
    </section>
  );
}

/**
 * Một dòng dưới kệ: suất kế mở lúc mấy giờ, có mấy món; bấm sang trang Giờ vàng, nơi đặt nhắc từng suất. `onOpen` trống (kệ không khai lối xem
 * tất cả) thì chỉ là dòng thông tin, không hứa "Nhắc tôi": nút dẫn tới nơi không có gì để nhắc là lạc.
 */
function NextSlotLine({ slot, onOpen }: { slot: NextFlashSlot; onOpen?: () => void }) {
  const label = (
    <Text variant="body-sm" tone="secondary">
      {fillCopy('flash.nextSlot', { time: slotClock(slot.startAt), n: slot.count })}
    </Text>
  );
  const frame: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    boxSizing: 'border-box',
    width: 'calc(100% - 32px)',
    minHeight: 44,
    margin: '0 16px',
    padding: 0,
  };
  if (!onOpen) return <div data-testid="flash-next-slot" style={frame}>{label}</div>;
  return (
    <button
      type="button"
      data-testid="flash-next-slot"
      className="tubu-press"
      onClick={() => {
        haptic('light');
        onOpen();
      }}
      style={{ ...frame, border: 'none', background: 'transparent', fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer' }}
    >
      {label}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, color: 'var(--color-text-brand)', fontSize: 'var(--type-label-size)', fontWeight: 600, flex: '0 0 auto' }}>
        {fillCopy('flash.remind')}
        <Icon icon={ChevronRight} size="sm" tone="current" />
      </span>
    </button>
  );
}

/** Thẻ Giờ vàng đang chạy: thẻ `flash` chung, thanh "đã bán" có chữ ở cuối (luôn có, kể cả chưa bán suất nào: "Vừa mở bán"). */
export function ActiveFlashCard({ item, reserveVariation }: { item: FlashSaleActiveItem; reserveVariation: boolean }) {
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
      href={`/product/${encodeURIComponent(item.productSlug)}`}
      // Đã tới giờ mở bán mà danh sách chưa tải lại: không còn gì để nhắc, chạm thẻ là vào xem.
      note={startsIn ? fillCopy('flash.startsInTile', { t: startsIn }) : vi.flashSale.live}
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
