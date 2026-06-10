import { Box, Text } from 'zmp-ui';

/**
 * Bộ chọn số lượng − [n] + . Touch target theo size:
 * PDP dùng 44pt (md), dòng giỏ hàng dùng 36pt (sm) — vẫn ≥ hit area khuyến nghị
 * nhờ padding dòng bao quanh. Disable nút ở min/max thay vì để bấm rồi báo lỗi.
 */
interface QuantitySelectorProps {
  value: number;
  max: number;
  min?: number;
  size?: 'sm' | 'md';
  onChange: (n: number) => void;
}

export function QuantitySelector({ value, max, min = 1, size = 'md', onChange }: QuantitySelectorProps) {
  const side = size === 'md' ? 44 : 36;
  const btn = (disabled: boolean): React.CSSProperties => ({
    width: side,
    height: side,
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--neutral-200)',
    background: disabled ? 'var(--neutral-100)' : 'var(--neutral-0)',
    color: disabled ? 'var(--neutral-400)' : 'var(--neutral-900)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: size === 'md' ? 20 : 17,
    userSelect: 'none',
  });

  return (
    <Box flex alignItems="center" style={{ gap: size === 'md' ? 12 : 8 }}>
      <Box
        role="button"
        aria-label="Giảm số lượng"
        aria-disabled={value <= min}
        className={value > min ? 'tubu-press' : undefined}
        style={btn(value <= min)}
        onClick={() => value > min && onChange(value - 1)}
      >
        −
      </Box>
      <Text bold size={size === 'md' ? 'normal' : 'small'} style={{ minWidth: 22, textAlign: 'center' }}>
        {value}
      </Text>
      <Box
        role="button"
        aria-label="Tăng số lượng"
        aria-disabled={value >= max}
        className={value < max ? 'tubu-press' : undefined}
        style={btn(value >= max)}
        onClick={() => value < max && onChange(value + 1)}
      >
        +
      </Box>
    </Box>
  );
}
