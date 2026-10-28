'use client';

import { usePathname } from 'next/navigation';
import { LineItemSkeleton, ProductGridSkeleton, Skeleton } from '@/components/ui/skeleton';

export type SkeletonKind = 'hub' | 'balance' | 'form' | 'list';

/** Đường dẫn đứng trước → khung chờ; khớp theo tiền tố dài nhất. Đường dẫn không có trong bảng dùng khung danh sách. */
const KIND_BY_PREFIX: [string, SkeletonKind][] = [
  ['/tai-khoan/diem-xanh', 'balance'],
  ['/tai-khoan/vi-tubu', 'balance'],
  ['/tai-khoan/ho-so', 'form'],
  ['/tai-khoan/cai-dat', 'form'],
  ['/tai-khoan/dia-chi', 'list'],
  ['/tai-khoan/don-hang', 'list'],
  ['/tai-khoan/thong-bao', 'list'],
  ['/tai-khoan/yeu-thich', 'list'],
  ['/tai-khoan', 'hub'],
  ['/thanh-toan', 'form'],
  ['/gio-hang', 'list'],
  ['/uu-dai', 'balance'],
  ['/vuon-xanh', 'balance'],
  ['/kho-qua', 'balance'],
  ['/dai-ly', 'balance'],
  ['/hoan-tien', 'form'],
];

export function skeletonKindFor(pathname: string | null | undefined): SkeletonKind {
  if (!pathname) return 'list';
  const hit = KIND_BY_PREFIX.filter(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`)).sort(
    (a, b) => b[0].length - a[0].length,
  )[0];
  return hit ? hit[1] : 'list';
}

function Body({ kind }: { kind: SkeletonKind }) {
  switch (kind) {
    case 'hub':
      return (
        <>
          <div className="flex items-center gap-3 rounded-card bg-stone-0 p-4 shadow-card">
            <Skeleton width={56} height={56} rounded="rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton width="55%" height={16} />
              <Skeleton width="35%" height={12} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Skeleton height={72} rounded="rounded-card" />
            <Skeleton height={72} rounded="rounded-card" />
          </div>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={52} rounded="rounded-card" />
          ))}
        </>
      );
    case 'balance':
      return (
        <>
          <Skeleton height={140} rounded="rounded-card" />
          <LineItemSkeleton />
          <LineItemSkeleton />
          <LineItemSkeleton />
        </>
      );
    case 'form':
      return (
        <>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton width={96} height={12} />
              <Skeleton height={44} />
            </div>
          ))}
          <Skeleton height={48} rounded="rounded-control" />
        </>
      );
    default:
      return (
        <>
          <LineItemSkeleton />
          <LineItemSkeleton />
          <LineItemSkeleton />
        </>
      );
  }
}

/**
 * Khung chờ theo hình màn thật, dùng cho phiên đang khôi phục (AuthLoading) và loading.tsx của từng nhóm trang: nội dung hiện ra
 * không đổi bố cục. Chiều cao tối thiểu đủ cao để chân trang nằm dưới màn hình trong lúc chờ, không bị đẩy xuống khi nội dung về.
 */
export function RouteSkeleton({ kind }: { kind?: SkeletonKind }) {
  const pathname = usePathname();
  const resolved = kind ?? skeletonKindFor(pathname);
  return (
    <div role="status" aria-busy="true" className="flex min-h-[80vh] flex-col gap-3 py-4">
      <span className="sr-only">Đang tải…</span>
      <Skeleton width="45%" height={24} />
      <Body kind={resolved} />
    </div>
  );
}
