'use client';

import { useState } from 'react';
import { Check, Leaf, X } from 'lucide-react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  confirmMerchantConsignment,
  listLinkedMerchantProducts,
  listPendingMerchantProducts,
  reviewMerchantProduct,
  unlinkMerchantProduct,
  mergeQueuePages,
  nextPageParam,
  ADMIN_QUEUE_PAGE_SIZE,
  type AdminLinkedMerchantProduct,
  type AdminPendingProduct,
  type PancakeLinkPreview,
} from '@/lib/admin-client';
import { formatVnd } from '@/lib/shop-client';
import { formatDate } from '@/lib/format-date';
import { BTN_SECONDARY, BTN_XS_DANGER, BTN_XS_PRIMARY, BTN_XS_SECONDARY, FIELD_XS, Notice, TOUCH_H, ToneBadge } from './ui';

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
      <LinkedMerchantProducts />
    </div>
  );
}

/** Khối "Tubu giao hộ" ở màn duyệt: biến thể Pancake và sản phẩm đang giữ nó sẽ bị chuyển khi bấm Duyệt (R2-MERCHANT-1). */
function PancakeLinkPanel({ link, storeTitle }: { link: PancakeLinkPreview; storeTitle: string }) {
  const v = link.variation;
  const o = link.origin;
  const brand = o ? (o.brandName ?? o.brand) : '';
  return (
    <div className="mt-3 space-y-2 border-t border-stone-200 pt-3 text-xs text-stone-700">
      <p>
        <strong className="text-stone-900">Mã Pancake {link.code}</strong>
        {v && (
          <>
            {' '}
            · biến thể {v.name} · giá {formatVnd(v.salePrice ?? v.retailPrice)} · tồn kho Tubu {v.stock} sp
          </>
        )}
      </p>
      {link.state === 'LINKED' && <p>Biến thể đã thuộc sản phẩm này (đối tác sửa nội dung, duyệt lại không chuyển gì).</p>}
      {link.state === 'UNAVAILABLE' && (
        <Notice tone="danger" role="alert">
          Không liên kết được: {link.reason} Hãy từ chối kèm lý do để đối tác nhập mã khác hoặc tự giao.
        </Notice>
      )}
      {o && link.state === 'AVAILABLE' && (
        <p>
          Đang thuộc sản phẩm Tubu không bán: <strong>{o.name}</strong> ({brand}). Duyệt thì biến thể chuyển sang gian hàng “{storeTitle}”.
        </p>
      )}
      {o && link.state === 'TAKEOVER' && (
        <Notice tone="warning" role="alert">
          <p>
            Duyệt sẽ chuyển biến thể đang bán của <strong>{o.name}</strong> (thương hiệu {brand}) sang gian hàng{' '}
            <strong>“{storeTitle}”</strong>: tồn kho {v?.stock ?? 0} sp, đã bán {o.sold}, {o.reviewCount} đánh giá.{' '}
            {o.otherVariations === 0
              ? 'Sản phẩm gốc không còn biến thể nào nên sẽ bị tắt bán (trang sản phẩm, đánh giá, yêu thích không còn hiện).'
              : `Sản phẩm gốc vẫn bán ${o.otherVariations} biến thể còn lại.`}
          </p>
          <p className="mt-1 font-semibold">
            {link.brandMatchesStore
              ? `Gian hàng là chủ thương hiệu ${brand}.`
              : `Gian hàng “${storeTitle}” không phải chủ thương hiệu ${brand}: chỉ duyệt khi đã có thoả thuận giao hàng này cho gian hàng.`}
          </p>
          <p className="mt-1">Gỡ liên kết sau này (hoặc từ chối khi đối tác sửa nội dung) trả biến thể về sản phẩm gốc.</p>
        </Notice>
      )}
    </div>
  );
}

function LinkedMerchantProducts() {
  const q = useQuery({
    queryKey: ['admin-merchant-products-linked'],
    queryFn: () => listLinkedMerchantProducts(1, ADMIN_QUEUE_PAGE_SIZE),
  });
  const rows = q.data?.data ?? [];
  return (
    <section className="mt-8" aria-label="Sản phẩm đối tác đang liên kết mã Pancake">
      <h2 className="text-base font-semibold text-stone-900">Đang liên kết mã Pancake ({q.data?.meta.total ?? 0})</h2>
      <p className="mt-1 text-xs text-stone-500">
        Sản phẩm đối tác &quot;Tubu giao hộ&quot; đang giữ biến thể Pancake. Gỡ liên kết trả biến thể về sản phẩm gốc và tắt bán sản phẩm đối tác.
      </p>
      {q.isError && <p className="mt-2 text-sm text-danger-fg">Không tải được danh sách đang liên kết.</p>}
      {q.data && rows.length === 0 && <p className="mt-2 text-sm text-stone-500">Chưa có sản phẩm đối tác nào liên kết mã Pancake.</p>}
      <div className="mt-3 space-y-3">
        {rows.map((l) => (
          <LinkedRow key={l.id} link={l} />
        ))}
      </div>
    </section>
  );
}

function LinkedRow({ link: l }: { link: AdminLinkedMerchantProduct }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const mut = useMutation({
    mutationFn: () => unlinkMerchantProduct(l.product.id, reason.trim()),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-merchant-products-linked'] });
      void qc.invalidateQueries({ queryKey: ['admin-merchant-products-pending'] });
    },
  });
  return (
    <div className="rounded-card border border-stone-200 bg-stone-0 p-3 text-xs text-stone-700 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-stone-900">
            {l.product.name} · {l.product.storefront?.title ?? 'Gian hàng'}
          </p>
          <p className="mt-0.5">
            Mã {l.variation.pancakeId} ({l.variation.name}) · tồn kho Tubu {l.variation.stock} sp · liên kết{' '}
            {formatDate(l.linkedAt)}
          </p>
          <p className="mt-0.5 text-stone-500">
            Sản phẩm gốc:{' '}
            {l.originProduct ? `${l.originProduct.name} (${l.originProduct.brand})` : 'không rõ (liên kết cũ — gỡ tay cần kỹ thuật)'}
          </p>
        </div>
        {!open ? (
          <button type="button" onClick={() => setOpen(true)} className={BTN_XS_DANGER} disabled={!l.originProduct}>
            Gỡ liên kết
          </button>
        ) : (
          <div className="flex w-full flex-col gap-1.5 sm:w-auto">
            <input
              type="text"
              placeholder="Lý do gỡ (gửi đối tác)..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className={`${FIELD_XS} w-full sm:w-56`}
            />
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => mut.mutate()}
                disabled={!reason.trim() || mut.isPending}
                className={`${TOUCH_H} rounded-control bg-danger-fg px-2.5 py-1 text-xs font-semibold text-stone-0 hover:brightness-90 disabled:opacity-50`}
              >
                {mut.isPending ? 'Đang gỡ…' : 'Xác nhận gỡ'}
              </button>
              <button type="button" onClick={() => setOpen(false)} className={BTN_XS_SECONDARY}>
                Huỷ
              </button>
            </div>
          </div>
        )}
      </div>
      {l.takeover && <ConsignmentConfirm link={l} />}
      {mut.isError && <p className="mt-2 text-danger-fg">{(mut.error as Error).message}</p>}
    </div>
  );
}

/** Bản sửa của sản phẩm ĐANG BÁN: khách vẫn thấy cột "Đang bán" cho tới khi admin duyệt cột "Bản sửa" (R3-MERCHANT-4). */
function EditComparison({ live, next }: { live: NonNullable<AdminPendingProduct['live']>; next: AdminPendingProduct }) {
  const rows: { label: string; before: string | null; after: string | null }[] = [
    { label: 'Tên', before: live.name, after: next.name },
    { label: 'Mô tả ngắn', before: live.shortDesc, after: next.shortDesc ?? null },
    { label: 'Mô tả', before: live.description, after: next.description },
    { label: 'Ảnh', before: live.thumbnail, after: next.thumbnail },
  ];
  return (
    <div className="mt-3 border-t border-stone-200 pt-3 text-xs text-stone-700">
      <p className="mb-2 text-stone-500">Khách vẫn thấy nội dung &quot;Đang bán&quot; cho tới khi bạn duyệt bản sửa.</p>
      <div className="space-y-2">
        {rows
          .filter((r) => (r.before ?? '') !== (r.after ?? ''))
          .map((r) => (
            <div key={r.label} className="grid gap-1 sm:grid-cols-2 sm:gap-3">
              <p className="min-w-0 break-words">
                <strong className="text-stone-900">{r.label} · Đang bán:</strong>{' '}
                <span className="line-clamp-3 text-stone-600">{r.before || '—'}</span>
              </p>
              <p className="min-w-0 break-words rounded-control bg-warning-bg px-2 py-1 text-warning-fg">
                <strong>{r.label} · Bản sửa:</strong> <span className="line-clamp-3">{r.after || '—'}</span>
              </p>
            </div>
          ))}
      </div>
    </div>
  );
}

/**
 * Liên kết nhận lại mã của sản phẩm Tubu đang bán: hàng đang có trong kho có thể là hàng Tubu đã mua, nên chỉ đối soát tự động
 * cho gian hàng sau khi admin đối chiếu tồn lúc liên kết và xác nhận đó là hàng ký gửi.
 */
function ConsignmentConfirm({ link: l }: { link: AdminLinkedMerchantProduct }) {
  const qc = useQueryClient();
  const [asking, setAsking] = useState(false);
  const mut = useMutation({
    mutationFn: () => confirmMerchantConsignment(l.id),
    onSuccess: () => {
      setAsking(false);
      void qc.invalidateQueries({ queryKey: ['admin-merchant-products-linked'] });
    },
  });
  const store = l.product.storefront?.title ?? 'gian hàng';
  return (
    <div className="mt-2 rounded-control border border-stone-200 bg-stone-50 p-2.5">
      <p>
        Nhận lại mã của sản phẩm Tubu đang bán · Tồn lúc liên kết: {l.stockAtLink ?? '—'} sp
      </p>
      {l.consignmentConfirmedAt ? (
        <p className="mt-0.5 text-stone-500">
          Đã xác nhận hàng ký gửi {formatDate(l.consignmentConfirmedAt)} — đơn đặt từ mốc này vào đối soát của {store}.
        </p>
      ) : (
        <>
          <p className="mt-0.5 text-stone-500">
            Chưa đối soát tự động: xác nhận khi số hàng này là hàng ký gửi của {store}, không phải hàng Tubu đã mua.
          </p>
          {!asking ? (
            <button type="button" onClick={() => setAsking(true)} className={`${BTN_XS_SECONDARY} mt-2`}>
              Xác nhận hàng ký gửi
            </button>
          ) : (
            <div className="mt-2 space-y-1.5">
              <p className="font-medium text-stone-900">Đơn đặt từ lúc xác nhận sẽ vào đối soát của {store}. Không hoàn tác được.</p>
              <div className="flex gap-1.5">
                <button type="button" onClick={() => mut.mutate()} disabled={mut.isPending} className={BTN_XS_PRIMARY}>
                  {mut.isPending ? 'Đang xác nhận…' : 'Xác nhận ký gửi'}
                </button>
                <button type="button" onClick={() => setAsking(false)} className={BTN_XS_SECONDARY}>
                  Huỷ
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {mut.isError && <p className="mt-1 text-danger-fg">{(mut.error as Error).message}</p>}
    </div>
  );
}

export function MerchantProductRow({ item: p }: { item: AdminPendingProduct }) {
  const qc = useQueryClient();
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [confirmTakeover, setConfirmTakeover] = useState(false);
  const link = p.pancakeLink ?? null;
  const takeover = link?.state === 'TAKEOVER';
  const approveBlocked = link?.state === 'UNAVAILABLE' || (takeover && !confirmTakeover);

  const reviewMut = useMutation({
    mutationFn: ({ approve, reason }: { approve: boolean; reason?: string }) =>
      reviewMerchantProduct(p.id, approve, reason, approve && takeover ? confirmTakeover : undefined, p.isEdit ? p.editVersion : undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-merchant-products-pending'] });
      qc.invalidateQueries({ queryKey: ['admin-merchant-products-linked'] });
    },
  });

  return (
    <div className="rounded-card border border-stone-200 bg-stone-0 p-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 gap-3">
          {p.thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.thumbnail} alt={p.name} className="h-20 w-20 shrink-0 rounded-control border border-stone-200 object-cover" />
          ) : (
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-control bg-forest-50 text-forest-600">
              <Leaf className="h-8 w-8" aria-hidden />
            </div>
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="break-words font-semibold text-stone-900">{p.name}</h3>
              <ToneBadge tone="warning">{p.isEdit ? 'Bản sửa chờ duyệt' : 'Chờ duyệt'}</ToneBadge>
              <ToneBadge tone={p.pancakeLinkCode ? 'info' : 'neutral'} wrap>
                {p.pancakeLinkCode ? `Tubu giao hộ · mã Pancake ${p.pancakeLinkCode}` : 'Gian hàng tự giao'}
              </ToneBadge>
            </div>
            <p className="break-words text-xs text-stone-500">Slug: /{p.slug} · Thương hiệu: {p.brand || 'Riêng'} · Danh mục: {p.category}</p>
            {p.storefront && (
              <p className="mt-1 break-words text-xs font-medium text-forest-700">
                Gian hàng: {p.storefront.title} {p.storefront.subdomain ? `(${p.storefront.subdomain}.tubutree.com)` : ''}
              </p>
            )}
            <div className="mt-1 flex items-center gap-3 text-xs">
              <span className="font-bold text-stone-900">{formatVnd(p.salePrice ?? p.basePrice)}</span>
              {p.salePrice && <span className="text-stone-500 line-through">{formatVnd(p.basePrice)}</span>}
              {!p.pancakeLinkCode && p.variations && p.variations.length > 0 && (
                <span className="text-stone-500">Tồn kho: {p.variations[0]?.stock ?? 0} sp</span>
              )}
            </div>
          </div>
        </div>

        {/* Hành động duyệt / từ chối */}
        <div className="flex flex-col gap-2">
          {takeover && (
            <label className="flex max-w-[16rem] items-start gap-2 text-xs text-stone-700">
              <input
                type="checkbox"
                checked={confirmTakeover}
                onChange={(e) => setConfirmTakeover(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-forest-600"
              />
              <span>Tôi đã xem sản phẩm đang bán ở dưới và đồng ý chuyển nó sang gian hàng này</span>
            </label>
          )}
          <button
            onClick={() => reviewMut.mutate({ approve: true })}
            disabled={reviewMut.isPending || approveBlocked}
            className={`${TOUCH_H} inline-flex items-center justify-center gap-1 rounded-control bg-forest-600 px-4 py-1.5 text-xs font-semibold text-stone-0 shadow-card hover:bg-forest-700 disabled:opacity-50`}
          >
            {reviewMut.isPending ? (
              'Đang xử lý...'
            ) : (
              <>
                <Check className="h-3.5 w-3.5" aria-hidden /> {p.isEdit ? 'Duyệt bản sửa' : 'Duyệt xuất bản'}
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

      {p.isEdit && p.live && <EditComparison live={p.live} next={p} />}

      {link && <PancakeLinkPanel link={link} storeTitle={p.storefront?.title ?? 'đối tác'} />}

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
