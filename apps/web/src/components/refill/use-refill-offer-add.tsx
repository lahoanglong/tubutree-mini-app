'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import type { RefillSwapSurface } from '@tubutree/shared-types';
import type { PdpRefillOfferView } from '@tubutree/app-core/refill/refill-saving';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { useQuickAdd } from '@/app/tai-khoan/yeu-thich/quick-add';
import { trackWebEvent } from '@/lib/analytics';
import { useAuthPhase } from '@/lib/auth-phase';
import { cartKey } from '@/lib/cart-key';
import { playCartFeedback } from '@/lib/cart-feedback';
import { useGuestCartFlag } from '@/lib/guest-cart/flag';
import { addGuestLine, GUEST_CART_MAX_LINES } from '@/lib/guest-cart/store';
import { loginHref, rememberPendingAdd } from '@/lib/return-to';

/** Giỏ khách ghi đồng bộ (không có lệnh mạng để khoá): hai chạm trong khoảng này là chạm đúp, không phải thêm hai gói. */
const GUEST_TAP_GAP_MS = 600;

export interface RefillOfferAdd {
  /** "+ Thêm" của một thẻ gói Refill; `origin` là nút vừa bấm (phản hồi bay từ đó vào giỏ). */
  add: (view: PdpRefillOfferView, origin: Element | null) => void;
  /** Phân loại gói đang được thêm (một lệnh mỗi lúc cho cả màn), null khi rảnh. */
  busyVariationId: string | null;
  /** Thông báo nổi "Đã thêm vào giỏ!" / lời lỗi: nơi dùng vẽ một lần ở bất cứ đâu trong cây. */
  feedback: ReactNode;
}

/**
 * Đường thêm gói Refill vào giỏ của thẻ `PdpRefillOffer` trên web (trang chi tiết chai, trang Tiết kiệm với Refill, chi tiết đơn đã giao): đã đăng nhập thì qua
 * đường giỏ nhanh dùng chung (`useQuickAdd`: khoá chạm đúp cho cả màn, thông báo nổi); khách chưa đăng nhập thì giỏ khách khi cờ bật, không thì nhớ món rồi sang
 * đăng nhập và quay về trang gói Refill (trang đó thêm nốt món sau khi có phiên). Đang khôi phục phiên thì chưa biết là ai nên bỏ qua cú chạm.
 * `staleKey` là truy vấn vẽ các thẻ: máy chủ từ chối vì trạng thái đã đổi thì `useQuickAdd` tải lại nó. `onRejected` cho nơi vẽ thẻ ở máy chủ (không có truy vấn để tải lại).
 */
export function useRefillOfferAdd(surface: RefillSwapSurface, staleKey: readonly unknown[], opts: { onRejected?: () => void } = {}): RefillOfferAdd {
  const router = useRouter();
  const qc = useQueryClient();
  const lastGuestTap = useRef(0);
  const phase = useAuthPhase();
  const guestFlag = useGuestCartFlag();
  const quick = useQuickAdd(surface === 'pdp' ? 'pdp' : undefined, staleKey);
  // Hook giỏ nhanh này chỉ phục vụ thẻ Refill: mỗi lời báo thành công là một lần thêm gói (đường đăng nhập lẫn giỏ khách).
  // Thành công: đọc lại giỏ máy chủ, vì nút mua khác của màn ghi giỏ bằng lệnh riêng, lời đáp về sau cùng có thể là bản cũ hơn.
  const notice = quick.notice;
  useEffect(() => {
    if (!notice) return;
    if (notice.ok) {
      trackWebEvent('refill_swap_applied', { surface });
      if (phase === 'authenticated') void qc.invalidateQueries({ queryKey: cartKey() });
    } else opts.onRejected?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ chạy khi có lời báo mới
  }, [notice]);

  const addAsGuest = (view: PdpRefillOfferView, origin: Element | null) => {
    if (!guestFlag.pending && guestFlag.enabled) {
      const now = Date.now();
      if (now - lastGuestTap.current < GUEST_TAP_GAP_MS) return;
      lastGuestTap.current = now;
      const res = addGuestLine({ variationId: view.variationId, slug: view.slug, quantity: 1 });
      if (res.ok) {
        quick.notify({ ok: true, text: 'Đã thêm vào giỏ!' });
        playCartFeedback(origin?.isConnected ? origin : null);
        return;
      }
      if (res.reason !== 'storage') {
        quick.notify({ ok: false, text: res.reason === 'full' ? fillCopy('guestCart.full', { n: GUEST_CART_MAX_LINES }) : fillCopy('guestCart.atMax') });
        return;
      }
    }
    rememberPendingAdd({ variationId: view.variationId, quantity: 1 });
    router.push(loginHref(`/san-pham/${encodeURIComponent(view.slug)}`));
  };

  return {
    add: (view, origin) => {
      if (phase === 'loading' || quick.busyId !== null) return;
      if (phase === 'guest') return addAsGuest(view, origin);
      void quick.addVariation(view.variationId, { origin });
    },
    busyVariationId: quick.busyId,
    feedback: quick.feedback,
  };
}
