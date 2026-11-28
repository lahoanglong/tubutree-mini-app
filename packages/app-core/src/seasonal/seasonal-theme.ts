/**
 * Giao diện theo mùa của Trang chủ (khoá cấu hình `theme.seasonal`, trả ở `seasonalTheme` của `/config/public` và khối `publicConfig` của `/home`).
 * Mô-đun nhỏ, không kéo chữ hay hình: chỗ gắn khối mùa ở Trang chủ chỉ đọc giá trị và lời nhắc lần trước, mã của từng mùa nằm ở chunk riêng.
 * Danh sách trùng `SEASONAL_THEMES` ở apps/api/src/modules/system-config/seasonal-theme.ts (spec so hai bên).
 */
export const SEASONAL_THEMES = ['none', 'christmas', 'tet'] as const;
export type SeasonalTheme = (typeof SEASONAL_THEMES)[number];

/** API cũ không trả, giá trị lạ: không có giao diện mùa. */
export function normalizeSeasonalTheme(v: unknown): SeasonalTheme {
  return typeof v === 'string' && (SEASONAL_THEMES as readonly string[]).includes(v) ? (v as SeasonalTheme) : 'none';
}

/** Mùa đã có giao diện trên Trang chủ. `tet` để dành: chưa có giao diện nên vẽ như `none`, không tải chunk nào. */
export function seasonHasHomeTheme(theme: SeasonalTheme): theme is 'christmas' {
  return theme === 'christmas';
}

/** Chiều cao thẻ cây thông (`.tubu-xmas-hero` trong design-tokens/src/seasonal-christmas.css): chỗ gắn giữ đúng chừng này khi chunk mùa lễ chưa về. */
export const CHRISTMAS_HERO_HEIGHT = 184;

export type HintStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Mùa của lần mở trước trên máy này: Trang chủ giữ đúng chỗ của khối mùa trước khi cấu hình về, nên khối không chen vào đẩy trang. */
export const SEASON_HINT_KEY = 'tubu_season_hint';

export function readSeasonHint(storage: HintStorage | null): SeasonalTheme {
  try {
    return normalizeSeasonalTheme(storage?.getItem(SEASON_HINT_KEY));
  } catch {
    return 'none';
  }
}

export function writeSeasonHint(storage: HintStorage | null, theme: SeasonalTheme): void {
  try {
    if (storage && storage.getItem(SEASON_HINT_KEY) !== theme) storage.setItem(SEASON_HINT_KEY, theme);
  } catch {
    /* bộ nhớ bị chặn (chế độ riêng tư): lần mở sau chỉ mất phần giữ chỗ */
  }
}
