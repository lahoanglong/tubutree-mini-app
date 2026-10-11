'use client';

import { useState } from 'react';
import { Check, Leaf, X } from 'lucide-react';
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
import { BTN_SECONDARY, BTN_XS_DANGER, BTN_XS_SECONDARY, FIELD_XS, TOUCH_H, ToneBadge } from './ui';

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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-stone-900">
          Sản phẩm đối tác gửi duyệt ({q.data ? view.total : 0})
        </h2>
        <button
          onClick={() => void q.refetch()}
          className={BTN_XS_SECONDARY}
        >
          Làm mới
        </button>
      </div>
      <div className="mt-4 space-y-4">
        {q.isLoading && <p className="text-sm text-stone-500">Đang tải danh sách...</p>}
        {q.isError && <p className="text-sm text-danger-fg">Không tải được danh sách sản phẩm đối tác.</p>}
        {q.data && view.items.length === 0 && (
          <p className="rounded-card border border-stone-200 bg-stone-0 p-6 text-center text-sm text-stone-500">
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
            className={BTN_SECONDARY}
          >
            {q.isFetchingNextPage ? 'Đang tải…' : 'Tải thêm'}
          </button>
          {q.isFetchNextPageError && <p className="mt-1 text-xs text-danger-fg">Không tải thêm được, thử lại.</p>}
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
    <div className="rounded-card border border-stone-200 bg-stone-0 p-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex gap-3">
          {p.thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.thumbnail} alt={p.name} className="h-20 w-20 rounded-control border border-stone-200 object-cover" />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-control bg-forest-50 text-forest-600">
              <Leaf className="h-8 w-8" aria-hidden />
            </div>
          )}
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-stone-900">{p.name}</h3>
              <ToneBadge tone="warning">Chờ duyệt</ToneBadge>
            </div>
            <p className="text-xs text-stone-500">Slug: /{p.slug} · Thương hiệu: {p.brand || 'Riêng'} · Danh mục: {p.category}</p>
            {p.storefront && (
              <p className="mt-1 text-xs font-medium text-forest-700">
                Gian hàng: {p.storefront.title} {p.storefront.subdomain ? `(${p.storefront.subdomain}.tubutree.com)` : ''}
              </p>
            )}
            <div className="mt-1 flex items-center gap-3 text-xs">
              <span className="font-bold text-stone-900">{formatVnd(p.salePrice ?? p.basePrice)}</span>
              {p.salePrice && <span className="text-stone-500 line-through">{formatVnd(p.basePrice)}</span>}
              {p.variations && p.variations.length > 0 && (
                <span className="text-stone-500">Tồn kho: {p.variations[0]?.stock ?? 0} sp</span>
              )}
            </div>
          </div>
        </div>

        {/* Hành động duyệt / từ chối */}
        <div className="flex flex-col gap-2">
          <button
            onClick={() => reviewMut.mutate({ approve: true })}
            disabled={reviewMut.isPending}
            className={`${TOUCH_H} inline-flex items-center justify-center gap-1 rounded-control bg-forest-600 px-4 py-1.5 text-xs font-semibold text-stone-0 shadow-card hover:bg-forest-700 disabled:opacity-50`}
          >
            {reviewMut.isPending ? (
              'Đang xử lý...'
            ) : (
              <>
                <Check className="h-3.5 w-3.5" aria-hidden /> Duyệt xuất bản
              </>
            )}
          </button>
          {!showRejectInput ? (
            <button
              onClick={() => setShowRejectInput(true)}
              className={`${BTN_XS_DANGER} inline-flex items-center justify-center gap-1`}
            >
              <X className="h-3.5 w-3.5" aria-hidden /> Từ chối
            </button>
          ) : (
            <div className="flex flex-col gap-1.5 pt-1">
              <input
                type="text"
                placeholder="Lý do từ chối..."
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className={`${FIELD_XS} w-full sm:w-48`}
              />
              <div className="flex gap-1.5">
                <button
                  onClick={() => reviewMut.mutate({ approve: false, reason: rejectReason.trim() || undefined })}
                  disabled={reviewMut.isPending}
                  className={`${TOUCH_H} rounded-control bg-danger-fg px-2.5 py-1 text-xs font-semibold text-stone-0 hover:brightness-90 disabled:opacity-50`}
                >
                  Xác nhận từ chối
                </button>
                <button onClick={() => setShowRejectInput(false)} className={BTN_XS_SECONDARY}>
                  Huỷ
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Chi tiết chứng nhận & thành phần xanh */}
      {(p.ingredients || (p.certifications && p.certifications.length > 0) || (p.ecoBadges && p.ecoBadges.length > 0) || p.description) && (
        <div className="mt-3 border-t border-stone-200 pt-2 text-xs text-stone-600">
          {p.ingredients && (
            <p><strong className="text-stone-700">Thành phần:</strong> {p.ingredients}</p>
          )}
          {p.certifications && p.certifications.length > 0 && (
            <p className="mt-1"><strong className="text-stone-700">Chứng nhận:</strong> {p.certifications.join(', ')}</p>
          )}
          {p.ecoBadges && p.ecoBadges.length > 0 && (
            <p className="mt-1"><strong className="text-stone-700">Tiêu chí xanh:</strong> {p.ecoBadges.join(', ')}</p>
          )}
          {p.description && (
            <p className="mt-1 line-clamp-2 text-stone-500"><strong className="text-stone-700">Mô tả:</strong> {p.description}</p>
          )}
        </div>
      )}
      {reviewMut.isError && (
        <p className="mt-2 text-xs text-danger-fg">{(reviewMut.error as Error).message}</p>
      )}
    </div>
  );
}
