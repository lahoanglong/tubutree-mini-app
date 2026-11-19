// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { flush, render } from '@/test-utils/dom';
import { QuerySeed } from './query-seed';

function Reader({ fetcher }: { fetcher: () => Promise<string> }) {
  const q = useQuery({ queryKey: ['seed-k'], queryFn: fetcher, staleTime: 60_000 });
  return <span>{q.data ?? 'pending'}</span>;
}

describe('QuerySeed', () => {
  it('HTML máy chủ đã có dữ liệu nạp sẵn, không gọi mạng', () => {
    const fetcher = vi.fn(async () => 'mang');
    const html = renderToString(
      <QueryClientProvider client={new QueryClient()}>
        <QuerySeed entries={[{ queryKey: ['seed-k'], data: 'may-chu', fetchedAt: Date.now() }]}>
          <Reader fetcher={fetcher} />
        </QuerySeed>
      </QueryClientProvider>,
    );
    expect(html).toContain('may-chu');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('dữ liệu ISR đã quá staleTime thì vẫn vẽ ngay rồi tự tải lại', async () => {
    const fetcher = vi.fn(async () => 'moi');
    const r = render(
      <QueryClientProvider client={new QueryClient()}>
        <QuerySeed entries={[{ queryKey: ['seed-k'], data: 'cu', fetchedAt: Date.now() - 120_000 }]}>
          <Reader fetcher={fetcher} />
        </QuerySeed>
      </QueryClientProvider>,
    );
    try {
      await flush();
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(r.container.textContent).toBe('moi');
    } finally {
      r.unmount();
    }
  });

  it('khoá đã có dữ liệu mới hơn trong bộ nhớ đệm (điều hướng trong app) thì không bị ghi đè', async () => {
    const qc = new QueryClient();
    qc.setQueryData(['seed-k'], 'trong-cache');
    const r = render(
      <QueryClientProvider client={qc}>
        <QuerySeed entries={[{ queryKey: ['seed-k'], data: 'may-chu', fetchedAt: Date.now() }]}>
          <Reader fetcher={async () => 'mang'} />
        </QuerySeed>
      </QueryClientProvider>,
    );
    try {
      await flush();
      expect(r.container.textContent).toBe('trong-cache');
    } finally {
      r.unmount();
    }
  });
});

describe('QuerySeed: khoá đã được khối khác tạo (đang chờ, chưa có dữ liệu)', () => {
  it('chân trang vẽ trước đã tạo khoá rỗng: vẫn nạp trong lượt vẽ, HTML máy chủ có dữ liệu', () => {
    const qc = new QueryClient();
    const html = renderToString(
      <QueryClientProvider client={qc}>
        <Reader fetcher={async () => 'mang'} />
        <QuerySeed entries={[{ queryKey: ['seed-k'], data: 'may-chu', fetchedAt: Date.now() }]}>
          <Reader fetcher={async () => 'mang'} />
        </QuerySeed>
      </QueryClientProvider>,
    );
    expect(html).toContain('pending');
    expect(html).toContain('may-chu');
  });
});
