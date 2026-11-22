import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Lối vào "Tiết kiệm với Refill" (hub Danh mục, Bộ quà tặng) của Mini App: cùng luật web, chỉ khi cờ bật VÀ có thẻ gói bán được.

const mocks = vi.hoisted(() => ({ goSmart: vi.fn(), coreGet: vi.fn(), config: vi.fn() }));
vi.mock('../../lib/smart-nav', () => ({ useSmartNavigate: () => mocks.goSmart }));
vi.mock('../../services/core-http', () => ({ coreHttp: { get: mocks.coreGet } }));
vi.mock('../../services/shop-api', () => ({ getPublicConfig: mocks.config }));

import { RefillLandingEntry } from './refill-landing-entry';

const offer = { productId: 'p-r', slug: 'refill-a', name: 'Túi Refill a 2L', thumbnail: null, variationId: 'v-r', price: 200_000, compareAt: null, sizeLabel: '2L', inStock: true, tubu: true };
const bottle = { productId: 'b-a', slug: 'chai-a', name: 'Chai a 500ml', thumbnail: null, price: 68_000, compareAt: null, sizeLabel: '500ml', inStock: true };
let landing: unknown;

function renderEntry() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RefillLandingEntry style={{ marginTop: 12 }} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.config.mockResolvedValue({ freeshipThreshold: 199_000, refillFirstEnabled: true });
  landing = { enabled: true, pairs: [{ bottle, refill: offer, savingPct: 26 }] };
  mocks.coreGet.mockImplementation(async (path: string) => {
    if (path === '/catalog/refill-pairs/landing') return landing;
    throw new Error(`đường dẫn lạ ${path}`);
  });
});

describe('RefillLandingEntry (Mini App, tubu-w17-01)', () => {
  it('cờ bật, có thẻ bán được: một hàng có tiêu đề + dòng phụ, chạm mở /refill-deals', async () => {
    renderEntry();
    const entry = await screen.findByTestId('refill-landing-entry');
    expect(entry.textContent).toContain('Tiết kiệm với Refill');
    expect(entry.textContent).toContain('Túi, can Refill rẻ hơn mua chai mới');
    expect(entry.style.marginTop).toBe('12px');
    fireEvent.click(screen.getByRole('button'));
    expect(mocks.goSmart).toHaveBeenCalledWith('/refill-deals');
  });

  it('cờ tắt: không vẽ, không gọi trang', async () => {
    mocks.config.mockResolvedValue({ freeshipThreshold: 199_000, refillFirstEnabled: false });
    const { container } = renderEntry();
    await waitFor(() => expect(mocks.config).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(container.innerHTML).toBe('');
    expect(mocks.coreGet).not.toHaveBeenCalled();
  });

  it('cờ bật nhưng mọi gói hết hàng: không vẽ', async () => {
    landing = { enabled: true, pairs: [{ bottle, refill: { ...offer, inStock: false }, savingPct: 26 }] };
    const { container } = renderEntry();
    await waitFor(() => expect(mocks.coreGet).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(container.innerHTML).toBe('');
  });
});
