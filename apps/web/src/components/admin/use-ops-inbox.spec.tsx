// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { createQueryClient } from '@/lib/query-client';
import { getOpsInbox, OPS_INBOX_QUERY_KEY } from '@/lib/admin-client';
import '@/test-utils/dom';
import { useOpsInbox } from './use-ops-inbox';

vi.mock('@/lib/admin-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/admin-client')>();
  return { ...actual, getOpsInbox: vi.fn(async () => ({ generatedAt: '2026-11-04T00:00:00.000Z', items: [] })) };
});

function Poller() {
  useOpsInbox({ poll: true });
  return null;
}
function Reader({ label }: { label: string }) {
  const q = useOpsInbox();
  return <span data-reader={label}>{q.data ? 'ok' : '…'}</span>;
}
/** Cách cũ: mỗi nơi tự giữ một refetchInterval riêng. */
function LegacyObserver() {
  useQuery({ queryKey: OPS_INBOX_QUERY_KEY, queryFn: getOpsInbox, refetchInterval: 60_000 });
  return null;
}

describe('useOpsInbox (F12)', () => {
  let host: HTMLDivElement;
  let root: Root;
  const client = () => createQueryClient();
  const mountAt = async (ui: React.ReactElement, c: ReturnType<typeof createQueryClient>, into: Root) => {
    await act(async () => {
      into.render(<QueryClientProvider client={c}>{ui}</QueryClientProvider>);
    });
  };
  const tick = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(getOpsInbox).mockClear();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it('hai nơi đọc hộp việc, một nơi giữ nhịp: 120 giây chỉ gọi mạng đúng theo nhịp của MỘT observer', async () => {
    const c = client();
    await mountAt(
      <>
        <Poller />
        <Reader label="a" />
      </>,
      c,
      root,
    );
    await tick(20_000);
    await mountAt(
      <>
        <Poller />
        <Reader label="a" />
        <Reader label="b" />
      </>,
      c,
      root,
    );
    await tick(100_000);
    // t=0 (tải đầu), t=60s, t=120s
    expect(getOpsInbox).toHaveBeenCalledTimes(3);
  });

  it('chỉ hai nơi đọc, không ai bật poll: không có nhịp tự gọi lại', async () => {
    const c = client();
    await mountAt(
      <>
        <Reader label="a" />
        <Reader label="b" />
      </>,
      c,
      root,
    );
    await tick(120_000);
    expect(getOpsInbox).toHaveBeenCalledTimes(1);
  });

  const pollingObservers = (c: ReturnType<typeof createQueryClient>) =>
    c.getQueryCache().find({ queryKey: OPS_INBOX_QUERY_KEY })!.observers.filter((o) => o.options.refetchInterval).length;

  it('số observer giữ refetchInterval trên khoá hộp việc: 1 với hook, mỗi nơi một cái với cách cũ', async () => {
    const withHook = client();
    await mountAt(
      <>
        <Poller />
        <Reader label="a" />
        <Reader label="b" />
      </>,
      withHook,
      root,
    );
    expect(pollingObservers(withHook)).toBe(1);
    await act(async () => root.unmount());
    root = createRoot(host);
    const legacy = client();
    await mountAt(
      <>
        <LegacyObserver />
        <LegacyObserver />
        <LegacyObserver />
      </>,
      legacy,
      root,
    );
    expect(pollingObservers(legacy)).toBe(3);
  });

  it('enabled=false: không gọi mạng', async () => {
    function Off() {
      useOpsInbox({ enabled: false, poll: true });
      return null;
    }
    await mountAt(<Off />, client(), root);
    await tick(120_000);
    expect(getOpsInbox).not.toHaveBeenCalled();
  });
});
