import { Suspense } from 'react';
import { RecycleNew } from '@/components/recycle/recycle-new';
import { LineItemSkeleton, Skeleton } from '@/components/ui/skeleton';

// RecycleNew đọc useSearchParams nên cần Suspense; fallback là khung chờ có chữ đọc để trang không trắng trơn lúc tải.
function RecycleNewFallback() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-3 px-4 py-4">
      <span className="sr-only">Đang tải…</span>
      <Skeleton width="50%" height={24} />
      <LineItemSkeleton />
      <LineItemSkeleton />
      <LineItemSkeleton />
    </div>
  );
}

export default function RecycleNewPage() {
  return (
    <Suspense fallback={<RecycleNewFallback />}>
      <RecycleNew />
    </Suspense>
  );
}
