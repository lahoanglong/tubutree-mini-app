import { ShoppingCart } from 'lucide-react';
import { useNavigate } from 'zmp-ui';
import { useCartCount } from '../hooks/use-cart-count';
import { vi } from '../i18n/vi';
import { haptic } from '../utils/haptic';
import { Icon } from './ui/icon';
import { CartBadge } from './ui/cart-badge';

/** Nút giỏ dùng chung ở header các trang mua sắm (spec §3.5). */
export function CartButton() {
  const navigate = useNavigate();
  const count = useCartCount();
  return (
    <button
      type="button"
      aria-label={count > 0 ? vi.cart.buttonLabelWithCount(count) : vi.cart.buttonLabel}
      className="tubu-press"
      onClick={() => {
        haptic('light');
        navigate('/cart');
      }}
      style={{
        position: 'relative',
        flex: '0 0 auto',
        width: 44,
        height: 44,
        padding: 0,
        border: 'none',
        borderRadius: 'var(--radius-pill)',
        background: 'var(--color-action-secondary-bg)',
        display: 'grid',
        placeItems: 'center',
        cursor: 'pointer',
      }}
    >
      <Icon icon={ShoppingCart} size="md" tone="brand" />
      <CartBadge count={count} />
    </button>
  );
}
