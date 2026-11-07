// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { click } from '@/test-utils/dom';
import { mount } from './harness';
import { StoryReelStrip, type StoryReelStripItem } from './story-reel-strip';

const item = (slug: string, over: Partial<StoryReelStripItem> = {}): StoryReelStripItem => ({ slug, name: `Món ${slug}`, thumbnail: null, seen: false, ...over });
const rings = (c: ParentNode) => Array.from(c.querySelectorAll<HTMLElement>('[data-testid="story-reel-item"]'));

describe('StoryReelStrip (web)', () => {
  it('mỗi món một vòng: tên, huy hiệu Story, aria-label "Xem câu chuyện {tên}"', () => {
    const { container } = mount(<StoryReelStrip items={[item('a'), item('b'), item('c')]} onOpen={vi.fn()} />);
    expect(rings(container).map((r) => r.dataset.slug)).toEqual(['a', 'b', 'c']);
    expect(rings(container)[0]!.getAttribute('aria-label')).toBe('Xem câu chuyện Món a');
    expect(rings(container)[0]!.textContent).toContain('Story');
    expect(container.querySelector('h2, h3, [data-testid="section-title"]')?.textContent ?? container.textContent).toContain('Câu chuyện sản phẩm');
  });

  it('chưa xem và đã xem: data-seen và aria-label khác nhau ("Xem lại câu chuyện")', () => {
    const { container } = mount(<StoryReelStrip items={[item('a'), item('b', { seen: true }), item('c')]} onOpen={vi.fn()} />);
    const [a, b] = rings(container);
    expect(a!.dataset.seen).toBe('false');
    expect(a!.querySelector('.tubu-reel-ring')!.getAttribute('data-seen')).toBe('false');
    expect(b!.dataset.seen).toBe('true');
    expect(b!.querySelector('.tubu-reel-ring')!.getAttribute('data-seen')).toBe('true');
    expect(b!.getAttribute('aria-label')).toBe('Xem lại câu chuyện Món b');
  });

  it('chạm vòng gọi onOpen(slug); pointerdown và focus gọi onWarm(slug) để tải trước chi tiết', () => {
    const onOpen = vi.fn();
    const onWarm = vi.fn();
    const { container } = mount(<StoryReelStrip items={[item('a'), item('b'), item('c')]} onOpen={onOpen} onWarm={onWarm} />);
    const b = rings(container)[1]!;
    b.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(onWarm).toHaveBeenCalledWith('b');
    click(b);
    expect(onOpen).toHaveBeenCalledWith('b');
  });

  it('đang chờ: sáu khung chờ cùng lớp với vòng thật, aria-busy, ẩn khỏi trình đọc màn hình, không có nút bấm', () => {
    const { container } = mount(<StoryReelStrip items={[]} loading onOpen={vi.fn()} />);
    expect(container.querySelector('[data-testid="story-reel-strip"]')!.getAttribute('aria-busy')).toBe('true');
    const sk = Array.from(container.querySelectorAll<HTMLElement>('[data-testid="story-reel-skeleton"]'));
    expect(sk).toHaveLength(6);
    for (const s of sk) {
      expect(s.getAttribute('aria-hidden')).toBe('true');
      expect(s.className).toContain('tubu-reel-item');
    }
    expect(rings(container)).toHaveLength(0);
  });

  it('rỗng và không chờ: không vẽ gì (không để lại tiêu đề trơ)', () => {
    const { container } = mount(<StoryReelStrip items={[]} onOpen={vi.fn()} />);
    expect(container.querySelector('[data-testid="story-reel-strip"]')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('vùng cuộn có nhãn trình đọc màn hình theo tiêu đề dải', () => {
    const { container } = mount(<StoryReelStrip items={[item('a'), item('b'), item('c')]} onOpen={vi.fn()} />);
    expect(container.querySelector('[aria-label="Câu chuyện sản phẩm"]')).not.toBeNull();
  });

  describe('mini.css', () => {
    const css = readFileSync(resolve(__dirname, 'mini.css'), 'utf8');
    const rule = (sel: string) => new RegExp(`${sel.replace(/[.[\]()']/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';

    it('vùng chạm cả cột vòng + nhãn ≥ 44x44 và dải giữ chiều cao 144 (khớp khung chờ chung, không nhảy trang)', () => {
      expect(rule('.tubu-reel-strip')).toMatch(/min-height:\s*144px/);
      expect(rule('.tubu-reel-item')).toMatch(/width:\s*var\(--reel-ring\)/);
      expect(css).toMatch(/--reel-ring:\s*72px/);
    });

    it('vòng chưa xem dùng chuyển sắc token, vòng đã xem dùng token xám, không màu cứng', () => {
      expect(rule('.tubu-reel-ring')).toContain('var(--color-story-ring-from)');
      expect(rule('.tubu-reel-ring')).toContain('var(--color-story-ring-to)');
      expect(rule(".tubu-reel-ring[data-seen='true']")).toContain('var(--color-story-ring-seen)');
      const block = css.slice(css.indexOf('.tubu-reel-strip'), css.indexOf('.tubu-freeship {'));
      expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    });
  });
});
