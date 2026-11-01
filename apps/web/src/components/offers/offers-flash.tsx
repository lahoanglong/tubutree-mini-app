'use client';

// Nguồn: apps/miniapp/src/components/offers/offers-flash.tsx
import { useId, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { readFlashHint } from '@tubutree/app-core/home-layout';
import { seeAllHref } from '@tubutree/app-core/merch/home-shelves';
import { shelf } from '@tubutree/app-core/merch/shelves';
import { flashActiveQuery } from '@tubutree/app-core/queries/flash-sale';
import { serverNow } from '@tubutree/app-core/server-clock';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { ActiveFlashCard, FlashSkeleton } from '@/components/home/flash-sale';
import { SectionHeader } from '@/components/mini';
import { Countdown } from '@/components/mini/countdown';
import { RailCell, RailShell } from '@/components/mini/product-rail';
import { coreHttp } from '@/lib/core-http';
import { browserStorage } from '@/lib/recently-viewed';
import { loadActiveFlashSales } from '@/lib/use-flash-sales';

const FLASH_SHELF = shelf('offers.flash');

/**
 * Giờ vàng hôm nay ở Ưu đãi (Q10): cùng thẻ và một đồng hồ như Trang chủ, ít thẻ hơn (`offers.flash` tối đa 4). Cùng khoá và cùng hàm tải với khối
 * Trang chủ nên `/flash-sales/active` chỉ bị gọi một lần. Không có suất còn giờ, hoặc tải lỗi, thì ẩn khối: đây là phần thêm của trang, Trang chủ mới là
 * nơi báo lỗi Giờ vàng. Lần mở trước có Giờ vàng thì lúc tải giữ chỗ bằng khung chờ của Trang chủ.
 */
export function OffersFlash() {
  const titleId = useId();
  const q = useQuery({ ...flashActiveQuery(coreHttp), queryFn: loadActiveFlashSales, staleTime: 30_000 });
  const [expiredTick, setExpiredTick] = useState(0);
  // Trang Ưu đãi chỉ dựng ở máy khách (useSearchParams bắt Suspense), nên đọc kho ngay lúc dựng không lệch với HTML server.
  const [hinted] = useState(() => readFlashHint(browserStorage()));

  const live = useMemo(() => {
    const now = serverNow();
    const seen = new Set<string>();
    // Một sản phẩm có hai phân loại cùng Giờ vàng chỉ một thẻ (như kệ Trang chủ).
    return (q.data ?? [])
      .filter((it) => Date.parse(it.endAt) > now && !seen.has(it.productSlug) && seen.add(it.productSlug))
      .slice(0, FLASH_SHELF.maxItems);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data, expiredTick]);
  const soonestEndAt = useMemo(() => live.reduce<string | null>((a, it) => (a === null || Date.parse(it.endAt) < Date.parse(a) ? it.endAt : a), null), [live]);

  if (q.isLoading) return hinted ? <FlashSkeleton withNextSlot={false} /> : null;
  if (live.length < FLASH_SHELF.minItems || soonestEndAt === null) return null;

  const title = fillCopy('flash.title');
  const seeAll = seeAllHref('offers.flash', 'web');
  return (
    <section aria-labelledby={titleId}>
      <SectionHeader
        id={titleId}
        title={title}
        icon="zap"
        tone="promo"
        trailing={<Countdown endAt={soonestEndAt} mode="clock" onEnd={() => setExpiredTick((n) => n + 1)} />}
        action={seeAll ? { to: seeAll } : undefined}
      />
      <RailShell label={`${title}, vuốt ngang để xem thêm`}>
        {live.map((item) => (
          <RailCell key={item.itemId} variant="flash">
            <ActiveFlashCard item={item} reserveVariation={live.some((it) => Boolean(it.variationName))} />
          </RailCell>
        ))}
      </RailShell>
    </section>
  );
}
