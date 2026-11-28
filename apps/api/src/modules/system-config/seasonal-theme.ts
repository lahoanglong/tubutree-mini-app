/**
 * Giao diện theo mùa của Trang chủ (Mini App và web): admin chọn ở Trung tâm tăng trưởng, không cần dựng lại app.
 * `christmas` = Noel Xanh (cây thông rung quà, lịch 12 ngày, tuyết); `tet` để dành cho giao diện Tết (chưa có, app vẽ như `none`).
 * Danh sách trùng `SEASONAL_THEMES` ở packages/app-core/src/seasonal/seasonal-theme.ts (spec app-core so hai bên).
 */
export const SEASONAL_THEME_KEY = 'theme.seasonal';
export const SEASONAL_THEMES = ['none', 'christmas', 'tet'] as const;
export type SeasonalTheme = (typeof SEASONAL_THEMES)[number];

/** Dòng cấu hình chưa có hoặc hỏng thì không có giao diện mùa: Trang chủ như thường, app không tải gì thêm. */
export const SEASONAL_THEME_FALLBACK: SeasonalTheme = 'none';

export function normalizeSeasonalTheme(v: unknown): SeasonalTheme {
  return typeof v === 'string' && (SEASONAL_THEMES as readonly string[]).includes(v) ? (v as SeasonalTheme) : SEASONAL_THEME_FALLBACK;
}
