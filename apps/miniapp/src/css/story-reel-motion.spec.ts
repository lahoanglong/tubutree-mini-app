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

  it('nội dung khung toàn màn hiện lên theo nhịp story (220ms, cubic-bezier(0.32, 0.72, 0, 1)) và tắt hẳn khi giảm chuyển động', () => {
    const story = strip(css('story.css'));
    expect(story).toMatch(/\.tubu-story-dialog \.tubu-story\s*\{[^}]*animation:\s*tubu-story-enter var\(--dur-story\) var\(--ease-story\) both/);
    expect(story).toMatch(/@keyframes tubu-story-enter\s*\{\s*from\s*\{[^}]*opacity:\s*0;[^}]*transform:\s*translateY\(12px\)/);
    const reduced = story.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(reduced).toMatch(/\.tubu-story-dialog \.tubu-story,\s*\.tubu-story-layer\s*\{\s*animation:\s*none/);
    // Cung phân loại cùng nhịp story như chương và nền cảnh, không còn nhịp chung của nút.
    expect(story).toMatch(/\.tubu-story-arc-item\s*\{[^}]*transition:\s*transform var\(--dur-story\) var\(--ease-story\)/);
    const tokens = readFileSync(join(__dirname, '../../../../packages/design-tokens/src/tokens.css'), 'utf8');
    expect(tokens).toMatch(/--p-dur-story:\s*220ms;/);
    expect(tokens).toMatch(/--p-ease-story:\s*cubic-bezier\(0\.32, 0\.72, 0, 1\);/);
  });

  it('thanh mua ghim đáy khung toàn màn chừa vùng an toàn (env(safe-area-inset-bottom)) cả ở chiều cao lẫn đệm dưới', () => {
    const bar = strip(css('story.css')).match(/\.tubu-story-bar\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(bar).toMatch(/position:\s*absolute/);
    expect(bar).toMatch(/bottom:\s*0/);
    expect(bar).toMatch(/height:\s*calc\(var\(--story-bar-h\) \+ var\(--safe-bottom, 0px\)\)/);
    expect(bar).toMatch(/padding:[^;]*var\(--safe-bottom, 0px\)/);
    expect(strip(css('tokens.css'))).toMatch(/--safe-bottom:\s*env\(safe-area-inset-bottom, 0px\)/);
  });

  it('dải vòng Story không tự thêm chuyển động riêng (thêm thì phải kèm luật giảm chuyển động)', () => {
    expect(strip(css('story-reel.css'))).not.toMatch(/animation\s*:|transition\s*:|scroll-behavior\s*:\s*smooth/);
  });
});
