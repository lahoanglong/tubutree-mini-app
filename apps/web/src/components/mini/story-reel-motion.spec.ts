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

  it('nội dung khung toàn màn hiện lên theo nhịp story như Mini, cung phân loại không còn nảy (spring), giảm chuyển động thì tắt', () => {
    expect(css).toMatch(/\.tubu-story-full \.tubu-story-split\s*\{[^}]*animation:\s*tubu-story-enter var\(--dur-story\) var\(--ease-story\) both/);
    expect(css).toMatch(/@keyframes tubu-story-enter\s*\{\s*from\s*\{[^}]*opacity:\s*0;[^}]*transform:\s*translateY\(12px\)/);
    expect(css).toMatch(/\.tubu-story-arc-item\s*\{[^}]*transition:\s*transform var\(--dur-story\) var\(--ease-story\)/);
    expect(css).not.toMatch(/\.tubu-story[\w-]*[^{}]*\{[^}]*--p-ease-spring/);
    const blocks = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n');
    expect(blocks).toMatch(/\.tubu-story-full \.tubu-story-split\s*\{\s*animation:\s*none;\s*transition:\s*none/);
  });

  it('đầu khung chừa vùng an toàn trên, thanh mua chừa vùng an toàn dưới (env(safe-area-inset-*))', () => {
    expect(css).toMatch(/--safe-top:\s*env\(safe-area-inset-top, 0px\)/);
    expect(css).toMatch(/--safe-bottom:\s*env\(safe-area-inset-bottom, 0px\)/);
    expect(css).toMatch(/\.tubu-story-header\s*\{[^}]*padding:\s*calc\(0\.5rem \+ var\(--safe-top\)\)/);
    expect(css).toMatch(/\.tubu-story-bar\s*\{[^}]*padding-bottom:\s*calc\(0\.625rem \+ var\(--safe-bottom\)\)/);
  });

  it('dải vòng Story (tubu-reel-*) không tự thêm chuyển động riêng', () => {
    const reelRules = [...css.matchAll(/\.tubu-reel-[\w-]+[^{}]*\{[^}]*\}/g)].map((m) => m[0]).join('\n');
    expect(reelRules.length).toBeGreaterThan(0);
    expect(reelRules).not.toMatch(/animation\s*:|transition\s*:|scroll-behavior\s*:\s*smooth/);
  });
});
