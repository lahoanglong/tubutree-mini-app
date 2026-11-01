import { CATEGORY_GRID_MAX_CELLS, categoriesBlockHeight, HOME_SETTLING_HEIGHTS as H } from '@tubutree/app-core/home-layout';
import { Skeleton } from '@/components/mini';

/**
 * Khung chờ chung cho mọi khối dưới thẻ thành viên: banner (chỉ khi lần mở trước có; từ lg ẩn vì banner thật nằm cạnh thẻ thành viên chứ không dưới nó), một hàng lối tắt (ẩn từ lg như `ShortcutGrid`, nếu không khi khối thật về, mọi khối dưới nhảy lên ~100px ở máy tính),
 * một khối ngang cỡ Giờ vàng, danh mục (số ô theo lần tải trước: một hàng khi ≤5 ô, hai hàng từ 6 ô), rồi hai hàng thẻ hàng.
 */
export function HomeSettlingSkeleton({ categoryCells = CATEGORY_GRID_MAX_CELLS, banner = false }: { categoryCells?: number; banner?: boolean }) {
  return (
    <div data-testid="home-settling" aria-hidden="true" className="flex flex-col gap-4">
      {banner && (
        <div className="lg:hidden">
          <Skeleton height="auto" radius="var(--radius-media)" style={{ aspectRatio: 'var(--banner-ratio)' }} />
        </div>
      )}
      <div className="lg:hidden">
        <Skeleton height={H.shortcuts} radius="var(--radius-card)" />
      </div>
      <Skeleton height={H.flash} radius="var(--radius-card)" />
      <Skeleton height={categoriesBlockHeight(categoryCells)} radius="var(--radius-card)" />
      <Skeleton height={H.products} radius="var(--radius-card)" />
    </div>
  );
}
