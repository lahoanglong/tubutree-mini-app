// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';

// Không mock khung soạn: chọn sự kiện rồi mở khung phải bắt đầu ở loại Trải nghiệm (bài dự thi), dù khung đã mount từ lúc chưa chọn sự kiện.

const mocks = vi.hoisted(() => ({
  auth: { user: { id: 'u1', role: 'CUSTOMER' } as Record<string, unknown> | null, status: 'authenticated' as string, initialized: true, sessionUnavailable: false, retrySession: vi.fn() },
  get: vi.fn(),
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: vi.fn() } }));

import CommunityEventsPage from './page';

const DAY = 24 * 3600 * 1000;
let mounted: Rendered[] = [];

beforeEach(() => {
  mocks.get.mockReset().mockImplementation(async (path: string) => {
    if (path === '/feed/categories') return [];
    if (path === '/feed/events')
      return [{ id: 'e1', title: 'Sự kiện e1', description: 'Mô tả', coverUrl: null, startAt: new Date(Date.now() - DAY).toISOString(), endAt: new Date(Date.now() + DAY).toISOString(), rewardPoints: 5, status: 'ACTIVE', winnerUserId: null, createdAt: new Date().toISOString() }];
    if (path === '/feed/events/e1/posts') return { posts: [], nextCursor: null };
    throw new Error(`no mock ${path}`);
  });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/cong-dong/su-kien — khung soạn bài dự thi', () => {
  it('mở khung sau khi chọn sự kiện thì loại Trải nghiệm đang được chọn', async () => {
    const r = render(<CommunityEventsPage />);
    mounted.push(r);
    await flush(6);
    click(byText(r.container, 'button', 'Sự kiện e1'));
    await flush(6);
    click(byText(r.container, 'button', 'Đăng bài dự thi'));
    await flush(3);
    const dlg = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const chip = byText(dlg, 'button', 'Trải nghiệm')!;
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(dlg.querySelector('input[aria-label^="Tiêu đề câu hỏi"]')).toBeNull();
  });
});
