// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { headingProblems, unnamedControls } from '@/test-utils/a11y';

// Chép ý pages/flash-sale.spec của Mini App: khung giờ, chip danh mục, khách chưa đăng nhập, Nhắc tôi, Mua ngay, khung hết giờ, tải/rỗng/lỗi.
const state = vi.hoisted(() => ({
  phase: 'authenticated' as string,
  push: vi.fn(),
  reminded: false,
  slots: undefined as unknown,
  items: {} as Record<string, unknown>,
  calls: [] as string[],
  posts: [] as string[],
  deletes: [] as string[],
  addToCart: vi.fn(),
  failRemind: false,
}));

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
        if (path === '/categories') return CATEGORIES;
        if (path === '/flash-sales/upcoming') return [{ itemId: 'c', variationId: 'v-c', productSlug: 'sp-c', productName: 'Sản phẩm c', thumbnail: null, flashPrice: 1, retailPrice: 2, startAt: S20.startAt, reminded: state.reminded }];
        if (path === '/flash-sales/slots') {
          if (state.slots instanceof Error) throw state.slots;
          return stamp(state.slots);
        }
        const id = /\/flash-sales\/slots\/([^/]+)\/items/.exec(path)?.[1];
        const body = id ? state.items[id] : undefined;
        if (body instanceof Error) throw body;
        if (body === undefined) throw new Error(`đường dẫn lạ ${path}`);
        return stamp(body);
      },
      post: async (path: string) => {
        state.posts.push(path);
        if (state.failRemind) throw new Error('boom');
        state.reminded = true;
        return {};
      },
      delete: async (path: string) => {
        state.deletes.push(path);
        state.reminded = false;
        return {};
      },
    },
  };
});
vi.mock('@/lib/shop-client', async (orig) => ({ ...(await orig<Record<string, unknown>>()), addToCart: (...a: unknown[]) => state.addToCart(...a) }));
vi.mock('@/components/mini/countdown', () => ({
  Countdown: ({ endAt, kind = 'ends', mode, onEnd }: { endAt: string; kind?: string; mode: string; onEnd?: () => void }) => (
    <button type="button" data-testid={`countdown-${kind}-${mode}`} data-end={endAt} onClick={() => onEnd?.()}>
      đồng hồ
    </button>
  ),
}));

import { PENDING_REMIND_KEY, rememberPendingRemind } from '@/lib/pending-remind';
import FlashSlotsView from './flash-slots-view';

const NOW = new Date('2026-11-01T06:00:00Z'); // 13:00 giờ VN
const iso = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();
const slot = (id: string, startH: number, endH: number, status: 'LIVE' | 'UPCOMING' | 'ENDED', itemCount = 3) => ({
  id,
  title: id,
  startAt: iso(startH),
  endAt: iso(endH),
  status,
  itemCount,
});
const S12 = slot('s12', -1, 1, 'LIVE');
const S20 = slot('s20', 7, 9, 'UPCOMING');
const CATEGORIES = [
  { id: 'food', slug: 'food', name: 'Thực phẩm', image: null, productCount: 9, children: [] },
  { id: 'home', slug: 'home', name: 'Gia dụng', image: null, productCount: 5, children: [] },
];
const item = (id: string, over: Record<string, unknown> = {}) => ({
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
  ...over,
});
const itemsOf = (s: typeof S12, list: unknown[]) => ({ slot: s, items: list });
const MANY = [...Array.from({ length: 7 }, (_, i) => item(`f${i}`, { categoryIds: ['food'] })), ...Array.from({ length: 5 }, (_, i) => item(`h${i}`, { categoryIds: ['home'] }))];

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<FlashSlotsView />);
  mounted.push(r);
  await flush(8);
  return r.container;
};
const all = <T extends Element>(c: ParentNode, sel: string) => Array.from(c.querySelectorAll<T>(sel));
const tabs = (c: HTMLElement) => all<HTMLButtonElement>(c, '[role="tab"]');
const named = (c: HTMLElement, name: string | RegExp) =>
  all<HTMLButtonElement>(c, 'button').find((b) => {
    const n = b.getAttribute('aria-label') ?? b.textContent ?? '';
    return typeof name === 'string' ? n === name : name.test(n);
  }) ?? null;
const buys = (c: HTMLElement) => all<HTMLButtonElement>(c, 'button').filter((b) => /^Mua ngay /.test(b.getAttribute('aria-label') ?? ''));
const reminds = (c: HTMLElement) => all<HTMLButtonElement>(c, 'button').filter((b) => /^Nhắc tôi /.test(b.getAttribute('aria-label') ?? ''));
const status = (c: HTMLElement) => c.querySelector('[role="status"]') as HTMLElement;
const alertText = (c: HTMLElement) => c.querySelector('[role="alert"]')?.textContent ?? null;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  state.phase = 'authenticated';
  state.push.mockReset();
  state.reminded = false;
  state.slots = { slots: [S12, S20] };
  state.items = { s12: itemsOf(S12, [item('a'), item('b')]), s20: itemsOf(S20, [item('c')]) };
  state.calls = [];
  state.posts = [];
  state.deletes = [];
  state.failRemind = false;
  state.addToCart.mockReset();
  sessionStorage.clear();
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.useRealTimers();
});

describe('Trang Giờ vàng (web): khung giờ và danh sách', () => {
  it('có tiêu đề h1, dải tab khung giờ chọn sẵn khung đang diễn ra, panel gắn với tab', async () => {
    const c = await mount();
    expect(c.querySelector('h1')!.textContent).toBe('Giờ vàng');
    expect(tabs(c).map((t) => t.getAttribute('aria-label'))).toEqual(['12:00, đang diễn ra', '20:00, sắp diễn ra']);
    expect(tabs(c)[0]!.getAttribute('aria-selected')).toBe('true');
    expect(named(c, 'Mua ngay Sản phẩm a')).not.toBeNull();
    expect(named(c, 'Mua ngay Sản phẩm b')).not.toBeNull();
    const panel = c.querySelector('[role="tabpanel"]') as HTMLElement;
    expect(panel.getAttribute('aria-labelledby')).toBe(tabs(c)[0]!.id);
    expect(tabs(c)[0]!.getAttribute('aria-controls')).toBe(panel.id);
  });

  it('dải tab và đồng hồ nằm trong một khối dính, danh sách thì ở ngoài khối đó (cuộn danh sách dài không mất tab và đồng hồ)', async () => {
    const c = await mount();
    const sticky = c.querySelector('[data-testid="flash-sticky"]') as HTMLElement;
    expect(sticky.className).toMatch(/\bsticky\b/);
    expect(sticky.className).toContain('sticky-below-back');
    expect(sticky.className).toContain('top-[var(--header-h)]');
    expect(sticky.querySelector('[role="tablist"]')).not.toBeNull();
    expect(sticky.querySelector('[data-testid="countdown-ends-clock"]')).not.toBeNull();
    expect(sticky.contains(named(c, 'Mua ngay Sản phẩm a'))).toBe(false);
    expect((c.querySelector('[role="tabpanel"]') as HTMLElement).contains(sticky)).toBe(false);
    click(tabs(c)[1]!);
    await flush(4);
    expect(sticky.querySelector('[data-testid="countdown-starts-text"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="flash-sticky"]')).toBe(sticky);
  });

  it('đồng hồ khung đang diễn ra có nhãn "Kết thúc sau", không lặp "Đang diễn ra" của tab', async () => {
    const c = await mount();
    const sticky = c.querySelector('[data-testid="flash-sticky"]') as HTMLElement;
    expect(sticky.textContent).toContain('Kết thúc sau');
    expect(sticky.textContent!.split('Đang diễn ra').length - 1).toBe(1);
    const label = Array.from(sticky.querySelectorAll('span')).find((s) => s.textContent === 'Kết thúc sau')!;
    expect(label.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('khung đang diễn ra có đồng hồ tới giờ kết thúc; khung sắp diễn ra có đếm ngược tới giờ bắt đầu', async () => {
    const c = await mount();
    expect(c.querySelector('[data-testid="countdown-ends-clock"]')!.getAttribute('data-end')).toBe(S12.endAt);
    click(tabs(c)[1]!);
    await flush(4);
    expect(c.querySelector('[data-testid="countdown-starts-text"]')!.getAttribute('data-end')).toBe(S20.startAt);
    expect(c.querySelector('[data-testid="countdown-ends-clock"]')).toBeNull();
  });

  it('chuyển sang khung 20:00: món có Nhắc tôi, không còn Mua ngay', async () => {
    const c = await mount();
    click(tabs(c)[1]!);
    await flush(4);
    expect(named(c, 'Nhắc tôi Sản phẩm c')).not.toBeNull();
    expect(buys(c)).toHaveLength(0);
    expect(tabs(c)[1]!.getAttribute('aria-selected')).toBe('true');
  });

  it('chỉ có khung sắp diễn ra: chọn sẵn khung sớm nhất', async () => {
    state.slots = { slots: [S20] };
    const c = await mount();
    expect(named(c, 'Nhắc tôi Sản phẩm c')).not.toBeNull();
  });

  it('món hết suất xuống cuối danh sách, vẫn hiện, nút khoá bằng aria-disabled', async () => {
    state.items = { s12: itemsOf(S12, [item('sold', { soldOut: true, soldCount: 10 }), item('ok1'), item('ok2')]) };
    const c = await mount();
    expect(buys(c).map((b) => b.getAttribute('aria-label'))).toEqual(['Mua ngay Sản phẩm ok1', 'Mua ngay Sản phẩm ok2', 'Mua ngay Sản phẩm sold']);
    expect(named(c, 'Mua ngay Sản phẩm sold')!.getAttribute('aria-disabled')).toBe('true');
  });

  it('mọi nút có tên truy cập, tiêu đề đúng bậc', async () => {
    const c = await mount();
    expect(unnamedControls(c)).toEqual([]);
    expect(headingProblems(c)).toEqual([]);
  });
});

describe('Trang Giờ vàng (web): chip danh mục', () => {
  it('dưới 12 món không có chip', async () => {
    state.items = { s12: itemsOf(S12, MANY.slice(0, 11)) };
    const c = await mount();
    expect(c.querySelector('[role="group"][aria-label="Danh mục"]')).toBeNull();
  });

  it('từ 12 món: chip kèm số món, chọn chip lọc danh sách, "Tất cả" bỏ lọc', async () => {
    state.items = { s12: itemsOf(S12, MANY) };
    const c = await mount();
    const group = c.querySelector('[role="group"][aria-label="Danh mục"]') as HTMLElement;
    const chips = () => all<HTMLButtonElement>(group, 'button');
    expect(chips().map((x) => x.textContent)).toEqual(['Tất cả', 'Thực phẩm(7)', 'Gia dụng(5)']);
    expect(chips()[0]!.getAttribute('aria-pressed')).toBe('true');
    click(chips()[2]!);
    expect(buys(c)).toHaveLength(5);
    expect(chips()[2]!.getAttribute('aria-pressed')).toBe('true');
    click(chips()[0]!);
    expect(buys(c)).toHaveLength(12);
  });

  it('đổi khung thì bỏ lọc danh mục của khung trước', async () => {
    state.items = { s12: itemsOf(S12, MANY), s20: itemsOf(S20, MANY) };
    const c = await mount();
    const group = c.querySelector('[role="group"][aria-label="Danh mục"]') as HTMLElement;
    click(all<HTMLButtonElement>(group, 'button')[2]!);
    click(tabs(c)[1]!);
    await flush(4);
    expect(reminds(c)).toHaveLength(12);
  });
});

describe('Trang Giờ vàng (web): khách chưa đăng nhập', () => {
  beforeEach(() => {
    state.phase = 'guest';
  });

  it('xem được trang; không hỏi danh sách nhắc của tài khoản', async () => {
    const c = await mount();
    expect(named(c, 'Mua ngay Sản phẩm a')).not.toBeNull();
    expect(state.calls).not.toContain('/flash-sales/upcoming');
  });

  it('bấm Nhắc tôi đi tới đăng nhập quay lại /gio-vang, không gọi API nhắc', async () => {
    const c = await mount();
    click(tabs(c)[1]!);
    await flush(4);
    click(named(c, 'Nhắc tôi Sản phẩm c'));
    await flush(2);
    expect(state.push).toHaveBeenCalledWith('/dang-nhap?returnTo=%2Fgio-vang');
    expect(state.posts).toEqual([]);
  });

  it('bấm Nhắc tôi nhớ suất lại (sessionStorage) trước khi đi đăng nhập, để đăng nhập xong tự đặt', async () => {
    const c = await mount();
    click(tabs(c)[1]!);
    await flush(4);
    click(named(c, 'Nhắc tôi Sản phẩm c'));
    await flush(2);
    expect(JSON.parse(sessionStorage.getItem(PENDING_REMIND_KEY)!)).toMatchObject({ itemId: 'c', startAt: S20.startAt });
  });

  it('khách quay về trang mà chưa đăng nhập (bỏ dở): ý định cũ bị xoá, lần đăng nhập sau không tự đặt nhắc', async () => {
    rememberPendingRemind({ itemId: 'c', startAt: S20.startAt });
    await mount();
    expect(sessionStorage.getItem(PENDING_REMIND_KEY)).toBeNull();
  });

  it('bấm Mua ngay đi tới đăng nhập, không thêm giỏ', async () => {
    const c = await mount();
    click(named(c, 'Mua ngay Sản phẩm a'));
    await flush(2);
    expect(state.push).toHaveBeenCalledWith('/dang-nhap?returnTo=%2Fgio-vang');
    expect(state.addToCart).not.toHaveBeenCalled();
  });

  it('phiên đang khôi phục: bấm Mua ngay chưa làm gì', async () => {
    state.phase = 'loading';
    const c = await mount();
    click(named(c, 'Mua ngay Sản phẩm a'));
    await flush(2);
    expect(state.push).not.toHaveBeenCalled();
    expect(state.addToCart).not.toHaveBeenCalled();
  });

  it('mất kết nối phiên: báo lỗi bằng chữ, không đẩy sang đăng nhập', async () => {
    state.phase = 'unavailable';
    const c = await mount();
    click(named(c, 'Mua ngay Sản phẩm a'));
    await flush(2);
    expect(state.push).not.toHaveBeenCalled();
    expect(alertText(c)).toContain('Chưa kết nối được tới Tubu Tree');
  });
});

describe('Trang Giờ vàng (web): Nhắc tôi khi đã đăng nhập', () => {
  async function openEvening() {
    const c = await mount();
    click(tabs(c)[1]!);
    await flush(4);
    return c;
  }

  it('bấm Nhắc tôi gọi đặt nhắc đúng suất, đổi sang "Đã đặt nhắc" và báo giờ nhắc', async () => {
    const c = await openEvening();
    click(named(c, 'Nhắc tôi Sản phẩm c'));
    await flush(6);
    expect(state.posts).toEqual(['/flash-sales/items/c/remind']);
    expect(named(c, 'Đã đặt nhắc Sản phẩm c, bỏ nhắc')!.getAttribute('aria-pressed')).toBe('true');
    expect(status(c).textContent).toBe('Tubu sẽ nhắc bạn lúc 20:00');
  });

  it('món đã đặt nhắc từ trước hiện "Đã đặt nhắc"; bấm lần nữa bỏ nhắc', async () => {
    state.reminded = true;
    const c = await openEvening();
    click(named(c, 'Đã đặt nhắc Sản phẩm c, bỏ nhắc'));
    await flush(6);
    expect(state.deletes).toEqual(['/flash-sales/items/c/remind']);
    expect(state.posts).toEqual([]);
    expect(status(c).textContent).toBe('Đã bỏ nhắc');
    expect(named(c, 'Nhắc tôi Sản phẩm c')).not.toBeNull();
  });

  it('đặt nhắc lỗi: trả nút về "Nhắc tôi" và báo lỗi', async () => {
    const c = await openEvening();
    state.failRemind = true;
    click(named(c, 'Nhắc tôi Sản phẩm c'));
    await flush(6);
    expect(alertText(c)).not.toBeNull();
    expect(named(c, 'Nhắc tôi Sản phẩm c')!.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('Trang Giờ vàng (web): quay về sau đăng nhập với một Nhắc tôi đang chờ', () => {
  const PENDING = { itemId: 'c', startAt: S20.startAt };

  it('món chưa nhắc: tự đặt nhắc đúng suất một lần, xoá ý định, báo giờ nhắc; render lại không đặt lần hai', async () => {
    rememberPendingRemind(PENDING);
    const c = await mount();
    await flush(10);
    expect(state.posts).toEqual(['/flash-sales/items/c/remind']);
    expect(state.deletes).toEqual([]);
    expect(sessionStorage.getItem(PENDING_REMIND_KEY)).toBeNull();
    expect(status(c).textContent).toBe('Tubu sẽ nhắc bạn lúc 20:00');
  });

  it('món đã được nhắc từ trước (máy khác): không gọi POST lẫn DELETE, vì bấm bật lại sẽ huỷ nhắc', async () => {
    state.reminded = true;
    rememberPendingRemind(PENDING);
    await mount();
    await flush(10);
    expect(state.posts).toEqual([]);
    expect(state.deletes).toEqual([]);
    expect(sessionStorage.getItem(PENDING_REMIND_KEY)).toBeNull();
  });

  it('không có ý định chờ: vào trang như thường, không đặt nhắc nào', async () => {
    await mount();
    await flush(10);
    expect(state.posts).toEqual([]);
  });
});

describe('Trang Giờ vàng (web): Mua ngay', () => {
  it('thêm đúng một sản phẩm của phân loại có suất rồi sang thanh toán đúng dòng đó', async () => {
    state.addToCart.mockResolvedValue({ items: [{ id: 'line-x', variationId: 'v-a', quantity: 1 }, { id: 'line-y', variationId: 'v-other', quantity: 1 }] });
    const c = await mount();
    click(named(c, 'Mua ngay Sản phẩm a'));
    await flush(6);
    expect(state.addToCart).toHaveBeenCalledWith('v-a', 1);
    expect(state.push).toHaveBeenCalledWith('/thanh-toan');
    expect(JSON.parse(sessionStorage.getItem('tubu_checkout_selection')!)).toEqual({ itemIds: ['line-x'] });
  });

  it('thêm giỏ lỗi (hết suất giữa chừng): báo lỗi, ở lại trang, không sang thanh toán', async () => {
    state.addToCart.mockRejectedValue(new Error('Hết hàng'));
    const c = await mount();
    click(named(c, 'Mua ngay Sản phẩm a'));
    await flush(6);
    expect(alertText(c)).not.toBeNull();
    expect(state.push).not.toHaveBeenCalled();
  });

  it('món hết suất: bấm Mua ngay không làm gì', async () => {
    state.items = { s12: itemsOf(S12, [item('sold', { soldOut: true, soldCount: 10 })]) };
    const c = await mount();
    click(named(c, 'Mua ngay Sản phẩm sold'));
    await flush(2);
    expect(state.addToCart).not.toHaveBeenCalled();
    expect(state.push).not.toHaveBeenCalled();
  });
});

describe('Trang Giờ vàng (web): khung hết giờ khi khách đang xem', () => {
  const endClock = async (c: HTMLElement) => {
    vi.setSystemTime(new Date(S12.endAt).getTime() + 1_000);
    click(c.querySelector('[data-testid="countdown-ends-clock"]'));
    await flush(6);
  };

  it('đồng hồ về 0: báo "Khung 12:00 đã kết thúc" ở vùng status rồi chuyển sang khung kế', async () => {
    const c = await mount();
    expect(status(c).textContent).toBe('');
    await endClock(c);
    expect(status(c).textContent).toBe('Khung 12:00 đã kết thúc');
    expect(named(c, 'Nhắc tôi Sản phẩm c')).not.toBeNull();
    expect(tabs(c)).toHaveLength(1);
    expect(tabs(c)[0]!.getAttribute('aria-selected')).toBe('true');
    expect(buys(c)).toHaveLength(0);
  });

  it('khung cuối hết giờ: báo đã kết thúc, không còn tab, hiện trạng thái rỗng', async () => {
    state.slots = { slots: [S12] };
    const c = await mount();
    await endClock(c);
    expect(status(c).textContent).toBe('Khung 12:00 đã kết thúc');
    expect(tabs(c)).toHaveLength(0);
    expect(c.textContent).toContain('Chưa có Giờ vàng lúc này');
  });

  it('máy chủ báo khung đang xem đã kết thúc (đồng hồ máy lệch): thông báo kèm lối sang khung kế', async () => {
    state.items = { s12: { slot: { ...S12, status: 'ENDED', itemCount: 0 }, items: [] }, s20: itemsOf(S20, [item('c')]) };
    const c = await mount();
    expect(c.textContent).toContain('Khung giờ này đã kết thúc');
    click(named(c, 'Xem khung giờ tiếp theo'));
    await flush(4);
    expect(named(c, 'Nhắc tôi Sản phẩm c')).not.toBeNull();
  });
});

describe('Trang Giờ vàng (web): trạng thái tải, rỗng, lỗi', () => {
  it('đang tải: khung chờ, không có tab', () => {
    const r = render(<FlashSlotsView />);
    mounted.push(r);
    expect(r.container.querySelector('[data-testid="flash-slots-loading"]')).not.toBeNull();
    expect(tabs(r.container)).toHaveLength(0);
  });

  it('không có khung nào: trạng thái rỗng, nút dẫn tới danh mục sản phẩm', async () => {
    state.slots = { slots: [] };
    const c = await mount();
    expect(c.textContent).toContain('Chưa có Giờ vàng lúc này');
    expect(c.textContent).toContain('Khung giờ tiếp theo sẽ hiện ở đây.');
    click(named(c, 'Xem sản phẩm khác'));
    expect(state.push).toHaveBeenCalledWith('/san-pham');
  });

  it('API khung giờ lỗi: báo lỗi và Thử lại tải lại', async () => {
    state.slots = new Error('500');
    const c = await mount();
    const retry = named(c, 'Thử lại')!;
    expect(retry).not.toBeNull();
    state.slots = { slots: [S12, S20] };
    click(retry);
    await flush(8);
    expect(named(c, 'Mua ngay Sản phẩm a')).not.toBeNull();
  });

  it('khung có nhưng món lỗi: lỗi nằm trong vùng danh sách, dải tab vẫn dùng được', async () => {
    state.items = { s12: new Error('500'), s20: itemsOf(S20, [item('c')]) };
    const c = await mount();
    expect(named(c, 'Thử lại')).not.toBeNull();
    click(tabs(c)[1]!);
    await flush(4);
    expect(named(c, 'Nhắc tôi Sản phẩm c')).not.toBeNull();
  });

  it('khung không còn món nào bán được thì báo rỗng, không để vùng trắng', async () => {
    state.items = { s12: itemsOf(S12, []) };
    const c = await mount();
    expect(c.textContent).toContain('Chưa có sản phẩm trong khung giờ này');
  });
});
