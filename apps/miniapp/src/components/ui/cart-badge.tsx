/**
 * Huy hiệu số lượng trên icon giỏ hàng.
 *
 * Trước đây mỗi màn tự vẽ: Trang chủ và Duyệt dùng `--clay-500`, trang sản phẩm dùng
 * `--primary-600` — cùng một con số nhưng hai màu, đọc như hai loại thông tin khác nhau.
 * Đặt trong một phần tử `position: relative`.
 */
export function CartBadge({ count, bounce }: { count: number; bounce?: boolean }) {
  if (count <= 0) return null;
  return (
    <span
      className={bounce ? 'tubu-bounce' : undefined}
      aria-label={`${count} sản phẩm trong giỏ`}
      style={{
        position: 'absolute',
        top: -2,
        right: -2,
        minWidth: 18,
        height: 18,
        borderRadius: 'var(--radius-full)',
        background: 'var(--clay-500)',
        color: 'var(--neutral-0)',
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
