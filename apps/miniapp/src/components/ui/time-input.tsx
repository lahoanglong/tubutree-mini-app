import type { CSSProperties } from 'react';

/** Ô chọn giờ native (type="time") — ZaUI Input không hỗ trợ type=time. Bấm 1 chạm hiện bánh xe giờ. */
export function TimeInput({
  value,
  onChange,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  style?: CSSProperties;
}) {
  return (
    <input
      type="time"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: '100%',
        padding: '10px 12px',
        borderRadius: 8,
        border: '1px solid var(--neutral-200, #dcdcdc)',
        fontSize: 16,
        background: 'var(--neutral-0, #fff)',
        color: 'inherit',
        boxSizing: 'border-box',
        ...style,
      }}
    />
  );
}
