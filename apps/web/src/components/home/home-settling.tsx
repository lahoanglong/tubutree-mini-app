import { CATEGORY_GRID_MAX_CELLS, categoriesBlockHeight, HOME_SETTLING_HEIGHTS as H } from '@tubutree/app-core/home-layout';
import { Skeleton } from '@/components/mini';

/**
 * Khung chờ chung cho mọi khối dưới dải ngữ cảnh, đúng thứ tự khối thật: danh mục (luôn một hàng 5 ô), kệ Bán chạy nhất, Bento Hub hệ sinh thái + lối tắt nhanh
 * (hiện ở mọi khổ màn hình như `ShortcutGrid`), rồi dải Story. Banner và Giờ vàng nằm dưới kệ đầu trong ô khuyến mãi (tự ẩn khi không có gì) nên khung chờ không giữ chỗ cho chúng.
 */
export function HomeSettlingSkeleton({ categoryCells = CATEGORY_GRID_MAX_CELLS }: { categoryCells?: number }) {
  return (
    <div data-testid="home-settling" aria-hidden="true" className="flex flex-col gap-4">
      <Skeleton height={categoriesBlockHeight(Math.min(categoryCells, CATEGORY_GRID_MAX_CELLS))} radius="var(--radius-card)" />
      <Skeleton height={H.products} radius="var(--radius-card)" />
      <Skeleton height={H.shortcuts} radius="var(--radius-card)" />
      <Skeleton height={H.stories} radius="var(--radius-card)" />
    </div>
  );
}
