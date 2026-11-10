// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';
import { ApiError, NetworkError } from '@/lib/client-api';

// Mua ngay và Nhắc tôi bị máy chủ từ chối bằng 400/404/409 (món hết hàng, khung vừa mở bán, món đã gỡ) nghĩa là khung giờ và danh sách món đang hiện đã cũ:
// lời lỗi hiện ngay, tải lại khung giờ và món rồi mới nhả khoá (tối đa 4 giây). Mất mạng, 401, 403, 5xx không nói gì về trạng thái thật nên không tải lại.
// Mini App chưa tải lại ở hai chỗ này (flash-sale.tsx chỉ báo lỗi): web chặt hơn có chủ ý, vì danh sách cũ thì chạm lại nhận đúng lời từ chối đó.
const state = vi.hoisted(() => ({
  phase: 'authenticated' as string,
  push: vi.fn(),
  reminded: false,
  slots: undefined as unknown,
  items: {} as Record<string, unknown>,
  calls: [] as string[],
  posts: [] as string[],
  addToCart: vi.fn(),
  failRemind: null as unknown,
  gates: new Map<string, Promise<void>>(),
}));

const heldBy = async (path: string) => {
  const hit = [...state.gates].find(([k]) => path.startsWith(k));
  if (hit) await hit[1];
};

vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => state.phase, useAuthRestoring: () => false }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: state.push }),
  usePathname: () => '/gio-vang',
  useSearchParams: () => new URLSearchParams(''),
}));
vi.mock('@/lib/core-http', () => {
  const stamp = (body: unknown) => ({ ...(body as object), serverNow: new Date().toISOString() });
  return {
    coreHttp: {
      get: async (path: string) => {
        state.calls.push(path);
        await heldBy(path);
        if (path === '/categories') return [];
        if (path === '/flash-sales/upcoming') return [{ itemId: 'c', variationId: 'v-c', productSlug: 'sp-c', productName: 'Sản phẩm c', thumbnail: null, flashPrice: 1, retailPrice: 2, startAt: S20.startAt, reminded: state.reminded }];
        if (path === '/flash-sales/slots') return stamp(state.slots);
        const id = /\/flash-sales\/slots\/([^/]+)\/items/.exec(path)?.[1];
        const body = id ? state.items[id] : undefined;
        if (body === undefined) throw new Error(`đường dẫn lạ ${path}`);
        return stamp(body);
      },
      post: async (path: string) => {
        state.posts.push(path);
        await heldBy(path);
        if (state.failRemind) throw state.failRemind;
        state.reminded = true;
        return {};
      },
      delete: async () => ({}),
    },
  };
});
vi.mock('@/lib/shop-client', async (orig) => ({ ...(await orig<Record<string, unknown>>()), addToCart: (...a: unknown[]) => state.addToCart(...a) }));
vi.mock('@/components/mini/countdown', () => ({ Countdown: () => <span>đồng hồ</span> }));

import FlashSlotsView from './flash-slots-view';

const NOW = new Date('2026-11-01T06:00:00Z');
const iso = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();
const slot = (id: string, startH: number, endH: number, status: 'LIVE' | 'UPCOMING' | 'ENDED') => ({ id, title: id, startAt: iso(startH), endAt: iso(endH), status, itemCount: 2 });
const S12 = slot('s12', -1, 1, 'LIVE');
const S20 = slot('s20', 7, 9, 'UPCOMING');
const item = (id: string) => ({
  itemId: id,
  variationId: `v-${id}`,
  variationName: null,
  productId: `p-${id}`,
  productSlug: `sp-${id}`,
  productName: `Sản phẩm ${id}`,
  thumbnail: null,
  categoryIds: ['food'],
  flashPrice: 50_000,
  retailPrice: 100_000,
  salePrice: null,
  soldCount: 2,
  quota: 10,
  soldOut: false,
  perUserLimit: 5,
});
const itemsOf = (s: typeof S12, list: unknown[]) => ({ slot: s, items: list });

const STALE = [
  [400, 'Sản phẩm đã hết hàng.'],
  [404, 'Không tìm thấy sản phẩm này.'],
  [409, 'Suất Giờ vàng vừa thay đổi, hãy tải lại rồi thử lại.'],
] as const;
const TRANSIENT: Array<[string, unknown]> = [
  ['401', new ApiError('Phiên hết hạn', 401)],
  ['403', new ApiError('Không có quyền', 403)],
  ['500', new ApiError('Internal server error', 500)],
  ['502', new ApiError('Bad gateway', 502)],
  ['503', new ApiError('Service unavailable', 503)],
  ['mất mạng', new NetworkError(false)],
];
const CART = { items: [{ id: 'line-x', variationId: 'v-a', quantity: 1 }] };

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<FlashSlotsView />);
  mounted.push(r);
  await flush(8);
  return r.container;
};
const all = <T extends Element>(c: ParentNode, sel: string) => Array.from(c.querySelectorAll<T>(sel));
const named = (c: HTMLElement, name: string | RegExp) =>
  all<HTMLButtonElement>(c, 'button').find((b) => {
    const n = b.getAttribute('aria-label') ?? b.textContent ?? '';
    return typeof name === 'string' ? n === name : name.test(n);
  }) ?? null;
const alertText = (c: HTMLElement) => c.querySelector('[role="alert"]')?.textContent ?? null;
const callsTo = (re: RegExp) => state.calls.filter((p) => re.test(p)).length;
const SLOTS = /^\/flash-sales\/slots$/;
const hold = (path: string) => {
  let open!: () => void;
  state.gates.set(path, new Promise<void>((r) => (open = r)));
  return () => {
    state.gates.delete(path);
    open();
  };
};
const tapTogether = async (...els: Array<HTMLElement | null>) => {
  await act(async () => {
    for (const e of els) e!.click();
  });
};
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const openEvening = async () => {
  const c = await mount();
  act(() => all<HTMLButtonElement>(c, '[role="tab"]')[1]!.click());
  await flush(4);
  return c;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  state.phase = 'authenticated';
  state.push.mockReset();
  state.reminded = false;
  state.slots = { slots: [S12, S20] };
  state.items = { s12: itemsOf(S12, [item('a'), item('b')]), s20: itemsOf(S20, [item('c')]) };
  state.calls = [];
  state.posts = [];
  state.failRemind = null;
  state.gates.clear();
  state.addToCart.mockReset();
  sessionStorage.clear();
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.useRealTimers();
});

describe('Giờ vàng: Mua ngay bị máy chủ từ chối', () => {
  it.each(STALE)('HTTP %i: lời lỗi hiện ngay, tải lại khung giờ và món, nút giữ bận (chạm lại không gọi giỏ) tới khi dữ liệu mới về', async (status, message) => {
    state.addToCart.mockRejectedValue(new ApiError(message, status));
    const c = await mount();
    const a = named(c, 'Mua ngay Sản phẩm a')!;
    const release = hold('/flash-sales/slots');
    state.items = { ...state.items, s12: itemsOf(S12, [item('b')]) };
    const slotsBefore = callsTo(SLOTS);
    const itemsBefore = callsTo(/s12\/items/);
    await tapTogether(a);
    await flush(6);
    expect(state.addToCart).toHaveBeenCalledTimes(1);
    expect(alertText(c)).toContain(message);
    expect(a.getAttribute('aria-busy')).toBe('true');
    expect(callsTo(SLOTS) - slotsBefore).toBe(1);
    expect(callsTo(/s12\/items/) - itemsBefore).toBe(1);
    await tapTogether(a, a);
    await flush(2);
    expect(state.addToCart).toHaveBeenCalledTimes(1);
    release();
    await flush(8);
    expect(named(c, 'Mua ngay Sản phẩm a')).toBeNull();
    expect(alertText(c)).toContain(message);
    const b = named(c, 'Mua ngay Sản phẩm b')!;
    expect(b.getAttribute('aria-busy')).toBeNull();
    expect(b.getAttribute('aria-disabled')).toBeNull();
    state.addToCart.mockResolvedValue({ items: [{ id: 'line-y', variationId: 'v-b', quantity: 1 }] });
    await tapTogether(b);
    await flush(6);
    expect(state.addToCart).toHaveBeenCalledTimes(2);
    expect(state.push).toHaveBeenCalledWith('/thanh-toan');
  });

  it.each(TRANSIENT)('lỗi tạm (%s): báo lỗi, không tải lại khung giờ và món, nhả khoá ngay', async (_name, error) => {
    state.addToCart.mockRejectedValueOnce(error).mockResolvedValue(CART);
    const c = await mount();
    const a = named(c, 'Mua ngay Sản phẩm a')!;
    const slotsBefore = callsTo(SLOTS);
    const itemsBefore = callsTo(/s12\/items/);
    await tapTogether(a);
    await flush(6);
    expect(alertText(c)).toBeTruthy();
    expect(callsTo(SLOTS) - slotsBefore).toBe(0);
    expect(callsTo(/s12\/items/) - itemsBefore).toBe(0);
    expect(a.getAttribute('aria-busy')).toBeNull();
    expect(a.getAttribute('aria-disabled')).toBeNull();
    await tapTogether(a);
    await flush(6);
    expect(state.addToCart).toHaveBeenCalledTimes(2);
  });

  it('tải lại không bao giờ về: còn khoá ở 3 giây, nhả sau 4 giây', async () => {
    state.addToCart.mockRejectedValueOnce(new ApiError('Sản phẩm đã hết hàng.', 400)).mockResolvedValue(CART);
    const c = await mount();
    const a = named(c, 'Mua ngay Sản phẩm a')!;
    hold('/flash-sales/slots');
    await tapTogether(a);
    await flush(6);
    await advance(3_000);
    expect(a.getAttribute('aria-busy')).toBe('true');
    await tapTogether(a);
    expect(state.addToCart).toHaveBeenCalledTimes(1);
    await advance(1_500);
    await flush(4);
    expect(a.getAttribute('aria-busy')).toBeNull();
    expect(alertText(c)).toContain('Sản phẩm đã hết hàng.');
    await tapTogether(a);
    await flush(6);
    expect(state.addToCart).toHaveBeenCalledTimes(2);
  });
});

describe('Giờ vàng: Nhắc tôi bị máy chủ từ chối', () => {
  const remindC = (c: HTMLElement) => named(c, /^(Nhắc tôi|Đã đặt nhắc|Mua ngay) Sản phẩm c\b/)!;

  it.each(STALE)('HTTP %i: lời lỗi hiện ngay, tải lại khung giờ, món và danh sách nhắc; nút giữ bận tới khi xong; khung vừa mở thì nút thành Mua ngay', async (status, message) => {
    state.failRemind = new ApiError(message, status);
    const c = await openEvening();
    const r = remindC(c);
    expect(r.getAttribute('aria-label')).toBe('Nhắc tôi Sản phẩm c');
    const release = hold('/flash-sales/slots');
    const live = slot('s20', -0.1, 2, 'LIVE');
    state.slots = { slots: [S12, live] };
    state.items = { ...state.items, s20: itemsOf(live, [item('c')]) };
    const slotsBefore = callsTo(SLOTS);
    const itemsBefore = callsTo(/s20\/items/);
    await tapTogether(r);
    await flush(6);
    expect(alertText(c)).toContain(message);
    expect(callsTo(SLOTS) - slotsBefore).toBe(1);
    expect(callsTo(/s20\/items/) - itemsBefore).toBe(1);
    expect(r.getAttribute('aria-busy')).toBe('true');
    await tapTogether(r, r);
    await flush(2);
    expect(state.posts).toEqual(['/flash-sales/items/c/remind']);
    release();
    await flush(8);
    const buy = named(c, 'Mua ngay Sản phẩm c')!;
    expect(buy).toBeTruthy();
    expect(buy.getAttribute('aria-busy')).toBeNull();
    expect(alertText(c)).toContain(message);
  });

  it.each(TRANSIENT)('lỗi tạm (%s): báo lỗi, chỉ làm mới danh sách nhắc (như trước), không tải lại khung giờ và món', async (_name, error) => {
    state.failRemind = error;
    const c = await openEvening();
    const r = remindC(c);
    const slotsBefore = callsTo(SLOTS);
    const itemsBefore = callsTo(/s20\/items/);
    const upcomingBefore = callsTo(/upcoming/);
    await tapTogether(r);
    await flush(8);
    expect(alertText(c)).toBeTruthy();
    expect(callsTo(/upcoming/) - upcomingBefore).toBe(1);
    expect(callsTo(SLOTS) - slotsBefore).toBe(0);
    expect(callsTo(/s20\/items/) - itemsBefore).toBe(0);
    expect(r.getAttribute('aria-busy')).toBeNull();
  });

  it('tải lại không bao giờ về: còn khoá ở 3 giây, nhả sau 4 giây', async () => {
    state.failRemind = new ApiError('Suất đã bắt đầu.', 400);
    const c = await openEvening();
    const r = remindC(c);
    hold('/flash-sales/slots');
    await tapTogether(r);
    await flush(6);
    await advance(3_000);
    expect(r.getAttribute('aria-busy')).toBe('true');
    await advance(1_500);
    await flush(4);
    expect(r.getAttribute('aria-busy')).toBeNull();
    state.failRemind = null;
    await tapTogether(r);
    await flush(6);
    expect(state.posts).toHaveLength(2);
  });
});
