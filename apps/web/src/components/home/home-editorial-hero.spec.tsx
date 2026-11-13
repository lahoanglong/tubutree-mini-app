// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { render, type Rendered } from '@/test-utils/dom';
import { HomeEditorialHero } from './home-editorial-hero';

let mounted: Rendered | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('HomeEditorialHero — khối giới thiệu mặc định của Trang chủ web', () => {
  it('chỉ có từ md (điện thoại ẩn hẳn như Mini) và giữ tỉ lệ banner để chiến dịch về muộn không làm trang nhảy', () => {
    mounted = render(<HomeEditorialHero />);
    const section = mounted.container.querySelector<HTMLElement>('section[data-testid="home-editorial-hero"]')!;
    expect(section.className.split(' ')).toEqual(expect.arrayContaining(['hidden', 'md:block']));
    expect(section.style.aspectRatio).toBe('var(--banner-ratio)');
    expect(section.getAttribute('aria-label')).toBe(homeCopy.hero.label);
  });

  it('một h2 tiêu đề, một câu mô tả và hai lối thật: danh mục sản phẩm và Hành trình nguyên liệu', () => {
    mounted = render(<HomeEditorialHero />);
    const c = mounted.container;
    expect(c.querySelectorAll('h2')).toHaveLength(1);
    expect(c.querySelector('h2')!.textContent).toBe(homeCopy.hero.title);
    expect(c.textContent).toContain(homeCopy.hero.body);
    const links = Array.from(c.querySelectorAll('a')).map((a) => [a.textContent, a.getAttribute('href')]);
    expect(links).toEqual([
      [homeCopy.hero.ctaShop, '/san-pham'],
      [homeCopy.hero.ctaStory, '/cau-chuyen'],
    ]);
  });

  it('hai lối cao ≥ 44px (min-h-11) và hoạ tiết nền ẩn khỏi trình đọc màn hình', () => {
    mounted = render(<HomeEditorialHero />);
    const c = mounted.container;
    for (const a of Array.from(c.querySelectorAll('a'))) expect(a.className).toContain('min-h-11');
    expect(c.querySelector('svg')!.closest('[aria-hidden]')).not.toBeNull();
  });

  it('chỉ dùng token: không hex, không màu nguyên thuỷ (--forest, --stone), không max-md', () => {
    mounted = render(<HomeEditorialHero />);
    const html = mounted.container.innerHTML;
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(html).not.toMatch(/--(forest|stone|sage|clay)-/);
    expect(html).not.toContain('max-md:');
  });

  it('chữ không chứa thuật ngữ cấm hay lời hứa chưa kiểm chứng', () => {
    const text = Object.values(homeCopy.hero).join(' ');
    expect(text).not.toMatch(/voucher|flash sale|freeship|vui lòng|chúng tôi|cửa hàng|hữu cơ|\.\.\./i);
  });
});
