// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({ getFlashAllowance: vi.fn(), phase: 'authenticated' as string }));
vi.mock('@/lib/shop-client', () => ({ getFlashAllowance: mocks.getFlashAllowance }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase }));

import { useFlashAllowance } from './use-flash-allowance';

const FLASH = [
  { itemId: 'fi1', variationId: 'v1', productSlug: 'p', flashPrice: 26_000 },
  { itemId: 'fi2', variationId: 'v2', productSlug: 'p', flashPrice: 30_000 },
  { itemId: 'fi9', variationId: 'v9', productSlug: 'khac', flashPrice: 10_000 },
];

let latest: ReturnType<typeof useFlashAllowance<(typeof FLASH)[number]>> = [];
function Probe({ flash, variationIds }: { flash: typeof FLASH | undefined; variationIds: string[] }) {
  latest = useFlashAllowance(flash, variationIds);
  return null;
}

let mounted: Rendered[] = [];
const mount = (flash: typeof FLASH | undefined, variationIds = ['v1', 'v2'], client?: QueryClient) => {
  const r = render(<Probe flash={flash} variationIds={variationIds} />, client);
  mounted.push(r);
  return r;
};

describe('useFlashAllowance (web)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.phase = 'authenticated';
    mocks.getFlashAllowance.mockResolvedValue({ items: { fi1: { perUserLeft: 0, allowance: 0 } } });
    latest = [];
  });
  afterEach(() => {
    mounted.forEach((m) => m.unmount());
    mounted = [];
  });

  it('đã đăng nhập: một request cho các suất của đúng các phân loại đang vẽ, rồi trộn perUserLeft', async () => {
    mount(FLASH);
    await flush();
    expect(mocks.getFlashAllowance).toHaveBeenCalledTimes(1);
    expect(mocks.getFlashAllowance).toHaveBeenCalledWith(['fi1', 'fi2']);
    expect(latest[0]).toHaveProperty('perUserLeft', 0);
    expect(latest[1]).toBe(FLASH[1]);
    expect(latest[2]).toBe(FLASH[2]);
  });

  it.each(['guest', 'loading', 'unavailable'])('phiên %s: không gọi, trả đúng danh sách gốc', async (phase) => {
    mocks.phase = phase;
    mount(FLASH);
    await flush();
    expect(mocks.getFlashAllowance).not.toHaveBeenCalled();
    expect(latest).toBe(FLASH);
  });

  it('không có suất thuộc các phân loại đang vẽ, hoặc danh sách chưa về: không gọi', async () => {
    mount(FLASH, ['v-khac']);
    mount(undefined);
    await flush();
    expect(mocks.getFlashAllowance).not.toHaveBeenCalled();
  });

  it('vẽ lại với cùng các suất không gọi lần hai (cùng QueryClient)', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const first = mount(FLASH, ['v1', 'v2'], client);
    await flush();
    first.unmount();
    mount([...FLASH], ['v2', 'v1'], client);
    await flush();
    expect(mocks.getFlashAllowance).toHaveBeenCalledTimes(1);
    expect(latest[0]).toHaveProperty('perUserLeft', 0);
  });

  it('API lỗi (cũ, 404, mất mạng): trả đúng danh sách gốc, không ném', async () => {
    mocks.getFlashAllowance.mockRejectedValue(new Error('404'));
    mount(FLASH);
    await flush();
    expect(mocks.getFlashAllowance).toHaveBeenCalled();
    expect(latest).toBe(FLASH);
  });
});
