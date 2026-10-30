// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: vi.fn(), delete: vi.fn() } }));
vi.mock('@/lib/route-map', () => ({ isWebRouteReady: () => true }));

import { HeaderBell } from './header-bell';

let mounted: Rendered | null = null;
const setViewport = (wide: boolean) => {
  window.matchMedia = ((query: string) => ({
    matches: wide,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
};
const paths = () => mocks.get.mock.calls.map(([p]) => p);

beforeEach(() => {
  mocks.get.mockReset().mockResolvedValue({ count: 73 });
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('HeaderBell', () => {
  it('khổ rộng: một lời gọi đếm unread-count (không tải danh sách tin), huy hiệu hiện số thật của hộp thư', async () => {
    setViewport(true);
    mounted = render(<HeaderBell authed />);
    await flush(5);
    expect(paths()).toEqual(['/me/notifications/unread-count']);
    expect(mounted.container.querySelector('a')?.getAttribute('aria-label')).toBe('Thông báo, 73 chưa đọc');
    expect(mounted.container.textContent).toBe('73');
  });

  it('khổ điện thoại: không gọi API (chuông riêng ở Trang chủ lo phần đếm)', async () => {
    setViewport(false);
    mounted = render(<HeaderBell authed />);
    await flush(5);
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('khách chưa đăng nhập: không có chuông và không gọi API', async () => {
    setViewport(true);
    mounted = render(<HeaderBell authed={false} />);
    await flush(5);
    expect(mounted.container.querySelector('a')).toBeNull();
    expect(mocks.get).not.toHaveBeenCalled();
  });
});
