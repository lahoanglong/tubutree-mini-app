// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { flush, render, type Rendered } from '@/test-utils/dom';

const getAdminImage = vi.fn();
vi.mock('@/lib/admin-client', () => ({ getAdminImage: (ref: string) => getAdminImage(ref) }));

import { AdminImage, directImageSrc, isAdminImageRef } from './admin-image';

describe('isAdminImageRef', () => {
  it.each([
    '/admin/reviews/r1/images/0?v=0123456789',
    '/admin/merchant-products/p1/images/product/thumb?v=0123456789',
    '/admin/merchant-products/p1/images/draft/3?v=0123456789',
  ])('nhận %s', (ref) => expect(isAdminImageRef(ref)).toBe(true));

  it.each([
    '/admin/orders/export',
    '/admin/reviews/r1/images/0',
    '/admin/reviews/../x/images/0?v=0123456789',
    '/admin/merchant-products/p1/images/other/0?v=0123456789',
    'https://evil.example/admin/reviews/r1/images/0?v=0123456789',
    null,
  ])('từ chối %s', (ref) => expect(isAdminImageRef(ref)).toBe(false));
});

describe('directImageSrc', () => {
  it('https và đường dẫn công khai của API được nhận; chuỗi lạ bị bỏ', () => {
    expect(directImageSrc('https://cdn.example/a.jpg')).toBe('https://cdn.example/a.jpg');
    expect(directImageSrc('/public-image/product/p1/0?v=0123456789abcdef')).toMatch(/\/public-image\/product\/p1\/0\?v=0123456789abcdef$/);
    expect(directImageSrc('javascript:alert(1)')).toBeNull();
    expect(directImageSrc('/etc/passwd')).toBeNull();
    expect(directImageSrc(null)).toBeNull();
  });
});

describe('AdminImage', () => {
  const REF = '/admin/reviews/r1/images/0?v=0123456789';
  const REF2 = '/admin/reviews/r1/images/1?v=0123456789';
  const png = () => ({ type: 'image/png', blob: new Blob(['x'], { type: 'image/png' }) });
  let seen: Array<() => void>;
  let create: ReturnType<typeof vi.fn>;
  let revoke: ReturnType<typeof vi.fn>;
  let mounted: Rendered[];
  const mount = (ui: Parameters<typeof render>[0]) => {
    const r = render(ui);
    mounted.push(r);
    return r;
  };
  const enterView = () => act(() => seen.forEach((f) => f()));
  const img = (r: Rendered) => r.container.querySelector('img');

  beforeEach(() => {
    seen = [];
    mounted = [];
    getAdminImage.mockReset();
    let n = 0;
    create = vi.fn(() => `blob:mock/${++n}`);
    revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(private cb: (e: Array<{ isIntersecting: boolean }>) => void) {}
        observe() {
          seen.push(() => this.cb([{ isIntersecting: true }]));
        }
        disconnect() {}
      },
    );
  });
  afterEach(() => {
    mounted.forEach((m) => m.container.isConnected && m.unmount());
    vi.unstubAllGlobals();
  });

  it('chưa vào khung nhìn thì chưa gọi fetch; vào rồi mới tải', async () => {
    getAdminImage.mockResolvedValue(png());
    mount(<AdminImage src={REF} alt="ảnh" className="h-16 w-16" />);
    await flush();
    expect(getAdminImage).not.toHaveBeenCalled();
    enterView();
    await flush();
    expect(getAdminImage).toHaveBeenCalledWith(REF);
  });

  it('môi trường không có IntersectionObserver thì tải ngay', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    getAdminImage.mockResolvedValue(png());
    mount(<AdminImage src={REF} alt="ảnh" />);
    await flush();
    expect(getAdminImage).toHaveBeenCalledTimes(1);
  });

  it('tải thành công dựng blob URL và bọc trong liên kết mở tab mới', async () => {
    getAdminImage.mockResolvedValue(png());
    const r = mount(<AdminImage src={REF} alt="ảnh review" className="h-16 w-16" />);
    enterView();
    await flush();
    expect(img(r)!.getAttribute('src')).toBe('blob:mock/1');
    const link = img(r)!.closest('a')!;
    expect(link.getAttribute('href')).toBe('blob:mock/1');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('lỗi tải hiện chữ "Không tải được ảnh" thay vì biến mất', async () => {
    getAdminImage.mockRejectedValue(new Error('429'));
    const r = mount(<AdminImage src={REF} alt="ảnh" className="h-16 w-16" />);
    enterView();
    await flush();
    expect(r.container.textContent).toContain('Không tải được ảnh');
    expect(img(r)).toBeNull();
  });

  it('định dạng không an toàn (ví dụ SVG) cũng hiện ô lỗi', async () => {
    getAdminImage.mockResolvedValue({ type: 'image/svg+xml', blob: new Blob(['<svg/>']) });
    const r = mount(<AdminImage src={REF} alt="ảnh" />);
    enterView();
    await flush();
    expect(r.container.textContent).toContain('Không tải được ảnh');
  });

  it('đổi src thì thu hồi blob cũ; unmount thì thu hồi blob hiện tại', async () => {
    getAdminImage.mockResolvedValue(png());
    const r = mount(<AdminImage src={REF} alt="a" />);
    enterView();
    await flush();
    expect(img(r)!.getAttribute('src')).toBe('blob:mock/1');
    act(() => r.root.render(<QueryClientProvider client={new QueryClient()}><AdminImage src={REF2} alt="a" /></QueryClientProvider>));
    await flush();
    expect(revoke).toHaveBeenCalledWith('blob:mock/1');
    expect(img(r)!.getAttribute('src')).toBe('blob:mock/2');
    r.unmount();
    expect(revoke).toHaveBeenCalledWith('blob:mock/2');
  });

  it('kết quả về sau unmount không setState và blob vừa tạo được thu hồi', async () => {
    let resolve!: (v: unknown) => void;
    getAdminImage.mockReturnValue(new Promise((res) => (resolve = res)));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = mount(<AdminImage src={REF} alt="a" />);
    enterView();
    await flush();
    expect(getAdminImage).toHaveBeenCalled();
    r.unmount();
    resolve(png());
    await flush();
    expect(revoke).toHaveBeenCalledWith('blob:mock/1');
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });
});
