// packages/design-tokens/src/tokens.spec.ts
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf-8');

/** Resolve `--name` through var() chains declared in the :root block of tokens.css to a hex. */
function resolveToken(name: string): string {
  const decl = css.match(new RegExp(`${name}:\\s*([^;]+);`));
  const value = decl?.[1]?.trim();
  if (!value) throw new Error(`token ${name} not found in tokens.css`);
  const ref = value.match(/^var\((--[\w-]+)/);
  return ref?.[1] ? resolveToken(ref[1]) : value;
}

function channel(hex: string, at: number): number {
  const c = parseInt(hex.slice(at, at + 2), 16) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

function contrast(fg: string, bg: string): number {
  const [lf, lb] = [luminance(fg), luminance(bg)];
  return (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05);
}

describe('design-tokens/tokens.css', () => {
  it('defines the forest primitive scale used as the primary action color', () => {
    expect(css).toMatch(/--forest-600:\s*#245E3E/i);
    expect(css).toMatch(/--forest-700:\s*#1B4B31/i);
    expect(css).toMatch(/--forest-800:\s*#143A26/i);
    expect(css).toMatch(/--forest-900:\s*#0D291B/i);
  });

  it('defines semantic color.action.primary tokens pointing at forest-600/700', () => {
    expect(css).toMatch(/--color-action-primary-bg:\s*var\(--forest-600\)/);
    expect(css).toMatch(/--color-action-primary-bg-pressed:\s*var\(--forest-700\)/);
    expect(css).toMatch(/--color-action-primary-fg:\s*var\(--stone-0\)/);
  });

  it('defines the warm stone neutral scale (replaces old cool neutral-*)', () => {
    expect(css).toMatch(/--stone-50:\s*#F6F4EF/i);
    expect(css).toMatch(/--stone-500:\s*#6E675B/i);
  });

  it('does not define the old --primary-* (orange) scale as a UI color — only as tubu-orange for logo use', () => {
    expect(css).not.toMatch(/--primary-600/);
    expect(css).toMatch(/--tubu-orange:\s*#E38E1E/i);
  });

  it('compare-at (strikethrough) price is informative text: stone-500 (AA), not the disabled stone-400', () => {
    expect(css).toMatch(/--color-text-price-compare:\s*var\(--stone-500\)/);
  });

  it('defines the dealer B2B palette once: navy primitives plus --color-dealer-* tokens at :root', () => {
    expect(css).toMatch(/--navy-900:\s*#1F2A44/i);
    expect(css).toMatch(/--navy-800:\s*#2E3B5E/i);
    expect(css).toMatch(/--navy-50:\s*#F4F6F9/i);
    expect(css).toMatch(/:root\s*\{[^}]*--color-dealer-ink:\s*var\(--navy-900\)/);
    expect(css).toMatch(/--color-dealer-ink-soft:\s*var\(--navy-800\)/);
    expect(css).toMatch(/--color-dealer-bg:\s*var\(--navy-50\)/);
    expect(css).toMatch(/--color-dealer-accent:\s*var\(--forest-300\)/);
  });

  it('keeps a dealer theme override block scoped to [data-theme="dealer"], touching only semantic layer', () => {
    expect(css).toMatch(/\[data-theme=['"]dealer['"]\]\s*\{/);
  });

  // C-023 (A4-006): axe flagged `#9E978A` (old --color-text-disabled = stone-400) on 29 pages / 131 nodes,
  // because the token is used for INFORMATIVE text (rating count, "★ Mới"), not only inert controls.
  // WCAG 1.4.3 needs 4.5:1 on every surface that text sits on.
  describe('WCAG 1.4.3 — informational text tokens reach 4.5:1 on every page surface', () => {
    // --color-status-neutral-bg (stone-100) is also the fill behind grey badges, chips and image placeholders.
    // stone-200 is deliberately absent: it only fills inert controls and borders, never a text surface.
    const surfaces = ['--color-bg-surface', '--color-bg-canvas', '--color-bg-subtle', '--color-status-neutral-bg'];
    const textTokens = [
      '--color-text-primary',
      '--color-text-secondary',
      '--color-text-tertiary',
      '--color-text-disabled',
      '--color-text-price-compare',
    ];
    for (const text of textTokens) {
      for (const surface of surfaces) {
        it(`${text} on ${surface}`, () => {
          expect(contrast(resolveToken(text), resolveToken(surface))).toBeGreaterThanOrEqual(4.5);
        });
      }
    }

    it('also holds on the forest-50 tint used by secondary buttons and chips', () => {
      expect(contrast(resolveToken('--color-text-disabled'), resolveToken('--forest-50'))).toBeGreaterThanOrEqual(4.5);
    });

    it('a genuinely inert control keeps the lighter disabled-button label (exempt from 1.4.3)', () => {
      expect(css).toMatch(/--color-action-primary-fg-disabled:\s*var\(--stone-400\)/);
    });
  });
});

describe('design-tokens/tokens.css: commerce tokens (P1 tokens-a11y)', () => {
  const decl = (name: string, value: string) =>
    expect(css, name).toMatch(new RegExp(`${name}:\\s*${value.replace(/[()*+.]/g, '\\$&')}\\s*;`));

  it('giá đang giảm dùng orange-700 #9A5200 (cam đậm, không đỏ); đồng hồ chữ Giờ vàng cùng màu', () => {
    decl('--orange-700', '#9A5200');
    decl('--color-text-price-deal', 'var(--orange-700)');
    decl('--color-flash-fg', 'var(--orange-700)');
    expect(resolveToken('--color-text-price-deal')).toBe('#9A5200');
  });

  it.each([
    ['--color-bg-media', 'var(--stone-100)'],
    ['--color-bg-cover', 'var(--forest-700)'],
    ['--color-bg-chip', 'var(--stone-100)'],
    ['--color-track', 'var(--stone-200)'],
    ['--color-progress-fill-from', 'var(--forest-200)'],
    ['--color-media-outline', 'rgba(28,26,22,.06)'],
    ['--color-verified-bg', 'var(--forest-600)'],
    ['--color-verified-fg', 'var(--stone-0)'],
    ['--color-voucher-bg', 'var(--orange-50)'],
    ['--color-voucher-fg', 'var(--orange-800)'],
    ['--color-voucher-edge', 'var(--tubu-orange)'],
    ['--color-voucher-stub-bg', 'var(--tubu-orange)'],
    ['--color-voucher-stub-fg', 'var(--stone-900)'],
    ['--color-voucher-ship-bg', 'var(--color-status-success-fg)'],
    ['--color-voucher-ship-fg', 'var(--stone-0)'],
    ['--color-voucher-shop-bg', 'var(--forest-50)'],
    ['--color-voucher-shop-fg', 'var(--forest-700)'],
    ['--color-voucher-shop-edge', 'var(--forest-300)'],
    ['--color-voucher-shop-stub-bg', 'var(--forest-600)'],
    ['--color-voucher-shop-stub-fg', 'var(--stone-0)'],
    ['--color-rank-1-bg', 'var(--honey-600)'],
    ['--color-rank-2-bg', 'var(--stone-600)'],
    ['--color-rank-3-bg', 'var(--clay-600)'],
    ['--color-rank-fg', 'var(--stone-0)'],
    ['--color-rank-n-bg', 'var(--stone-100)'],
    ['--color-rank-n-fg', 'var(--stone-700)'],
    ['--color-countdown-bg', 'var(--color-bg-inverse)'],
    ['--color-countdown-fg', 'var(--color-text-inverse)'],
  ])('lớp semantic %s = %s', (name, value) => decl(name, value));

  it.each([
    ['--tile-w-sm', '128px'],
    ['--tile-w-md', '148px'],
    ['--tile-gap', 'var(--p-space-4)'],
    ['--tile-inset', 'var(--p-space-3)'],
    ['--rail-pad-block', 'var(--p-space-2) var(--p-space-4)'],
    ['--section-header-h', '44px'],
    ['--space-block', 'var(--p-space-5)'],
    ['--space-section', 'var(--p-space-7)'],
    ['--banner-ratio', '5 / 2'],
    ['--badge-h-sm', '20px'],
    ['--badge-h-md', '24px'],
    ['--radius-tag', 'var(--p-radius-1)'],
    ['--type-price-tile-size', '16px'],
    ['--type-price-tile-lh', '1.25'],
    ['--type-price-tile-weight', '700'],
  ])('lớp component (commerce) %s = %s', (name, value) => decl(name, value));

  it.each([
    ['--elevation-nav', '0 -1px 0 rgba(28,26,22,.06), 0 -4px 16px rgba(28,26,22,.06)'],
    ['--p-dur-press', '80ms'],
    ['--p-dur-release', '180ms'],
    ['--p-ease-spring', 'cubic-bezier(0.34, 1.56, 0.64, 1)'],
  ])('chuyển động và bóng %s', (name, value) => decl(name, value));
});
