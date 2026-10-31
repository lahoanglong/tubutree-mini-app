import { CATEGORY_GRID_MAX_CELLS, categoriesBlockHeight, HOME_SETTLING_HEIGHTS as H } from '@tubutree/app-core/home-layout';
import { Skeleton } from '@/components/mini';

/** Khung chờ chung cho mọi khối dưới thẻ thành viên: một hàng lối tắt, một khối ngang cỡ Giờ vàng, danh mục (số ô theo lần tải trước: một hàng khi ≤5 ô, hai hàng từ 6 ô), rồi hai hàng thẻ hàng. */
export function HomeSettlingSkeleton({ categoryCells = CATEGORY_GRID_MAX_CELLS }: { categoryCells?: number }) {
  return (
    <div data-testid="home-settling" aria-hidden="true" className="flex flex-col gap-4">
      <Skeleton height={H.shortcuts} radius="var(--radius-card)" />
      <Skeleton height={H.flash} radius="var(--radius-card)" />
      <Skeleton height={categoriesBlockHeight(categoryCells)} radius="var(--radius-card)" />
      <Skeleton height={H.products} radius="var(--radius-card)" />
    </div>
  );
}
