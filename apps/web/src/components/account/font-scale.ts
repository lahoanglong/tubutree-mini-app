import { platformBridge } from '@/lib/platform-bridge';

export type FontScale = 'small' | 'normal' | 'large';

export const FONT_SCALES: readonly FontScale[] = ['small', 'normal', 'large'];

// Khoá và cỡ chữ giống apps/miniapp (utils/font-scale.ts, pages/settings.tsx).
const PREFS_KEY = 'tubu_prefs';
const FONT_PX: Record<FontScale, string> = { small: '15px', normal: '16px', large: '18px' };

export function applyFontScale(scale: FontScale): void {
  document.documentElement.dataset.fontScale = scale;
  document.documentElement.style.fontSize = FONT_PX[scale];
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
