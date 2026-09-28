// packages/design-tokens/src/fonts.spec.ts
import { readFileSync, existsSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const css = readFileSync(new URL('./fonts.css', import.meta.url), 'utf-8');

describe('design-tokens/fonts.css', () => {
  it('declares @font-face for Fraunces and Inter with a local woff2 src (no fonts.googleapis.com)', () => {
    expect(css).toMatch(/@font-face\s*\{[^}]*font-family:\s*['"]Fraunces['"]/s);
    expect(css).toMatch(/@font-face\s*\{[^}]*font-family:\s*['"]Inter['"]/s);
    expect(css).not.toMatch(/fonts\.googleapis\.com/);
    expect(css).toMatch(/src:\s*url\(['"]\.\/fonts\//);
  });

  it('ships the referenced woff2 files on disk', () => {
    const files = ['fraunces-500.woff2', 'fraunces-600.woff2', 'inter-400.woff2', 'inter-500.woff2'];
    for (const f of files) {
      expect(existsSync(new URL(`./fonts/${f}`, import.meta.url))).toBe(true);
    }
  });
});
