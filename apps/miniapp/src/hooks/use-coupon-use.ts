import { useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'zmp-ui';
import { useNotify } from './use-notify';
import { couponUseCopy, couponUseOutcome, couponUseTarget } from '@tubutree/app-core/coupon-use';
import { cartKey } from '../services/cart-key';
import { getErrorMessage, isStaleStateError } from '../services/api';
import { applyCoupon, getCart } from '../services/shop-api';
import { copyText } from '../utils/clipboard';
import { haptic } from '../utils/haptic';

/**
 * "Sao chép" và "Dùng ngay" của thẻ mã giảm giá. Dùng ngay: chờ giỏ tải xong rồi mới quyết (giỏ chưa tải không được coi là trống);
 * giỏ có hàng thì chọn sẵn mã ở giỏ rồi tới giỏ, chưa có hàng thì tới danh sách sản phẩm. Mã không chọn sẵn được (đơn tối
 * thiểu, phạm vi sản phẩm) vẫn đưa khách tới giỏ và nói lý do; giỏ đang giữ mã khác thì báo đã đổi.
 */
export function useCouponUse() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { notify } = useNotify();
  // Khoá đồng bộ chống chạm đúp: chỉ một lần "Dùng ngay" đang chạy, nên chuyển trang đúng một lần.
  const busy = useRef(false);

  const copy = async (code: string) => {
    const ok = await copyText(code);
    haptic('light');
    notify(ok ? { text: couponUseCopy.copied, type: 'success' } : { text: couponUseCopy.copyFailed, type: 'error' });
  };

  const apply = async (code: string, onBeforeNavigate?: () => void) => {
    if (busy.current) return;
    busy.current = true;
    try {
      await run(code, onBeforeNavigate);
    } finally {
      busy.current = false;
    }
  };

  const run = async (code: string, onBeforeNavigate?: () => void) => {
    haptic('light');
    let before;
    try {
      before = await qc.fetchQuery({ queryKey: cartKey(), queryFn: getCart, staleTime: 15_000 });
    } catch (e) {
      // Không đọc được giỏ: không đoán là trống, đưa khách tới giỏ để thấy tình trạng thật.
      notify({ text: couponUseCopy.notApplied(getErrorMessage(e)), type: 'warning' });
      onBeforeNavigate?.();
      navigate('/cart');
      return;
    }
    if (couponUseTarget(before.itemCount) === 'products') {
      onBeforeNavigate?.();
      navigate('/browse');
      return;
    }
    try {
      const cart = await applyCoupon(code.trim().toUpperCase());
      qc.setQueryData(cartKey(), cart);
      void qc.invalidateQueries({ queryKey: ['quote'] });
      const outcome = couponUseOutcome(before.couponCode, code, cart);
      if (outcome.kind !== 'ok') notify({ text: outcome.text, type: outcome.kind === 'notApplied' ? 'warning' : 'info' });
    } catch (e) {
      notify({ text: couponUseCopy.notApplied(getErrorMessage(e)), type: 'warning' });
      // Máy chủ từ chối mã (hết lượt, đã dùng, bị thu hồi: 400/404/409) mà thẻ trong ví còn nói dùng được: đọc lại ví ở nền để thẻ không mời "Dùng ngay" lần nữa.
      // Không giữ khoá chờ: ngay sau đây đã chuyển sang giỏ, chỗ nào giữ khoá cũng đã rời màn.
      if (isStaleStateError(e)) void qc.invalidateQueries({ queryKey: ['coupons'] });
    }
    onBeforeNavigate?.();
    navigate('/cart');
  };

  return { copy, apply };
}
