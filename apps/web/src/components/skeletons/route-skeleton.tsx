'use client';

import { usePathname } from 'next/navigation';
import { LineItemSkeleton, ProductGridSkeleton, Skeleton } from '@/components/ui/skeleton';

export type SkeletonKind = 'hub' | 'balance' | 'form' | 'list' | 'loyalty' | 'game';

/** Đường dẫn đứng trước → khung chờ; khớp theo tiền tố dài nhất. Đường dẫn không có trong bảng dùng khung danh sách. */
const KIND_BY_PREFIX: [string, SkeletonKind][] = [
  ['/tai-khoan/diem-xanh', 'loyalty'],
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
  ['/vuon-xanh', 'game'],
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
    case 'loyalty':
      return (
        <>
          <Skeleton height={180} />
          <Skeleton height={80} />
        </>
      );
    case 'game':
      return (
        <>
          <Skeleton height={160} rounded="rounded-card" />
          <Skeleton height={44} />
          <Skeleton height={56} rounded="rounded-card" />
          <Skeleton height={140} rounded="rounded-card" />
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
export function RouteSkeleton({ kind, standalone = false }: { kind?: SkeletonKind; standalone?: boolean }) {
  const pathname = usePathname();
  const resolved = kind ?? skeletonKindFor(pathname);
  // Điểm Xanh và Vườn Xanh dựng trong khung trang (đã có PageHeader), nên khối chờ dạng khối như Mini, không có thanh tiêu đề.
  // `standalone` (loading.tsx, chưa có PageHeader) vẽ một dải cỡ PageHeader (đệm 12/16 + safe-top, một dòng title-lg, nền surface)
  // rồi cách mt-4, để lúc trang về khối không nhảy lên và dải trắng không hiện thêm.
  const blockKind = resolved === 'loyalty' || resolved === 'game';
  const block = !standalone && blockKind;
  if (standalone && blockKind) {
    return (
      <div role="status" aria-busy="true" className="flex min-h-[80vh] flex-col md:gap-3 md:py-4">
        <span className="sr-only">Đang tải…</span>
        <div
          data-page-bleed=""
          aria-hidden="true"
          className="max-md:mx-[calc(50%-50vw)] max-md:bg-[var(--color-bg-surface)] max-md:px-4 max-md:pb-3 max-md:pt-[calc(12px+var(--safe-top))] md:hidden"
        >
          <div style={{ height: 'var(--type-title-lg-lh)' }} />
        </div>
        <div className="max-md:hidden">
          <Skeleton width="45%" height={24} />
        </div>
        <div className="mt-4 flex flex-col gap-3 md:mt-0">
          <Body kind={resolved} />
        </div>
      </div>
    );
  }
  return (
    <div role="status" aria-busy="true" className={`flex min-h-[80vh] flex-col gap-3 ${block ? '' : 'py-4'}`}>
      <span className="sr-only">Đang tải…</span>
      {!block && <Skeleton width="45%" height={24} />}
      <Body kind={resolved} />
    </div>
  );
}

/** Khung chờ chi tiết sản phẩm: ảnh vuông, tên, giá và nút mua; hiện ngay lúc bấm thẻ sản phẩm (xem PdpNavSkeleton). */
export function ProductDetailSkeleton() {
  return (
    <div role="status" aria-busy="true" className="md:grid md:grid-cols-2 md:gap-8">
      <span className="sr-only">Đang tải…</span>
      <Skeleton height="auto" rounded="rounded-none" style={{ aspectRatio: '1 / 1' }} />
      <div className="flex flex-col gap-3 bg-stone-0 p-4 md:bg-transparent md:p-0">
        <div className="flex items-center max-md:h-11">
          <Skeleton width={80} height={14} />
        </div>
        <Skeleton width="85%" height={22} />
        <Skeleton width={140} height={26} />
        <Skeleton width="60%" height={14} />
        <Skeleton height={48} rounded="rounded-control" />
      </div>
    </div>
  );
}
