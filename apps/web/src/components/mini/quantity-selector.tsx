'use client';

// Nguồn: apps/miniapp/src/components/ui/quantity-selector.tsx
import { Plus, Minus } from 'lucide-react';
import { Text } from './text';

/**
 * Bộ chọn số lượng − [n] + . Hai nút là `<button>` thật (Tab + Enter/Space, trình đọc màn hình báo là nút).
 * Nhìn theo size: PDP 44pt (md), dòng giỏ hàng/dealer 36pt (sm); cả hai đều có vùng chạm 44x44 —
 * sm nhờ `.tubu-hit-44-square::after` (giãn 4px mỗi phía, vẫn nằm trong khoảng cách 8px giữa các phần tử
 * nên không chồng lên nút bên cạnh). Ở min/max nút chỉ `aria-disabled` + không làm gì (không dùng
 * `disabled` để nút vẫn là phần tử focus được và đọc được lý do).
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
    borderRadius: 'var(--radius-control)',
    border: '1px solid var(--color-border-subtle)',
    background: disabled ? 'var(--stone-100)' : 'var(--color-bg-surface)',
    color: disabled ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    userSelect: 'none',
    padding: 0,
    margin: 0,
    font: 'inherit',
    cursor: disabled ? 'default' : 'pointer',
  });

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: size === 'md' ? 12 : 8 }}>
      <button
        type="button"
        aria-label="Giảm số lượng"
        aria-disabled={value <= min}
        className={value > min ? 'tubu-press tubu-hit-44-square' : 'tubu-hit-44-square'}
        style={btn(value <= min)}
        onClick={() => value > min && onChange(value - 1)}
      >
        <Minus size={size === 'md' ? 18 : 15} strokeWidth={2.2} />
      </button>
      <Text variant={size === 'md' ? 'body-lg' : 'body-sm'} style={{ minWidth: 22, textAlign: 'center', fontWeight: 600 }}>
        {value}
      </Text>
      <button
        type="button"
        aria-label="Tăng số lượng"
        aria-disabled={value >= max}
        className={value < max ? 'tubu-press tubu-hit-44-square' : 'tubu-hit-44-square'}
        style={btn(value >= max)}
        onClick={() => value < max && onChange(value + 1)}
      >
        <Plus size={size === 'md' ? 18 : 15} strokeWidth={2.2} />
      </button>
    </div>
  );
}
