'use client';

import { useEffect } from 'react';
import type { RefillSwapView } from '@tubutree/app-core/refill/refill-swap';
import { Badge } from '@/components/mini/badge';
import { trackWebEvent } from '@/lib/analytics';

export interface RefillSwapLinkProps {
  view: RefillSwapView;
  disabled?: boolean;
  onPress: (view: RefillSwapView) => void;
}

/**
 * Liên kết chữ dưới dòng chai trong giỏ ("Đã có chai? Đổi sang Refill 10L · 650.000đ"), kèm huy hiệu "Rẻ hơn 34%/100ml" khi đọc được lượng:
 * không phải dải, không phải nút chính. Cùng props với Mini App.
 */
export function RefillSwapLink({ view, disabled, onPress }: RefillSwapLinkProps) {
  const id = view.refill.productId;
  useEffect(() => trackWebEvent('refill_swap_shown', { surface: 'cart' }), [id]);
  return (
    <button
      type="button"
      data-testid="refill-swap-link"
      disabled={disabled}
      aria-haspopup={view.needsConfirm ? 'dialog' : undefined}
      onClick={() => onPress(view)}
      className="tubu-hit-44 order-4 mt-2 block basis-full text-left text-caption font-semibold text-[color:var(--color-text-brand)] disabled:opacity-50"
    >
      <span className="underline">{view.label}</span>
      {view.saving && (
        <>
          {' '}
          <Badge tone="success" size="sm">
            {view.saving}
          </Badge>
        </>
      )}
    </button>
  );
}
