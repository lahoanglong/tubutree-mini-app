import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = (f: string) => readFileSync(join(__dirname, f), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');

describe('Reel Mini App: giảm chuyển động và khung 100dvh', () => {
  it('khối prefers-reduced-motion của story.css tắt lớp động và chuyển tiếp của chương, cung, bước', () => {
    const reduced = strip(css('story.css')).match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(reduced).toMatch(/\.tubu-story-layer\s*\{[^}]*animation:\s*none/);
    for (const sel of ['.tubu-story-stage', '.tubu-story-arc-item', '.tubu-story-step']) {
      expect(reduced, sel).toContain(sel);
    }
    expect(reduced).toMatch(/transition:\s*none/);
  });

  it('khung chờ toàn màn của Reel cao đúng 100dvh', () => {
    expect(strip(css('story-reel.css'))).toMatch(/\.tubu-reel-wait\s*\{[^}]*height:\s*100dvh/);
  });

  it('dải vòng Story không tự thêm chuyển động riêng (thêm thì phải kèm luật giảm chuyển động)', () => {
    expect(strip(css('story-reel.css'))).not.toMatch(/animation\s*:|transition\s*:|scroll-behavior\s*:\s*smooth/);
  });
});
