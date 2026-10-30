import { render, screen, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentType, ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Tài khoản bị khoá: login() gặp 401 ACCOUNT_BLOCKED, store về 'idle' kèm lời máy chủ ở `error`. Mọi màn mời đăng nhập
 * phải nói lời đó, không được lặp lời mời chung khiến khách bấm đăng nhập mãi mà không biết vì sao không vào được.
 */

vi.mock('zmp-sdk/apis', () => ({ setStorage: vi.fn(), getStorage: vi.fn().mockResolvedValue({}), removeStorage: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => vi.fn(),
  useParams: () => ({ id: 'p1' }),
  useLocation: () => ({ pathname: '/', search: '', state: null, key: 'k' }),
  useSnackbar: () => ({ openSnackbar: vi.fn(), closeSnackbar: vi.fn() }),
}));
vi.mock('../services/shop-api');
vi.mock('../services/account-api');
vi.mock('../services/wishlist-api');
vi.mock('../services/waste-api');
vi.mock('../services/affiliate-api');
vi.mock('../services/feed-api');
vi.mock('../services/game-api');
vi.mock('../services/cashback-api');
vi.mock('../services/brand-owner-api');
vi.mock('../services/dealer-api');
vi.mock('../services/subscriptions-api');
vi.mock('../services/payment-api');
vi.mock('../services/analytics');
vi.mock('../services/core-http', () => ({ coreHttp: { get: vi.fn().mockRejectedValue(new Error('offline')), post: vi.fn() } }));
vi.mock('../services/zmp-bridge', () => ({
  hasOA: false,
  callPhone: vi.fn(),
  openOAChat: vi.fn(),
  openExternal: vi.fn(),
  getLaunchReferral: vi.fn(),
  getZaloAccessToken: vi.fn(),
  requestZaloPhoneToken: vi.fn(),
  shouldShowFollowOaPrompt: () => false,
  getOaPromptState: vi.fn().mockResolvedValue({ promptSeen: true }),
}));

import { useAuthStore } from '../store/auth';

const BLOCKED = 'Tài khoản đã bị khoá. Liên hệ Tubu Tree để được hỗ trợ.';

const PAGES: { name: string; load: () => Promise<{ default: ComponentType }>; generic: RegExp }[] = [
  { name: 'Cá nhân', load: () => import('./profile'), generic: /Đăng nhập để xem tích điểm/ },
  { name: 'Ưu đãi', load: () => import('./offers'), generic: /Đăng nhập/ },
  { name: 'Điểm Xanh', load: () => import('./loyalty'), generic: /Đăng nhập/ },
  { name: 'Đổi quà', load: () => import('./rewards'), generic: /Đăng nhập/ },
  { name: 'Cộng đồng', load: () => import('./feed'), generic: /Đăng nhập để xem cộng đồng/ },
  { name: 'Sự kiện cộng đồng', load: () => import('./community-events'), generic: /Đăng nhập để xem cộng đồng/ },
  { name: 'Bài viết', load: () => import('./post-detail'), generic: /Đăng nhập để xem cộng đồng/ },
];

// Nạp module trang ngoài thân test: import động cả trang mất vài giây khi máy bận, tính vào hạn 5 giây của ca đầu thì ca đó hết giờ.
const loaded = new Map<string, ComponentType>();
beforeAll(async () => {
  for (const p of PAGES) loaded.set(p.name, (await p.load()).default);
}, 120_000);

function renderPage(Page: ComponentType) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <Page />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function setGuest(error?: string) {
  act(() => useAuthStore.setState({ status: 'idle', user: null, error, restore: vi.fn(), login: vi.fn() }));
}

afterEach(() => setGuest(undefined));

describe.each(PAGES)('$name — khách đã đăng xuất hoặc bị khoá', ({ name, generic }) => {
  it('tài khoản bị khoá: hiện lời máy chủ, vẫn còn nút đăng nhập', async () => {
    setGuest(BLOCKED);
    renderPage(loaded.get(name)!);
    expect(await screen.findByText(BLOCKED)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Đăng nhập|Tiếp tục với Zalo/ }).length).toBeGreaterThan(0);
  });

  it('khách thường: vẫn là lời mời đăng nhập của màn, không có lời khoá', async () => {
    setGuest(undefined);
    const { container } = renderPage(loaded.get(name)!);
    expect(await screen.findAllByText(generic)).not.toHaveLength(0);
    expect(container.textContent).not.toContain('bị khoá');
  });
});
