'use client';

import { Minus, Plus } from 'lucide-react';

interface QuantitySelectorProps {
  value: number;
  max: number;
  min?: number;
  size?: 'sm' | 'md';
  onChange: (n: number) => void;
}

/**
 * Bộ chọn số lượng − [n] +, cùng hành vi với Mini App: ở min/max nút chỉ `aria-disabled` và không làm gì (không dùng
 * `disabled` để nút vẫn focus được). `sm` 36px nhưng vùng chạm vẫn 44px nhờ lớp phủ `after:-inset-1`.
 */
export function QuantitySelector({ value, max, min = 1, size = 'md', onChange }: QuantitySelectorProps) {
  const side = size === 'md' ? 'h-11 w-11' : 'h-9 w-9 relative after:absolute after:-inset-1 after:content-[""]';
  const icon = size === 'md' ? 'h-[18px] w-[18px]' : 'h-[15px] w-[15px]';
  const btn = (disabled: boolean) =>
    `${side} inline-flex items-center justify-center rounded-control border border-stone-450 p-0 ${
      disabled ? 'bg-stone-100 text-stone-500' : 'bg-stone-0 text-stone-900 active:scale-95'
    }`;
  return (
    <div className={`flex items-center ${size === 'md' ? 'gap-3' : 'gap-2'}`}>
      <button
        type="button"
        aria-label="Giảm số lượng"
        aria-disabled={value <= min}
        className={btn(value <= min)}
        onClick={() => value > min && onChange(value - 1)}
      >
        <Minus className={icon} strokeWidth={2.2} aria-hidden="true" />
      </button>
      <span className={`min-w-[22px] text-center font-semibold text-stone-900 ${size === 'md' ? 'text-base' : 'text-sm'}`} aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        aria-label="Tăng số lượng"
        aria-disabled={value >= max}
        className={btn(value >= max)}
        onClick={() => value < max && onChange(value + 1)}
      >
        <Plus className={icon} strokeWidth={2.2} aria-hidden="true" />
      </button>
    </div>
  );
}
