import { HOME_SETTLING_HEIGHTS as H } from '@tubutree/app-core/home-layout';
import { Skeleton } from '@/components/mini';

/** Khung chờ chung cho mọi khối dưới thẻ thành viên: một hàng lối tắt, một khối ngang cỡ Giờ vàng, một hàng danh mục, rồi hai hàng thẻ hàng. */
export function HomeSettlingSkeleton() {
  return (
    <div data-testid="home-settling" aria-hidden="true" className="flex flex-col gap-4">
      <Skeleton height={H.shortcuts} radius="var(--radius-card)" />
      <Skeleton height={H.flash} radius="var(--radius-card)" />
      <Skeleton height={H.categories} radius="var(--radius-card)" />
      <Skeleton height={H.products} radius="var(--radius-card)" />
    </div>
  );
}
