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
    expect(css).toMatch(/--stone-500:\s*#746D61/i);
  });

  it('does not define the old --primary-* (orange) scale as a UI color — only as tubu-orange for logo use', () => {
    expect(css).not.toMatch(/--primary-600/);
    expect(css).toMatch(/--tubu-orange:\s*#E08C1C/i);
  });

  it('compare-at (strikethrough) price is informative text: stone-500 (AA), not the disabled stone-400', () => {
    expect(css).toMatch(/--color-text-price-compare:\s*var\(--stone-500\)/);
  });

  it('keeps a dealer theme override block scoped to [data-theme="dealer"], touching only semantic layer', () => {
    expect(css).toMatch(/\[data-theme=['"]dealer['"]\]\s*\{/);
  });

  // C-023 (A4-006): axe flagged `#9E978A` (old --color-text-disabled = stone-400) on 29 pages / 131 nodes,
  // because the token is used for INFORMATIVE text (rating count, "★ Mới"), not only inert controls.
  // WCAG 1.4.3 needs 4.5:1 on every surface that text sits on.
  describe('WCAG 1.4.3 — informational text tokens reach 4.5:1 on every page surface', () => {
    const surfaces = ['--color-bg-surface', '--color-bg-canvas', '--color-bg-subtle'];
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
