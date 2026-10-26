import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSnackbar } from 'zmp-ui';
import { couponUseCopy, couponUseTarget } from '@tubutree/app-core/coupon-use';
import { cartKey } from '../services/cart-key';
import { getErrorMessage } from '../services/api';
import { applyCoupon } from '../services/shop-api';
import { copyText } from '../utils/clipboard';
import { haptic } from '../utils/haptic';
import { useCartCount } from './use-cart-count';

/**
 * "Sao chép" và "Dùng ngay" của thẻ mã giảm giá. Dùng ngay: giỏ có hàng thì chọn sẵn mã ở giỏ rồi tới giỏ, chưa có hàng thì
 * tới danh sách sản phẩm. Mã không chọn sẵn được (đơn tối thiểu, phạm vi sản phẩm) vẫn đưa khách tới giỏ và nói lý do.
 */
export function useCouponUse() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { openSnackbar } = useSnackbar();
  const cartCount = useCartCount();

  const copy = async (code: string) => {
    const ok = await copyText(code);
    haptic('light');
    openSnackbar(ok ? { text: couponUseCopy.copied, type: 'success' } : { text: couponUseCopy.copyFailed, type: 'error' });
  };

  const use = async (code: string, onBeforeNavigate?: () => void) => {
    haptic('light');
    if (couponUseTarget(cartCount) === 'products') {
      onBeforeNavigate?.();
      navigate('/browse');
      return;
    }
    try {
      const cart = await applyCoupon(code.trim().toUpperCase());
      qc.setQueryData(cartKey(), cart);
      void qc.invalidateQueries({ queryKey: ['quote'] });
      if (cart.couponNotice && cart.discount === 0 && !cart.freeship) {
        openSnackbar({ text: couponUseCopy.notApplied(cart.couponNotice), type: 'warning' });
      }
    } catch (e) {
      openSnackbar({ text: couponUseCopy.notApplied(getErrorMessage(e)), type: 'warning' });
    }
    onBeforeNavigate?.();
    navigate('/cart');
  };

  return { copy, use };
}
