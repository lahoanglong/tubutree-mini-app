import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hasPartnerLinkParams, ONBOARDING_SNOOZE_KEY, ONBOARDING_SNOOZE_MS, shouldShowOnboarding } from './onboarding-rules';

const mocks = vi.hoisted(() => ({
  location: { pathname: '/', search: '' },
  storage: {} as Record<string, string>,
  setStorage: vi.fn(),
  getMe: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('zmp-ui')>()),
  useLocation: () => mocks.location,
  useSnackbar: () => ({ openSnackbar: vi.fn(), closeSnackbar: vi.fn() }),
}));
vi.mock('zmp-sdk/apis', () => ({
  getStorage: async () => mocks.storage,
  setStorage: async (arg: { data: Record<string, string> }) => {
    mocks.setStorage(arg);
    return {};
  },
}));
vi.mock('../services/account-api', () => ({ getMe: mocks.getMe, completeOnboarding: vi.fn() }));
vi.mock('../store/auth', () => ({ useAuthStore: () => ({ status: 'authenticated' }) }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import { OnboardingGate } from './onboarding';

const base = { onboarded: false, pathname: '/', search: '', openedFromPartnerLink: false, snoozedUntil: null, now: 1_000 };

describe('Luật hiện quiz onboarding (C-018)', () => {
  it('chỉ hiện ở Trang chủ cho khách chưa làm quiz', () => {
    expect(shouldShowOnboarding(base)).toBe(true);
    expect(shouldShowOnboarding({ ...base, onboarded: true })).toBe(false);
  });

  it.each(['/product/nuoc-rua-chen', '/checkout', '/s/shop-lan', '/brand/tubu', '/cart'])('không phủ route %s', (pathname) => {
    expect(shouldShowOnboarding({ ...base, pathname })).toBe(false);
  });

  it('không hiện khi vào từ link CTV/gian hàng (?ref=, ?s=), kể cả lúc mở app', () => {
    expect(shouldShowOnboarding({ ...base, search: '?ref=CTV01' })).toBe(false);
    expect(shouldShowOnboarding({ ...base, search: '?s=shop-lan' })).toBe(false);
    expect(shouldShowOnboarding({ ...base, openedFromPartnerLink: true })).toBe(false);
    expect(hasPartnerLinkParams('', '#/product/a?ref=X')).toBe(true);
    expect(hasPartnerLinkParams('?utm=1', '#/')).toBe(false);
  });

  it('"Để sau" còn hạn thì không hiện, hết hạn thì hiện lại', () => {
    expect(shouldShowOnboarding({ ...base, snoozedUntil: 2_000 })).toBe(false);
    expect(shouldShowOnboarding({ ...base, snoozedUntil: 500 })).toBe(true);
  });
});

function renderGate() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><OnboardingGate /></QueryClientProvider>);
}

describe('OnboardingGate (C-018)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.location = { pathname: '/', search: '' };
    mocks.storage = {};
    mocks.getMe.mockResolvedValue({ onboarded: false });
  });

  it('ở Trang chủ: hiện quiz, không hứa quà chào mừng hay gợi ý sản phẩm', async () => {
    renderGate();
    expect(await screen.findByText('Chào mừng đến Tubu Tree!')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/quà chào mừng|gợi ý sản phẩm/);
  });

  it('mở link sản phẩm: không phủ quiz', async () => {
    mocks.location = { pathname: '/product/abc', search: '' };
    renderGate();
    await waitFor(() => expect(mocks.getMe).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Chào mừng đến Tubu Tree!')).toBeNull();
  });

  it('bấm "Để sau" (nút thật) → nhớ 7 ngày trên máy', async () => {
    const before = Date.now();
    renderGate();
    fireEvent.click(await screen.findByRole('button', { name: 'Để sau' }));
    expect(screen.queryByText('Chào mừng đến Tubu Tree!')).toBeNull();
    await waitFor(() => expect(mocks.setStorage).toHaveBeenCalled());
    const saved = Number(mocks.setStorage.mock.calls[0]?.[0].data[ONBOARDING_SNOOZE_KEY]);
    expect(saved).toBeGreaterThanOrEqual(before + ONBOARDING_SNOOZE_MS);
  });

  it('đã bấm "Để sau" trong 7 ngày → lần mở sau không hiện', async () => {
    mocks.storage = { [ONBOARDING_SNOOZE_KEY]: String(Date.now() + 60_000) };
    renderGate();
    await waitFor(() => expect(mocks.getMe).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Chào mừng đến Tubu Tree!')).toBeNull();
  });
});
