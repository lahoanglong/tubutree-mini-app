/**
 * Chữ số rộng đều nhau cho mọi số trong quản trị (bộ đếm việc, doanh thu, tồn kho, tổng đơn, huy hiệu menu): số đổi theo lượt tải lại
 * hay bộ lọc không làm cột và thẻ nhảy bề rộng.
 *
 * `font-variant-numeric` được kế thừa nên `tabular-nums` ở khung gốc là đủ, TRỪ: (1) nút, ô nhập, ô chọn đặt lại về `normal`
 * (đo bằng Chromium) mà bộ đếm và huy hiệu nằm ngay trong `<button>`; (2) ngăn trượt và hộp thoại render qua portal ra ngoài khung gốc.
 * Nên khung gốc của quản trị (app/admin/layout.tsx) và gốc mỗi portal quản trị cùng dùng hằng này.
 *
 * Để ở file TS thường (không 'use client') vì layout của Next là server component.
 */
export const ADMIN_TABULAR = 'tabular-nums [&_button]:tabular-nums [&_input]:tabular-nums [&_select]:tabular-nums [&_textarea]:tabular-nums';
