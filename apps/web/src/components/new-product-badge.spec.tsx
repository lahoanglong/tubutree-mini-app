// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';

vi.mock('@/lib/core-http', () => ({ coreHttp: { get: async () => ({}) } }));

import { NewProductBadge } from './new-product-badge';

describe('NewProductBadge với mốc ngày mở bán', () => {
  let mounted: Rendered | null = null;
  afterEach(() => mounted?.unmount());

  const badge = async (launch: string | null, createdAt: string) => {
    const qc = new QueryClient();
    qc.setQueryData(['public-config'], { catalogLaunchDate: launch });
    mounted = render(
      <QueryClientProvider client={qc}>
        <NewProductBadge createdAt={createdAt} />
      </QueryClientProvider>,
    );
    await flush();
    return mounted.container.querySelector('[data-testid="card-new-badge"]');
  };
  const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
  const startVn = new Date(`${today}T00:00:00+07:00`).getTime();

  it('tạo trước mốc: không nhãn', async () => {
    expect(await badge(today, new Date(startVn - 1000).toISOString())).toBeNull();
  });

  it('tạo từ mốc, hoặc mốc rỗng: có nhãn', async () => {
    expect((await badge(today, new Date(startVn).toISOString()))?.textContent).toBe('Mới');
    mounted?.unmount();
    expect((await badge('', new Date(startVn - 1000).toISOString()))?.textContent).toBe('Mới');
  });
});
