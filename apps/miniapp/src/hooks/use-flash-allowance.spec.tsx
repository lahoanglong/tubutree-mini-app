import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchFlashAllowance: vi.fn(), phase: 'authenticated' as string }));
vi.mock('../services/shop-api', () => ({ fetchFlashAllowance: mocks.fetchFlashAllowance }));
vi.mock('./use-auth-phase', () => ({ useAuthPhase: () => mocks.phase }));

import { useFlashAllowance } from './use-flash-allowance';

const FLASH = [
  { itemId: 'fi1', variationId: 'v1', productSlug: 'p', flashPrice: 26_000 },
  { itemId: 'fi2', variationId: 'v2', productSlug: 'p', flashPrice: 30_000 },
  { itemId: 'fi9', variationId: 'v9', productSlug: 'khac', flashPrice: 10_000 },
];

function setup(initial: { flash?: typeof FLASH | undefined; variationIds?: string[] } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return renderHook((props: { flash?: typeof FLASH; variationIds: string[] }) => useFlashAllowance(props.flash, props.variationIds), {
    wrapper,
    initialProps: { flash: 'flash' in initial ? initial.flash : FLASH, variationIds: initial.variationIds ?? ['v1', 'v2'] },
  });
}

describe('useFlashAllowance (Mini)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.phase = 'authenticated';
    mocks.fetchFlashAllowance.mockResolvedValue({ items: { fi1: { perUserLeft: 0, allowance: 0 } } });
  });

  it('đã đăng nhập: một request cho các suất của đúng các phân loại đang vẽ, rồi trộn perUserLeft vào danh sách', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current[0]).toHaveProperty('perUserLeft', 0));
    expect(mocks.fetchFlashAllowance).toHaveBeenCalledTimes(1);
    expect(mocks.fetchFlashAllowance).toHaveBeenCalledWith(['fi1', 'fi2']);
    expect(result.current[1]).toBe(FLASH[1]);
    expect(result.current[2]).toBe(FLASH[2]);
  });

  it.each(['guest', 'loading', 'unavailable'])('phiên %s: không gọi, trả đúng danh sách gốc', async (phase) => {
    mocks.phase = phase;
    const { result } = setup();
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.fetchFlashAllowance).not.toHaveBeenCalled();
    expect(result.current).toBe(FLASH);
  });

  it('không có suất nào thuộc các phân loại đang vẽ (hoặc danh sách chưa về): không gọi', async () => {
    setup({ variationIds: ['v-khac'] });
    setup({ flash: undefined });
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.fetchFlashAllowance).not.toHaveBeenCalled();
  });

  it('vẽ lại và đổi prop không liên quan (cùng các suất) không gọi lần hai', async () => {
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current[0]).toHaveProperty('perUserLeft', 0));
    rerender({ flash: [...FLASH], variationIds: ['v2', 'v1'] });
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.fetchFlashAllowance).toHaveBeenCalledTimes(1);
  });

  it('API lỗi (cũ, 404, mất mạng): trả đúng danh sách gốc, không ném', async () => {
    mocks.fetchFlashAllowance.mockRejectedValue(new Error('404'));
    const { result } = setup();
    await waitFor(() => expect(mocks.fetchFlashAllowance).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current).toBe(FLASH);
  });
});
