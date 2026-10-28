// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { headingProblems, smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// Chép phần OnboardingGate của onboarding.spec.tsx (Mini App): quiz chỉ ở Trang chủ cho khách chưa làm, "Để sau" nhớ 7 ngày,
// các bước, gửi đúng danh sách đáp án. Web thêm: Esc cũng là "Để sau", lỗi gửi hiện ngay trong hộp thoại.

const mocks = vi.hoisted(() => ({
  auth: { status: 'authenticated' as string, initialized: true, sessionUnavailable: false },
  pathname: '/',
  storage: {} as Record<string, string>,
  set: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: mocks.post } }));
vi.mock('@/lib/platform-bridge', () => ({
  platformBridge: {
    storage: {
      get: async (k: string) => mocks.storage[k] ?? null,
      set: async (k: string, v: string) => {
        mocks.set(k, v);
        mocks.storage[k] = v;
      },
    },
  },
}));

import { OnboardingGate } from './onboarding-gate';
import { ONBOARDING_SNOOZE_KEY, ONBOARDING_SNOOZE_MS } from './account/onboarding-rules';

let mounted: Rendered | null = null;
const mount = async () => {
  mounted = render(<OnboardingGate enabled />);
  await flush(8);
  return document.body;
};
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const named = (role: string, name: string) =>
  Array.from(document.querySelectorAll<HTMLElement>(`[role="${role}"]`)).find((e) => e.textContent?.includes(name))!;
const btn = (name: string | RegExp) => byText(document.body, 'button', name)!;
const next = () => click(btn(/^(Tiếp tục|Hoàn tất)$/));
const open = (url: string) => window.history.replaceState({}, '', url);

beforeEach(() => {
  mocks.auth.status = 'authenticated';
  mocks.auth.initialized = true;
  mocks.pathname = '/';
  mocks.storage = {};
  mocks.set.mockReset();
  mocks.get.mockReset().mockResolvedValue({ onboarded: false });
  mocks.post.mockReset().mockResolvedValue({});
  open('/');
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('OnboardingGate: khảo sát đang tắt', () => {
  it('mặc định không vẽ gì (không phủ màn chào lúc mở trang)', async () => {
    mounted = render(<OnboardingGate />);
    await flush(8);
    expect(dialog()).toBeNull();
  });
});

describe('OnboardingGate: khi nào hiện', () => {
  it('ở Trang chủ, khách đã đăng nhập chưa làm quiz: hiện lời chào, không hứa quà chào mừng hay gợi ý sản phẩm', async () => {
    const body = await mount();
    expect(body.textContent).toContain('Chào mừng đến Tubu Tree!');
    expect(body.textContent).not.toMatch(/quà chào mừng|gợi ý sản phẩm/);
  });

  it('khách chưa đăng nhập: không hiện, không gọi /me', async () => {
    mocks.auth.status = 'idle';
    await mount();
    expect(dialog()).toBeNull();
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('đã làm quiz rồi: không hiện', async () => {
    mocks.get.mockResolvedValue({ onboarded: true });
    await mount();
    expect(dialog()).toBeNull();
  });

  it('trang khác Trang chủ: không phủ quiz', async () => {
    mocks.pathname = '/san-pham/abc';
    await mount();
    expect(dialog()).toBeNull();
  });

  it.each(['/?ref=CTV01', '/?s=shop-lan', '/?claim=SHOPEE-AB12CD34'])('mở bằng link %s: không phủ quiz', async (url) => {
    open(url);
    await mount();
    expect(dialog()).toBeNull();
  });

  it('đã bấm "Để sau" trong 7 ngày: lần mở sau không hiện', async () => {
    mocks.storage[ONBOARDING_SNOOZE_KEY] = String(Date.now() + 60_000);
    await mount();
    expect(dialog()).toBeNull();
  });

  it('"Để sau" đã hết hạn thì hiện lại', async () => {
    mocks.storage[ONBOARDING_SNOOZE_KEY] = String(Date.now() - 1_000);
    const body = await mount();
    expect(body.textContent).toContain('Chào mừng đến Tubu Tree!');
  });
});

describe('OnboardingGate: "Để sau"', () => {
  it('bấm "Để sau": đóng và nhớ 7 ngày trên máy', async () => {
    const before = Date.now();
    await mount();
    click(btn('Để sau'));
    expect(dialog()).toBeNull();
    await flush();
    const saved = Number(mocks.set.mock.calls[0]![1]);
    expect(mocks.set.mock.calls[0]![0]).toBe(ONBOARDING_SNOOZE_KEY);
    expect(saved).toBeGreaterThanOrEqual(before + ONBOARDING_SNOOZE_MS);
  });

  it('Esc cũng là "Để sau"', async () => {
    await mount();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await flush();
    expect(dialog()).toBeNull();
    expect(mocks.set).toHaveBeenCalledTimes(1);
  });
});

describe('OnboardingGate: các bước quiz', () => {
  it('là hộp thoại có tên, mỗi bước đúng một tiêu đề, không emoji, không lỗi a11y', async () => {
    await mount();
    expect(dialog()?.getAttribute('aria-label')).toBe('Chào mừng đến Tubu Tree');
    expect(dialog()?.getAttribute('aria-modal')).toBe('true');
    expect(document.querySelectorAll('[role="dialog"] h2')).toHaveLength(1);
    click(btn('Bắt đầu'));
    expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe('Bạn quan tâm điều gì nhất?');
    expect(document.querySelectorAll('[role="dialog"] h2')).toHaveLength(1);
    expect(document.querySelectorAll('[role="checkbox"]')).toHaveLength(5);
    expect(document.body.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(unnamedControls(dialog()!)).toEqual([]);
    expect(smallTouchTargets(dialog()!)).toEqual([]);
    expect(headingProblems(dialog()!).filter((p) => !/h1/i.test(p))).toEqual([]);
  });

  it('"Tiếp tục" chỉ bấm được khi đã chọn; câu nhiều đáp án bật/tắt từng ý, câu một đáp án thay ý cũ', async () => {
    await mount();
    click(btn('Bắt đầu'));
    expect((btn('Tiếp tục') as HTMLButtonElement).disabled).toBe(true);
    const eco = named('checkbox', 'Sống xanh, tái chế');
    click(eco);
    expect(eco.getAttribute('aria-checked')).toBe('true');
    expect((btn('Tiếp tục') as HTMLButtonElement).disabled).toBe(false);
    click(eco);
    expect(eco.getAttribute('aria-checked')).toBe('false');
    expect((btn('Tiếp tục') as HTMLButtonElement).disabled).toBe(true);
    click(eco);
    next();
    expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe('Làn da của bạn thế nào?');
    click(named('radio', 'Dầu'));
    click(named('radio', 'Khô'));
    expect(named('radio', 'Dầu').getAttribute('aria-checked')).toBe('false');
    expect(named('radio', 'Khô').getAttribute('aria-checked')).toBe('true');
  });

  it('"Quay lại" về câu trước và giữ đáp án; hoàn tất gửi đúng danh sách đáp án rồi hiện lời cảm ơn', async () => {
    await mount();
    click(btn('Bắt đầu'));
    click(named('checkbox', 'Chăm sóc da'));
    next();
    click(named('radio', 'Nhạy cảm'));
    next();
    click(btn('Quay lại'));
    expect(named('radio', 'Nhạy cảm').getAttribute('aria-checked')).toBe('true');
    next();
    click(named('checkbox', 'Gia đình'));
    click(named('checkbox', 'Em bé'));
    next();
    click(named('radio', 'Giá tốt'));
    expect((btn('Hoàn tất') as HTMLButtonElement).disabled).toBe(false);
    next();
    await flush();
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledWith('/me/onboarding', { segments: ['skincare', 'sensitive_skin', 'family', 'baby', 'price'] });
    expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe('Tuyệt vời!');
    click(btn('Khám phá ngay'));
    expect(dialog()).toBeNull();
  });

  it('gửi lỗi: báo ngay trong hộp thoại, ở lại câu cuối để gửi lại', async () => {
    mocks.post.mockRejectedValueOnce(new Error('Máy chủ bận'));
    await mount();
    click(btn('Bắt đầu'));
    click(named('checkbox', 'Chăm sóc da'));
    next();
    click(named('radio', 'Nhạy cảm'));
    next();
    click(named('checkbox', 'Gia đình'));
    next();
    click(named('radio', 'Giá tốt'));
    next();
    await flush();
    expect(dialog()?.querySelector('[role="alert"]')?.textContent).toContain('Máy chủ bận');
    expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe('Điều gì quan trọng nhất khi chọn sản phẩm?');
    next();
    await flush();
    expect(mocks.post).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe('Tuyệt vời!');
  });
});
