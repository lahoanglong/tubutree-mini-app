// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { headingProblems, smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// mv-order: thông báo (kiểu điện thoại giống Mini App).

// Chép ý notifications-page.spec.tsx (Mini App): một h1 ở mọi trạng thái, không gọi API khi chưa có phiên, thử lại, dấu chưa đọc,
// chạm tin thì đánh dấu đã đọc và mở chi tiết, nút hành động theo template, "Đọc tất cả".

const mocks = vi.hoisted(() => ({
  auth: { user: { id: 'u1' } as Record<string, unknown> | null, status: 'authenticated' as string, initialized: true, sessionUnavailable: false, retrySession: vi.fn() },
  get: vi.fn(),
  post: vi.fn(),
  push: vi.fn(),
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/cart-key', () => ({ cartStorefrontSlug: () => null }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: mocks.post } }));

import NotificationsPage from './page';

const SENT_AT = new Date(Date.now() - 5 * 60_000).toISOString();
const ORDER_UNREAD = {
  id: 'n1',
  templateCode: 'ORDER_CONFIRMED',
  payload: { body: 'Đơn TT001 đã được xác nhận', data: { order_code: 'TT001' } },
  status: 'SENT',
  sentAt: SENT_AT,
};
const POINTS_READ = { id: 'n2', templateCode: 'POINTS_EARNED', payload: { body: 'Bạn nhận thêm 50 điểm Xanh' }, status: 'READ', sentAt: SENT_AT };
const REMINDER = {
  id: 'n3',
  templateCode: 'REORDER_REMINDER',
  payload: { body: 'Dầu gội sắp hết', data: { product_slug: 'dau-goi', variation_id: 'v1' } },
  status: 'SENT',
  sentAt: SENT_AT,
};
const OPS = { id: 'n4', templateCode: 'OPS_GOMDON_ALERT', payload: { body: 'Gomdon lỗi', data: { order_code: 'KHAC1' } }, status: 'SENT', sentAt: SENT_AT };

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<NotificationsPage />);
  mounted.push(r);
  await flush(6);
  return r;
};
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const rowOf = (c: HTMLElement, text: string) => byText(c, 'button', text) as HTMLElement;
const openRow = async (c: HTMLElement, text: string) => {
  click(rowOf(c, text));
  await flush(4);
  return dialog()!;
};

beforeEach(() => {
  mocks.auth.user = { id: 'u1' };
  mocks.auth.status = 'authenticated';
  mocks.auth.initialized = true;
  mocks.auth.sessionUnavailable = false;
  mocks.get.mockReset().mockResolvedValue([ORDER_UNREAD, POINTS_READ]);
  mocks.post.mockReset().mockResolvedValue({ ok: true, count: 1 });
  mocks.push.mockReset();
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('thông báo như Mini App (điện thoại)', () => {
  it('"Đọc tất cả" chữ xanh không gạch chân trong dải tiêu đề; ô icon nền sage', async () => {
    const { container } = await mount();
    const readAll = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Đọc tất cả'))!;
    expect(readAll.closest('[data-page-bleed]')).not.toBeNull();
    expect(readAll.className).toContain('max-md:no-underline');
    expect(readAll.className).toContain('max-md:text-[color:var(--color-text-brand)]');
    const tile = container.querySelector('li button span')!;
    expect(tile.className).toContain('max-md:bg-[var(--color-bg-subtle)]');
  });
});
