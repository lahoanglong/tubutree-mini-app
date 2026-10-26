'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { couponUseCopy, couponUseTarget } from '@tubutree/app-core/coupon-use';
import { useAuthPhase } from '@/lib/auth-phase';
import { cartKey, useCartKey } from '@/lib/cart-key';
import { copyText } from '@/lib/copy-text';
import { applyCoupon, getCart } from '@/lib/shop-client';

export interface CouponNotice {
  code: string;
  text: string;
  error: boolean;
}

/**
 * "Sao chép" và "Dùng ngay" của thẻ mã giảm giá (cùng luật với Mini App). Web không có snackbar nên câu báo trả ở `notice`
 * để thẻ in một dòng `role="status"`. Dùng ngay: giỏ có hàng thì chọn sẵn mã ở giỏ rồi tới giỏ, chưa có hàng thì tới sản phẩm.
 */
export function useCouponUse() {
  const router = useRouter();
  const qc = useQueryClient();
  const phase = useAuthPhase();
  const cartCount = useQuery({ queryKey: useCartKey(), queryFn: getCart, enabled: phase === 'authenticated' }).data?.itemCount ?? 0;
  const [notice, setNotice] = useState<CouponNotice | null>(null);

  const copy = async (code: string) => {
    const ok = await copyText(code);
    setNotice(ok ? { code, text: couponUseCopy.copied, error: false } : { code, text: couponUseCopy.copyFailed, error: true });
  };

  const use = async (code: string, onBeforeNavigate?: () => void) => {
    if (couponUseTarget(cartCount) === 'products') {
      onBeforeNavigate?.();
      router.push('/san-pham');
      return;
    }
    try {
      const cart = await applyCoupon(code.trim().toUpperCase());
      qc.setQueryData(cartKey(), cart);
      void qc.invalidateQueries({ queryKey: ['quote'] });
    } catch {
      // Mã không chọn sẵn được (đơn tối thiểu, phạm vi sản phẩm): vẫn tới giỏ, ở đó khách tự nhập hoặc chọn mã khác.
    }
    onBeforeNavigate?.();
    router.push('/gio-hang');
  };

  return { copy, use, notice };
}
