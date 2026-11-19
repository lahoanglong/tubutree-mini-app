import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const mocks = vi.hoisted(() => ({ get: vi.fn(), paths: [] as string[], revalidate: [] as (number | undefined)[] }));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('@/lib/core-http-server', () => ({
  createServerHttp: (init?: { revalidate?: number }) => {
    mocks.revalidate.push(init?.revalidate);
    return {
      get: (path: string) => {
        mocks.paths.push(path);
        return mocks.get(path);
      },
    };
  },
}));

import GuestOrderLayout, { metadata } from './layout';

const child = <p data-testid="guest-order-child">trang theo dõi</p>;
const renderLayout = async () => renderToStaticMarkup(await GuestOrderLayout({ children: child }));

beforeEach(() => {
  mocks.get.mockReset();
  mocks.paths = [];
  mocks.revalidate = [];
});

describe('/don/[code] layout: cờ web.guest_checkout_enabled', () => {
  it('cờ tắt: 404 (notFound) thay vì dựng khung trang 200', async () => {
    mocks.get.mockResolvedValue({ webGuestCheckoutEnabled: false });
    await expect(renderLayout()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.paths).toEqual(['/config/public']);
  });

  it('API cũ không trả trường cờ: coi là tắt, 404', async () => {
    mocks.get.mockResolvedValue({ freeshipThreshold: 199_000 });
    await expect(renderLayout()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('cờ bật: dựng trang theo dõi như cũ; cấu hình đọc thẳng API mỗi lượt (revalidate 0), không lấy bản cờ cũ trong bộ đệm', async () => {
    mocks.get.mockResolvedValue({ webGuestCheckoutEnabled: true });
    expect(await renderLayout()).toContain('data-testid="guest-order-child"');
    expect(mocks.revalidate).toEqual([0]);
  });

  it('API treo: quá 2 giây thì dựng trang như khi API lỗi, không đứng chờ', async () => {
    vi.useFakeTimers();
    try {
      mocks.get.mockReturnValue(new Promise(() => undefined));
      const pending = renderLayout();
      await vi.advanceTimersByTimeAsync(2_000);
      expect(await pending).toContain('data-testid="guest-order-child"');
    } finally {
      vi.useRealTimers();
    }
  });

  it('không đọc được cấu hình (API tạm lỗi): vẫn dựng trang, sự cố tạm thời không thành 404', async () => {
    mocks.get.mockRejectedValue(new Error('offline'));
    expect(await renderLayout()).toContain('data-testid="guest-order-child"');
  });

  it('vẫn chặn lập chỉ mục và không gửi Referer', () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.referrer).toBe('no-referrer');
  });
});
