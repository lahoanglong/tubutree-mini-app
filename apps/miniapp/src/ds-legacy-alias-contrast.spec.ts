import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const tokensCss = readFileSync(
  new URL('../../../packages/design-tokens/src/tokens.css', import.meta.url),
  'utf-8',
);
const aliasCss = readFileSync(new URL('./css/tokens.css', import.meta.url), 'utf-8');

const decls = new Map<string, string>();
for (const m of `${tokensCss}\n${aliasCss}`.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
  if (m[1] && m[2]) decls.set(m[1], m[2].trim());
}

function resolve(name: string): string {
  const value = decls.get(name);
  if (!value) throw new Error(`${name} not declared`);
  const ref = value.match(/^var\((--[\w-]+)/);
  return ref?.[1] ? resolve(ref[1]) : value;
}

function channel(hex: string, at: number): number {
  const c = parseInt(hex.slice(at, at + 2), 16) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
const luminance = (hex: string) =>
  0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
function contrast(fg: string, bg: string): number {
  const [a, b] = [luminance(fg), luminance(bg)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// C-023 (A4-006): ~190 legacy call sites set `color: var(--neutral-400)` for secondary text; the alias
// pointed at stone-400 (2.6-2.9:1), the main source of the 131 axe color-contrast nodes.
describe('legacy --neutral-400 alias (text colour at ~190 call sites)', () => {
  for (const surface of ['--stone-0', '--stone-25', '--stone-50', '--stone-100', '--forest-50', '--sage-50']) {
    it(`reaches 4.5:1 on ${surface}`, () => {
      expect(contrast(resolve('--neutral-400'), resolve(surface))).toBeGreaterThanOrEqual(4.5);
    });
  }
});
