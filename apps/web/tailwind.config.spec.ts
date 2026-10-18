import { describe, it, expect } from 'vitest';
import { tailwindPreset } from '@tubutree/design-tokens';
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
  describe('legacy web palette reaches WCAG AA (4.5:1) where it carries text', () => {
    const channel = (hex: string, at: number) => {
      const c = parseInt(hex.slice(at, at + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (hex: string) => 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
    const contrast = (a: string, b: string) => {
      const [la, lb] = [luminance(a), luminance(b)];
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    };
    const shade = (family: Shades, key: number) => {
      const hex = family[key];
      if (!hex) throw new Error(`missing shade ${key}`);
      return hex;
    };
    const primary = colors.primary as Shades;
    const neutral = colors.neutral as Shades;
    const p = (key: number) => shade(primary, key);
    const n = (key: number) => shade(neutral, key);
    const green = colors.green as Shades;
    const g = (key: number) => shade(green, key);

    it('white label on the primary-600 button fill', () => {
      expect(contrast('#FFFFFF', p(600))).toBeGreaterThanOrEqual(4.5);
    });
    it('primary-600 as text on white, the page background and the primary-50 tint', () => {
      for (const bg of ['#FFFFFF', n(50), p(50)]) expect(contrast(p(600), bg)).toBeGreaterThanOrEqual(4.5);
    });
    it('primary-700 (hover fill / tinted-badge text) is darker than 600 and also passes', () => {
      expect(luminance(p(700))).toBeLessThan(luminance(p(600)));
      expect(contrast('#FFFFFF', p(700))).toBeGreaterThanOrEqual(4.5);
      for (const bg of [p(50), p(100)]) expect(contrast(p(700), bg)).toBeGreaterThanOrEqual(4.5);
    });

    // `text-neutral-400` (#A8A8A0, 2.39:1 on white) carried ~70 secondary labels; `bg-neutral-400` is the
    // grey status pill with a white label.
    it('neutral-400 is readable as text on white / page / grey surfaces and carries a white label', () => {
      for (const bg of ['#FFFFFF', n(50), n(100)]) expect(contrast(n(400), bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast('#FFFFFF', n(400))).toBeGreaterThanOrEqual(4.5);
    });

    // Tailwind's stock green-600 (#16A34A) is the white-label confirm button at 3.3:1.
    it('green-600 button fill carries a white label; green-700 hover is darker and also passes', () => {
      expect(contrast('#FFFFFF', g(600))).toBeGreaterThanOrEqual(4.5);
      expect(luminance(g(700))).toBeLessThan(luminance(g(600)));
      expect(contrast('#FFFFFF', g(700))).toBeGreaterThanOrEqual(4.5);
    });
  });
  // C-097: các cặp màu DS v2 mà web khách (trang chủ, header, footer, thẻ sản phẩm) dùng cho chữ.
  describe('DS v2 pairs used by web khách reach WCAG AA (4.5:1)', () => {
    const channel = (hex: string, at: number) => {
      const c = parseInt(hex.slice(at, at + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (hex: string) => 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
    const contrast = (a: string, b: string) => {
      const [la, lb] = [luminance(a), luminance(b)];
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    };
    const v2 = (tailwindPreset.theme?.extend as { colors: Record<string, Record<string, string>> }).colors;
    const c = (family: string, shade: number) => {
      const hex = v2[family]?.[shade];
      if (!hex) throw new Error(`missing ${family}-${shade}`);
      return hex;
    };
    const promoSolid = (colors.promo as Shades).solid as string;

    const pairs: [string, string, string][] = [
      ['nút chính: chữ trắng trên forest-600', c('stone', 0), c('forest', 600)],
      ['nút chính khi hover: chữ trắng trên forest-700', c('stone', 0), c('forest', 700)],
      ['nút nền trắng trong hero: chữ forest-700', c('forest', 700), c('stone', 0)],
      ['chữ liên kết forest-700 trên nền trắng', c('forest', 700), c('stone', 0)],
      ['chữ liên kết forest-800 (hover) trên nền trắng', c('forest', 800), c('stone', 0)],
      ['hero: đoạn mô tả forest-100 trên forest-800', c('forest', 100), c('forest', 800)],
      ['hero: tiêu đề nhấn forest-200 trên forest-800', c('forest', 200), c('forest', 800)],
      ['chữ phụ stone-600 trên nền trắng', c('stone', 600), c('stone', 0)],
      ['chữ phụ stone-600 trên canvas stone-50', c('stone', 600), c('stone', 50)],
      ['giá gạch ngang stone-500 trên nền trắng', c('stone', 500), c('stone', 0)],
      ['chip lọc stone-700 trên nền trắng', c('stone', 700), c('stone', 0)],
      ['chip lọc stone-700 khi hover trên stone-50', c('stone', 700), c('stone', 50)],
      ['nhãn khuyến mãi: chữ stone-900 trên promo-solid (cam logo)', c('stone', 900), promoSolid],
      ['chữ khuyến mãi promo-fg trên promo-bg', (colors.promo as Shades).fg as string, (colors.promo as Shades).bg as string],
      ['nhãn thương hiệu forest-800 trên nền trắng 90%', c('forest', 800), c('stone', 0)],
      ['chữ cái đầu tài khoản forest-800 trên forest-100', c('forest', 800), c('forest', 100)],
      ['biểu tượng cam kết sage-700 trên sage-50', c('sage', 700), c('sage', 50)],
      ['biểu tượng cam kết forest-700 trên forest-50', c('forest', 700), c('forest', 50)],
      ['chữ chính stone-900 trên canvas', c('stone', 900), c('stone', 50)],
    ];
    it.each(pairs)('%s', (_label, fg, bg) => {
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
    });
  });
});
