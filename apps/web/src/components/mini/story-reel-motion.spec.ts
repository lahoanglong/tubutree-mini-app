import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, 'mini.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('Reel web: giảm chuyển động và khung 100dvh', () => {
  it('khối prefers-reduced-motion tắt lớp động và chuyển tiếp của chương, cung, bước', () => {
    const blocks = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n');
    expect(blocks).toMatch(/\.tubu-story-layer\[data-animated='true'\][^{]*\{[^}]*animation:\s*none;[^}]*transition:\s*none/);
    for (const sel of ['.tubu-story-stage', '.tubu-story-arc-item', '.tubu-story-step']) {
      expect(blocks, sel).toContain(sel);
    }
  });

  it('khung Reel toàn màn là hộp cố định cao đúng 100dvh', () => {
    expect(css).toMatch(/\.tubu-story-full\s*\{[^}]*position:\s*fixed[^}]*height:\s*100dvh/);
  });

  it('dải vòng Story (tubu-reel-*) không tự thêm chuyển động riêng', () => {
    const reelRules = [...css.matchAll(/\.tubu-reel-[\w-]+[^{}]*\{[^}]*\}/g)].map((m) => m[0]).join('\n');
    expect(reelRules.length).toBeGreaterThan(0);
    expect(reelRules).not.toMatch(/animation\s*:|transition\s*:|scroll-behavior\s*:\s*smooth/);
  });
});
