import { describe, it, expect } from 'vitest';
import config from './tailwind.config';

type Shades = Record<string, string>;

describe('web tailwind.config', () => {
  const ext = config.theme?.extend as Record<string, unknown> | undefined;
  const colors = (ext?.colors ?? {}) as Record<string, Shades>;

  it('extends the shared design-tokens preset', () => {
    expect(config.presets?.length).toBeGreaterThan(0);
  });

  // Final review C2: web is NOT migrated in sub-project 3 — dropping the v1 palette made 1,049
  // class uses emit no CSS (white-on-transparent login/checkout CTAs). Hex must match the
  // merge-base (22e36d4) verbatim.
  it('keeps the legacy v1 web palette verbatim until web migrates', () => {
    expect(colors.primary).toMatchObject({ 50: '#FDF3E3', 100: '#FBE4C4', 900: '#5C3505' });
    expect(colors.leaf).toMatchObject({ 50: '#EEF7D9', 600: '#509018', 700: '#3C6D12', 900: '#1F3A09' });
    expect(colors.clay).toMatchObject({ 50: '#FBF4ED', 200: '#EDD4BD', 500: '#C97B4A', 700: '#8C4F2A' });
    expect(colors.sun).toMatchObject({ 300: '#FDD96E', 500: '#F4B400' });
    expect(colors.neutral).toMatchObject({ 0: '#FFFFFF', 50: '#FAFAF8', 200: '#E5E5E0', 900: '#1A1A17' });
  });

  it('re-adds the stock Tailwind neutral shades web used implicitly (preset sets neutral: undefined)', () => {
    expect(colors.neutral).toMatchObject({
      300: '#d4d4d4',
      500: '#737373',
      700: '#404040',
      800: '#262626',
      950: '#0a0a0a',
    });
  });

  it('keeps the old custom border radii', () => {
    expect(ext?.borderRadius).toMatchObject({ sm: '6px', md: '10px', lg: '16px', xl: '24px' });
  });

  it('does not define a custom spacing scale (Tailwind default: p-4 = 1rem)', () => {
    expect(config.theme).not.toHaveProperty('spacing');
    expect(ext).not.toHaveProperty('spacing');
  });

  // C-023 (A4-006): the legacy orange (#E08C1C) was the CTA fill with white text at 2.65:1 and the
  // text colour on #FAFAF8 at 2.53:1. The CTA shades must clear WCAG 1.4.3 (4.5:1) in both roles.
  describe('legacy orange CTA reaches WCAG AA (4.5:1)', () => {
    const luminance = (hex: string) => {
      const [r, g, b] = [1, 3, 5]
        .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a: string, b: string) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    const p = colors.primary as Shades;
    const n = colors.neutral as Shades;

    it('white label on the primary-600 button fill', () => {
      expect(contrast('#FFFFFF', p[600])).toBeGreaterThanOrEqual(4.5);
    });
    it('primary-600 as text on white, the page background and the primary-50 tint', () => {
      for (const bg of ['#FFFFFF', n[50], p[50]]) expect(contrast(p[600], bg)).toBeGreaterThanOrEqual(4.5);
    });
    it('primary-700 (hover fill / tinted-badge text) is darker than 600 and also passes', () => {
      expect(luminance(p[700])).toBeLessThan(luminance(p[600]));
      expect(contrast('#FFFFFF', p[700])).toBeGreaterThanOrEqual(4.5);
      for (const bg of [p[50], p[100]]) expect(contrast(p[700], bg)).toBeGreaterThanOrEqual(4.5);
    });
  });
});
