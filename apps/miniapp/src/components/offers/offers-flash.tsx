import { useId, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { readFlashHint } from '@tubutree/app-core/home-layout';
import { seeAllHref } from '@tubutree/app-core/merch/home-shelves';
import { shelf } from '@tubutree/app-core/merch/shelves';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { fetchActiveFlashSales } from '../../services/shop-api';
import { serverNow } from '../../utils/server-clock';
import { browserStorage } from '../../utils/recently-viewed';
import { ActiveFlashCard, FlashSkeleton } from '../flash-sale';
import { Countdown } from '../ui/countdown';
import { RailCell, RailShell } from '../ui/product-rail';
import { SectionHeader } from '../ui/section-header';

const FLASH_SHELF = shelf('offers.flash');
// Hàng chữ "Kết thúc sau …" dưới tiêu đề: đồng hồ HH:MM:SS chỉ ở đầu khối Giờ vàng Trang chủ và trang Giờ vàng (Q3), ở Ưu đãi là chữ theo phút. Khung chờ cộng đúng chiều cao này.
const FLASH_TEXT_ROW_H = 24;

/**
 * Giờ vàng hôm nay ở Ưu đãi (Q10): cùng thẻ như Trang chủ, ít thẻ hơn (`offers.flash` tối đa 4), đồng hồ dạng chữ (Q3). Đọc cache `['flash-sales','active']`
 * mà Trang chủ đã nạp. Không có suất còn giờ, hoặc tải lỗi, thì ẩn khối: đây là phần thêm của trang, Trang chủ mới là nơi báo lỗi Giờ vàng.
 * Lần mở trước có Giờ vàng thì lúc tải giữ chỗ bằng khung chờ của Trang chủ.
 */
export function OffersFlash() {
  const titleId = useId();
  const q = useQuery({ queryKey: ['flash-sales', 'active'], queryFn: fetchActiveFlashSales, staleTime: 30_000 });
  const [expiredTick, setExpiredTick] = useState(0);
  const [hinted] = useState(() => readFlashHint(browserStorage()));

  const live = useMemo(() => {
    const now = serverNow();
    const seen = new Set<string>();
    // Một sản phẩm có hai phân loại cùng Giờ vàng chỉ một thẻ (như kệ Trang chủ).
    return (q.data ?? [])
      .filter((it) => Date.parse(it.endAt) > now && !seen.has(it.productSlug) && seen.add(it.productSlug))
      .slice(0, FLASH_SHELF.maxItems);
  }, [q.data, expiredTick]);
  const soonestEndAt = useMemo(() => live.reduce<string | null>((a, it) => (a === null || Date.parse(it.endAt) < Date.parse(a) ? it.endAt : a), null), [live]);

  if (q.isLoading) {
    return hinted ? (
      <div style={{ paddingTop: 12, paddingBottom: FLASH_TEXT_ROW_H }}>
        <FlashSkeleton withNextSlot={false} />
      </div>
    ) : null;
  }
  if (live.length < FLASH_SHELF.minItems || soonestEndAt === null) return null;

  const title = fillCopy('flash.todayTitle');
  // Giờ vàng là ngoại lệ của mẫu "Tất cả (n)": trang đích chia theo khung giờ (hôm nay, ngày mai, mỗi khung một danh sách) và các khung lần lượt hết giờ, nên không có một con số n đúng để hứa trước; nút giữ "Xem tất cả".
  const seeAll = seeAllHref('offers.flash');
  return (
    <section aria-labelledby={titleId} style={{ paddingTop: 12 }}>
      <div style={{ padding: '0 16px' }}>
        <SectionHeader
          id={titleId}
          title={title}
          icon="zap"
          tone="promo"
          action={seeAll ? { to: seeAll } : undefined}
        />
        <div style={{ display: 'flex', alignItems: 'center', minHeight: FLASH_TEXT_ROW_H }}>
          <Countdown endAt={soonestEndAt} mode="text" onEnd={() => setExpiredTick((n) => n + 1)} />
        </div>
      </div>
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
