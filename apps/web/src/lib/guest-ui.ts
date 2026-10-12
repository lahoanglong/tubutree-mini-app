const FIELD_BASE =
  'min-h-11 w-full rounded-control border bg-stone-0 px-3 text-sm text-stone-900 placeholder:text-stone-500 disabled:bg-stone-100 disabled:text-stone-500';

/**
 * Lớp Tailwind dùng chung cho các trang web khách (DS v2, C-097). Gom một chỗ để giỏ hàng, thanh toán,
 * tài khoản, đăng nhập... cùng một nút/ô nhập/thẻ thay vì mỗi trang tự pha màu và bo góc.
 * Chỉ dùng token của preset (forest/stone/promo/danger/success/warning, rounded-control/card/sheet).
 * Vùng chạm tối thiểu 44px (`min-h-11`); viền ô nhập dùng stone-450 để đủ 3:1 (WCAG 1.4.11).
 */
export const ui = {
  card: 'rounded-card border border-stone-200 bg-stone-0 shadow-card',
  /** Tiêu đề trang (h1) — Fraunces như trang chủ. */
  pageTitle: 'font-display text-2xl font-semibold text-stone-900',
  sectionTitle: 'font-display text-lg font-semibold text-stone-900',
  backLink: 'inline-flex min-h-11 items-center text-sm font-medium text-forest-600 hover:text-forest-700 hover:underline',
  field: `${FIELD_BASE} border-stone-450`,
  /** Ô nhập đang báo lỗi: đổi màu viền bằng lớp riêng, không chồng hai lớp `border-*` lên nhau (thứ tự CSS không đảm bảo). */
  fieldError: `${FIELD_BASE} border-danger-fg`,
  btnPrimary:
    'inline-flex min-h-11 items-center justify-center rounded-control bg-forest-600 px-5 text-sm font-semibold text-stone-0 shadow-card transition hover:bg-forest-700 active:scale-95 disabled:bg-stone-200 disabled:text-stone-500 disabled:shadow-none disabled:active:scale-100',
  btnSecondary:
    'inline-flex min-h-11 items-center justify-center rounded-control border border-stone-450 bg-stone-0 px-5 text-sm font-semibold text-stone-800 transition hover:bg-stone-50 active:scale-95 disabled:text-stone-500 disabled:active:scale-100',
  /** Nút chữ (thử lại, xoá...) — vẫn đủ 44px để bấm trên điện thoại. */
  btnText: 'inline-flex min-h-11 items-center px-2 text-sm font-semibold underline disabled:opacity-50',
  error: 'text-sm text-danger-fg',
} as const;
