// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';

// Đăng ký CTV (chỉ web: Mini chỉ gọi `void invalidateQueries` nên không giữ khoá): khoá giữ tới khi hồ sơ CTV mới về, có hạn 4 giây; làm mới treo thì nút nhả sau hạn thay vì kẹt tới khi
// yêu cầu hết thời gian. Còn khoá ở 3,5 giây thì chạm thêm không gửi đăng ký lần hai.

const h = vi.hoisted(() => ({ hang: new Set<string>(), post: vi.fn() }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'authenticated' }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn(), user: { id: 'u1' } }) }));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: (path: string) => {
      if (h.hang.has(path)) return new Promise(() => undefined);
      if (path === '/affiliate/me') return Promise.resolve({ isAffiliate: false, canRegister: true });
      if (path === '/academy/courses') return Promise.resolve([]);
      return Promise.reject(new Error(`chưa mock ${path}`));
    },
    post: (path: string, body?: unknown) => h.post(path, body),
  },
}));

import CtvPage from './page';

let mounted: Rendered | null = null;
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const isBusy = (b: HTMLElement) => b.getAttribute('aria-busy') === 'true';
const registers = () => h.post.mock.calls.filter((c) => c[0] === '/affiliate/register').length;

beforeEach(() => {
  h.hang = new Set();
  h.post.mockReset().mockResolvedValue({ ok: true });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
});

describe('Đăng ký CTV: hồ sơ mới không về', () => {
  it('còn khoá ở 3,5 giây (nút báo bận, chạm thêm không đăng ký lần hai), nhả sau 4 giây và đăng ký lại được', async () => {
    mounted = render(<CtvPage />);
    await flush(6);
    const c = mounted.container;
    click(c.querySelector('input[type="checkbox"]'));
    const submit = () => byText(c, 'button', /^(Đăng ký miễn phí ngay|Đang đăng ký…)$/) as HTMLButtonElement;
    h.hang.add('/affiliate/me');
    click(submit());
    await flush(4);
    expect(registers()).toBe(1);
    expect(isBusy(submit())).toBe(true);
    await advance(3_500);
    expect(isBusy(submit())).toBe(true);
    click(submit());
    await flush(2);
    expect(registers()).toBe(1);
    await advance(1_000);
    await flush(2);
    expect(isBusy(submit())).toBe(false);
    click(submit());
    await flush(2);
    expect(registers()).toBe(2);
  });
});
