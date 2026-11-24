import { SECTION_HEADER_HEIGHT } from '@tubutree/app-core/home-layout';
import { Skeleton } from '../ui/skeleton';

/**
 * Khung chờ kệ Mua lại ở Trang chủ, cao đúng `height` (`purchasedSkeletonHeight`). Dùng chung cho kệ lúc dữ liệu chưa về và cho chỗ giữ của khối lúc chunk
 * `home-below` (nơi kệ nằm) chưa về, để hai khung trông như một và trang không nhảy khi kệ thật thế chỗ.
 */
export function PurchasedRailSkeleton({ height }: { height: number }) {
  return (
    <div data-testid="purchased-rail-loading" aria-hidden="true" style={{ height }}>
      <div style={{ height: SECTION_HEADER_HEIGHT, display: 'flex', alignItems: 'center', padding: '0 var(--space-inset-page)', boxSizing: 'border-box' }}>
        <Skeleton width={96} height={20} />
      </div>
      <div style={{ padding: '0 var(--space-inset-page)' }}>
        <Skeleton height={height - SECTION_HEADER_HEIGHT} radius="var(--radius-card)" />
      </div>
    </div>
  );
}
