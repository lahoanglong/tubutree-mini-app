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
    expect(colors.primary).toMatchObject({ 50: '#FDF3E3', 600: '#E08C1C', 700: '#B86A10', 900: '#5C3505' });
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
});
