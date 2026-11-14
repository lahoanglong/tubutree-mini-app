'use client';

import { Minus, Plus } from 'lucide-react';
import { parseQtyInput } from '@tubutree/app-core/qty-input';

interface QuantitySelectorProps {
  value: number;
  max: number;
  min?: number;
  size?: 'sm' | 'md';
  onChange: (n: number) => void;
  /** Khoá cả − lẫn + (dòng hết hàng): nút vẫn là phần tử đọc được, chỉ không đổi số. */
  disabled?: boolean;
  /** Cho gõ số trực tiếp vào ô giữa thay vì chỉ bấm − và +. */
  editable?: boolean;
  /** Nút cộng nhanh (+5, +10...) đặt dưới bộ đếm; cộng dồn rồi kẹp vào max. */
  quickSteps?: readonly number[];
  /** Tên món: bộ chọn lặp theo danh sách thì tên nút phải khác nhau ("Giảm số lượng Sữa tắm"), không thì trình đọc màn hình đọc chục nút "Giảm số lượng" y hệt. */
  itemLabel?: string;
}

/**
 * Bộ chọn số lượng − [n] +, cùng hành vi với Mini App: ở min/max nút chỉ `aria-disabled` và không làm gì (không dùng
 * `disabled` để nút vẫn focus được). `sm` 36px nhưng vùng chạm vẫn 44px nhờ lớp phủ `after:-inset-1`; nút cộng nhanh rộng theo chữ nhưng không dưới 44px (`min-w-11`).
 */
export function QuantitySelector({ value, max, min = 1, size = 'md', onChange, editable, quickSteps, disabled, itemLabel }: QuantitySelectorProps) {
  const named = (base: string) => (itemLabel ? `${base} ${itemLabel}` : base);
  const side = size === 'md' ? 'h-11 w-11' : 'h-9 w-9 relative after:absolute after:-inset-1 after:content-[""]';
  const icon = size === 'md' ? 'h-[18px] w-[18px]' : 'h-[15px] w-[15px]';
  const btn = (disabled: boolean) =>
    `${side} inline-flex items-center justify-center rounded-control border border-stone-450 p-0 ${
      disabled ? 'bg-stone-100 text-stone-500' : 'tubu-press bg-stone-0 text-stone-900'
    }`;
  const row = (
    <div className={`flex items-center ${size === 'md' ? 'gap-3' : 'gap-2'}`}>
      <button
        type="button"
        aria-label={named('Giảm số lượng')}
        aria-disabled={disabled || value <= min}
        className={btn(!!disabled || value <= min)}
        onClick={() => !disabled && value > min && onChange(value - 1)}
      >
        <Minus className={icon} strokeWidth={2.2} aria-hidden="true" />
      </button>
      {editable ? (
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          aria-label={named('Số lượng')}
          value={String(value)}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => onChange(parseQtyInput(e.target.value, min, max))}
          className={`w-14 rounded-control border border-stone-450 bg-stone-0 text-center font-semibold tabular-nums text-stone-900 h-11 ${size === 'md' ? 'text-base' : 'text-sm'}`}
        />
      ) : (
        <span className={`min-w-[22px] text-center font-semibold tabular-nums text-stone-900 ${size === 'md' ? 'text-base' : 'text-sm'}`} aria-live="polite">
          {value}
        </span>
      )}
      <button
        type="button"
        aria-label={named('Tăng số lượng')}
        aria-disabled={disabled || value >= max}
        className={btn(!!disabled || value >= max)}
        onClick={() => !disabled && value < max && onChange(value + 1)}
      >
        <Plus className={icon} strokeWidth={2.2} aria-hidden="true" />
      </button>
    </div>
  );
  if (!quickSteps || quickSteps.length === 0) return row;
  return (
    <div className="flex flex-col gap-2">
      {row}
      <div className="flex gap-2">
        {quickSteps.map((n) => (
          <button
            key={n}
            type="button"
            aria-label={named(`Thêm ${n}`)}
            aria-disabled={disabled || value >= max}
            className={`${btn(!!disabled || value >= max)} !w-auto min-w-11 px-3 text-sm font-semibold`}
            onClick={() => !disabled && value < max && onChange(Math.min(max, value + n))}
          >
            {`+${n}`}
          </button>
        ))}
      </div>
    </div>
  );
}
