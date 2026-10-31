import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../services/shop-api', async (orig) => ({ ...(await orig<typeof import('../services/shop-api')>()), getPublicConfig: vi.fn(() => new Promise(() => {})) }));

import { useFreeShipThreshold } from './use-free-ship-threshold';

const wrapper = (qc: QueryClient) =>
  function Wrap({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };

describe('useFreeShipThreshold', () => {
  it('chưa có cấu hình thật thì null (không hứa con số mặc định)', () => {
    const { result } = renderHook(() => useFreeShipThreshold(), { wrapper: wrapper(new QueryClient()) });
    expect(result.current).toBeNull();
  });

  it('cấu hình về thì trả ngưỡng của máy chủ', () => {
    const qc = new QueryClient();
    qc.setQueryData(['public-config'], { freeshipThreshold: 249_000 });
    const { result } = renderHook(() => useFreeShipThreshold(), { wrapper: wrapper(qc) });
    expect(result.current).toBe(249_000);
  });
});
