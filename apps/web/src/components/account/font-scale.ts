import { platformBridge } from '@/lib/platform-bridge';

export type FontScale = 'small' | 'normal' | 'large';

export const FONT_SCALES: readonly FontScale[] = ['small', 'normal', 'large'];

// Khoá và cỡ chữ giống apps/miniapp (utils/font-scale.ts, pages/settings.tsx).
const PREFS_KEY = 'tubu_prefs';
// Phần trăm của cỡ gốc trình duyệt (không px) để giữ cỡ chữ mặc định khách đặt (WCAG 1.4.4); ở 16px là 15/16/18px như Mini App.
export const FONT_SIZE: Record<FontScale, string> = { small: '93.75%', normal: '100%', large: '112.5%' };

export function applyFontScale(scale: FontScale): void {
  document.documentElement.dataset.fontScale = scale;
  document.documentElement.style.fontSize = FONT_SIZE[scale];
}

/** Cỡ chữ khách đã chọn; null khi chưa chọn, hỏng hoặc giá trị lạ (để không ghi đè cỡ chữ mặc định của trình duyệt). */
export async function readFontScale(): Promise<FontScale | null> {
  try {
    const raw = await platformBridge.storage.get(PREFS_KEY);
    if (!raw) return null;
    const { fontScale } = JSON.parse(raw) as { fontScale?: unknown };
    return FONT_SCALES.find((s) => s === fontScale) ?? null;
  } catch {
    return null;
  }
}

export async function loadFontScale(): Promise<FontScale> {
  return (await readFontScale()) ?? 'normal';
}

export async function saveFontScale(scale: FontScale): Promise<void> {
  await platformBridge.storage.set(PREFS_KEY, JSON.stringify({ fontScale: scale }));
}
