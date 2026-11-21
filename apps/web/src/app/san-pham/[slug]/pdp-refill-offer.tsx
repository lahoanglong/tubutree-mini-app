'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import type { PdpRefillOfferView } from '@tubutree/app-core/refill/refill-saving';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { useQuickAdd } from '@/app/tai-khoan/yeu-thich/quick-add';
import { PdpRefillOffer } from '@/components/mini/pdp-refill-offer';
import { trackWebEvent } from '@/lib/analytics';
import { useAuthPhase } from '@/lib/auth-phase';
import { cartKey } from '@/lib/cart-key';
import { playCartFeedback } from '@/lib/cart-feedback';
import { useGuestCartFlag } from '@/lib/guest-cart/flag';
import { addGuestLine, GUEST_CART_MAX_LINES } from '@/lib/guest-cart/store';
import { loginHref, rememberPendingAdd } from '@/lib/return-to';

const addButton = () => document.querySelector('[data-testid="pdp-refill-add"]');
/** Giỏ khách ghi đồng bộ (không có lệnh mạng để khoá): hai chạm trong khoảng này là chạm đúp, không phải thêm hai gói. */
const GUEST_TAP_GAP_MS = 600;

/**
 * Thẻ gói Refill của trang chi tiết web (trang dựng `view` ở máy chủ từ cặp công khai) kèm đường thêm giỏ: đã đăng nhập thì qua đường giỏ nhanh dùng chung
 * (`useQuickAdd`: khoá chạm đúp, thông báo nổi, nguồn ghi nhận `pdp`); khách chưa đăng nhập thì giỏ khách khi cờ bật, không thì nhớ món rồi sang đăng nhập và
 * quay về trang gói Refill (trang đó thêm nốt món sau khi có phiên). Đang khôi phục phiên thì chưa biết là ai nên bỏ qua cú chạm.
 */
export function PdpRefillOfferBlock({ view, blocked = false }: { view: PdpRefillOfferView; blocked?: boolean }) {
  const router = useRouter();
  const qc = useQueryClient();
  const lastGuestTap = useRef(0);
  const phase = useAuthPhase();
  const guestFlag = useGuestCartFlag();
  const quick = useQuickAdd('pdp', ['refill-pairs', 'public', view.productId]);
  // Hook giỏ nhanh này chỉ phục vụ thẻ Refill: mỗi lời báo thành công là một lần thêm gói (đường đăng nhập lẫn giỏ khách).
  // Thành công: đọc lại giỏ máy chủ, vì nút mua chính và dòng Mua lại ghi giỏ bằng lệnh riêng, lời đáp về sau cùng có thể là bản cũ hơn.
  // Thất bại: thẻ dựng ở máy chủ, không có truy vấn ở trình duyệt để tải lại, nên làm mới trang (gói vừa hết hàng hay đổi giá thì thẻ đổi theo).
  const notice = quick.notice;
  useEffect(() => {
    if (!notice) return;
    if (notice.ok) {
      trackWebEvent('refill_swap_applied', { surface: 'pdp' });
      if (phase === 'authenticated') void qc.invalidateQueries({ queryKey: cartKey() });
    } else router.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ chạy khi có lời báo mới
  }, [notice]);

  const addAsGuest = () => {
    if (!guestFlag.pending && guestFlag.enabled) {
      const now = Date.now();
      if (now - lastGuestTap.current < GUEST_TAP_GAP_MS) return;
      lastGuestTap.current = now;
      const res = addGuestLine({ variationId: view.variationId, slug: view.slug, quantity: 1 });
      if (res.ok) {
        quick.notify({ ok: true, text: 'Đã thêm vào giỏ!' });
        playCartFeedback(addButton());
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

  const onAdd = () => {
    if (blocked || phase === 'loading' || quick.busyId !== null) return;
    if (phase === 'guest') return addAsGuest();
    void quick.addVariation(view.variationId, { origin: addButton() });
  };

  return (
    <>
      <PdpRefillOffer view={view} busy={quick.busyId === view.variationId} blocked={blocked} onAdd={onAdd} />
      {quick.feedback}
    </>
  );
}
