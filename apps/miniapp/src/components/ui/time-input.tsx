import type { AriaAttributes, CSSProperties } from 'react';
import { vi } from '../../i18n/vi';

interface TimeInputProps extends Pick<AriaAttributes, 'aria-label' | 'aria-labelledby' | 'aria-describedby' | 'aria-invalid'> {
  value: string;
  onChange: (v: string) => void;
  style?: CSSProperties;
  /** `Field` cấp id để gắn `<label htmlFor>`. */
  id?: string;
}

/** Ô chọn giờ native (type="time") — ZaUI Input không hỗ trợ type=time. Bấm 1 chạm hiện bánh xe giờ.
 * Luôn có tên truy cập (axe `label`): nhãn từ `Field` (id) hoặc aria-label/labelledby của chỗ gọi;
 * không có gì thì dùng tên mặc định "Giờ" — aria-label thắng `<label for>` nên chỉ đặt khi chưa có nguồn tên nào. */
export function TimeInput({ value, onChange, style, id, ...aria }: TimeInputProps) {
  const named = id !== undefined || aria['aria-label'] !== undefined || aria['aria-labelledby'] !== undefined;
  return (
    <input
      id={id}
      aria-label={named ? undefined : vi.common.timeInput}
      {...aria}
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
