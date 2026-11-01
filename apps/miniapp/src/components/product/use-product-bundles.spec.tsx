import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductBundles } from '@tubutree/app-core/api/bundle';

const mocks = vi.hoisted(() => ({ fetchBundles: vi.fn() }));
vi.mock('../../services/bundle-api', () => ({ getProductBundles: mocks.fetchBundles }));

import { PDP_BUNDLES_WAIT_MS, useBundlesWait, useProductBundles } from './use-product-bundles';

const EMPTY: ProductBundles = { combos: [], addons: [] };
let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mocks.fetchBundles.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('useProductBundles', () => {
  it('gọi một lần cho mỗi slug, không gọi khi chưa có slug', async () => {
    mocks.fetchBundles.mockResolvedValue(EMPTY);
    const { result, rerender } = renderHook(({ slug }: { slug?: string }) => useProductBundles(slug), { wrapper, initialProps: { slug: undefined as string | undefined } });
    expect(mocks.fetchBundles).not.toHaveBeenCalled();
    rerender({ slug: 'sp-a' });
    await waitFor(() => expect(result.current.data).toEqual(EMPTY));
    rerender({ slug: 'sp-a' });
    expect(mocks.fetchBundles).toHaveBeenCalledTimes(1);
    expect(mocks.fetchBundles).toHaveBeenCalledWith('sp-a');
  });
});

describe('useBundlesWait: giữ khung chờ trang sản phẩm để khối về sau không đẩy nội dung', () => {
  const mount = (slug = 'sp-a') => renderHook(({ s }: { s: string }) => useBundlesWait(s), { wrapper, initialProps: { s: slug } });

  it('đang tải thì chờ; tải xong (có hay rỗng) thì thôi chờ', async () => {
    let resolve!: (v: ProductBundles) => void;
    mocks.fetchBundles.mockReturnValue(new Promise<ProductBundles>((r) => { resolve = r; }));
    const { result } = mount();
    expect(result.current).toBe(true);
    act(() => resolve(EMPTY));
    await waitFor(() => expect(result.current).toBe(false));
  });

  it('lỗi thì thôi chờ ngay, không báo lỗi', async () => {
    mocks.fetchBundles.mockRejectedValue(new Error('mạng'));
    const { result } = mount();
    await waitFor(() => expect(result.current).toBe(false));
  });

  it(`chờ tối đa ${PDP_BUNDLES_WAIT_MS}ms: API treo thì trang vẫn hiện, không đứng mãi ở khung chờ`, async () => {
    vi.useFakeTimers();
    mocks.fetchBundles.mockReturnValue(new Promise(() => {}));
    const { result } = mount();
    expect(result.current).toBe(true);
    await act(async () => vi.advanceTimersByTime(PDP_BUNDLES_WAIT_MS - 1));
    expect(result.current).toBe(true);
    await act(async () => vi.advanceTimersByTime(1));
    expect(result.current).toBe(false);
  });

  it('sang sản phẩm khác lại chờ từ đầu', async () => {
    vi.useFakeTimers();
    mocks.fetchBundles.mockReturnValue(new Promise(() => {}));
    const { result, rerender } = mount('sp-a');
    await act(async () => vi.advanceTimersByTime(PDP_BUNDLES_WAIT_MS));
    expect(result.current).toBe(false);
    rerender({ s: 'sp-b' });
    expect(result.current).toBe(true);
  });
});

describe('useBundlesWait: chỉ chờ một lần', () => {
  it('đã hết chờ rồi truy vấn bị đặt lại về "đang tải" (vd đăng xuất, làm mới toàn bộ): không dựng lại khung chờ', async () => {
    mocks.fetchBundles.mockRejectedValue(new Error('mạng'));
    const { result } = renderHook(() => useBundlesWait('sp-a'), { wrapper });
    await waitFor(() => expect(result.current).toBe(false));
    mocks.fetchBundles.mockReturnValue(new Promise(() => {}));
    act(() => {
      void client.resetQueries({ queryKey: ['bundles', 'product', 'sp-a'] });
    });
    await waitFor(() => expect(client.getQueryState(['bundles', 'product', 'sp-a'])?.fetchStatus).toBe('fetching'));
    expect(client.getQueryState(['bundles', 'product', 'sp-a'])?.status).toBe('pending');
    expect(result.current).toBe(false);
  });
});
