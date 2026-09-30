import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSnackbar } from 'zmp-ui';
import { addToCart, repurchaseOrder, type RepurchaseResponse } from '../services/shop-api';
import { getErrorMessage } from '../services/api';
import { trackReorderCompleted, type ReorderSource } from '../services/buy-flow-events';
import { targetLines, type ReorderSelection, type ReorderTarget } from '../components/reorder/reorder-types';
import { summarizeReorder, type ReorderSummary } from '../components/reorder/reorder-summary';
import { vi } from '../i18n/vi';
import { haptic } from '../utils/haptic';

export interface UseReorderOptions {
  /** Mua lại cả đơn (chi tiết đơn / thẻ đơn) → sang giỏ. Kệ Home/tab Đơn hàng/thông báo → ở lại. */
  navigateToCart?: boolean;
}

export interface UseReorder {
  /**
   * Gửi yêu cầu mua lại. Resolve với tóm tắt kết quả (kể cả khi không thêm được món nào — lúc đó đã có snackbar lỗi).
   *
   * - Lỗi (mạng, chưa chọn dòng nào...): snackbar lỗi đã hiện rồi RE-THROW — caller PHẢI `.catch` (thường để giữ nguyên
   *   lựa chọn trong sheet), nếu không sẽ thành unhandled rejection.
   * - Chống bấm đúp đồng bộ: khi đang có yêu cầu bay, gọi `submit` lần nữa KHÔNG gửi thêm request mà trả về đúng promise
   *   của yêu cầu đang bay (cùng kết quả/lỗi). Vì vậy caller nào cũng xử lý như một lần gọi bình thường, không có
   *   nhánh "bị chặn" riêng và không sinh thêm snackbar/event.
   */
  submit: (target: ReorderTarget, selections: ReorderSelection[]) => Promise<ReorderSummary>;
  isPending: boolean;
}

async function send(source: ReorderSource, target: ReorderTarget, selections: ReorderSelection[]): Promise<RepurchaseResponse> {
  // Không có dòng nào được chọn thì không gọi API (server sẽ hiểu `items: []`/thiếu items là "cả đơn").
  if (selections.length === 0) throw new Error(vi.reorder.noSelection);
  if (target.kind === 'item') {
    const s = selections[0]!;
    // Mua lại MỘT sản phẩm dùng cart.addItem (spec §3.3), gắn nguồn để add_to_cart không ghi nhầm 'pdp'.
    const cart = await addToCart(s.variationId, s.quantity, source === 'notification' ? 'reorder_notification' : 'repurchase');
    return { cart, results: [{ orderItemId: s.key, status: 'added', addedQuantity: s.quantity }], legacy: false };
  }
  // Backend cũ (trước 4a) bỏ qua `items` và thêm CẢ đơn — summarizeReorder xử lý qua cờ `legacy`.
  return repurchaseOrder(target.orderCode, {
    items: selections.map((s) => ({ orderItemId: s.key, quantity: s.quantity })),
    addSource: 'repurchase',
  });
}

/** Một luồng mua lại cho MỌI điểm vào (Home, thẻ đơn, chi tiết đơn, thông báo, tab Đơn hàng). */
export function useReorder(source: ReorderSource, opts: UseReorderOptions = {}): UseReorder {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();

  // Chống bấm đúp đồng bộ: `isPending` chỉ đổi sau lần render kế tiếp nên hai tap cùng tick vẫn lọt qua.
  const inFlight = useRef<Promise<ReorderSummary> | null>(null);

  const mutation = useMutation({
    mutationFn: async (v: { target: ReorderTarget; selections: ReorderSelection[] }) => {
      const res = await send(source, v.target, v.selections);
      return { res, summary: summarizeReorder(res, targetLines(v.target), v.selections) };
    },
    onSuccess: ({ res, summary }) => {
      qc.setQueryData(['cart'], res.cart);
      trackReorderCompleted({ source, added: summary.addedLines, skipped: summary.skippedLines });
      if (summary.addedUnits === 0) {
        openSnackbar({ text: summary.message, type: 'error', duration: 5000 });
        return;
      }
      haptic('medium');
      const type = summary.hasProblems ? 'warning' : 'success';
      if (opts.navigateToCart) {
        openSnackbar({ text: summary.message, type });
        navigate('/cart');
        return;
      }
      openSnackbar({
        text: summary.message,
        type,
        duration: 4000,
        action: { text: vi.reorder.viewCart, close: true, onClick: () => navigate('/cart') },
      });
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  return {
    submit: (target, selections) => {
      if (inFlight.current) return inFlight.current;
      const p = mutation
        .mutateAsync({ target, selections })
        .then((r) => r.summary)
        .finally(() => {
          inFlight.current = null;
        });
      inFlight.current = p;
      return p;
    },
    isPending: mutation.isPending,
  };
}
