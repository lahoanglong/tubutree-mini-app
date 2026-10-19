/** renderHook tối giản cho spec (không thêm dependency testing-library): chạy hook trong QueryClientProvider, `result.current` luôn là giá trị mới nhất. CHỈ dùng trong *.spec.tsx. */
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export function newTestClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

export function renderHook<T, P = undefined>(hook: (props: P) => T, opts: { client?: QueryClient; initialProps?: P } = {}) {
  const client = opts.client ?? newTestClient();
  const result = { current: undefined as T };
  const container = document.createElement('div');
  const root = createRoot(container);
  function Probe({ props }: { props: P }) {
    result.current = hook(props);
    return null;
  }
  const mount = (props: P): ReactNode => (
    <QueryClientProvider client={client}>
      <Probe props={props} />
    </QueryClientProvider>
  );
  act(() => root.render(mount(opts.initialProps as P)));
  return {
    result,
    client,
    rerender: (props: P) => act(() => root.render(mount(props))),
    unmount: () => act(() => root.unmount()),
  };
}

export async function waitFor(assertion: () => void, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  for (;;) {
    try {
      assertion();
      return;
    } catch (err) {
      if (Date.now() - start > timeoutMs) throw err;
      await act(async () => {
        await new Promise((r) => setTimeout(r, 5));
      });
    }
  }
}
