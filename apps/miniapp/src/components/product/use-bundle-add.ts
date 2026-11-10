import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { useNotify } from '../../hooks/use-notify';
import { addAllToCart } from '../../services/cart-batch';
import { getErrorMessage, isBusinessMessage, isStaleStateError } from '../../services/api';
import { isHttpError } from '../../services/http';
import { haptic } from '../../utils/haptic';
import { settleWithin } from '../../utils/settle-within';

/**
 * Nơi các món của bộ đọc tồn kho: Combo trang sản phẩm (`bundles`), Mua kèm (`product`, `bought-together`), Combo Trang chủ (`bundles`), dải Mua lại (`purchased-items`).
 * Hook dùng chung cho cả bốn nên tải lại theo tiền tố; khoá nào không đang mở chỉ bị đánh dấu cũ, không gọi mạng.
 * Không có giỏ: máy chủ thêm hết hoặc không món nào nên lệnh bị từ chối không đổi giỏ.
 */
const BUNDLE_STOCK_KEYS = [['bundles'], ['product'], ['bought-together'], ['purchased-items']] as const;

export interface BundleAdd {
  /** Khoá riêng của lần thêm (id combo hay 'addons'): `busyId` trả lại để chỉ nút đó quay. */
  id: string;
  lines: { variationId: string; quantity: number }[];
  /** Câu báo khi không có lời nghiệp vụ của máy chủ. */
  errorKey: string;
  /** Có thì báo thành công bằng câu này (combo); mua kèm tự đổi nhãn nút nên không báo. */
  successText?: string;
  onDone?: () => void;
}

/** Lỗi 4xx có lời nghiệp vụ ("Sản phẩm X đã hết hàng") thì đọc thẳng; còn lại câu cố định, vì lời chung chung sai nghĩa với lệnh tất cả-hoặc-không. */
function errorText(error: unknown, fallback: string): string {
  if (isHttpError(error) && error.response && error.response.status < 500) {
    const message = getErrorMessage(error);
    if (isBusinessMessage(message)) return message;
  }
  return fallback;
}

/**
 * "Thêm cả combo" và "Thêm n món vào giỏ": một lệnh `addAllToCart` (máy chủ thêm hết hoặc không món nào), mỗi lúc chỉ một lệnh bay.
 * Thành công thì làm mới giỏ; thất bại thì giỏ không đổi nên chỉ làm mới khi máy chủ từ chối vì tồn kho/giá đã đổi (400/404/409).
 */
export function useBundleAdd() {
  const qc = useQueryClient();
  const { notify } = useNotify();
  const inflight = useRef(false);
  const mutation = useMutation({
    mutationFn: (v: BundleAdd) => addAllToCart(v.lines),
    onSuccess: (_data, v) => {
      void qc.invalidateQueries({ queryKey: ['cart'] });
      haptic('medium');
      if (v.successText) notify({ type: 'success', text: v.successText });
      v.onDone?.();
    },
    // Trả Promise: ô giữ khoá tới khi tồn kho mới về (tối đa `settleWithin`) khi máy chủ từ chối (món hết hàng, ngừng bán, giá đổi), kẻo bấm lại trên số cũ nhận đúng lỗi đó. Mất mạng, quá hạn, 401, 5xx: nhả ngay.
    onError: (error, v) => {
      notify({ type: 'error', text: errorText(error, fillCopy(v.errorKey)) });
      if (!isStaleStateError(error)) return undefined;
      return settleWithin(Promise.all(BUNDLE_STOCK_KEYS.map((queryKey) => qc.invalidateQueries({ queryKey }))));
    },
    onSettled: () => {
      inflight.current = false;
    },
  });
  return {
    add: (v: BundleAdd) => {
      if (inflight.current || v.lines.length === 0) return;
      inflight.current = true;
      mutation.mutate(v);
    },
    busyId: mutation.isPending ? mutation.variables?.id : undefined,
    /** Đọc khoá ref (đúng ngay trong khung hình), khác `busyId` chỉ đúng sau lần vẽ kế tiếp. */
    inFlight: () => inflight.current,
  };
}
