// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loginHref } from '@/lib/return-to';
import { flush, render, type Rendered } from '@/test-utils/dom';

// Mua chung web ↔ Mini (Wave 84A ↔ 94B): khách chưa đăng nhập chạm "Tham gia" hai lần cùng khung hình chỉ chuyển sang đăng nhập một lần
// (không có khoá thì `router.push` chạy hai lần: hai mục lịch sử). Mini giữ nút bằng Promise của `login()` tới khi đăng nhập xong.

const h = vi.hoisted(() => ({ phase: 'guest' as string, push: vi.fn(), retrySession: vi.fn() }));
vi.mock('@/lib/use-flash-sales', () => ({ useActiveFlashSales: () => [] }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => h.phase }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: null, retrySession: h.retrySession }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock('@/lib/platform-bridge', () => ({ platformBridge: { share: vi.fn() } }));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string) => {
      if (path === '/group-buy') return [GROUP];
      return GROUP;
    },
    post: vi.fn(),
  },
}));

import { GroupBuyView } from './group-buy-view';

const GROUP = {
  id: 'a',
  product: { name: 'Sản phẩm a', slug: 'sp-a', thumbnail: 'https://img.test/a.jpg' },
  targetSize: 5,
  currentSize: 2,
  unitPrice: 80_000,
  basePrice: 100_000,
  discountPct: 20,
  status: 'OPEN',
  expiresAt: new Date(Date.now() + 3 * 3600 * 1000).toISOString(),
  joined: false,
  isOwner: false,
};

let mounted: Rendered | null = null;
const mount = async (invitedId?: string) => {
  mounted = render(<GroupBuyView invitedId={invitedId} />);
  await flush(6);
  return mounted.container;
};
const join = (c: HTMLElement) => Array.from(c.querySelectorAll('button')).find((b) => /^Đăng nhập để tham gia/.test((b.textContent ?? '').trim()))!;
const tapTogether = (el: HTMLElement) =>
  act(async () => {
    el.click();
    el.click();
  });

beforeEach(() => {
  h.phase = 'guest';
  h.push.mockReset();
  h.retrySession.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('/mua-chung — khách chạm Tham gia', () => {
  it('hai cú chạm cùng khung hình chỉ sang đăng nhập một lần, quay lại đúng trang', async () => {
    const c = await mount();
    await tapTogether(join(c));
    expect(h.push).toHaveBeenCalledTimes(1);
    expect(h.push).toHaveBeenCalledWith(loginHref('/mua-chung'));
  });

  it('mở qua liên kết mời: quay lại đúng nhóm được mời, vẫn chỉ một lần', async () => {
    const c = await mount('a');
    await tapTogether(join(c));
    expect(h.push).toHaveBeenCalledTimes(1);
    expect(h.push).toHaveBeenCalledWith(loginHref('/mua-chung/a'));
  });
});
