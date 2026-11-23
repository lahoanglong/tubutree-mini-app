// @vitest-environment jsdom
import { act, useSyncExternalStore, type ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Pha thật sau hydrate; máy chủ và lượt hydrate đầu luôn là 'guest' như `PrebuiltGuest`. */
const state = vi.hoisted(() => ({ phase: 'guest' as string }));

vi.mock('next/navigation', () => ({
  usePathname: () => '/ctv',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ status: 'idle', initialized: false, sessionUnavailable: false, user: null, retrySession: vi.fn() }),
}));
// Pha 'authenticated': truy vấn hồ sơ CTV/đại lý chạy nhưng không bao giờ trả (màn chờ), không gọi mạng thật.
vi.mock('@/lib/core-http', () => ({ coreHttp: new Proxy({}, { get: () => () => new Promise(() => {}) }) }));
vi.mock('@/lib/auth-phase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth-phase')>()),
  useAuthPhase: () =>
    useSyncExternalStore(
      () => () => {},
      () => state.phase,
      () => 'guest',
    ),
}));

import CtvPage from './ctv/ctv-page';
import DealerPage from './dai-ly/dealer-page';

const PAGES = [
  ['/ctv', CtvPage],
  ['/dai-ly', DealerPage],
] as const;

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  container.remove();
});

/**
 * HTML máy chủ của trang (màn khách dựng sẵn), người dùng Tab tới link lùi `href` TRƯỚC khi hydrate, rồi hydrate với pha thật `phase`.
 * Trả link đã focus và lỗi hydrate (lệch HTML) nếu có.
 */
async function focusThenHydrate(Page: (p: { guestLanding?: ReactElement }) => ReactElement, href: string, phase: string) {
  const ui = (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })}>
      <Page guestLanding={<p>Màn khách dựng sẵn</p>} />
    </QueryClientProvider>
  );
  container.innerHTML = renderToString(ui);
  const link = container.querySelector<HTMLAnchorElement>(`a[data-back-link][href="${href}"]`)!;
  expect(link).not.toBeNull();
  link.focus();
  expect(document.activeElement).toBe(link);

  state.phase = phase;
  const hydrationErrors: unknown[] = [];
  await act(async () => {
    root = hydrateRoot(container, ui, { onRecoverableError: (e) => hydrationErrors.push(e) });
  });
  return { link, hydrationErrors };
}

describe('tubu-w19-03: link lùi /ctv, /dai-ly giữ focus bàn phím qua hydrate', () => {
  it.each(PAGES)('%s: khách vãng lai đã Tab tới "← Trang chủ" trước hydrate, hydrate xong focus vẫn ở đúng link đó', async (_path, Page) => {
    const { link, hydrationErrors } = await focusThenHydrate(Page, '/', 'guest');
    expect(hydrationErrors).toEqual([]);
    expect(link.isConnected).toBe(true);
    expect(document.activeElement).toBe(link);
    const links = Array.from(container.querySelectorAll<HTMLAnchorElement>('a[data-back-link]'));
    expect(links.map((a) => [a.getAttribute('href'), a.textContent])).toEqual([['/', '← Trang chủ']]);
  });

  it.each(PAGES)('%s: người đã đăng nhập (máy còn cờ phiên) Tab tới "← Tài khoản" trước hydrate, pha thật về thì focus vẫn ở đó', async (_path, Page) => {
    for (const phase of ['loading', 'authenticated']) {
      const { link, hydrationErrors } = await focusThenHydrate(Page, '/tai-khoan', phase);
      expect(hydrationErrors).toEqual([]);
      expect(link.isConnected).toBe(true);
      expect(document.activeElement).toBe(link);
      const links = Array.from(container.querySelectorAll<HTMLAnchorElement>('a[data-back-link]'));
      expect(links.map((a) => [a.getAttribute('href'), a.textContent])).toEqual([['/tai-khoan', '← Tài khoản']]);
      act(() => root!.unmount());
      root = null;
    }
  });
});
