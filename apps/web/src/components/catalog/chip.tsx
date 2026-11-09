import type { ReactNode } from 'react';

/** Chip chọn/bỏ chọn (sắp xếp, bộ lọc, lọc đang bật). Vùng chạm 44px; trạng thái chọn đọc được qua aria-pressed. */
export function Chip({
  selected,
  onPress,
  ariaLabel,
  disabled = false,
  children,
}: {
  selected: boolean;
  onPress: () => void;
  ariaLabel?: string;
  /** Khoá chip (đang gửi dở): nút DOM `disabled` thật, không bấm, không nhận focus. */
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onPress}
      className={`inline-flex min-h-11 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-4 text-sm tabular-nums transition-all tubu-hit-44 max-md:px-3.5 ${
        disabled ? 'cursor-not-allowed opacity-60' : 'tubu-press'
      } ${
        selected
          ? 'bg-forest-600 font-semibold text-stone-0 shadow-card ring-2 ring-forest-600/30 max-md:shadow-none max-md:ring-0'
          : 'border border-stone-300 bg-stone-0 font-medium text-stone-700 hover:border-stone-450 hover:bg-stone-50 max-md:border-0 max-md:bg-stone-100 max-md:text-[var(--color-text-secondary)]'
      }`}
    >
      {children}
    </button>
  );
}
