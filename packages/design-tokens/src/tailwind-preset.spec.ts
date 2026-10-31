// packages/design-tokens/src/tailwind-preset.spec.ts
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { tailwindPreset } from './tailwind-preset';

const tokensCss = readFileSync(new URL('./tokens.css', import.meta.url), 'utf-8');

describe('design-tokens/tailwind-preset', () => {
  const ext = (tailwindPreset.theme?.extend ?? {}) as Record<string, unknown>;

  it('does NOT re-key Tailwind spacing (final review C2: p-4 became 12px across apps/web)', () => {
    expect(tailwindPreset.theme).not.toHaveProperty('spacing');
    expect(ext).not.toHaveProperty('spacing');
  });

  it('does not override any stock borderRadius key (sm/md/lg/xl/2xl/3xl/full stay app-controlled)', () => {
    const radius = (ext.borderRadius ?? {}) as Record<string, string>;
    for (const stock of ['none', 'sm', 'DEFAULT', 'md', 'lg', 'xl', '2xl', '3xl', 'full']) {
      expect(radius).not.toHaveProperty(stock);
    }
    expect(radius).toMatchObject({ control: '12px', card: '16px', media: '12px', sheet: '24px' });
  });

  it('exposes the forest action scale', () => {
    const colors = ext.colors as Record<string, Record<string, string>>;
    expect(colors.forest?.[600]).toBe('#245E3E');
  });
});

describe('design-tokens/tailwind-preset: khớp tokens.css (DS-12)', () => {
  const ext = (tailwindPreset.theme?.extend ?? {}) as Record<string, unknown>;
  const colors = ext.colors as Record<string, unknown>;
  // Tailwind gọi cam logo là orange-500; tokens.css đặt tên --tubu-orange.
  const ALIAS: Record<string, string> = { 'orange-500': 'tubu-orange' };

  it('mọi hex của thang màu trong preset bằng đúng primitive cùng tên ở tokens.css', () => {
    const drift: string[] = [];
    const check = (name: string, hex: string) => {
      const token = ALIAS[name] ?? name;
      const m = new RegExp(`--${token}:\\s*(#[0-9A-Fa-f]{6})`).exec(tokensCss);
      if (!m) drift.push(`${name}: không có --${token} trong tokens.css`);
      else if (m[1]!.toLowerCase() !== hex.toLowerCase()) drift.push(`${name}: preset ${hex} khác tokens.css ${m[1]}`);
    };
    for (const [family, value] of Object.entries(colors)) {
      if (typeof value === 'string') {
        if (/^#/.test(value)) check(family, value);
      } else if (value && typeof value === 'object') {
        for (const [shade, hex] of Object.entries(value as Record<string, unknown>)) {
          if (typeof hex === 'string' && /^#/.test(hex)) check(`${family}-${shade}`, hex);
        }
      }
    }
    expect(drift).toEqual([]);
  });

  it('mọi var(--x) trong preset có định nghĩa ở tokens.css', () => {
    const defined = new Set([...tokensCss.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
    const missing = [...JSON.stringify(tailwindPreset).matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]!).filter((n) => !defined.has(n));
    expect(missing).toEqual([]);
  });

  it('có orange-700 #9A5200 và lớp ngữ nghĩa commerce trỏ biến CSS', () => {
    expect((colors.orange as Record<string, string>)[700]).toBe('#9A5200');
    expect(colors.media).toBe('var(--color-bg-media)');
    expect(colors.chip).toBe('var(--color-bg-chip)');
    expect(colors.track).toBe('var(--color-track)');
    expect(colors['shop-cover']).toBe('var(--color-bg-cover)');
    expect(colors.countdown).toBe('var(--color-countdown-bg)');
    expect(colors['price-deal']).toBe('var(--color-text-price-deal)');
    expect(colors.voucher).toMatchObject({ bg: 'var(--color-voucher-bg)', fg: 'var(--color-voucher-fg)', edge: 'var(--color-voucher-edge)', 'stub-bg': 'var(--color-voucher-stub-bg)', 'ship-bg': 'var(--color-voucher-ship-bg)' });
    expect(colors.rank).toMatchObject({ 1: 'var(--color-rank-1-bg)', 2: 'var(--color-rank-2-bg)', 3: 'var(--color-rank-3-bg)', n: 'var(--color-rank-n-bg)' });
  });

  it('không đặt tên màu `cover` (đụng utility bg-cover của Tailwind)', () => {
    expect(colors).not.toHaveProperty('cover');
  });
});
