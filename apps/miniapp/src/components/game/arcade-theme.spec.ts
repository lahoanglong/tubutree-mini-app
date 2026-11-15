// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARCADE_THEME_TOKENS, prefersReducedMotion, readArcadeTheme } from './arcade-theme';

const here = dirname(fileURLToPath(import.meta.url));
const tokensCss =
  readFileSync(join(here, '../../../../../packages/design-tokens/src/tokens.css'), 'utf8') + readFileSync(join(here, '../../css/tokens.css'), 'utf8');

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.removeAttribute('style');
});

describe('theme của canvas mini game', () => {
  it('đủ tám màu, mỗi màu trỏ một token NGỮ NGHĨA (không bậc primitive) có định nghĩa thật', () => {
    expect(Object.keys(ARCADE_THEME_TOKENS).sort()).toEqual(['accent', 'bg', 'cream', 'danger', 'forest', 'ink', 'sage', 'surface']);
    for (const token of Object.values(ARCADE_THEME_TOKENS)) {
      expect(token).toMatch(/^--color-/);
      expect(token).not.toMatch(/^--(forest|sage|stone|clay|orange|red|amber)-/);
      expect(tokensCss, token).toContain(`${token}:`);
    }
  });

  it('đọc giá trị token từ phần tử gốc của lớp phủ và cắt khoảng trắng thừa', () => {
    for (const token of Object.values(ARCADE_THEME_TOKENS)) document.documentElement.style.setProperty(token, ` ${token}-giá-trị `);
    const theme = readArcadeTheme(document.body);
    expect(theme.bg).toBe(`${ARCADE_THEME_TOKENS.bg}-giá-trị`);
    expect(theme.danger).toBe(`${ARCADE_THEME_TOKENS.danger}-giá-trị`);
    expect(Object.values(theme).every((v) => v.length > 0)).toBe(true);
  });

  it('prefers-reduced-motion: bật thì true, matchMedia hỏng thì false', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as never;
    expect(prefersReducedMotion()).toBe(true);
    window.matchMedia = (() => {
      throw new Error('không hỗ trợ');
    }) as never;
    expect(prefersReducedMotion()).toBe(false);
  });
});
