// Kiểu Mini App ở khổ điện thoại (< md) cho các nút/chip dùng chung của nhóm màn mua sắm; từ md giữ giao diện máy tính.

/** Nút phụ của Mini App (zaui secondary): nền xanh nhạt, chữ xanh, không viền. Ghép sau `ui.btnSecondary`. */
export const phoneSecondary =
  'max-md:border-0 max-md:bg-[var(--color-action-secondary-bg)] max-md:text-[var(--color-action-secondary-fg)] max-md:hover:bg-[var(--color-action-secondary-bg-pressed)]';

/** Nút chữ xanh đậm không gạch chân (Xem tất cả, Nội dung...) như `Text variant="label" tone="brand"` của Mini App. Ghép sau `ui.btnText`. */
export const phoneBrandText = 'max-md:text-[var(--color-text-brand)] max-md:no-underline';
