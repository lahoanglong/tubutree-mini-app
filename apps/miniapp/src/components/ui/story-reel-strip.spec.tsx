import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HOME_SETTLING_HEIGHTS } from '@tubutree/app-core/home-layout';
import { StoryReelStrip, type StoryReelStripItem } from './story-reel-strip';

const item = (slug: string, over: Partial<StoryReelStripItem> = {}): StoryReelStripItem => ({ slug, name: `Món ${slug}`, thumbnail: null, seen: false, ...over });

describe('StoryReelStrip (Mini)', () => {
  it('có tiêu đề khối và một nút cho mỗi vòng, tên truy cập "Story {tên}, mở câu chuyện"', () => {
    render(<StoryReelStrip items={[item('a'), item('b'), item('c')]} onOpen={vi.fn()} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Câu chuyện sản phẩm' })).toBeInTheDocument();
    expect(screen.getAllByTestId('story-reel-item')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Story Món a, mở câu chuyện' })).toBeInTheDocument();
  });

  it('hàng cuộn là vùng có tên (ScrollRow), mỗi vòng có huy hiệu Story và nhãn tên', () => {
    render(<StoryReelStrip items={[item('a')]} onOpen={vi.fn()} />);
    const row = screen.getByRole('region', { name: 'Câu chuyện sản phẩm' });
    expect(row.className).toContain('scroll-x');
    const btn = within(row).getByRole('button');
    expect(within(btn).getByText('Story')).toBeInTheDocument();
    expect(within(btn).getByText('Món a')).toHaveClass('tubu-reel-label');
  });

  it('đã xem: data-seen="true" và tên truy cập đổi sang "đã xem, mở lại"; chưa xem là "false"', () => {
    render(<StoryReelStrip items={[item('a'), item('b', { seen: true })]} onOpen={vi.fn()} />);
    const [fresh, seen] = screen.getAllByTestId('story-reel-item');
    expect(fresh).toHaveAttribute('data-seen', 'false');
    expect(seen).toHaveAttribute('data-seen', 'true');
    expect(seen).toHaveAccessibleName('Story Món b, đã xem, mở lại');
  });

  it('mỗi vòng mang data-slug để e2e và các phép đo chung tìm đúng món', () => {
    render(<StoryReelStrip items={[item('a'), item('b')]} onOpen={vi.fn()} />);
    expect(screen.getAllByTestId('story-reel-item').map((b) => b.getAttribute('data-slug'))).toEqual(['a', 'b']);
  });

  it('chạm một vòng gọi onOpen với đúng slug', () => {
    const onOpen = vi.fn();
    render(<StoryReelStrip items={[item('a'), item('b')]} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: 'Story Món b, mở câu chuyện' }));
    expect(onOpen).toHaveBeenCalledWith('b');
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('onWarm gọi khi pointerdown hoặc focus (host tải trước chi tiết), không gọi khi chỉ vẽ', () => {
    const onWarm = vi.fn();
    render(<StoryReelStrip items={[item('a'), item('b')]} onOpen={vi.fn()} onWarm={onWarm} />);
    expect(onWarm).not.toHaveBeenCalled();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Story Món a, mở câu chuyện' }));
    expect(onWarm).toHaveBeenLastCalledWith('a');
    fireEvent.focus(screen.getByRole('button', { name: 'Story Món b, mở câu chuyện' }));
    expect(onWarm).toHaveBeenLastCalledWith('b');
  });

  it('không truyền onWarm vẫn không ném lỗi', () => {
    render(<StoryReelStrip items={[item('a')]} onOpen={vi.fn()} />);
    const btn = screen.getByRole('button');
    expect(() => {
      fireEvent.pointerDown(btn);
      fireEvent.focus(btn);
    }).not.toThrow();
  });

  it('loading: khung chờ 6 vòng xám, không nút, không tiêu đề, ẩn khỏi trình đọc', () => {
    const { container } = render(<StoryReelStrip items={[]} loading onOpen={vi.fn()} />);
    const sk = screen.getByTestId('story-reel-skeleton');
    expect(sk).toHaveAttribute('aria-busy', 'true');
    expect(sk).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelectorAll('.tubu-reel-skel-ring')).toHaveLength(6);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText('Câu chuyện sản phẩm')).toBeNull();
  });

  it('loading thắng items: vẫn là khung chờ dù đã có món', () => {
    render(<StoryReelStrip items={[item('a')]} loading onOpen={vi.fn()} />);
    expect(screen.getByTestId('story-reel-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('story-reel-strip')).toBeNull();
  });

  it('rỗng và không loading: không vẽ gì', () => {
    const { container } = render(<StoryReelStrip items={[]} onOpen={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('khối thật và khung chờ cùng lớp ngoài .tubu-reel-strip (một nguồn chiều cao 144)', () => {
    const real = render(<StoryReelStrip items={[item('a')]} onOpen={vi.fn()} />);
    expect(screen.getByTestId('story-reel-strip')).toHaveClass('tubu-reel-strip');
    real.unmount();
    render(<StoryReelStrip items={[]} loading onOpen={vi.fn()} />);
    expect(screen.getByTestId('story-reel-skeleton')).toHaveClass('tubu-reel-strip');
  });

  it('các phần tử do dải tự vẽ không mang thuộc tính style và không có màu thô (số đo ở css/story-reel.css)', () => {
    const { container } = render(<StoryReelStrip items={[item('a', { seen: true }), item('b')]} onOpen={vi.fn()} />);
    const own = container.querySelectorAll('[class*="tubu-reel-"]:not(.tubu-reel-row)');
    expect(own.length).toBeGreaterThan(0);
    own.forEach((el) => expect(el.hasAttribute('style')).toBe(false));
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe('css/story-reel.css: số đo của dải Story', () => {
  function loadRules() {
    const style = document.createElement('style');
    style.textContent = readFileSync(resolve(__dirname, '../../css/story-reel.css'), 'utf8');
    document.head.appendChild(style);
    return Array.from(style.sheet!.cssRules).filter((r): r is CSSStyleRule => 'selectorText' in r);
  }
  afterEach(() => document.head.querySelectorAll('style').forEach((s) => s.remove()));
  const rule = (sel: string) => loadRules().find((r) => r.selectorText === sel)!;

  it('khối cao đúng HOME_SETTLING_HEIGHTS.stories (khung chờ chung và khối thật không lệch)', () => {
    expect(rule('.tubu-reel-strip').style.getPropertyValue('height')).toBe(`${HOME_SETTLING_HEIGHTS.stories}px`);
  });

  it('tiêu đề 24 + 8, hàng 112 (vòng 72, 6, nhãn 32, dư 2) cộng lại đúng 144', () => {
    const head = rule('.tubu-reel-head');
    expect(head.style.getPropertyValue('height')).toBe('24px');
    expect(head.style.getPropertyValue('margin-bottom')).toBe('var(--space-stack-sm)');
    expect(rule('.tubu-reel-row').style.getPropertyValue('height')).toBe('112px');
    const ring = rule('.tubu-reel-ring').style;
    expect(ring.getPropertyValue('width')).toBe('72px');
    expect(ring.getPropertyValue('height')).toBe('72px');
    expect(ring.getPropertyValue('padding')).toBe('4px');
    expect(rule('.tubu-reel-photo').style.getPropertyValue('width')).toBe('64px');
    expect(rule('.tubu-reel-label').style.getPropertyValue('height')).toBe('32px');
    expect(rule('.tubu-reel-label').style.getPropertyValue('line-height')).toBe('16px');
  });

  it('viền chuyển sắc theo token chưa xem, token xám khi đã xem; nhãn cắt hai dòng', () => {
    expect(rule('.tubu-reel-ring').style.getPropertyValue('background')).toContain('var(--color-story-ring-from)');
    expect(rule('.tubu-reel-ring').style.getPropertyValue('background')).toContain('var(--color-story-ring-to)');
    expect(rule(".tubu-reel-item[data-seen='true'] .tubu-reel-ring").style.getPropertyValue('background')).toBe('var(--color-story-ring-seen)');
    expect(rule('.tubu-reel-label').style.getPropertyValue('-webkit-line-clamp')).toBe('2');
  });

  it('vòng bấm rộng 72 (≥44) và có focus-visible; khung chờ toàn màn cùng lớp z với khung Reel', () => {
    expect(rule('.tubu-reel-item').style.getPropertyValue('width')).toBe('72px');
    expect(rule('.tubu-reel-item:focus-visible').style.getPropertyValue('outline')).toContain('var(--color-border-focus)');
    expect(rule('.tubu-reel-wait').style.getPropertyValue('z-index')).toBe('var(--z-dialog)');
    expect(rule('.tubu-reel-wait-close').style.getPropertyValue('width')).toBe('44px');
    expect(rule('.tubu-reel-wait-close').style.getPropertyValue('height')).toBe('44px');
  });
});
