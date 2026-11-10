// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush } from '@/test-utils/dom';

// Cùng ý nghĩa wishlist-heart-restoring.spec.tsx của Mini App: chạm tim lúc app còn đang khôi phục phiên không bị nuốt. Ra phiên thì làm đúng việc khách vừa chạm
// (một lần, dù chạm nhiều lần trong lúc chờ); ra khách thì sang đăng nhập như mọi cú chạm của khách; mất kết nối thì bỏ ý định và không để lại cờ.

const mocks = vi.hoisted(() => ({
  phase: 'loading' as string,
  push: vi.fn(),
  http: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/core-http', () => ({ coreHttp: mocks.http }));

import { WishlistHeart } from './wishlist-heart';

let server: string[] = [];
let root: Root;
let container: HTMLDivElement;
let qc: QueryClient;
const parentClick = vi.fn();

const draw = () =>
  act(() => {
    root.render(createElement(QueryClientProvider, { client: qc }, createElement('div', { onClick: parentClick }, createElement(WishlistHeart, { productId: 'p1' }))));
  });
const goTo = async (phase: string) => {
  mocks.phase = phase;
  draw();
  await flush(8);
};
const heart = () => container.querySelector('button')!;
const sent = () => ({ posts: mocks.http.post.mock.calls.length, deletes: mocks.http.delete.mock.calls.length });

beforeEach(() => {
  mocks.phase = 'loading';
  mocks.push.mockReset();
  parentClick.mockReset();
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
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  draw();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('WishlistHeart: chạm lúc app đang khôi phục phiên', () => {
  it('chạm lúc đang khôi phục: chưa gọi API; khôi phục ra phiên thì thích đúng một lần', async () => {
    await flush(2);
    click(heart());
    await flush(4);
    expect(sent()).toEqual({ posts: 0, deletes: 0 });
    expect(mocks.push).not.toHaveBeenCalled();
    await goTo('authenticated');
    expect(mocks.http.post).toHaveBeenCalledTimes(1);
    expect(mocks.http.post).toHaveBeenCalledWith('/me/wishlist', { productId: 'p1' });
    expect(sent().deletes).toBe(0);
    expect(heart().getAttribute('aria-pressed')).toBe('true');
    expect(server).toEqual(['p1']);
  });

  it('chạm nhiều lần lúc đang chờ vẫn là một ý định: một lần thích, không thêm rồi bỏ', async () => {
    await flush(2);
    click(heart());
    click(heart());
    click(heart());
    await flush(4);
    await goTo('authenticated');
    expect(sent()).toEqual({ posts: 1, deletes: 0 });
    expect(heart().getAttribute('aria-pressed')).toBe('true');
  });

  it('không nổi bọt lên thẻ cha', async () => {
    click(heart());
    await flush(2);
    expect(parentClick).not.toHaveBeenCalled();
  });

  it('khôi phục ra khách: sang đăng nhập quay lại đúng trang như khách chạm tim, không gọi API', async () => {
    click(heart());
    await flush(2);
    await goTo('guest');
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledWith('/dang-nhap?returnTo=%2Fsan-pham%2Fdau-goi%3Fref%3DA');
    expect(sent()).toEqual({ posts: 0, deletes: 0 });
  });

  it('khôi phục mất kết nối (unavailable): bỏ ý định, không gọi API; có phiên lại sau đó cũng không tự thích', async () => {
    click(heart());
    await flush(2);
    await goTo('unavailable');
    expect(sent()).toEqual({ posts: 0, deletes: 0 });
    expect(mocks.push).not.toHaveBeenCalled();
    await goTo('authenticated');
    expect(sent()).toEqual({ posts: 0, deletes: 0 });
  });

  it('chạm lúc đã mất kết nối (unavailable) không để lại ý định: có phiên lại sau đó không tự thích', async () => {
    await goTo('unavailable');
    click(heart());
    await flush(4);
    expect(sent()).toEqual({ posts: 0, deletes: 0 });
    expect(mocks.push).not.toHaveBeenCalled();
    await goTo('authenticated');
    expect(sent()).toEqual({ posts: 0, deletes: 0 });
    expect(heart().getAttribute('aria-pressed')).toBe('false');
  });

  it('không chạm lúc chờ: ra phiên không tự thích', async () => {
    await goTo('authenticated');
    expect(sent()).toEqual({ posts: 0, deletes: 0 });
    expect(heart().getAttribute('aria-pressed')).toBe('false');
  });

  it('ý định chỉ dùng một lần: pha đổi qua lại sau đó không thích lại hay bỏ thích', async () => {
    click(heart());
    await flush(2);
    await goTo('authenticated');
    expect(sent()).toEqual({ posts: 1, deletes: 0 });
    await goTo('loading');
    await goTo('authenticated');
    expect(sent()).toEqual({ posts: 1, deletes: 0 });
    expect(heart().getAttribute('aria-pressed')).toBe('true');
  });

  it('ra khách rồi: ý định đã dùng, pha đổi qua lại không đẩy sang đăng nhập lần hai', async () => {
    click(heart());
    await flush(2);
    await goTo('guest');
    await goTo('loading');
    await goTo('guest');
    expect(mocks.push).toHaveBeenCalledTimes(1);
  });

  it('chạm một lần lúc đã đăng nhập vẫn như cũ: đúng một lệnh, không đợi pha', async () => {
    await goTo('authenticated');
    click(heart());
    await flush(8);
    expect(sent()).toEqual({ posts: 1, deletes: 0 });
  });
});
