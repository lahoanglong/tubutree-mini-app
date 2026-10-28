import { FLASH_SKELETON_HEIGHT } from '@tubutree/app-core/home-layout';
import { Skeleton } from '@/components/mini';

/** Khung chờ chung cho mọi khối dưới thẻ thành viên: một hàng lối tắt, một khối ngang cỡ Giờ vàng, một hàng danh mục, rồi hai hàng thẻ hàng. */
export function HomeSettlingSkeleton() {
  return (
    <div data-testid="home-settling" aria-hidden="true" className="flex flex-col gap-4">
      <Skeleton height={96} radius="var(--radius-card)" />
      <Skeleton height={FLASH_SKELETON_HEIGHT - 16} radius="var(--radius-card)" />
      <Skeleton height={138} radius="var(--radius-card)" />
      <Skeleton height={260} radius="var(--radius-card)" />
    </div>
  );
}
