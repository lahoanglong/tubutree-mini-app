/**
 * Lớp nút chính của web khách (`ui.btnPrimary` trong guest-ui.ts lấy từ đây). Tệp riêng, không nhập gì: khung lỗi gốc (app/error, app/global-error)
 * nằm trong JS tải lần đầu của MỌI trang, nhập `ui` thì kéo cả bảng lớp của guest-ui vào từng khung.
 */
export const BTN_PRIMARY =
  'inline-flex min-h-11 items-center justify-center rounded-control bg-forest-600 px-5 text-sm font-semibold text-stone-0 shadow-card transition hover:bg-forest-700 active:scale-[0.97] motion-reduce:active:scale-100 disabled:bg-stone-200 disabled:text-stone-500 disabled:shadow-none disabled:active:scale-100 aria-disabled:bg-stone-200 aria-disabled:text-stone-500 aria-disabled:shadow-none aria-disabled:active:scale-100';
