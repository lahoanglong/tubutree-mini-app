import { Skeleton } from '@/components/ui/skeleton';

/** Cùng khung với trang thật để lúc chuyển sang nội dung chính không bị nhảy; cũng là HTML dựng sẵn đầu tiên của /dang-nhap. */
export function LoginSkeleton() {
  return (
    <main aria-busy="true" className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-6 py-10 text-center">
      <Skeleton width={160} height={58} />
      <Skeleton width={120} height={28} style={{ marginTop: 20 }} />
      <Skeleton width="85%" height={16} style={{ marginTop: 12 }} />
      <Skeleton width="65%" height={16} style={{ marginTop: 8 }} />
      <Skeleton height={44} rounded="rounded-control" style={{ marginTop: 32 }} />
    </main>
  );
}
