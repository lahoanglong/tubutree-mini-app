import { vi } from '../../i18n/vi';

/**
 * Huy hiệu đếm trên icon (giỏ hàng, tab Đơn hàng). Đặt trong phần tử `position: relative`.
 * Trước đây Trang chủ/Duyệt dùng `--clay-500`, trang sản phẩm dùng `--primary-600` — cùng con số
 * mà hai màu. Nay một nguồn, token DS v2.
 */
export function CountBadge({ count, label, bounce }: { count: number; label: string; bounce?: boolean }) {
  if (count <= 0) return null;
  return (
    <span
      className={bounce ? 'tubu-bounce' : undefined}
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

export function CartBadge({ count, bounce }: { count: number; bounce?: boolean }) {
  return <CountBadge count={count} bounce={bounce} label={vi.cart.badgeLabel(count)} />;
}
