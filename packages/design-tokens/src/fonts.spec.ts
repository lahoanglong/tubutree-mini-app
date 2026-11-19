// packages/design-tokens/src/fonts.spec.ts
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const css = readFileSync(new URL('./fonts.css', import.meta.url), 'utf-8');

/** Weights declared for a family in fonts.css (one @font-face per weight, each with its own file). */
function declaredWeights(family: string): number[] {
  return [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)]
    .map((m) => m[1] ?? '')
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

  // The Inter files are subset to the glyphs reachable through features browsers turn on by themselves plus tnum/pnum/case
  // (see the comment at the top of fonts.css). A full Inter file is ~27 KB and costs the Zalo Mini App bundle 43 KB in total.
  it('keeps the Inter files at the default-feature subset size', () => {
    for (const weight of [400, 500, 600, 700]) {
      const bytes = statSync(new URL(`./fonts/inter-${weight}.woff2`, import.meta.url)).size;
      expect(bytes, `inter-${weight}.woff2`).toBeLessThanOrEqual(18_000);
    }
  });

  it('no stylesheet or component asks Inter for an OpenType feature the subset dropped', () => {
    const repo = fileURLToPath(new URL('../../../', import.meta.url));
    const roots = ['apps/web/src', 'apps/miniapp/src', 'apps/web/tailwind.config.ts', 'apps/miniapp/tailwind.config.ts', 'packages'];
    const files: string[] = [];
    const walk = (p: string): void => {
      if (!existsSync(p)) return;
      if (statSync(p).isFile()) {
        if (/\.(css|scss|html|[cm]?[jt]sx?)$/.test(p) && !/\.(spec|test)\.[cm]?[jt]sx?$/.test(p)) files.push(p);
        return;
      }
      for (const name of readdirSync(p)) if (!['node_modules', 'dist', '.next', 'www', '.turbo'].includes(name)) walk(join(p, name));
    };
    for (const root of roots) walk(join(repo, root));
    expect(files.length).toBeGreaterThan(100);

    const allowedNumeric = new Set(['tabular-nums', 'proportional-nums', 'lining-nums', 'normal', 'inherit', 'initial', 'unset']);
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
      const where = relative(repo, file);
      // Shorthand `font-variant:` / `fontVariant:` cũng bật được tính năng (small-caps, ordinal…): cấm hẳn như font-feature-settings.
      if (/font-feature-settings|fontFeatureSettings|font-variant(?:-(?:ligatures|caps|alternates|position|east-asian))?\s*:|fontVariant(?:Ligatures|Caps|Alternates|Position|EastAsian)?\s*:/.test(src)) {
        offenders.push(`${where}: font-feature-settings / font-variant-* other than numeric`);
      }
      // Cả dạng class tuỳ ý của Tailwind `[font-variant-numeric:…]`; `!important` và biến CSS không phải tên tính năng.
      for (const m of src.matchAll(/(?:font-variant-numeric\s*:\s*|fontVariantNumeric\s*:\s*['"`])([^;'"`}\]\n]+)/g)) {
        const values = (m[1] ?? '').replace(/!important/g, '').trim().split(/\s+/).filter(Boolean);
        for (const value of values) if (!value.startsWith('var(') && !allowedNumeric.has(value)) offenders.push(`${where}: font-variant-numeric ${value}`);
      }
      // Class Tailwind bật tính năng đã bỏ, ở bất kỳ chuỗi nào (className, hằng, cn()/clsx()), không chỉ thuộc tính className.
      for (const m of src.matchAll(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g)) {
        for (const cls of m[0].slice(1, -1).split(/\s+/)) {
          if (/^(?:[\w-]+:)*(?:ordinal|slashed-zero|diagonal-fractions|stacked-fractions|oldstyle-nums)$/.test(cls)) offenders.push(`${where}: class ${cls}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
