// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { ApiError } from '@/lib/client-api';

// Chuông báo hàng về trên thẻ hết hàng ở Yêu thích (cùng luật với apps/miniapp/src/pages/wishlist-restock.spec.tsx): một lần GET cho cả trang,
// nhãn "Đang chờ hàng về" + chip "Chờ hàng về" theo đúng danh sách đăng ký, một chạm huỷ/đăng ký lại, lỗi thì gỡ đúng thay đổi vừa vẽ.

type Alert = { variationId: string; productId: string; productSlug: string; productName: string; variationName: string; stock: number; createdAt: string };

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), del: vi.fn() }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'authenticated' }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn() }) }));
vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ push: () => undefined }) }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: mocks.post, delete: mocks.del } }));
vi.mock('@/lib/use-flash-sales', () => ({ useActiveFlashSales: () => [] }));

import WishlistPage from './page';

const item = (id: string, name: string, inStock: boolean, repVariationId: string) => ({
  id, slug: `sp-${id}`, brand: 'Tubu', name, thumbnail: null, basePrice: 100000, salePrice: null, isFeatured: false, inStock, repVariationId,
});
const alert = (productId: string, variationId: string): Alert => ({
  variationId, productId, productSlug: `sp-${productId}`, productName: productId, variationName: 'Loại', stock: 0, createdAt: '2026-11-24T01:00:00.000Z',
});

let server: { enabled: boolean; items: Alert[] };
let wishlist: ReturnType<typeof item>[];
let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<WishlistPage />);
  mounted.push(r);
  await flush(5);
  return r.container;
};
const row = (c: HTMLElement) => c.querySelector<HTMLElement>('[role="region"][aria-label="Lọc sản phẩm yêu thích"]');
const chip = (c: HTMLElement, label: string) =>
  Array.from(row(c)?.querySelectorAll<HTMLButtonElement>('button[aria-pressed]') ?? []).find((b) => (b.textContent ?? '').startsWith(label));
const bell = (c: HTMLElement, name: string) => c.querySelector<HTMLButtonElement>(`button[aria-label="Báo khi ${name} có hàng"]`);
const shown = (c: HTMLElement) => Array.from(c.querySelectorAll('a[href^="/san-pham/"]')).map((a) => a.getAttribute('href')!.split('?')[0]);
const waitingBadges = (c: HTMLElement) => c.textContent!.split('Đang chờ hàng về').length - 1;
const restockGets = () => mocks.get.mock.calls.filter(([p]) => p === '/me/restock-alerts').length;

beforeEach(() => {
  server = { enabled: true, items: [alert('c', 'vC')] };
  wishlist = [item('a', 'Nước rửa chén', true, 'vA'), item('c', 'Dầu gội', false, 'vC'), item('d', 'Nước giặt', false, 'vD')];
  mocks.get.mockReset().mockImplementation(async (path: string) => {
    if (path === '/me/wishlist') return structuredClone(wishlist);
    if (path === '/me/restock-alerts') return structuredClone(server);
    return [];
  });
  mocks.post.mockReset().mockImplementation(async (path: string, body: { variationId?: string }) => {
    if (path !== '/me/restock-alerts') return { items: [] };
    server.items.push(alert(body.variationId === 'vD' ? 'd' : 'c', body.variationId!));
    return { variationId: body.variationId, subscribed: true };
  });
  mocks.del.mockReset().mockImplementation(async (path: string) => {
    const id = decodeURIComponent(path.split('/').pop()!);
    server.items = server.items.filter((a) => a.variationId !== id);
    return { variationId: id, subscribed: false };
  });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/tai-khoan/yeu-thich — báo hàng về trên thẻ hết hàng (w24-03)', () => {
  it('một lần GET /me/restock-alerts cho cả trang; thẻ đang chờ có nhãn, chuông bật; thẻ còn hàng không có chuông; chip đếm 1', async () => {
    const c = await mount();
    expect(restockGets()).toBe(1);
    expect(waitingBadges(c)).toBe(1);
    expect(bell(c, 'Dầu gội')!.getAttribute('aria-pressed')).toBe('true');
    expect(bell(c, 'Nước giặt')!.getAttribute('aria-pressed')).toBe('false');
    expect(bell(c, 'Nước rửa chén')).toBeNull();
    expect(chip(c, 'Chờ hàng về')!.textContent).toBe('Chờ hàng về(1)');
  });

  it('chuông có vùng chạm 44px (h-11 w-11)', async () => {
    const c = await mount();
    for (const n of ['Dầu gội', 'Nước giặt']) {
      expect(bell(c, n)!.className).toContain('h-11');
      expect(bell(c, n)!.className).toContain('w-11');
    }
  });

  it('vòng huỷ → đăng ký: DELETE tắt nhãn và chip, POST phân loại đại diện bật lại; mỗi lần có lời báo', async () => {
    const c = await mount();
    click(bell(c, 'Dầu gội'));
    await flush(5);
    expect(mocks.del).toHaveBeenCalledWith('/me/restock-alerts/vC');
    expect(bell(c, 'Dầu gội')!.getAttribute('aria-pressed')).toBe('false');
    expect(waitingBadges(c)).toBe(0);
    expect(chip(c, 'Chờ hàng về')).toBeUndefined();
    expect(c.textContent).toContain('Đã huỷ báo hàng về.');

    click(bell(c, 'Dầu gội'));
    await flush(5);
    expect(mocks.post).toHaveBeenCalledWith('/me/restock-alerts', { variationId: 'vC' });
    expect(bell(c, 'Dầu gội')!.getAttribute('aria-pressed')).toBe('true');
    expect(waitingBadges(c)).toBe(1);
    expect(chip(c, 'Chờ hàng về')!.textContent).toBe('Chờ hàng về(1)');
    expect(c.textContent).toContain('Có hàng Tubu sẽ báo bạn ở mục Thông báo.');
  });

  it('chip "Chờ hàng về" lọc đúng thẻ mang nhãn; huỷ món cuối thì chip mất và trang về Tất cả', async () => {
    const c = await mount();
    click(chip(c, 'Chờ hàng về')!);
    expect(shown(c)).toEqual(['/san-pham/sp-c']);
    click(bell(c, 'Dầu gội'));
    await flush(5);
    expect(chip(c, 'Chờ hàng về')).toBeUndefined();
    expect(chip(c, 'Tất cả')!.getAttribute('aria-pressed')).toBe('true');
    expect(shown(c)).toEqual(['/san-pham/sp-a', '/san-pham/sp-c', '/san-pham/sp-d']);
  });

  it('chạm đúp cùng một chuông chỉ gửi một lệnh; đang bay thì chuông aria-busy', async () => {
    let release!: () => void;
    mocks.post.mockImplementationOnce(() => new Promise((r) => (release = () => r({ variationId: 'vD', subscribed: true }))));
    const c = await mount();
    click(bell(c, 'Nước giặt'));
    click(bell(c, 'Nước giặt'));
    await flush(2);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(bell(c, 'Nước giặt')!.getAttribute('aria-busy')).toBe('true');
    await act(async () => release());
    await flush(5);
    expect(bell(c, 'Nước giặt')!.getAttribute('aria-busy')).toBeNull();
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it('máy chủ từ chối đăng ký (409): gỡ trạng thái vẽ trước, báo lỗi, tải lại danh sách yêu thích', async () => {
    const msg = 'Sản phẩm đang có hàng, bạn đặt mua được ngay.';
    mocks.post.mockRejectedValueOnce(new ApiError(msg, 409));
    const c = await mount();
    const before = mocks.get.mock.calls.filter(([p]) => p === '/me/wishlist').length;
    click(bell(c, 'Nước giặt'));
    await flush(6);
    expect(c.textContent).toContain(msg);
    expect(bell(c, 'Nước giặt')!.getAttribute('aria-pressed')).toBe('false');
    expect(waitingBadges(c)).toBe(1);
    expect(mocks.get.mock.calls.filter(([p]) => p === '/me/wishlist').length).toBeGreaterThan(before);
  });

  // Lệnh xong trước không được tải lại danh sách khi lệnh kia chưa có trả lời: bản tải về chưa có thay đổi của thẻ kia và vẽ đè nó về trạng thái cũ.
  it.each([
    ['huỷ (Dầu gội) trả lời trước', 'del'],
    ['đăng ký (Nước giặt) trả lời trước', 'post'],
  ] as const)('chạm hai chuông sát nhau, %s: thẻ kia không nhấp nháy; tải lại một lần sau lệnh cuối', async (_label, first) => {
    const pending: Record<'del' | 'post', () => void> = { del: () => undefined, post: () => undefined };
    mocks.del.mockImplementationOnce(
      () =>
        new Promise((r) => {
          pending.del = () => {
            server.items = server.items.filter((a) => a.variationId !== 'vC');
            r({ variationId: 'vC', subscribed: false });
          };
        }),
    );
    mocks.post.mockImplementationOnce(
      () =>
        new Promise((r) => {
          pending.post = () => {
            server.items.push(alert('d', 'vD'));
            r({ variationId: 'vD', subscribed: true });
          };
        }),
    );
    const c = await mount();
    click(bell(c, 'Dầu gội'));
    click(bell(c, 'Nước giặt'));
    await flush(3);
    expect(bell(c, 'Dầu gội')!.getAttribute('aria-pressed')).toBe('false');
    expect(bell(c, 'Nước giặt')!.getAttribute('aria-pressed')).toBe('true');
    const getsBefore = restockGets();

    await act(async () => pending[first]());
    await flush(5);
    expect(bell(c, 'Dầu gội')!.getAttribute('aria-pressed')).toBe('false');
    expect(bell(c, 'Nước giặt')!.getAttribute('aria-pressed')).toBe('true');
    expect(restockGets()).toBe(getsBefore);

    await act(async () => pending[first === 'del' ? 'post' : 'del']());
    await flush(5);
    expect(restockGets()).toBe(getsBefore + 1);
    expect(bell(c, 'Dầu gội')!.getAttribute('aria-pressed')).toBe('false');
    expect(bell(c, 'Nước giặt')!.getAttribute('aria-pressed')).toBe('true');
    expect(waitingBadges(c)).toBe(1);
  });

  describe('focus bàn phím khi huỷ trong chip "Chờ hàng về"', () => {
    it('huỷ món không phải cuối: thẻ rời lưới, focus sang chuông của thẻ kế', async () => {
      server.items = [alert('c', 'vC'), alert('d', 'vD')];
      const c = await mount();
      click(chip(c, 'Chờ hàng về')!);
      expect(shown(c)).toEqual(['/san-pham/sp-c', '/san-pham/sp-d']);
      bell(c, 'Dầu gội')!.focus();
      click(bell(c, 'Dầu gội'));
      await flush(5);
      expect(shown(c)).toEqual(['/san-pham/sp-d']);
      expect(document.activeElement).toBe(bell(c, 'Nước giặt'));
    });

    it('huỷ món cuối của danh sách lọc: focus sang chuông của thẻ trước', async () => {
      server.items = [alert('c', 'vC'), alert('d', 'vD')];
      const c = await mount();
      click(chip(c, 'Chờ hàng về')!);
      bell(c, 'Nước giặt')!.focus();
      click(bell(c, 'Nước giặt'));
      await flush(5);
      expect(shown(c)).toEqual(['/san-pham/sp-c']);
      expect(document.activeElement).toBe(bell(c, 'Dầu gội'));
    });

    it('huỷ món chờ cuối cùng: chip mất, bộ lọc về Tất cả và focus nằm ở chip Tất cả của thanh lọc', async () => {
      const c = await mount();
      click(chip(c, 'Chờ hàng về')!);
      bell(c, 'Dầu gội')!.focus();
      click(bell(c, 'Dầu gội'));
      await flush(5);
      expect(chip(c, 'Chờ hàng về')).toBeUndefined();
      expect(document.activeElement).toBe(chip(c, 'Tất cả'));
      expect(chip(c, 'Tất cả')!.getAttribute('aria-pressed')).toBe('true');
    });

    it('chuông không giữ focus lúc bấm (bấm chuột ở Safari): không kéo focus khỏi chỗ người dùng đang đứng', async () => {
      server.items = [alert('c', 'vC'), alert('d', 'vD')];
      const c = await mount();
      click(chip(c, 'Chờ hàng về')!);
      const all = chip(c, 'Tất cả')!;
      all.focus();
      click(bell(c, 'Dầu gội'));
      await flush(5);
      expect(shown(c)).toEqual(['/san-pham/sp-d']);
      expect(document.activeElement).toBe(all);
    });
  });

  it('cờ tắt: không chuông, không nhãn, không chip; danh sách không có món hết hàng thì không gọi API báo hàng về', async () => {
    server = { enabled: false, items: [] };
    const c = await mount();
    expect(restockGets()).toBe(1);
    expect(c.querySelector('button[aria-label^="Báo khi"]')).toBeNull();
    expect(waitingBadges(c)).toBe(0);
    expect(chip(c, 'Chờ hàng về')).toBeUndefined();
    mounted.forEach((m) => m.unmount());
    mounted = [];

    mocks.get.mockClear();
    wishlist = [item('a', 'Nước rửa chén', true, 'vA')];
    await mount();
    expect(restockGets()).toBe(0);
  });
});
