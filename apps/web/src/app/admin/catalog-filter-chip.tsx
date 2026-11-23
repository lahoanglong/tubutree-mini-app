import type { ReactNode } from 'react';

export const Count = ({ n }: { n: number }) => <span className="tabular-nums">({n})</span>;

/** Chip bật/tắt của tab Kiểm tra catalog (loại lỗi, tình trạng mô tả, thương hiệu thiếu thành phần): cao 44px trên điện thoại, 36px từ sm. */
export function FilterChip({ active, onPress, children }: { active: boolean; onPress: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onPress}
      className={`min-h-[44px] rounded-full border px-3 text-sm font-medium sm:min-h-[36px] ${active ? 'border-forest-600 bg-forest-600 text-stone-0' : 'border-stone-450 bg-stone-0 text-stone-700 hover:bg-stone-50'}`}
    >
      {children}
    </button>
  );
}
