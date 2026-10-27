/**
 * Khung trang web dùng chung cho khổ máy tính bảng và máy tính (từ md): cùng một bề rộng tối đa và cùng một lề cho mọi trang,
 * thay cho mỗi trang một `max-w-*`. Ở điện thoại (< md) lớp `px-4` giữ nguyên như trước: chỉ có `md:` là mới.
 * `wide`: trang danh sách, giao dịch, tài khoản; thẳng hàng với logo ở thanh đầu. `narrow`: trang đọc/form, cột hẹp ở giữa;
 * tiêu đề trang nằm TRONG cột đó (không lồng khung hẹp vào khung rộng).
 */
export const PAGE_WIDE = 'mx-auto w-full max-w-frame px-4 md:px-6';
export const PAGE_NARROW = 'mx-auto w-full max-w-3xl px-4 md:px-6';
