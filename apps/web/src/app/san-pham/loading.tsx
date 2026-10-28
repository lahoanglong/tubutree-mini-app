import { CatalogSkeleton } from '@/components/skeletons/route-skeleton';
import { PAGE_WIDE } from '@/lib/page-frame';

export default function Loading() {
  return (
    <main className={`${PAGE_WIDE} py-6 max-md:pb-0 max-md:pt-3 md:py-8`}>
      <CatalogSkeleton />
    </main>
  );
}
