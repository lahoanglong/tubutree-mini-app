// packages/design-tokens/src/fonts.spec.ts
import { readFileSync, existsSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const css = readFileSync(new URL('./fonts.css', import.meta.url), 'utf-8');

/** Weights declared for a family in fonts.css (one @font-face per weight, each with its own file). */
function declaredWeights(family: string): number[] {
  return [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)]
    .map((m) => m[1])
    .filter((face) => new RegExp(`font-family:\\s*['"]${family}['"]`).test(face))
    .map((face) => Number(face.match(/font-weight:\s*(\d+)/)?.[1]));
}

describe('design-tokens/fonts.css', () => {
  it('declares @font-face for Fraunces and Inter with a local woff2 src (no fonts.googleapis.com)', () => {
    expect(css).toMatch(/@font-face\s*\{[^}]*font-family:\s*['"]Fraunces['"]/s);
    expect(css).toMatch(/@font-face\s*\{[^}]*font-family:\s*['"]Inter['"]/s);
    expect(css).not.toMatch(/fonts\.googleapis\.com/);
    expect(css).toMatch(/src:\s*url\(['"]\.\/fonts\//);
  });

  it('ships the referenced woff2 files on disk', () => {
    const files = [
      'fraunces-500.woff2',
      'fraunces-600.woff2',
      'inter-400.woff2',
      'inter-500.woff2',
      'inter-600.woff2',
      'inter-700.woff2',
    ];
    for (const f of files) {
      expect(existsSync(new URL(`./fonts/${f}`, import.meta.url))).toBe(true);
    }
  });

  // C-089 (A4-013): the type scale and Chip use Inter 600 (labels, price-md/sm) and 700 (price-xl/lg).
  // Without a matching @font-face the browser synthesises a smeared faux-bold from 500.
  it('loads Inter 400/500/600/700, each pointing at an existing file', () => {
    expect(declaredWeights('Inter').sort()).toEqual([400, 500, 600, 700]);
    for (const weight of [400, 500, 600, 700]) {
      expect(css).toContain(`url('./fonts/inter-${weight}.woff2')`);
      expect(existsSync(new URL(`./fonts/inter-${weight}.woff2`, import.meta.url))).toBe(true);
    }
  });

  it('every font-weight the type scale asks of the UI font has a face (no synthetic bold)', () => {
    const tokens = readFileSync(new URL('./tokens.css', import.meta.url), 'utf-8');
    // display-* use Fraunces; every other --type-* style is set in Inter.
    const used = new Set(
      [...tokens.matchAll(/--type-(?!display)[\w-]+-weight:\s*(\d+)/g)].map((m) => Number(m[1])),
    );
    const declared = new Set(declaredWeights('Inter'));
    for (const weight of used) expect(declared.has(weight), `Inter ${weight}`).toBe(true);
  });
});
