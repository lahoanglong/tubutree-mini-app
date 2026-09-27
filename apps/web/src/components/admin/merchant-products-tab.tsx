'use client';

import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listPendingMerchantProducts,
  reviewMerchantProduct,
  mergeQueuePages,
  nextPageParam,
  ADMIN_QUEUE_PAGE_SIZE,
  type AdminPendingProduct,
} from '@/lib/admin-client';
import { formatVnd } from '@/lib/shop-client';

/**
 * "Duyệt SP đối tác" — P0 A6-07 (docs/audit-2026-09/06-web.md): API `/admin/merchant-products/pending`
 * trả `{data, meta}` (paginated(), admin.service.ts) nhưng bản cũ khai kiểu mảng trần rồi gọi `.map`
 * thẳng lên response → TypeError, cả trang admin rơi vào app/error.tsx; tiêu đề luôn hiện "(0)".
 *
 * Tách riêng thành file này (như dealer-claims-tab.tsx/pos-screen.tsx) để test được độc lập, và sửa
 * ĐÚNG theo pattern đã dùng cho tab Đại lý/Đổi-Trả trong admin/page.tsx: `listPendingMerchantProducts`
 * giờ trả `Page<T>` thật (asPage() ở admin-client.ts) + useInfiniteQuery + mergeQueuePages + "Tải thêm".
 * Endpoint này không nhận tham số `order` (PaginationQuery thường, khác DealerAppsQuery/
 * ReturnRequestsQuery) nên không dùng "cũ nhất lên đầu" — chỉ mergeQueuePages(pages, false).
 */
export function MerchantProductsTab() {
  const q = useInfiniteQuery({
    queryKey: ['admin-merchant-products-pending'],
    queryFn: ({ pageParam }) => listPendingMerchantProducts(pageParam, ADMIN_QUEUE_PAGE_SIZE),
    initialPageParam: 1,
    getNextPageParam: (last) => nextPageParam(last.meta),
  });
  const view = mergeQueuePages(q.data?.pages, false);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-neutral-900">
          Sản phẩm đối tác gửi duyệt ({q.data ? view.total : 0})
        </h2>
        <button
          onClick={() => void q.refetch()}
          className="rounded border border-neutral-200 bg-white px-3 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-50"
        >
          Làm mới
        </button>
      </div>
      <div className="mt-4 space-y-4">
        {q.isLoading && <p className="text-sm text-neutral-500">Đang tải danh sách...</p>}
        {q.isError && <p className="text-sm text-red-600">Không tải được danh sách sản phẩm đối tác.</p>}
        {q.data && view.items.length === 0 && (
          <p className="rounded-lg border border-neutral-100 bg-white p-6 text-center text-sm text-neutral-500">
            Không có sản phẩm đối tác nào đang chờ duyệt.
          </p>
        )}
        {view.items.map((p) => (
          <MerchantProductRow key={p.id} item={p} />
        ))}
      </div>
      {view.hasMore && (
        <div className="mt-3 text-center">
          <button
            type="button"
            onClick={() => void q.fetchNextPage()}
            disabled={q.isFetchingNextPage}
            className="rounded border border-neutral-300 bg-white px-4 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          >
            {q.isFetchingNextPage ? 'Đang tải…' : 'Tải thêm'}
          </button>
          {q.isFetchNextPageError && <p className="mt-1 text-xs text-red-600">Không tải thêm được, thử lại.</p>}
        </div>
      )}
    </div>
  );
}

export function MerchantProductRow({ item: p }: { item: AdminPendingProduct }) {
  const qc = useQueryClient();
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);

  const reviewMut = useMutation({
    mutationFn: ({ approve, reason }: { approve: boolean; reason?: string }) =>
      reviewMerchantProduct(p.id, approve, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-merchant-products-pending'] });
    },
  });

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex gap-3">
          {p.thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.thumbnail} alt={p.name} className="h-20 w-20 rounded-lg object-cover border" />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-lg bg-leaf-50 text-2xl">
              🌿
            </div>
          )}
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-neutral-900">{p.name}</h3>
              <span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                Chờ duyệt
              </span>
            </div>
            <p className="text-xs text-neutral-500">Slug: /{p.slug} · Thương hiệu: {p.brand || 'Riêng'} · Danh mục: {p.category}</p>
            {p.storefront && (
              <p className="mt-1 text-xs font-medium text-emerald-700">
                Gian hàng: {p.storefront.title} {p.storefront.subdomain ? `(${p.storefront.subdomain}.tubutree.com)` : ''}
              </p>
            )}
            <div className="mt-1 flex items-center gap-3 text-xs">
              <span className="font-bold text-neutral-900">{formatVnd(p.salePrice ?? p.basePrice)}</span>
              {p.salePrice && <span className="text-neutral-400 line-through">{formatVnd(p.basePrice)}</span>}
              {p.variations && p.variations.length > 0 && (
                <span className="text-neutral-500">Tồn kho: {p.variations[0]?.stock ?? 0} sp</span>
              )}
            </div>
          </div>
        </div>

        {/* Hành động duyệt / từ chối */}
        <div className="flex flex-col gap-2">
          <button
            onClick={() => reviewMut.mutate({ approve: true })}
            disabled={reviewMut.isPending}
            className="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
          >
            {reviewMut.isPending ? 'Đang xử lý...' : '✓ Duyệt xuất bản'}
          </button>
          {!showRejectInput ? (
            <button
              onClick={() => setShowRejectInput(true)}
              className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
            >
              ✕ Từ chối
            </button>
          ) : (
            <div className="flex flex-col gap-1.5 pt-1">
              <input
                type="text"
                placeholder="Lý do từ chối..."
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="w-48 rounded border border-neutral-300 px-2 py-1 text-xs"
              />
              <div className="flex gap-1.5">
                <button
                  onClick={() => reviewMut.mutate({ approve: false, reason: rejectReason.trim() || undefined })}
                  disabled={reviewMut.isPending}
                  className="rounded bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                >
                  Xác nhận từ chối
                </button>
                <button
                  onClick={() => setShowRejectInput(false)}
                  className="rounded border border-neutral-200 px-2 py-1 text-xs text-neutral-500"
                >
                  Huỷ
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Chi tiết chứng nhận & thành phần xanh */}
      {(p.ingredients || (p.certifications && p.certifications.length > 0) || (p.ecoBadges && p.ecoBadges.length > 0) || p.description) && (
        <div className="mt-3 border-t border-neutral-100 pt-2 text-xs text-neutral-600">
          {p.ingredients && (
            <p><strong className="text-neutral-700">Thành phần:</strong> {p.ingredients}</p>
          )}
          {p.certifications && p.certifications.length > 0 && (
            <p className="mt-1"><strong className="text-neutral-700">Chứng nhận:</strong> {p.certifications.join(', ')}</p>
          )}
          {p.ecoBadges && p.ecoBadges.length > 0 && (
            <p className="mt-1"><strong className="text-neutral-700">Tiêu chí xanh:</strong> {p.ecoBadges.join(', ')}</p>
          )}
          {p.description && (
            <p className="mt-1 line-clamp-2 text-neutral-500"><strong className="text-neutral-700">Mô tả:</strong> {p.description}</p>
          )}
        </div>
      )}
      {reviewMut.isError && (
        <p className="mt-2 text-xs text-red-600">{(reviewMut.error as Error).message}</p>
      )}
    </div>
  );
}
