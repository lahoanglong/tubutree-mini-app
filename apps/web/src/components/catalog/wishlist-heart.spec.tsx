// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush } from '@/test-utils/dom';

// Cùng ý nghĩa wishlist-heart.spec.tsx của Mini App: chạm nhanh không đua lệnh, tim đổi ngay, lệnh lỗi thì về đúng trạng thái máy chủ.

const mocks = vi.hoisted(() => ({
  phase: 'authenticated' as string,
  push: vi.fn(),
  http: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/core-http', () => ({ coreHttp: mocks.http }));

import { WishlistHeart } from './wishlist-heart';

let server: string[] = [];
let unmount: (() => void) | null = null;
let qc: QueryClient;

function mount(parentClick = vi.fn()) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => {
    root.render(
      createElement(QueryClientProvider, { client: qc }, createElement('div', { onClick: parentClick }, createElement(WishlistHeart, { productId: 'p1' }))),
    );
  });
  unmount = () => {
    act(() => root.unmount());
    container.remove();
  };
  return container;
}
const heart = (c: HTMLElement) => c.querySelector('button')!;

beforeEach(() => {
  mocks.phase = 'authenticated';
  mocks.push.mockReset();
  server = [];
  mocks.http.get.mockReset().mockImplementation(async () => [...server]);
  mocks.http.post.mockReset().mockImplementation(async (_p: string, body: { productId: string }) => {
    if (!server.includes(body.productId)) server.push(body.productId);
    return { ok: true };
  });
  mocks.http.delete.mockReset().mockImplementation(async (p: string) => {
    server = server.filter((x) => `/me/wishlist/${x}` !== p);
    return { ok: true };
  });
  window.history.replaceState(null, '', '/san-pham/dau-goi?ref=A');
});
afterEach(() => unmount?.());

describe('WishlistHeart', () => {
  it('có tên truy cập và vùng chạm 44px', async () => {
    const c = mount();
    await flush();
    expect(heart(c).getAttribute('aria-label')).toBe('Thêm yêu thích');
    expect(heart(c).className).toContain('h-11');
    expect(heart(c).className).toContain('w-11');
  });

  it('khách chưa đăng nhập chạm tim thì sang đăng nhập và quay lại đúng trang, không nổi bọt lên thẻ cha', async () => {
    mocks.phase = 'guest';
    const parent = vi.fn();
    const c = mount(parent);
    await flush();
    click(heart(c));
    expect(mocks.push).toHaveBeenCalledWith('/dang-nhap?returnTo=%2Fsan-pham%2Fdau-goi%3Fref%3DA');
    expect(parent).not.toHaveBeenCalled();
    expect(mocks.http.post).not.toHaveBeenCalled();
  });

  it('thích gửi POST /me/wishlist {productId} và làm mới danh sách yêu thích', async () => {
    const c = mount();
    await flush();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    click(heart(c));
    await flush();
    expect(mocks.http.post).toHaveBeenCalledWith('/me/wishlist', { productId: 'p1' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['wishlist'] });
    expect(heart(c).getAttribute('aria-pressed')).toBe('true');
  });

  it('chạm đúp lúc chưa thích: thêm rồi bỏ lần lượt, kết quả cuối là chưa thích', async () => {
    const c = mount();
    await flush();
    click(heart(c));
    click(heart(c));
    await flush(10);
    expect(mocks.http.post).toHaveBeenCalledTimes(1);
    expect(mocks.http.delete).toHaveBeenCalledWith('/me/wishlist/p1');
    expect(mocks.http.post.mock.invocationCallOrder[0]).toBeLessThan(mocks.http.delete.mock.invocationCallOrder[0]!);
    expect(heart(c).getAttribute('aria-pressed')).toBe('false');
    expect(server).toEqual([]);
  });

  it('một lệnh lỗi: tim trở về đúng trạng thái máy chủ', async () => {
    const c = mount();
    await flush();
    mocks.http.post.mockRejectedValueOnce(new Error('500'));
    click(heart(c));
    expect(qc.getQueryData(['wishlist-ids'])).toEqual(['p1']);
    await flush(10);
    expect(heart(c).getAttribute('aria-pressed')).toBe('false');
  });
});
