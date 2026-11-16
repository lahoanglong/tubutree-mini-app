import { CATEGORY_GRID_MAX_CELLS, categoriesBlockHeight, HOME_SETTLING_HEIGHTS as H } from '@tubutree/app-core/home-layout';
import { Skeleton } from '../ui/skeleton';

/** Khung chờ chung cho mọi khối dưới dải ngữ cảnh, đúng thứ tự khối thật: danh mục (luôn một hàng 5 ô, như khối thật), kệ Bán chạy nhất, lối vào, rồi dải Story. Ô khuyến mãi tự ẩn khi không có gì nên không giữ chỗ ở đây. */
export function HomeSettlingSkeleton({ categoryCells = CATEGORY_GRID_MAX_CELLS }: { categoryCells?: number }) {
  return (
    <div data-testid="home-settling" aria-hidden="true" style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Skeleton height={categoriesBlockHeight(Math.min(categoryCells, CATEGORY_GRID_MAX_CELLS))} radius="var(--radius-card)" />
      <Skeleton height={H.products} radius="var(--radius-card)" />
      <Skeleton height={H.shortcuts} radius="var(--radius-card)" />
      <Skeleton height={H.stories} radius="var(--radius-card)" />
    </div>
  );
}
