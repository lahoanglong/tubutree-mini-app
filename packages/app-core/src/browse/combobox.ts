/**
 * Hộp gợi ý ở ô tìm của thanh đầu web (mẫu combobox của WAI-ARIA APG): tiêu điểm luôn ở ô nhập, dòng đang chọn chỉ báo qua
 * `aria-activedescendant`. Hàm thuần để test đủ phím mà không cần trình duyệt.
 */
export interface ComboboxState {
  open: boolean;
  /** Vị trí dòng đang chọn; -1 = chưa chọn dòng nào (Enter gửi đúng chữ đang gõ). */
  active: number;
}

/** `pick`: mở dòng `state.active` cũ; `submit`: để form gửi chữ đang gõ; `close`: đóng hộp, tiêu điểm vẫn ở ô. */
export type ComboboxEffect = 'none' | 'pick' | 'submit' | 'close';

export interface ComboboxStep {
  state: ComboboxState;
  effect: ComboboxEffect;
  preventDefault: boolean;
}

export const COMBOBOX_CLOSED: ComboboxState = { open: false, active: -1 };

/** ↓ mở hộp hoặc xuống dòng kế (hết thì vòng lên đầu); ↑ lên dòng trước (đầu thì vòng xuống cuối); Enter mở dòng đang chọn hoặc gửi; Esc và Tab đóng. */
export function comboboxKey(s: ComboboxState, key: string, count: number): ComboboxStep {
  switch (key) {
    case 'ArrowDown':
      // Hộp đóng thì nơi gọi chưa dựng các dòng (count = 0): vẫn chọn dòng đầu, dòng sẽ có khi hộp mở.
      return { state: { open: true, active: !s.open ? 0 : count === 0 ? -1 : (s.active + 1) % count }, effect: 'none', preventDefault: true };
    case 'ArrowUp':
      if (!s.open || count === 0) return { state: s, effect: 'none', preventDefault: s.open };
      return { state: { open: true, active: s.active <= 0 ? count - 1 : s.active - 1 }, effect: 'none', preventDefault: true };
    case 'Enter':
      if (s.open && s.active >= 0 && s.active < count) return { state: COMBOBOX_CLOSED, effect: 'pick', preventDefault: true };
      return { state: COMBOBOX_CLOSED, effect: 'submit', preventDefault: false };
    case 'Escape':
      return s.open ? { state: COMBOBOX_CLOSED, effect: 'close', preventDefault: true } : { state: s, effect: 'none', preventDefault: false };
    case 'Tab':
      return { state: COMBOBOX_CLOSED, effect: s.open ? 'close' : 'none', preventDefault: false };
    default:
      return { state: s, effect: 'none', preventDefault: false };
  }
}

export const SUGGEST_OPTION_LIMITS = { recent: 3, categories: 4 } as const;

export type SuggestOption<C, P> =
  | { kind: 'search'; term: string }
  | { kind: 'recent'; term: string }
  | { kind: 'popular'; term: string }
  | { kind: 'category'; entry: C }
  | { kind: 'product'; product: P; index: number };

/**
 * Các dòng của hộp gợi ý, cùng dữ liệu và thứ tự với `SuggestList` của trang Danh mục: chưa gõ thì từ khoá gần đây rồi cụm tìm phổ
 * biến (bỏ cụm trùng từ gần đây); đang gõ thì "Tìm …", từ gần đây khớp (tối đa 3), danh mục khớp (tối đa 4), sản phẩm của API.
 */
export function suggestOptions<C extends { label: string }, P>(p: {
  draft: string;
  recent: readonly string[];
  popular: readonly string[];
  categories: readonly C[];
  products: readonly P[];
  fold: (s: string) => string;
}): SuggestOption<C, P>[] {
  const term = p.draft.trim();
  const has = (hay: string, needle: string) => {
    const n = p.fold(needle);
    return n.length > 0 && p.fold(hay).includes(n);
  };
  if (!term) {
    const seen = new Set(p.recent.map((r) => p.fold(r)));
    return [
      ...p.recent.map((t): SuggestOption<C, P> => ({ kind: 'recent', term: t })),
      ...p.popular.filter((t) => !seen.has(p.fold(t))).map((t): SuggestOption<C, P> => ({ kind: 'popular', term: t })),
    ];
  }
  return [
    { kind: 'search', term },
    ...p.recent
      .filter((r) => has(r, term))
      .slice(0, SUGGEST_OPTION_LIMITS.recent)
      .map((t): SuggestOption<C, P> => ({ kind: 'recent', term: t })),
    ...p.categories
      .filter((c) => has(c.label, term))
      .slice(0, SUGGEST_OPTION_LIMITS.categories)
      .map((entry): SuggestOption<C, P> => ({ kind: 'category', entry })),
    ...p.products.map((product, index): SuggestOption<C, P> => ({ kind: 'product', product, index })),
  ];
}
