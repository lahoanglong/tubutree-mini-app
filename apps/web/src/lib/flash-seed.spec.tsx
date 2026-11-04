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

  it('hydrate khi đợt đã hết giữa lúc dựng HTML và lúc tải: không lệch hydrate ở lần dựng đầu, sau mount thanh biến mất một lần', async () => {
    const t0 = Date.now() - 120_000;
    const endAt = new Date(t0 + 30_000).toISOString();
    const html = renderToString(tree([item(endAt)], t0));
    expect(html).toContain('1|wait');
    resetFlashSales();
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
    expect(container.textContent).toBe('0|wait');
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
