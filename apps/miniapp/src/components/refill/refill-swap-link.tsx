import { useEffect } from 'react';
import type { RefillSwapView } from '@tubutree/app-core/refill/refill-swap';
import { trackEvent } from '../../services/analytics';
import { Text } from '../ui/text';

export interface RefillSwapLinkProps {
  view: RefillSwapView;
  disabled?: boolean;
  onPress: (view: RefillSwapView) => void;
}

const LINK = { display: 'block', marginTop: 'var(--space-stack-sm)', padding: 0, border: 0, background: 'none', textAlign: 'left', cursor: 'pointer' } as const;

/** Liên kết chữ dưới dòng chai trong giỏ ("Đã có chai? Đổi sang Refill 10L · 650.000đ"): không phải dải, không phải nút chính. */
export function RefillSwapLink({ view, disabled, onPress }: RefillSwapLinkProps) {
  const id = view.refill.productId;
  useEffect(() => trackEvent('refill_swap_shown', 'miniapp', { surface: 'cart' }), [id]);
  return (
    <button type="button" data-testid="refill-swap-link" className="tubu-hit-44" disabled={disabled} onClick={() => onPress(view)} style={LINK}>
      <Text variant="caption" tone="brand" style={{ fontWeight: 600, textDecoration: 'underline' }}>
        {view.label}
      </Text>
    </button>
  );
}
