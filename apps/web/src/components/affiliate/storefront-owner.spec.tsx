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

import { StorefrontAction, StorefrontEmpty } from './storefront-owner';

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

  it('khách ở điện thoại: nút Xem sản phẩm xanh đậm như Button mặc định của Mini App', () => {
    state.ref = undefined;
    mounted = render(<StorefrontAction slug="an" title="An" referralCode="ctv123" />);
    const link = mounted.container.querySelector('a')!;
    expect(link.className).toContain('max-md:bg-forest-600');
    expect(link.className).toContain('max-md:text-stone-0');
  });

  it('chủ gian hàng: nút Chia sẻ gian hàng mở sheet kèm mã giới thiệu, không có "Thêm sản phẩm"', () => {
    mounted = render(<StorefrontAction slug="an" title="An" referralCode="ctv123" />);
    expect(mounted.container.textContent).not.toContain('Thêm sản phẩm');
    click(mounted.container.querySelector('button'));
    expect(document.body.textContent).toContain('an|ctv123');
  });

  it('khách: Xem sản phẩm dẫn sang danh mục khi đã mở, chưa mở thì về trang chủ', () => {
    state.ref = undefined;
    mounted = render(<StorefrontAction slug="an" title="An" referralCode="ctv123" />);
    expect(mounted.container.querySelector('a')?.getAttribute('href')).toBe('/san-pham');
    mounted.unmount();
    state.catalogReady = false;
    mounted = render(<StorefrontAction slug="an" title="An" referralCode="ctv123" />);
    expect(mounted.container.querySelector('a')?.getAttribute('href')).toBe('/');
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
