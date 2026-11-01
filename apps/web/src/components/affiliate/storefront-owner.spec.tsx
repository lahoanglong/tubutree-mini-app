// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, render, type Rendered } from '@/test-utils/dom';

const state = vi.hoisted(() => ({ ref: 'CTV123' as string | undefined, catalogReady: true }));

vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: state.ref ? { referralCode: state.ref } : null }) }));
vi.mock('@/lib/route-map', () => ({ isWebRouteReady: (p: string) => (p === '/san-pham' ? state.catalogReady : true) }));
vi.mock('./storefront-share', () => ({
  StorefrontShareSheet: ({ open, slug, referralCode }: { open: boolean; slug: string; referralCode?: string | null }) =>
    open ? <div data-testid="share">{`${slug}|${referralCode}`}</div> : null,
}));

import { LearnStorefrontLink, MoreAtTubuLink, StorefrontAction, StorefrontEmpty } from './storefront-owner';

let mounted: Rendered | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  state.ref = 'CTV123';
  state.catalogReady = true;
});

describe('StorefrontAction', () => {
  it('điện thoại: nút nằm trong thanh dính đáy rộng hết hàng như StickyActionBar của Mini App (D7-35)', () => {
    mounted = render(<StorefrontAction slug="an" title="An" referralCode="ctv123" />);
    const bar = mounted.container.firstElementChild!;
    expect(bar.className).toContain('max-md:fixed');
    expect(bar.className).toContain('max-md:bottom-0');
    expect(mounted.container.querySelector('button')!.className).toContain('max-md:w-full');
  });

  it('khách không có thanh dính đáy: không nút nào kéo khách rời gian hàng', () => {
    state.ref = undefined;
    mounted = render(<StorefrontAction slug="an" title="An" referralCode="ctv123" />);
    expect(mounted.container.firstElementChild).toBeNull();
  });

  it('chủ gian hàng: nút Chia sẻ gian hàng mở sheet kèm mã giới thiệu, không có "Thêm sản phẩm"', () => {
    mounted = render(<StorefrontAction slug="an" title="An" referralCode="ctv123" />);
    expect(mounted.container.textContent).not.toContain('Thêm sản phẩm');
    click(mounted.container.querySelector('button'));
    expect(document.body.textContent).toContain('an|ctv123');
  });

  it('khách: link phụ "Xem thêm ở Tubu Tree" dẫn sang danh mục khi đã mở, chưa mở thì về trang chủ; chủ không có link này', () => {
    state.ref = undefined;
    mounted = render(<MoreAtTubuLink referralCode="ctv123" />);
    expect(mounted.container.querySelector('a')?.textContent).toBe('Xem thêm ở Tubu Tree');
    expect(mounted.container.querySelector('a')?.getAttribute('href')).toBe('/san-pham');
    mounted.unmount();
    state.catalogReady = false;
    mounted = render(<MoreAtTubuLink referralCode="ctv123" />);
    expect(mounted.container.querySelector('a')?.getAttribute('href')).toBe('/');
    mounted.unmount();
    state.ref = 'CTV123';
    mounted = render(<MoreAtTubuLink referralCode="ctv123" />);
    expect(mounted.container.querySelector('a')).toBeNull();
  });
});

describe('MoreAtTubuLink — hình dạng như Mini App', () => {
  it('là nút ghost xanh (zaui-btn-tertiary tubu-btn, 44px, không gạch chân) cách dòng "Tìm hiểu" 8px, không còn link gạch chân mt-4', () => {
    state.ref = undefined;
    state.catalogReady = true;
    mounted = render(<MoreAtTubuLink referralCode="ctv123" />);
    const wrap = mounted.container.querySelector<HTMLElement>('[data-testid="more-at-tubu"]')!;
    expect(wrap.className).toMatch(/\bmt-2\b/);
    expect(wrap.className).not.toMatch(/\bmt-4\b/);
    expect(wrap.className).toMatch(/\bmax-md:px-4\b/);
    const a = wrap.querySelector<HTMLAnchorElement>('a')!;
    expect(a.className).toMatch(/\bzaui-btn-tertiary\b/);
    expect(a.className).toMatch(/\btubu-btn\b/);
    expect(a.className).not.toMatch(/underline/);
    expect(a.style.minHeight).toBe('44px');
    expect(a.querySelector('.zaui-btn-container')).not.toBeNull();
    // <a> với khối bên trong không được nằm trong <p> (HTML không hợp lệ).
    expect(mounted.container.querySelector('p')).toBeNull();
  });
});

describe('LearnStorefrontLink', () => {
  it('khách thấy dòng "Tìm hiểu" dẫn tới /ctv/gian-hang; chủ gian hàng (so mã không phân biệt hoa thường) không thấy', () => {
    state.ref = undefined;
    mounted = render(<LearnStorefrontLink referralCode="ctv123" />);
    const a = mounted.container.querySelector('a')!;
    expect(a.textContent).toBe('Muốn có gian hàng như này? Tìm hiểu');
    expect(a.getAttribute('href')).toBe('/ctv/gian-hang');
    // Như Mini (tubu-press tubu-hit-44): dòng cao bằng chữ phụ, vùng chạm 44px do ::after, không min-h-11 làm dòng cao 44px.
    expect(a.className).toMatch(/\btubu-hit-44\b/);
    expect(a.className).not.toMatch(/\bmin-h-11\b/);
    mounted.unmount();
    state.ref = 'CTV123';
    mounted = render(<LearnStorefrontLink referralCode="ctv123" />);
    expect(mounted.container.querySelector('a')).toBeNull();
  });
});

describe('StorefrontEmpty', () => {
  it('chủ: nhắc Thêm sản phẩm tới trình dựng', () => {
    mounted = render(<StorefrontEmpty referralCode="CTV123" />);
    const a = mounted.container.querySelector('a');
    expect(a?.getAttribute('href')).toBe('/ctv/gian-hang');
    expect(a?.textContent).toBe('Thêm sản phẩm');
  });
});
