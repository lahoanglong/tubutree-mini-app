'use client';

import { useQuery } from '@tanstack/react-query';
import { ListSkeleton, LoadError } from '@/components/admin/ui';
import { loadErrorText } from '@/lib/admin-error-text';
import { formatDateTime } from '@/lib/format-date';
import { formatVnd } from '@/lib/format-vnd';
import { getPancakeZeroPrice, type PancakeZeroPriceKind } from './catalog-quality-api';

const KIND_LABEL: Record<PancakeZeroPriceKind, string> = {
  PRICE_KEPT: 'Đã giữ giá cũ',
  NEW_AT_ZERO: 'Chưa mở bán',
};

/**
 * SKU mà Pancake POS đang báo giá 0đ. Đồng bộ không bao giờ ghi 0đ ra cửa hàng: biến thể đang bán giữ giá cũ, biến thể mới
 * chưa có giá thì chưa mở bán. Thẻ này chỉ để quản trị viên biết SKU nào cần sửa giá ở Pancake.
 */
export function PancakeZeroPriceCard() {
  const q = useQuery({ queryKey: ['admin-pancake-zero-price'], queryFn: getPancakeZeroPrice });
  const d = q.data;
  // Máy chủ chưa từng ghi danh sách thì trả mốc 1970: khác với "đã kiểm mà không có SKU nào".
  const neverRecorded = !!d && !(new Date(d.updatedAt).getTime() > 0);

  return (
    <section aria-labelledby="pancake-zero-price-title" className="rounded-card border border-stone-200 bg-stone-0 p-3">
      <h2 id="pancake-zero-price-title" className="m-0 font-display text-lg font-semibold text-stone-900">
        SKU Pancake báo giá 0đ
      </h2>
      <div className="mt-3 space-y-3" aria-busy={q.isFetching || undefined}>
        {q.isLoading ? (
          <ListSkeleton label="Đang tải danh sách SKU giá 0đ" rows={2} className="h-12" />
        ) : q.isError || !d ? (
          <LoadError onRetry={() => void q.refetch()} retrying={q.isFetching}>
            {`Không tải được danh sách SKU giá 0đ. ${loadErrorText(q.error)}`}
          </LoadError>
        ) : neverRecorded ? (
          <p className="max-w-2xl text-sm text-stone-600">Chưa có lượt đồng bộ Pancake nào ghi nhận danh sách này. Danh sách sẽ hiện sau lượt đồng bộ kế tiếp.</p>
        ) : d.count === 0 ? (
          <p role="status" className="max-w-2xl text-sm text-stone-600">
            Không có SKU nào đang báo giá 0đ trên Pancake.
          </p>
        ) : (
          <>
            <p role="status" className="max-w-2xl text-sm text-stone-700">
              <span className="tabular-nums">{d.count}</span> SKU đang báo giá 0đ: <span className="tabular-nums">{d.keptCount}</span> đã giữ giá cũ trên cửa hàng,{' '}
              <span className="tabular-nums">{d.newCount}</span> chưa có giá nên chưa mở bán. Sửa giá trong Pancake POS rồi chờ đồng bộ; Tubu không ghi giá 0đ ra cửa hàng.
            </p>
            <ul aria-label="SKU Pancake báo giá 0đ" className="divide-y divide-stone-200 rounded-control border border-stone-200">
              {d.skus.map((s) => (
                <li key={s.pancakeId} className="flex flex-col gap-1 px-3 py-2 text-sm text-stone-800 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                  <div className="min-w-0">
                    <div className="break-words font-medium">{s.productName}</div>
                    <div className="break-all text-xs text-stone-500">Mã SKU: {s.sku}</div>
                  </div>
                  <div className="shrink-0 text-xs text-stone-600 sm:text-right">
                    <div>{KIND_LABEL[s.kind]}</div>
                    {s.keptPrice !== null && <div className="tabular-nums">Giá cửa hàng: {formatVnd(s.keptPrice)}</div>}
                  </div>
                </li>
              ))}
            </ul>
            {d.truncated && <p className="text-xs text-stone-500">Chỉ hiện {d.skus.length} SKU đầu tiên trong tổng số {d.count}.</p>}
            <p className="max-w-2xl text-xs text-stone-500">
              Cập nhật {formatDateTime(d.updatedAt)} (giờ Việt Nam). Danh sách được dựng lại sau mỗi lượt quét toàn bộ ban đêm; lượt 15 phút chỉ thêm hoặc gỡ SKU vừa đổi.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
