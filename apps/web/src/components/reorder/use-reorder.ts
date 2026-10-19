'use client';

import { useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { addToCart } from '@tubutree/app-core/api/cart';
import { repurchaseOrder, type RepurchaseResponse } from '@tubutree/app-core/api/orders';
import { cartStorefrontSlug } from '@/lib/cart-key';
import { coreHttp } from '@/lib/core-http';
import { reorderText } from '@/lib/home-text';
import { summarizeReorder, type ReorderSummary } from './reorder-summary';
import { targetLines, type ReorderSelection, type ReorderSource, type ReorderTarget } from './reorder-types';

export interface UseReorderOptions {
  /** Nguồn riêng của điểm vào; bỏ trống = kệ Mua lại / thẻ đơn / chi tiết đơn (addSource 'repurchase'). */
  source?: ReorderSource;
  /** Sang giỏ sau khi thêm đủ (kệ Mua lại, thẻ đơn, chi tiết đơn). Có dòng không thêm được thì ở lại để khách đọc lý do. */
  navigateToCart?: boolean;
}

export interface UseReorder {
  /**
   * Gửi yêu cầu mua lại. Resolve với tóm tắt kết quả (kể cả khi không thêm được món nào).
   * Lỗi (mạng, chưa chọn dòng nào...) bị ném lại: caller PHẢI `.catch` (thường để giữ nguyên lựa chọn trong sheet).
   * Chống bấm đúp đồng bộ: đang có yêu cầu bay thì gọi lại trả về đúng promise đó, không gửi thêm request.
   */
  submit: (target: ReorderTarget, selections: ReorderSelection[]) => Promise<ReorderSummary>;
  isPending: boolean;
}

async function send(source: ReorderSource | undefined, target: ReorderTarget, selections: ReorderSelection[]): Promise<RepurchaseResponse> {
  // Không có dòng nào được chọn thì không gọi API (server sẽ hiểu `items: []`/thiếu items là "cả đơn").
  if (selections.length === 0) throw new Error(reorderText.noSelection);
  if (target.kind === 'item') {
    const s = selections[0]!;
    // Mua lại MỘT sản phẩm dùng cart.addItem, gắn nguồn để add_to_cart không ghi nhầm 'pdp'.
    const cart = await addToCart(coreHttp, s.variationId, s.quantity, source === 'notification' ? 'reorder_notification' : 'repurchase', cartStorefrontSlug());
    return { cart, results: [{ orderItemId: s.key, status: 'added', addedQuantity: s.quantity }], legacy: false };
  }
  // Backend cũ (trước 4a) bỏ qua `items` và thêm CẢ đơn — summarizeReorder xử lý qua cờ `legacy`.
  return repurchaseOrder(coreHttp, target.orderCode, {
    items: selections.map((s) => ({ orderItemId: s.key, quantity: s.quantity })),
    addSource: 'repurchase',
  });
}

/** Một luồng mua lại cho mọi điểm vào của web (kệ Mua lại ở Trang chủ, thẻ đơn, chi tiết đơn, thông báo nhắc). */
export function useReorder(opts: UseReorderOptions = {}): UseReorder {
  const qc = useQueryClient();
  const router = useRouter();
  const inFlight = useRef<Promise<ReorderSummary> | null>(null);

  const mutation = useMutation({
    mutationFn: async (v: { target: ReorderTarget; selections: ReorderSelection[] }) => {
      const res = await send(opts.source, v.target, v.selections);
      return summarizeReorder(res, targetLines(v.target), v.selections);
    },
    onSuccess: (summary) => {
      // Giỏ trong phản hồi không kèm gian hàng (không có combo): tải lại giỏ thay vì ghi số cũ vào cache.
      void qc.invalidateQueries({ queryKey: ['cart'] });
      if (opts.navigateToCart && summary.addedUnits > 0 && !summary.hasProblems) router.push('/gio-hang');
    },
  });

  return {
    submit: (target, selections) => {
      if (inFlight.current) return inFlight.current;
      const p = mutation.mutateAsync({ target, selections }).finally(() => {
        inFlight.current = null;
      });
      inFlight.current = p;
      return p;
    },
    isPending: mutation.isPending,
  };
}
