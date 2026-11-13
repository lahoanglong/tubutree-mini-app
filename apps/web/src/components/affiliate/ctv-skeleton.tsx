import { Skeleton } from '@/components/ui/skeleton';

/**
 * Khung chờ đúng hình trang CTV: thẻ hoa hồng, bốn lối tắt, hai ô số liệu. Cùng trục và cùng lưới với bảng điều khiển thật (`md:max-w-2xl` bám mép trái,
 * từ lg hai cột 24rem + phần còn lại) nên trang không nhảy khi dữ liệu về.
 */
export function CtvDashboardSkeleton() {
  return (
    <div
      data-testid="ctv-skeleton"
      role="status"
      aria-busy="true"
      className="flex flex-col gap-3 md:max-w-2xl lg:grid lg:max-w-none lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:items-start lg:gap-x-6"
    >
      <span className="sr-only">Đang tải…</span>
      <div className="flex flex-col gap-3 lg:col-start-1">
        <Skeleton height={160} rounded="rounded-card" />
        <div className="grid grid-cols-4 gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={98} rounded="rounded-card" />
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:col-start-2">
        {[0, 1].map((i) => (
          <Skeleton key={i} height={98} rounded="rounded-card" />
        ))}
      </div>
    </div>
  );
}
