import { RouteSkeleton } from '@/components/skeletons/route-skeleton';
import { PAGE_WIDE } from '@/lib/page-frame';

export default function Loading() {
  return (
    <main className={PAGE_WIDE}>
      <RouteSkeleton />
    </main>
  );
}
