import { CATEGORY_GRID_MAX_CELLS, categoriesBlockHeight, HOME_SETTLING_HEIGHTS as H } from '@tubutree/app-core/home-layout';
import { Skeleton } from '@/components/mini';

/**
 * Khung chờ chung cho mọi khối dưới thẻ thành viên: banner (prop `banner`, cho nơi không có `HubLayout`; Trang chủ không truyền vì khung giữ chỗ banner đứng ở slot banner của HubLayout, cột 8 từ lg),
 * Bento Hub hệ sinh thái + lối tắt nhanh (hiện ở mọi khổ màn hình như `ShortcutGrid`), dải Story, một khối ngang cỡ Giờ vàng, danh mục (luôn một hàng 5 ô), rồi hai hàng thẻ hàng.
 */
export function HomeSettlingSkeleton({ categoryCells = CATEGORY_GRID_MAX_CELLS, banner = false }: { categoryCells?: number; banner?: boolean }) {
  return (
    <div data-testid="home-settling" aria-hidden="true" className="flex flex-col gap-4">
      {banner && (
        <div className="lg:hidden">
          <Skeleton height="auto" radius="var(--radius-media)" style={{ aspectRatio: 'var(--banner-ratio)' }} />
        </div>
      )}
      <Skeleton height={H.shortcuts} radius="var(--radius-card)" />
      <Skeleton height={H.stories} radius="var(--radius-card)" />
      <Skeleton height={H.flash} radius="var(--radius-card)" />
      <Skeleton height={categoriesBlockHeight(Math.min(categoryCells, CATEGORY_GRID_MAX_CELLS))} radius="var(--radius-card)" />
      <Skeleton height={H.products} radius="var(--radius-card)" />
    </div>
  );
}
