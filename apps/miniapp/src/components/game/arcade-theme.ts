import type { ArcadeTheme } from '@tubutree/app-core/arcade/arcade-canvas';

/** Màu của canvas lấy từ token ngữ nghĩa lúc mở ván: `mountArcade` không có màu viết cứng. */
export const ARCADE_THEME_TOKENS: Readonly<Record<keyof ArcadeTheme, string>> = {
  bg: '--color-bg-subtle',
  surface: '--color-bg-surface',
  forest: '--color-text-brand',
  sage: '--color-action-secondary-border',
  cream: '--color-track',
  ink: '--color-text-primary',
  accent: '--color-flash-fg',
  danger: '--color-text-danger',
};

export function readArcadeTheme(el: Element): ArcadeTheme {
  const style = getComputedStyle(el);
  const theme = {} as Record<keyof ArcadeTheme, string>;
  for (const [name, token] of Object.entries(ARCADE_THEME_TOKENS) as [keyof ArcadeTheme, string][]) {
    theme[name] = style.getPropertyValue(token).trim();
  }
  return theme;
}

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
