import { ProductDetailSkeleton } from '@/components/skeletons/route-skeleton';
import { PAGE_WIDE } from '@/lib/page-frame';

export default function Loading() {
  return (
    <main data-page-bleed className={`${PAGE_WIDE} py-6 max-md:px-0 max-md:py-0`}>
      <ProductDetailSkeleton />
    </main>
  );
}
