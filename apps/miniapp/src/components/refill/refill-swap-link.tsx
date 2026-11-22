import { useEffect } from 'react';
import type { RefillSwapView } from '@tubutree/app-core/refill/refill-swap';
import { trackEvent } from '../../services/analytics';
import { Badge } from '../ui/badge';
import { Text } from '../ui/text';

export interface RefillSwapLinkProps {
  view: RefillSwapView;
  disabled?: boolean;
  onPress: (view: RefillSwapView) => void;
}

const LINK = { display: 'block', marginTop: 'var(--space-stack-sm)', padding: 0, border: 0, background: 'none', textAlign: 'left', cursor: 'pointer' } as const;

/**
 * Liên kết chữ dưới dòng chai trong giỏ ("Đã có chai? Đổi sang Refill 10L · 650.000đ"), kèm huy hiệu "Tiết kiệm 470.000đ" (so với mua chai
 * cùng lượng; gói nhỏ hơn một chai thì "Rẻ hơn 34%/100ml") khi đọc được lượng: không phải dải, không phải nút chính. Cùng props với web.
 */
export function RefillSwapLink({ view, disabled, onPress }: RefillSwapLinkProps) {
  const id = view.refill.productId;
  useEffect(() => trackEvent('refill_swap_shown', 'miniapp', { surface: 'cart' }), [id]);
  return (
    <button
      type="button"
      data-testid="refill-swap-link"
      className="tubu-hit-44"
      disabled={disabled}
      aria-haspopup={view.needsConfirm ? 'dialog' : undefined}
      onClick={() => onPress(view)}
      style={disabled ? { ...LINK, opacity: 0.5 } : LINK}
    >
      <Text variant="caption" tone="brand" style={{ fontWeight: 600, textDecoration: 'underline' }}>
        {view.label}
      </Text>
      {view.saving && (
        <>
          {' '}
          <Badge tone="success" size="sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {view.saving}
          </Badge>
        </>
      )}
    </button>
  );
}
