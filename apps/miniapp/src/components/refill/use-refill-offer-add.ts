import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { RefillSwapSurface } from '@tubutree/shared-types';
import type { PdpRefillOfferView } from '@tubutree/app-core/refill/refill-saving';
import { useLoginWithNotice } from '../../hooks/use-login-notice';
import { useNotify } from '../../hooks/use-notify';
import { vi } from '../../i18n/vi';
import { trackEvent } from '../../services/analytics';
import { getErrorMessage, isStaleStateError } from '../../services/api';
import { cartKey } from '../../services/cart-key';
import { addToCart } from '../../services/shop-api';
import { useAuthStore } from '../../store/auth';
import { playCartFeedback } from '../../utils/cart-feedback';
import { haptic } from '../../utils/haptic';
import { settleWithin } from '../../utils/settle-within';

export interface RefillOfferAdd {
  /** "+ Thêm" của một thẻ gói Refill; `origin` là nút vừa bấm (phản hồi bay từ đó vào giỏ). */
  add: (view: PdpRefillOfferView, origin: Element | null) => Promise<void>;
  /** Phân loại gói đang được thêm (một lệnh mỗi lúc cho cả màn), null khi rảnh. */
  busyVariationId: string | null;
}

/**
 * "+ Thêm" của thẻ `PdpRefillOffer` ở trang Tiết kiệm với Refill và Chi tiết đơn đã giao: một gói, số lượng 1, một lệnh mỗi lúc cho cả màn (khoá ref đồng bộ, giữ cả
 * lúc mời đăng nhập). Chưa đăng nhập thì mời đăng nhập trước như nút Thêm vào giỏ. Máy chủ từ chối vì trạng thái đã đổi (gói hết hàng, đổi giá) thì giữ khoá tới khi
 * truy vấn vẽ thẻ (`staleKey`) về bản mới, kẻo chạm lại nhận đúng lời đó. Cùng vai với `useRefillOfferAdd` của web.
 */
export function useRefillOfferAdd(surface: RefillSwapSurface, staleKey: readonly unknown[]): RefillOfferAdd {
  const qc = useQueryClient();
  const { notify } = useNotify();
  const loginWithNotice = useLoginWithNotice();
  const inflight = useRef(false);
  const mutation = useMutation({
    mutationFn: ({ view }: { view: PdpRefillOfferView; origin: Element | null }) => addToCart(view.variationId, 1),
    onSuccess: (cart, { origin }) => {
      qc.setQueryData(cartKey(), cart);
      haptic('medium');
      playCartFeedback(origin?.isConnected ? origin : null);
      notify({ text: vi.product.added, type: 'success', duration: 2000, position: 'top' });
      trackEvent('refill_swap_applied', 'miniapp', { surface });
    },
    onError: (e) => {
      notify({ text: getErrorMessage(e), type: 'error' });
      return isStaleStateError(e) ? settleWithin(qc.invalidateQueries({ queryKey: staleKey })) : undefined;
    },
    onSettled: () => {
      inflight.current = false;
    },
  });
  const add = async (view: PdpRefillOfferView, origin: Element | null) => {
    if (inflight.current) return;
    const status = useAuthStore.getState().status;
    if (status === 'loading') return;
    inflight.current = true;
    if (status !== 'authenticated') {
      try {
        await loginWithNotice();
      } catch {
        // Lời báo đã do useLoginWithNotice hiện; chỉ nhả khoá.
      }
      if (useAuthStore.getState().status !== 'authenticated') {
        inflight.current = false;
        return;
      }
    }
    haptic('light');
    mutation.mutate({ view, origin });
  };
  return { add, busyVariationId: mutation.isPending ? (mutation.variables?.view.variationId ?? null) : null };
}
