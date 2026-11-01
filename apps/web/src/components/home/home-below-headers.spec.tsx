// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        mocks.push(href);
      }}
      {...p}
    >
      {children}
    </a>
  ),
}));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'authenticated' }));
vi.mock('@/lib/use-public-config', () => ({ usePublicConfig: () => ({ isLoaded: true, communityPublicPreview: false }) }));
vi.mock('@/lib/route-map', () => ({ isWebRouteReady: () => true }));
vi.mock('@tubutree/app-core/api/feed', () => ({
  getFeed: vi.fn().mockResolvedValue({
    posts: [{ id: 'p1', title: 'Lá cúc bị vàng', body: 'x', author: 'An', createdAt: new Date().toISOString(), commentCount: 2 }],
  }),
}));

import { homeCopy } from '@tubutree/app-core/home-copy';
import { BrandJourney } from './brand-journey';
import { CommunityPreview } from './community-preview';

let mounted: Rendered | null = null;
const mount = async (ui: React.ReactElement) => {
  mounted = render(ui);
  await flush(5);
  return mounted.container;
};
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  mocks.push.mockReset();
});

describe('Hành trình nguyên liệu và Cộng đồng hỏi đáp dùng SectionHeader (P2 #5, web)', () => {
  it('Hành trình nguyên liệu: một SectionHeader, h2 chữ Inter 700, "Xem bản đồ" mở /cau-chuyen', async () => {
    const c = await mount(<BrandJourney initialBrands={[{ brand: 'Tubu', count: 4, slug: 'tubu' }]} />);
    const header = c.querySelector<HTMLElement>('[data-testid="section-header"]')!;
    expect(header).not.toBeNull();
    const h2 = header.querySelector('h2')!;
    expect(h2.textContent).toBe('Hành trình nguyên liệu');
    expect(h2.style.fontFamily).toBe('var(--font-ui)');
    expect(h2.style.fontWeight).toBe('700');
    expect(c.querySelectorAll('h2')).toHaveLength(1);
    click(header.querySelector('a[aria-label="Xem bản đồ Hành trình nguyên liệu"]'));
    expect(mocks.push).toHaveBeenCalledWith('/cau-chuyen');
  });

  it('Hành trình nguyên liệu: thẻ bản đồ và chip nhãn vẫn bấm được', async () => {
    const c = await mount(<BrandJourney initialBrands={[{ brand: 'Tubu', count: 4, slug: 'tubu' }]} />);
    const chip = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Tubu')!;
    click(chip);
    expect(mocks.push).toHaveBeenCalledWith('/brand/tubu');
    const card = Array.from(c.querySelectorAll('button')).find((b) => b.textContent?.includes('nhãn Việt'))!;
    click(card);
    expect(mocks.push).toHaveBeenCalledWith('/cau-chuyen');
  });

  it('Hành trình nguyên liệu: thẻ bản đồ ẩn khỏi trình đọc và khỏi Tab (aria-hidden + tabIndex -1), "Xem bản đồ" ở tiêu đề là điều khiển đọc được duy nhất (H3 #3)', async () => {
    const c = await mount(<BrandJourney initialBrands={[{ brand: 'Tubu', count: 4, slug: 'tubu' }]} />);
    const card = Array.from(c.querySelectorAll('button')).find((b) => b.textContent?.includes('nhãn Việt'))!;
    expect(card.getAttribute('aria-hidden')).toBe('true');
    expect(card.tabIndex).toBe(-1);
    const readable = Array.from(c.querySelectorAll('a, button')).filter((e) => !e.closest('[aria-hidden="true"]') && /bản đồ/i.test(e.getAttribute('aria-label') ?? e.textContent ?? ''));
    expect(readable).toHaveLength(1);
    expect(readable[0]!.getAttribute('aria-label')).toBe('Xem bản đồ Hành trình nguyên liệu');
  });

  it('Hành trình nguyên liệu: câu mô tả số nhãn vẫn đọc được đúng một lần dù thẻ bản đồ aria-hidden (H3 review)', async () => {
    const c = await mount(<BrandJourney initialBrands={[{ brand: 'Tubu', count: 4, slug: 'tubu' }, { brand: 'Lá Xanh', count: 2, slug: 'la-xanh' }]} />);
    const spokenCopy = Array.from(c.querySelectorAll('span')).filter((e) => e.children.length === 0 && /nhãn Việt/.test(e.textContent ?? '') && !e.closest('[aria-hidden="true"]'));
    expect(spokenCopy).toHaveLength(1);
    expect(spokenCopy[0]!.textContent).toBe(homeCopy.journey.body(2));
    expect(spokenCopy[0]!.closest('button')).toBeNull();
  });

  it('Cộng đồng hỏi đáp: một SectionHeader, h2 chữ Inter 700, "Xem tất cả" mở /cong-dong', async () => {
    const c = await mount(<CommunityPreview />);
    expect(c.textContent).toContain('Lá cúc bị vàng');
    const header = c.querySelector<HTMLElement>('[data-testid="section-header"]')!;
    expect(header).not.toBeNull();
    const h2 = header.querySelector('h2')!;
    expect(h2.textContent).toBe('Cộng đồng hỏi đáp');
    expect(h2.style.fontFamily).toBe('var(--font-ui)');
    click(header.querySelector('a[aria-label="Xem tất cả Cộng đồng hỏi đáp"]'));
    expect(mocks.push).toHaveBeenCalledWith('/cong-dong');
  });
});
