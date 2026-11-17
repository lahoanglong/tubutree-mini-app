// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

// Bản web của components/offers/offers-history.spec.tsx (Mini App).
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get } }));

import { ApiError } from '@/lib/client-api';
import { OffersHistory } from './offers-history';

const PATH = '/me/coupons/history';
const row = (code: string, status: 'USED' | 'EXPIRED') => ({
  code,
  type: 'AMOUNT',
  value: 20_000,
  minOrder: null,
  maxDiscount: null,
  endAt: '2026-10-01T00:00:00.000Z',
  status,
  usedAt: status === 'USED' ? '2026-09-20T00:00:00.000Z' : null,
});

let mounted: Rendered | null = null;
let qc: QueryClient;
const tree = (initialOpen: boolean, scrollReady: boolean) => <OffersHistory initialOpen={initialOpen} scrollReady={scrollReady} />;
const mount = async (initialOpen = false, scrollReady = true) => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mounted = render(tree(initialOpen, scrollReady), qc);
  await flush(6);
  return mounted.container;
};
const toggle = (c: ParentNode) => [...c.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Mã đã dùng, hết hạn')!;
const panel = (c: ParentNode) => document.getElementById(toggle(c).getAttribute('aria-controls')!)!;
const calls = () => mocks.get.mock.calls.filter(([p]) => p === PATH).length;

beforeEach(() => {
  mocks.get.mockReset().mockResolvedValue([row('DA-DUNG', 'USED'), row('HET-HAN', 'EXPIRED')]);
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('OffersHistory (web) — mục "Mã đã dùng, hết hạn" mở tại chỗ ở Mã của tôi', () => {
  it('đóng: không gọi API lịch sử, panel ẩn, nút aria-expanded=false trỏ vào panel', async () => {
    const c = await mount();
    expect(toggle(c).getAttribute('aria-expanded')).toBe('false');
    expect(panel(c).hidden).toBe(true);
    expect(calls()).toBe(0);
  });

  it('mở: gọi /me/coupons/history một lần, vẽ phiếu đã dùng và hết hạn trong lưới, không phiếu nào có nút; đóng lại không gọi thêm', async () => {
    const c = await mount();
    click(toggle(c));
    await flush(6);
    expect(toggle(c).getAttribute('aria-expanded')).toBe('true');
    expect(panel(c).hidden).toBe(false);
    expect(panel(c).querySelectorAll('[role="group"]')).toHaveLength(2);
    expect(panel(c).querySelectorAll('button')).toHaveLength(0);
    for (const cls of ['grid-cols-1', 'md:grid-cols-2', 'lg:grid-cols-3']) expect(panel(c).className).toContain(cls);
    expect(calls()).toBe(1);
    click(toggle(c));
    await flush(2);
    expect(toggle(c).getAttribute('aria-expanded')).toBe('false');
    expect(panel(c).hidden).toBe(true);
    expect(calls()).toBe(1);
  });

  it('đang tải: panel aria-busy; tải xong rỗng thì trạng thái rỗng tại chỗ, bỏ aria-busy', async () => {
    let release: (v: unknown) => void = () => undefined;
    mocks.get.mockImplementation(() => new Promise((r) => (release = r)));
    const c = await mount(true);
    expect(panel(c).getAttribute('aria-busy')).toBe('true');
    await act(async () => release([]));
    await flush(4);
    expect(panel(c).textContent).toContain('Chưa có mã đã dùng hoặc hết hạn');
    expect(panel(c).getAttribute('aria-busy')).toBeNull();
  });

  it('tải lỗi: báo tại chỗ, "Thử lại" gọi lại API rồi vẽ phiếu', async () => {
    mocks.get.mockRejectedValueOnce(new ApiError('x', 500));
    const c = await mount(true);
    expect(panel(c).textContent).toContain('Chưa tải được mã giảm giá');
    const retry = [...panel(c).querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Thử lại')!;
    await act(async () => click(retry));
    await flush(6);
    expect(panel(c).querySelectorAll('[role="group"]')).toHaveLength(2);
    expect(calls()).toBe(2);
  });

  it('initialOpen (?history=1): mở sẵn và cuộn tới mục đúng một lần, chỉ khi scrollReady', async () => {
    const c = await mount(true, false);
    expect(toggle(c).getAttribute('aria-expanded')).toBe('true');
    expect(window.HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
    act(() => mounted!.root.render(<QueryClientProvider client={qc}>{tree(true, true)}</QueryClientProvider>));
    await flush(2);
    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    click(toggle(c));
    click(toggle(c));
    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('không initialOpen thì không cuộn', async () => {
    await mount(false, true);
    expect(window.HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
  });
});
