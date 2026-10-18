'use client';

import { useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { addToCart } from '@tubutree/app-core/api/cart';
import { repurchaseOrder, type RepurchaseResponse } from '@tubutree/app-core/api/orders';
import { coreHttp } from '@/lib/core-http';
import { cartStorefrontSlug } from '@/lib/cart-key';
import {
  selectedLines,
  summarizeReorder,
  targetLines,
  type ReorderSelection,
  type ReorderSource,
  type ReorderSummary,
  type ReorderTarget,
} from './reorder';

export interface ReorderNotice {
  tone: 'success' | 'warning';
  text: string;
}

export interface UseReorderOptions {
  /** Sang giỏ sau khi thêm đủ. Thêm thiếu thì ở lại để khách đọc được dòng nào chưa vào giỏ. */
  navigateToCart?: boolean;
  /** Báo kết quả ở trang gọi (sheet đã đóng nên không còn chỗ nào khác để nói). */
  onNotice?: (notice: ReorderNotice) => void;
}

export interface UseReorder {
  /**
   * Gửi yêu cầu mua lại; resolve với tóm tắt kết quả (kể cả khi không thêm được món nào). Lỗi mạng/máy chủ ném lại cho
   * caller giữ nguyên lựa chọn. Chống bấm đúp đồng bộ: đang có yêu cầu bay thì trả về đúng promise của yêu cầu đó.
   */
  submit: (target: ReorderTarget, selections: ReorderSelection[]) => Promise<ReorderSummary>;
  isPending: boolean;
}

async function send(target: ReorderTarget, selections: ReorderSelection[]): Promise<RepurchaseResponse> {
  // Không có dòng nào được chọn thì không gọi API (server sẽ hiểu `items: []`/thiếu items là "cả đơn").
  if (selections.length === 0) throw new Error('Chưa chọn sản phẩm');
  if (target.kind === 'item') {
    const s = selections[0]!;
    // Mua lại MỘT sản phẩm dùng cart.addItem, gắn nguồn để add_to_cart không ghi nhầm 'pdp'.
    const cart = await addToCart(coreHttp, s.variationId, s.quantity, 'repurchase', cartStorefrontSlug());
    return { cart, results: [{ orderItemId: s.key, status: 'added', addedQuantity: s.quantity }], legacy: false };
  }
  // Backend cũ (trước 4a) bỏ qua `items` và thêm CẢ đơn — summarizeReorder xử lý qua cờ `legacy`.
  return repurchaseOrder(coreHttp, target.orderCode, {
    items: selections.map((s) => ({ orderItemId: s.key, quantity: s.quantity })),
    addSource: 'repurchase',
  });
}

/** Một luồng mua lại cho mọi điểm vào (thẻ đơn, chi tiết đơn, kệ Mua lại). `source` chỉ để phân biệt điểm vào. */
export function useReorder(_source: ReorderSource, opts: UseReorderOptions = {}): UseReorder {
  const qc = useQueryClient();
  const router = useRouter();
  // Chống bấm đúp đồng bộ: `isPending` chỉ đổi sau lần render kế tiếp nên hai cú bấm cùng nhịp vẫn lọt qua.
  const inFlight = useRef<Promise<ReorderSummary> | null>(null);

  const mutation = useMutation({
    mutationFn: async (v: { target: ReorderTarget; selections: ReorderSelection[] }) => {
      const res = await send(v.target, v.selections);
      return summarizeReorder(res, targetLines(v.target), v.selections);
    },
    onSuccess: (summary) => {
      // Giỏ trong phản hồi không kèm gian hàng (không có combo): tải lại giỏ thay vì ghi số cũ vào cache.
      void qc.invalidateQueries({ queryKey: ['cart'] });
      if (summary.addedUnits === 0) return;
      if (opts.navigateToCart && !summary.hasProblems) {
        router.push('/gio-hang');
        return;
      }
      opts.onNotice?.({ tone: summary.hasProblems ? 'warning' : 'success', text: summary.message });
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
