'use client';

// Nguồn: apps/miniapp/src/components/ui/cart-voucher-hint-strip.tsx (cùng props, cùng test-id).
import { useId } from 'react';
import type { CartVoucherHint } from '@tubutree/app-core/commerce/cart-voucher-hint';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { Button } from './button';

export interface CartVoucherHintStripProps {
  /** Kết quả của `cartVoucherHint` (app-core); chỉ phần `unlock` được vẽ ở đây. Không có `unlock` thì không vẽ gì. */
  hint: CartVoucherHint | null;
  /** Một chạm quay lại chọn thêm món, đặt ngay trên dòng sắp mở khoá. Không truyền thì dòng giữ nguyên như cũ, không có nút. */
  onShopMore?: () => void;
}

/**
 * Nhắc mã sắp mở khoá dưới thanh Miễn phí giao hàng ở Giỏ (còn thiếu bao nhiêu, thanh đầy dần). Chữ, mã và số do `cartVoucherHint` quyết, dùng chung với Mini App.
 * Mời áp mã đã đủ điều kiện (`hint.apply`) KHÔNG vẽ ở đây: hành động áp mã chỉ có một chỗ là hàng "Mã giảm giá" (nút "Áp dụng" của `CouponBox`). Số đo ở `.tubu-vhint*` (mini.css).
 */
export function CartVoucherHintStrip({ hint, onShopMore }: CartVoucherHintStripProps) {
  const unlockTextId = useId();
  const unlock = hint?.unlock ?? null;
  if (!unlock) return null;
  return (
    <div data-testid="cart-voucher-hint" className="tubu-vhint">
      <div data-testid="cart-voucher-unlock" data-kind="unlock" className="tubu-vhint-row tubu-vhint-row--stack">
        {onShopMore ? (
          <div className="tubu-vhint-head">
            <p id={unlockTextId} className="tubu-vhint-text">{unlock.text}</p>
            <Button variant="secondary" className="tubu-vhint-cta" data-testid="cart-voucher-unlock-cta" aria-describedby={unlockTextId} onPress={onShopMore}>
              {fillCopy('cart.voucherHint.shopMoreCta')}
            </Button>
          </div>
        ) : (
          <p className="tubu-vhint-text">{unlock.text}</p>
        )}
        <div
          role="progressbar"
          data-testid="cart-voucher-unlock-bar"
          aria-label={unlock.barAria}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={unlock.pct}
          className="tubu-freeship-track"
        >
          <div className="tubu-freeship-fill" style={{ width: `${unlock.pct}%` }} />
        </div>
      </div>
    </div>
  );
}
