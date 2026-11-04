// @vitest-environment jsdom
import { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush } from '@/test-utils/dom';
import type { FlashItem } from './flash-price';

const api = vi.hoisted(() => ({ impl: null as null | (() => Promise<unknown>) }));
vi.mock('@/lib/shop-client', () => ({ getActiveFlashSales: () => api.impl!() }));

import { FlashSalesSeed, resetFlashSales, useFlashSalesLoaded, useRunningFlash } from './use-flash-sales';

const item = (endAt: string): FlashItem => ({
  itemId: 'i1', variationId: 'v1', productSlug: 'sp', flashPrice: 100, retailPrice: 200, salePrice: null, soldCount: 0, quota: 5, endAt,
});

function Probe() {
  const { flash } = useRunningFlash();
  const loaded = useFlashSalesLoaded();
  return <p data-testid="p">{`${flash.length}|${loaded ? 'loaded' : 'wait'}`}</p>;
}
const tree = (items: FlashItem[], now: number) => (
  <FlashSalesSeed items={items} now={now}>
    <Probe />
  </FlashSalesSeed>
);

beforeEach(() => {
  resetFlashSales();
  api.impl = () => new Promise(() => undefined);
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('FlashSalesSeed', () => {
  it('server render: đợt còn chạy theo giờ lúc dựng HTML thì có trong HTML', () => {
    const t0 = Date.now();
    expect(renderToString(tree([item(new Date(t0 + 60_000).toISOString())], t0))).toContain('1|wait');
  });

  it('hydrate khi đợt đã hết giữa lúc dựng HTML và lúc tải: không lệch hydrate, vẫn hiện như HTML tới khi lần hỏi đầu trả danh sách mới (không còn đợt)', async () => {
    const t0 = Date.now() - 120_000;
    const endAt = new Date(t0 + 30_000).toISOString();
    const html = renderToString(tree([item(endAt)], t0));
    expect(html).toContain('1|wait');
    resetFlashSales();
    let resolve!: (v: unknown) => void;
    api.impl = () => new Promise((r) => (resolve = r));
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);
    const errors: unknown[] = [];
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await act(async () => {
      hydrateRoot(container, tree([item(endAt)], t0), { onRecoverableError: (e) => errors.push(e) });
    });
    await flush();
    expect(errors).toEqual([]);
    expect(logged).not.toHaveBeenCalled();
    expect(container.textContent).toBe('1|wait');
    await act(async () => resolve([]));
    await flush();
    expect(container.textContent).toBe('0|loaded');
  });

  it('đợt còn chạy lâu: sau hydrate vẫn hiện, và chưa đánh dấu "đã tải" tới khi trình duyệt hỏi xong', async () => {
    const t0 = Date.now();
    const endAt = new Date(t0 + 600_000).toISOString();
    const container = document.createElement('div');
    container.innerHTML = renderToString(tree([item(endAt)], t0));
    document.body.appendChild(container);
    resetFlashSales();
    let resolve!: (v: unknown) => void;
    api.impl = () => new Promise((r) => (resolve = r));
    await act(async () => {
      hydrateRoot(container, tree([item(endAt)], t0));
    });
    await flush();
    expect(container.textContent).toBe('1|wait');
    await act(async () => resolve([item(endAt)]));
    await flush();
    expect(container.textContent).toBe('1|loaded');
  });
});

describe('useFlashNow: đồng hồ điện thoại lệch (trước khi lần hỏi đầu xong dùng đồng hồ đơn điệu, sau đó giờ máy chủ)', () => {
  const hydrateWith = async (stale: FlashItem, t0: number) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    container.innerHTML = renderToString(tree([stale], t0));
    const htmlText = container.textContent;
    resetFlashSales();
    let resolve!: (v: unknown) => void;
    api.impl = () => new Promise((r) => (resolve = r));
    await act(async () => {
      hydrateRoot(container, tree([stale], t0));
    });
    await flush();
    return { container, htmlText, resolve };
  };

  it('điện thoại chạy NHANH 7 giờ, đợt còn chạy: không bị giấu rồi hiện lại; vẫn hiện trước và sau khi lần hỏi đầu xong', async () => {
    const t0 = Date.now();
    const realNow = Date.now;
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 7 * 3_600_000);
    const running = item(new Date(t0 + 600_000).toISOString());
    const { container, htmlText, resolve } = await hydrateWith(running, t0);
    expect(htmlText).toBe('1|wait');
    expect(container.textContent).toBe('1|wait');
    // Lần hỏi đầu trả về cùng đợt và giờ máy chủ đúng (giờ thật = t0): đợt vẫn chạy.
    const { syncServerClock } = await import('@tubutree/app-core/server-clock');
    syncServerClock(new Date(t0).toISOString());
    await act(async () => resolve([running]));
    await flush();
    expect(container.textContent).toBe('1|loaded');
  });

  it('điện thoại chạy CHẬM 10 phút, đợt đã hết lúc dựng HTML: không hiện lại sau mount', async () => {
    const t0 = Date.now();
    const realNow = Date.now;
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() - 600_000);
    const { container, htmlText } = await hydrateWith(item(new Date(t0 - 1_000).toISOString()), t0);
    expect(htmlText).toBe('0|wait');
    expect(container.textContent).toBe('0|wait');
  });

  it('đợt hết giữa giờ dựng HTML và giờ thật: hiện như HTML lúc hydrate và sau mount, rồi biến mất khi lần hỏi đầu xong (danh sách mới không còn đợt)', async () => {
    const t0 = Date.now() - 120_000;
    const { container, htmlText, resolve } = await hydrateWith(item(new Date(t0 + 30_000).toISOString()), t0);
    expect(htmlText).toBe('1|wait');
    expect(container.textContent).toBe('1|wait');
    await act(async () => resolve([]));
    await flush();
    expect(container.textContent).toBe('0|loaded');
  });

  it('sau khi đã đồng bộ giờ máy chủ: đợt đã hết theo giờ máy chủ biến mất ngay cả khi API vẫn trả nó', async () => {
    const t0 = Date.now() - 120_000;
    const ended = item(new Date(t0 + 30_000).toISOString());
    const { container, resolve } = await hydrateWith(ended, t0);
    const { syncServerClock } = await import('@tubutree/app-core/server-clock');
    syncServerClock(new Date().toISOString());
    await act(async () => resolve([ended]));
    await flush();
    expect(container.textContent).toBe('0|loaded');
  });
});

describe('điều hướng phía khách tới trang có seed mới', () => {
  it('mã đã nạp từ lâu, lần hỏi đầu chưa xong: seed mới có đợt còn chạy thì vẫn hiện (mốc đơn điệu tính từ seed, không từ lúc nạp mã)', async () => {
    const t0 = Date.now();
    const realPerf = performance.now.bind(performance);
    // Giả lập đã ở trên trang 10 phút: đồng hồ đơn điệu đã chạy xa trước khi seed này được dựng.
    vi.spyOn(performance, 'now').mockImplementation(() => realPerf() + 600_000);
    resetFlashSales();
    api.impl = () => new Promise(() => undefined);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const { createRoot } = await import('react-dom/client');
    const root = createRoot(container);
    await act(async () => {
      root.render(tree([item(new Date(t0 + 120_000).toISOString())], t0));
    });
    await flush();
    expect(container.textContent).toBe('1|wait');
    act(() => root.unmount());
  });

  it('lần hỏi đầu lỗi: không đánh dấu đã đồng bộ giờ; thành công thì có', async () => {
    const { isFlashClockSynced } = await import('./flash-now');
    const t0 = Date.now();
    const mountOnce = async () => {
      const c = document.createElement('div');
      document.body.appendChild(c);
      const { createRoot } = await import('react-dom/client');
      const root = createRoot(c);
      await act(async () => root.render(tree([], t0)));
      await flush();
      act(() => root.unmount());
    };
    resetFlashSales();
    api.impl = () => Promise.reject(new Error('x'));
    await mountOnce();
    expect(isFlashClockSynced()).toBe(false);
    resetFlashSales();
    api.impl = async () => [];
    await mountOnce();
    expect(isFlashClockSynced()).toBe(true);
  });
});
