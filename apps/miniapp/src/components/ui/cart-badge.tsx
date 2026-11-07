import { vi } from '../../i18n/vi';
import { useCartBumpKey } from '../../utils/cart-feedback';

/**
 * Huy hiệu đếm trên icon (giỏ hàng, tab Đơn hàng). Đặt trong phần tử `position: relative`.
 * Trước đây Trang chủ/Duyệt dùng `--clay-500`, trang sản phẩm dùng `--primary-600` — cùng con số
 * mà hai màu. Nay một nguồn, token DS v2.
 */
export function CountBadge({ count, label, bump = false }: { count: number; label: string; bump?: boolean }) {
  const bumpKey = useCartBumpKey(bump);
  if (count <= 0) return null;
  return (
    <span
      key={bump ? bumpKey : undefined}
      className={bump && bumpKey > 0 ? 'cart-badge-bump' : undefined}
      aria-label={label}
      style={{
        position: 'absolute',
        top: -2,
        right: -2,
        minWidth: 18,
        height: 18,
        borderRadius: 'var(--radius-pill)',
        background: 'var(--color-promo-solid-bg)',
        color: 'var(--color-promo-solid-fg)',
        fontSize: 11,
        fontWeight: 700,
        fontVariantNumeric: 'tabular-nums',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 4px',
        boxSizing: 'border-box',
      }}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

/** Huy hiệu giỏ: nảy 220ms mỗi lần khách thêm vào giỏ (`playCartFeedback`), tắt khi bật giảm chuyển động. */
export function CartBadge({ count }: { count: number }) {
  return <CountBadge count={count} bump label={vi.cart.badgeLabel(count)} />;
}
