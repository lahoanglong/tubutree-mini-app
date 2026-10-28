import { Skeleton } from '@/components/ui/skeleton';

/** Khung chờ đúng hình trang CTV: thẻ hoa hồng, bốn lối tắt, hai ô số liệu. */
export function CtvDashboardSkeleton() {
  return (
    <div data-testid="ctv-skeleton" role="status" aria-busy="true" className="flex flex-col gap-3">
      <span className="sr-only">Đang tải…</span>
      <Skeleton height={160} rounded="rounded-card" />
      <div className="grid grid-cols-4 gap-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} height={98} rounded="rounded-card" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[0, 1].map((i) => (
          <Skeleton key={i} height={98} rounded="rounded-card" />
        ))}
      </div>
    </div>
  );
}
