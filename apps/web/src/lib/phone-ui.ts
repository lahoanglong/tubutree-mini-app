// Kiểu Mini App ở khổ điện thoại (< md) cho các nút/chip dùng chung của nhóm màn mua sắm; từ md giữ giao diện máy tính.

/** Nút phụ của Mini App (zaui secondary): nền xanh nhạt, chữ xanh, không viền; đang tắt thì cặp token `secondary-*-disabled` (lớp `tubu-phone-secondary` ở mini.css). Ghép sau `ui.btnSecondary`. */
export const phoneSecondary =
  'tubu-phone-secondary max-md:border-0 max-md:bg-[var(--color-action-secondary-bg)] max-md:text-[var(--color-action-secondary-fg)] max-md:hover:bg-[var(--color-action-secondary-bg-pressed)]';

/** Nút chữ xanh đậm không gạch chân (Xem tất cả, Nội dung...) như `Text variant="label" tone="brand"` của Mini App. Ghép sau `ui.btnText`. */
export const phoneBrandText = 'max-md:text-[var(--color-text-brand)] max-md:no-underline';

/** Thẻ phẳng của `Card` Mini App: không viền, đổ bóng elevation-1. Ghép sau `ui.card`. */
export const phoneFlatCard = 'max-md:border-0 max-md:shadow-[var(--elevation-1)]';

/** Tiêu đề thẻ 16px như `Heading variant="title-sm"` của Mini App. Ghép sau `ui.sectionTitle` (18px ở máy tính). */
export const phoneSectionTitle = 'max-md:text-[length:var(--type-title-sm-size)] max-md:leading-[var(--type-title-sm-lh)]';

/** Chữ phụ 13px như `Text variant="caption"` của Mini App. Ghép sau `text-xs` (12px ở máy tính). */
export const phoneCaption = 'max-md:text-[length:var(--type-caption-size)] max-md:leading-[var(--type-caption-lh)]';

/** Chữ thân 14px, dòng 22px như `Text variant="body-sm"` của Mini App. Ghép sau `text-sm` (dòng 20px ở máy tính). */
export const phoneBodySm = 'max-md:leading-[var(--type-body-sm-lh)]';

/** Dải trắng riêng của Mini App: nền surface, đệm 16px, cách dải trên 8px trên nền canvas. Ghép sau `mt-N` của máy tính (mt-N bị `max-md:mt-2` thắng ở điện thoại). */
export const phoneBand = 'max-md:mt-2 max-md:bg-[var(--color-bg-surface)] max-md:p-4';

/** Dải trắng chỉ đệm ngang 16px, đệm dọc do khối tự đặt thêm (khối con của cột thông tin trang sản phẩm). */
export const phoneBandPad = 'max-md:bg-[var(--color-bg-surface)] max-md:px-4';

/** Nhãn nhỏ xanh đậm đậm nét như dòng "Tubu Tree giao hàng" và "Nhận Điểm Xanh" của Mini App. Ghép sau `text-sm`. */
export const phoneBrandLabel = 'max-md:text-xs max-md:font-semibold max-md:text-[var(--color-text-brand)]';
