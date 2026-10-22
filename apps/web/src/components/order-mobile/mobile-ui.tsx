import { Check } from 'lucide-react';

// Lớp dùng chung của nhóm màn đơn hàng/tài khoản để khổ điện thoại (< md) giống Mini App; từ md giữ giao diện máy tính.
// Nguồn kiểu: apps/miniapp/src/components/ui/* (components/mini chưa có Form, CartButton, ô chọn tự vẽ).

/** Lớp `max-md:` được Tailwind phát SAU lớp thường nên đè đúng trong media query mà không cần gỡ lớp gốc. */
export const mini = {
  /** Thẻ ui.card thành thẻ nổi của Mini App: không viền, đổ bóng elevation-1. */
  card: 'max-md:border-0 max-md:shadow-[var(--elevation-1)]',
  /** Dải trắng phẳng tràn ngang (checkout, chi tiết đơn): Box p=4 mt=2 nền surface. */
  band: 'max-md:rounded-none max-md:border-0 max-md:shadow-none',
  /** SectionTitle của Mini App: chữ không chân Inter title-sm, thay serif của web. */
  sectionTitle:
    'max-md:font-ui max-md:text-[length:var(--type-title-sm-size)] max-md:leading-[var(--type-title-sm-lh)] max-md:font-semibold',
  /** Tiêu đề phần của trang thanh toán: Text bold size small của Mini App (14px/600). */
  sectionLabel: 'max-md:font-ui max-md:text-sm max-md:leading-5 max-md:font-semibold',
  /** Nút phụ nền xanh nhạt không viền (--color-action-secondary-*), thay nút trắng viền stone-450. */
  secondary:
    'max-md:border-transparent max-md:bg-[var(--color-action-secondary-bg)] max-md:text-[color:var(--color-action-secondary-fg)] max-md:hover:bg-[var(--color-action-secondary-bg-pressed)]',
  /** Ô ảnh/icon nền --color-bg-subtle (sage-50) thay bg-stone-100. */
  thumb: 'max-md:bg-[var(--color-bg-subtle)]',
} as const;

/**
 * Nút chữ đỏ không nền không viền (Button ghost + màu danger của Mini App). Dựng riêng thay vì chồng `text-danger-fg` lên `ui.btnSecondary`:
 * hai lớp màu chữ cùng trên một nút thì màu nào thắng phụ thuộc thứ tự CSS (nút "Hủy" định kỳ từng hiện chữ đen).
 */
export const miniGhostDanger =
  'inline-flex min-h-11 min-w-max flex-1 items-center justify-center rounded-control bg-transparent px-5 text-sm font-semibold text-danger-fg transition hover:bg-stone-50 active:scale-95 disabled:opacity-50 disabled:active:scale-100';

/** Lớp cho ô chọn: gốc của trình duyệt từ md, ô tự vẽ bo góc xanh (Checkbox của zmp-ui) ở điện thoại. Đi kèm <CheckMark />. */
export const miniCheckbox =
  'peer h-6 w-6 flex-none accent-forest-600 max-md:appearance-none max-md:rounded-[6px] max-md:border-2 max-md:border-[var(--color-border-strong)] max-md:bg-[var(--color-bg-surface)] max-md:checked:border-[var(--color-action-primary-bg)] max-md:checked:bg-[var(--color-action-primary-bg)]';

/** Nút radio tự vẽ như Radio của zmp-ui: vòng viền, chọn rồi thì đặc xanh có chấm trắng. Từ md giữ radio gốc. */
export const miniRadio =
  'h-6 w-6 shrink-0 accent-forest-600 max-md:appearance-none max-md:rounded-full max-md:border-2 max-md:border-[var(--color-border-strong)] max-md:bg-[var(--color-bg-surface)] max-md:checked:border-[var(--color-action-primary-bg)] max-md:checked:bg-[radial-gradient(circle,#fff_0_26%,var(--color-action-primary-bg)_30%)]';

/** Khung 24px bọc input ô chọn + CheckMark. */
export const miniCheckboxWrap = 'relative inline-flex h-6 w-6 flex-none';

/** Dấu tick trắng nằm đè lên ô chọn tự vẽ; đặt NGAY SAU input, cả hai bọc trong `<CheckBox>`-style span `relative inline-flex h-6 w-6` (xem miniCheckboxWrap) để tick bám đúng ô. */
export function CheckMark() {
  return (
    <Check
      aria-hidden="true"
      strokeWidth={3}
      className="pointer-events-none absolute inset-0 m-auto hidden h-4 w-4 text-[color:var(--color-action-primary-fg)] max-md:peer-checked:block"
    />
  );
}
