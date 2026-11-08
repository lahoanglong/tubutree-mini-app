'use client';

// Nguồn: apps/miniapp/src/components/ui/cart-voucher-hint-strip.tsx (cùng props, cùng test-id).
import { useId } from 'react';
import type { CartVoucherHint } from '@tubutree/app-core/commerce/cart-voucher-hint';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { Button } from './button';

export interface CartVoucherHintStripProps {
  /** Kết quả của `cartVoucherHint` (app-core); null hoặc không có gì để nói thì không vẽ gì. */
  hint: CartVoucherHint | null;
  /** Áp mã dùng được: nhận mã thật (`hint.apply.code`). */
  onApply: (code: string) => void;
  /** Đang áp: nút báo bận (giữ nhãn) và không nhận thêm cú chạm. */
  applying?: boolean;
  /** Lời báo khi áp không được; hiện ngay dưới dòng mời áp. */
  error?: string | null;
  /** Một chạm quay lại chọn thêm món, đặt ngay trên dòng sắp mở khoá. Không truyền thì dòng giữ nguyên như cũ, không có nút. */
  onShopMore?: () => void;
}

/**
 * Gợi ý mã giảm giá dưới thanh Miễn phí giao hàng ở Giỏ. Hai dòng độc lập, mỗi dòng chỉ hiện khi có: mời áp mã đã đủ điều kiện (một chạm)
 * và nhắc mã sắp mở khoá (còn thiếu bao nhiêu, thanh đầy dần). Chữ, mã và số do `cartVoucherHint` quyết, dùng chung với Mini App. Số đo ở `.tubu-vhint*` (mini.css).
 */
export function CartVoucherHintStrip({ hint, onApply, applying = false, error = null, onShopMore }: CartVoucherHintStripProps) {
  const unlockTextId = useId();
  const apply = hint?.apply ?? null;
  const unlock = hint?.unlock ?? null;
  if (!apply && !unlock) return null;
  return (
    <div data-testid="cart-voucher-hint" className="tubu-vhint">
      {apply && (
        <div data-testid="cart-voucher-apply" data-kind="apply" className="tubu-vhint-row">
          <p className="tubu-vhint-text">{apply.text}</p>
          <Button
            variant="secondary"
            className="tubu-vhint-cta"
            data-testid="cart-voucher-apply-cta"
            aria-label={apply.ariaLabel}
            loading={applying}
            onPress={() => onApply(apply.code)}
          >
            {fillCopy('cart.voucherHint.applyCta')}
          </Button>
        </div>
      )}
      {apply && error && (
        <p role="alert" data-testid="cart-voucher-error" className="tubu-vhint-error">
          {error}
        </p>
      )}
      {unlock && (
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
      )}
    </div>
  );
}
