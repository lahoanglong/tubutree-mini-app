import type { CSSProperties } from 'react';
import { Text } from 'zmp-ui';
import { formatVnd } from '../../utils/format';

/**
 * Hiển thị giá tiền. Gom về một chỗ vì giá xuất hiện ở rất nhiều màn (thẻ sản phẩm, chi tiết,
 * giỏ, thanh toán, đơn hàng) và trước đây mỗi chỗ tự quyết cỡ chữ/độ đậm/màu — cùng một con số
 * trông khác nhau giữa các trang, còn giá gạch thì chỗ có chỗ không.
 */
export function Price({
  value,
  /** Giá gốc để gạch ngang khi đang giảm. Bỏ qua nếu không nhỏ hơn `value`. */
  compareAt,
  size = 'medium',
  tone = 'brand',
  style,
}: {
  value: number;
  compareAt?: number | null;
  size?: 'small' | 'medium' | 'large';
  tone?: 'brand' | 'default';
  style?: CSSProperties;
}) {
  const fontSize = size === 'large' ? 20 : size === 'small' ? 13 : 16;
  const showCompare = typeof compareAt === 'number' && compareAt > value;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, ...style }}>
      <Text
        bold
        style={{ fontSize, color: tone === 'brand' ? 'var(--primary-700)' : 'var(--neutral-900)' }}
      >
        {formatVnd(value)}
      </Text>
      {showCompare && (
        <Text style={{ fontSize: Math.max(11, fontSize - 4), color: 'var(--neutral-400)', textDecoration: 'line-through' }}>
          {formatVnd(compareAt)}
        </Text>
      )}
    </span>
  );
}

/** % giảm giá, chỉ hiện khi thực sự có giảm. Làm tròn xuống để không hứa quá mức thực tế. */
export function DiscountPct({ value, compareAt }: { value: number; compareAt?: number | null }) {
  if (typeof compareAt !== 'number' || compareAt <= value || compareAt <= 0) return null;
  const pct = Math.floor(((compareAt - value) / compareAt) * 100);
  if (pct <= 0) return null;
  return (
    <span
      style={{
        background: 'var(--danger-bg)',
        color: 'var(--danger)',
        fontSize: 11,
        fontWeight: 700,
        padding: '2px 6px',
        borderRadius: 'var(--radius-sm)',
      }}
    >
      -{pct}%
    </span>
  );
}
