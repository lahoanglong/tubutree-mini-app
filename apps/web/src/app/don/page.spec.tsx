import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

const mocks = vi.hoisted(() => ({ get: vi.fn(), revalidate: [] as (number | undefined)[] }));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/lib/core-http-server', () => ({
  createServerHttp: (init?: { revalidate?: number }) => {
    mocks.revalidate.push(init?.revalidate);
    return { get: (path: string) => mocks.get(path) };
  },
}));

import GuestOrderLookupPage, { metadata } from './page';
import { GuestOrderLookup } from './lookup-form';

const page = (ma?: string | string[]) => GuestOrderLookupPage({ searchParams: Promise.resolve(ma === undefined ? {} : { ma }) }) as Promise<ReactElement<{ initialCode: string }>>;

beforeEach(() => {
  mocks.get.mockReset();
  mocks.revalidate = [];
});

describe('/don trang tra cứu (máy chủ)', () => {
  it('noindex, nofollow, không gửi Referer', () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.referrer).toBe('no-referrer');
  });

  it('cờ tắt: 404 như /don/<mã>; đọc cờ thẳng API mỗi lượt (revalidate 0)', async () => {
    mocks.get.mockResolvedValue({ webGuestCheckoutEnabled: false });
    await expect(page()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.revalidate).toEqual([0]);
  });

  it('cờ bật: dựng biểu mẫu, ?ma= điền sẵn mã (cắt 40 ký tự, lấy giá trị đầu nếu lặp)', async () => {
    mocks.get.mockResolvedValue({ webGuestCheckoutEnabled: true });
    const el = await page('TB777');
    expect(el.type).toBe(GuestOrderLookup);
    expect(el.props.initialCode).toBe('TB777');
    expect((await page(['A1', 'B2'])).props.initialCode).toBe('A1');
    expect((await page('X'.repeat(60))).props.initialCode).toHaveLength(40);
    expect((await page()).props.initialCode).toBe('');
  });

  it('không đọc được cấu hình (API lỗi): vẫn dựng biểu mẫu, API tự trả 404 khi không có đơn', async () => {
    mocks.get.mockRejectedValue(new Error('down'));
    expect((await page()).type).toBe(GuestOrderLookup);
  });
});
