// @vitest-environment jsdom
import { act } from 'react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets } from '@/test-utils/a11y';
import { ApiError } from '@/lib/client-api';
import { TILE_METRICS } from '@tubutree/app-core/commerce/tile-metrics';

// Chép ý nghĩa flash-sale.spec của Mini App: giờ vàng đang chạy, sắp diễn ra + nhắc, tải lại sau lỗi, giá khớp giá thật.
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), del: vi.fn(), phase: 'guest' }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: mocks.post, delete: mocks.del } }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase, useAuthRestoring: () => false }));

import { FlashSale as FlashSaleBlock, UpcomingFlashSales } from './flash-sale';
import { useHomeShelves } from './use-home-shelves';
import { FLASH_HINT_KEY, FLASH_SKELETON_HEIGHT, FLASH_NEXT_SLOT_HEIGHT } from '@tubutree/app-core/home-layout';
import { resetFlashSales } from '@/lib/use-flash-sales';

/** Khối thật được nối như Trang chủ: dữ liệu và chống trùng đến từ `useHomeShelves`, không tự tải. */
function FlashSale({ initial }: { initial?: unknown[] }) {
  const s = useHomeShelves('new', { flash: initial as never });
  return <FlashSaleBlock items={s.flash} loading={s.flashQuery.isLoading} error={s.flashQuery.error} onRetry={s.flashQuery.refetch} retrying={s.flashQuery.isFetching} onExpire={s.onFlashEnd} />;
}

const HOUR = 3_600_000;
// Giá gạch của thẻ: phần tử có gạch ngang (chỉ PriceTag được vẽ gạch).
const struck = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>('span')).find((e) => e.style.textDecoration === 'line-through');
const active = (over: Record<string, unknown> = {}) => ({
  itemId: 'i1', variationId: 'v1', productSlug: 'nuoc-rua-chen', productName: 'Nước rửa chén', thumbnail: null,
  retailPrice: 100000, flashPrice: 80000, quota: 10, soldCount: 2, endAt: new Date(Date.now() + HOUR).toISOString(), ...over,
});
/** Khối Giờ vàng chỉ hiện từ 3 suất (kệ mỏng không đáng một khối): ba suất cùng thuộc tính, slug khác nhau. */
const three = (over: Record<string, unknown> = {}) => [
  active(over),
  active({ ...over, itemId: 'x2', variationId: 'vx2', productSlug: 'sp-x2', productName: 'Sản phẩm X2' }),
  active({ ...over, itemId: 'x3', variationId: 'vx3', productSlug: 'sp-x3', productName: 'Sản phẩm X3' }),
];
const upcoming = (over: Record<string, unknown> = {}) => ({
  itemId: 'u1', variationId: 'v9', productSlug: 'dau-goi', productName: 'Dầu gội', thumbnail: null,
  retailPrice: 100000, flashPrice: 70000, startAt: new Date(Date.now() + HOUR).toISOString(), reminded: false, ...over,
});

let activeResult: () => Promise<unknown>;
let upcomingResult: () => Promise<unknown>;
let mounted: Rendered | null = null;
const mount = async (ui: React.ReactElement) => {
  mounted = render(ui);
  await flush(8);
  return mounted.container;
};

beforeEach(() => {
  resetFlashSales();
  mocks.phase = 'guest';
  activeResult = async () => [];
  upcomingResult = async () => [];
  mocks.post.mockReset().mockResolvedValue({});
  mocks.del.mockReset().mockResolvedValue({});
  mocks.get.mockReset().mockImplementation((path: string) => (path === '/flash-sales/active' ? activeResult() : upcomingResult()));
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
});

describe('FlashSale hydrate', () => {
  it('suất còn giờ: HTML dựng trước chỉ có khung đồng hồ không chữ số, đồng hồ trình duyệt lệch 75 giây vẫn không làm hỏng hydrate', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-28T10:00:50Z'));
    const items = three({ endAt: '2026-10-28T12:16:00Z' });
    const ui = () => (
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <FlashSale initial={items} />
      </QueryClientProvider>
    );
    const html = renderToString(ui());
    expect(html).toContain('role="timer"');
    expect(html).toContain('Nước rửa chén');
    // Đoạn script chống ISR cũ mang mốc endAt ISO, không phải chữ số đồng hồ.
    expect(html.replace(/<script>[\s\S]*?<\/script>/g, '')).not.toMatch(/\d{2}:\d{2}:\d{2}/);
    vi.setSystemTime(new Date('2026-10-28T10:02:05Z'));
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);
    const errors: unknown[] = [];
    const consoleError = vi.spyOn(console, 'error').mockImplementation((...a) => void errors.push(a));
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, ui(), { onRecoverableError: (e) => void errors.push(e) });
    });
    consoleError.mockRestore();
    expect(errors).toEqual([]);
    act(() => root.unmount());
    container.remove();
  });

  it('HTML ISR cũ trả sau giờ hết suất (đồng hồ trình duyệt đã qua endAt): hydrate không lỗi, sau hydrate khối tự ẩn (không hiện 00:00:00)', async () => {
    activeResult = () => new Promise(() => undefined);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-28T11:55:00Z'));
    const items = three({ endAt: '2026-10-28T12:00:00Z' });
    const ui = () => (
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <FlashSale initial={items} />
      </QueryClientProvider>
    );
    const html = renderToString(ui());
    expect(html).toContain('Nước rửa chén');
    vi.setSystemTime(new Date('2026-10-28T12:30:00Z'));
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);
    const errors: unknown[] = [];
    const consoleError = vi.spyOn(console, 'error').mockImplementation((...a) => void errors.push(a));
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, ui(), { onRecoverableError: (e) => void errors.push(e) });
    });
    consoleError.mockRestore();
    expect(errors).toEqual([]);
    expect(container.textContent).not.toContain('00:00:00');
    expect(container.querySelector('[role="timer"]')).toBeNull();
    act(() => root.unmount());
    container.remove();
  });

  it('HTML ISR cũ quá giờ: đoạn script ngay sau kệ ẩn kệ TRƯỚC lần vẽ đầu (không vẽ rồi biến mất); hydrate không lỗi và gỡ kệ, script', async () => {
    activeResult = () => new Promise(() => undefined);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-28T11:55:00Z'));
    const items = three({ endAt: '2026-10-28T12:00:00Z' });
    const ui = () => (
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <FlashSale initial={items} />
      </QueryClientProvider>
    );
    const container = document.createElement('div');
    container.innerHTML = renderToString(ui());
    document.body.appendChild(container);
    const run = () => {
      const script = container.querySelector('script')!;
      new Function('document', script.textContent!.replace('document.currentScript', 'document.__s'))({ __s: script });
    };
    // Còn giờ khi trình duyệt đọc script: kệ giữ nguyên.
    vi.setSystemTime(new Date('2026-10-28T11:59:00Z'));
    run();
    expect((container.querySelector('section') as HTMLElement).style.display).toBe('');
    // Quá giờ: ẩn ngay, trước khi React chạy.
    vi.setSystemTime(new Date('2026-10-28T12:30:00Z'));
    run();
    expect((container.querySelector('section') as HTMLElement).style.display).toBe('none');
    const errors: unknown[] = [];
    const consoleError = vi.spyOn(console, 'error').mockImplementation((...a) => void errors.push(a));
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, ui(), { onRecoverableError: (e) => void errors.push(e) });
    });
    consoleError.mockRestore();
    expect(errors).toEqual([]);
    expect(container.querySelector('section')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    act(() => root.unmount());
    container.remove();
  });

  it('HTML ISR còn giờ: hydrate gỡ script nhưng KHÔNG remount kệ (thẻ và đồng hồ giữ nguyên nút DOM)', async () => {
    activeResult = () => new Promise(() => undefined);
    const items = three();
    const ui = () => (
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <FlashSale initial={items} />
      </QueryClientProvider>
    );
    const container = document.createElement('div');
    container.innerHTML = renderToString(ui());
    document.body.appendChild(container);
    const before = container.querySelector('section');
    expect(container.querySelector('script')).not.toBeNull();
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, ui());
    });
    expect(container.querySelector('section')).toBe(before);
    expect(container.querySelector('script')).toBeNull();
    act(() => root.unmount());
    container.remove();
  });
});

describe('FlashSale dữ liệu dựng sẵn rỗng', () => {
  const withStorage = (hint: string | null) => {
    try { localStorage.clear(); if (hint) localStorage.setItem(FLASH_HINT_KEY, hint); } catch { /* không có kho */ }
  };
  it('máy nhớ lần trước có Giờ vàng, bản dựng sẵn rỗng, lần tải lại cũng rỗng: hydrate không chèn khung giữ chỗ nào (HTML server không có khung)', async () => {
    withStorage('1');
    activeResult = async () => [];
    const ui = () => (
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <FlashSale initial={[]} />
      </QueryClientProvider>
    );
    const html = renderToString(ui());
    // Chỉ có chỗ giữ cho ca "dự kiến mở" (ẩn, và đoạn script không hiện nó với hint "1"): không có khung chờ hay nội dung nào.
    expect(html).toContain('data-testid="flash-sale-reserve"');
    expect(html).not.toContain('flash-sale-loading');
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);
    const seen: boolean[] = [];
    const watch = new MutationObserver(() => seen.push(container.querySelector('[data-testid="flash-sale-loading"]') !== null));
    watch.observe(container, { childList: true, subtree: true });
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, ui());
    });
    await flush(8);
    watch.disconnect();
    expect(seen).not.toContain(true);
    expect(container.innerHTML).toBe('');
    act(() => root.unmount());
    container.remove();
  });

  /** Dựng HTML như máy chủ rồi hydrate; trả về các lần DOM đổi: có khung giữ chỗ hay chỗ giữ của máy chủ ở từng thời điểm. */
  async function hydrateEmpty(hint: string | null, opts: { now?: Date; activeIs?: () => Promise<unknown> } = {}) {
    withStorage(hint);
    if (opts.now) {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(opts.now);
    }
    activeResult = opts.activeIs ?? (() => new Promise(() => undefined));
    const ui = () => (
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <FlashSale initial={[]} />
      </QueryClientProvider>
    );
    const container = document.createElement('div');
    container.innerHTML = renderToString(ui());
    document.body.appendChild(container);
    const reserve = container.querySelector<HTMLElement>('[data-testid="flash-sale-reserve"]')!;
    // Giống trình duyệt: đoạn script liền sau chỗ giữ chạy trước hydrate.
    const script = container.querySelector('script')!;
    new Function('document', 'localStorage', script.textContent!.replace('document.currentScript', 'document.__s'))(
      Object.assign(Object.create(null), { __s: script }),
      localStorage,
    );
    const states: string[] = [];
    const snap = () => `${reserve.isConnected && reserve.style.display === 'block' ? 'giữ-chỗ' : ''}${container.querySelector('[data-testid="flash-sale-loading"]') ? 'khung' : ''}` || 'trống';
    states.push(snap());
    const watch = new MutationObserver(() => {
      const next = snap();
      if (states[states.length - 1] !== next) states.push(next);
    });
    watch.observe(container, { childList: true, subtree: true, attributes: true });
    const errors: unknown[] = [];
    const consoleError = vi.spyOn(console, 'error').mockImplementation((...a) => void errors.push(a));
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, ui(), { onRecoverableError: (e) => void errors.push(e) });
    });
    await flush(8);
    consoleError.mockRestore();
    watch.disconnect();
    const done = () => {
      act(() => root.unmount());
      container.remove();
    };
    return { container, states, errors, snap, done };
  }

  it('HTML dựng chưa có suất, máy nhớ suất kế mở lúc 12:00 và giờ đó đã tới: lần vẽ đầu đã giữ chỗ, hydrate thay bằng khung chờ cùng chiều cao, không có lúc nào trống', async () => {
    const now = new Date('2026-10-28T12:03:00Z');
    const r = await hydrateEmpty(`0@${Date.parse('2026-10-28T12:00:00Z')}`, { now });
    expect(r.errors).toEqual([]);
    expect(r.states[0]).toBe('giữ-chỗ');
    expect(r.states).not.toContain('trống');
    expect(r.snap()).toBe('khung');
    expect((r.container.querySelector('[data-testid="flash-sale-loading"]')!.firstElementChild as HTMLElement).style.height).toBe(`${FLASH_SKELETON_HEIGHT}px`);
    r.done();
  });

  it('cùng ca đó nhưng lần tải lại không mang suất nào về: khung chờ gỡ đi, không treo', async () => {
    const r = await hydrateEmpty(`0@${Date.parse('2026-10-28T12:00:00Z')}`, { now: new Date('2026-10-28T12:03:00Z'), activeIs: async () => [] });
    expect(r.errors).toEqual([]);
    expect(r.snap()).toBe('trống');
    r.done();
  });

  it('giờ mở dự kiến chưa tới, đã quá cửa sổ, hay máy chỉ nhớ "có Giờ vàng": không giữ chỗ lần vẽ đầu và không chèn khung chờ', async () => {
    for (const [hint, now] of [
      [`0@${Date.parse('2026-10-28T12:00:00Z')}`, '2026-10-28T11:59:00Z'],
      [`0@${Date.parse('2026-10-28T12:00:00Z')}`, '2026-10-28T14:00:00Z'],
      ['1', '2026-10-28T12:03:00Z'],
      [null, '2026-10-28T12:03:00Z'],
    ] as const) {
      const r = await hydrateEmpty(hint, { now: new Date(now) });
      expect(r.errors).toEqual([]);
      expect(r.states, `${hint} @${now}`).toEqual(['trống']);
      r.done();
      vi.useRealTimers();
    }
  });
  it('chưa nhớ Giờ vàng: không vẽ khung giữ chỗ', async () => {
    withStorage(null);
    activeResult = () => new Promise(() => undefined);
    const c = await mount(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <FlashSale initial={[]} />
      </QueryClientProvider>,
    );
    expect(c.querySelector('[data-testid="flash-sale-loading"]')).toBeNull();
  });
});

describe('FlashSale', () => {
  it('không có đợt giờ vàng nào → không vẽ gì', async () => {
    expect((await mount(<FlashSale />)).textContent).toBe('');
  });

  it('tải lỗi → khối có tiêu đề, thông báo và "Thử lại" thay vì biến mất; thử lại thành công hiện đợt giờ vàng', async () => {
    let calls = 0;
    activeResult = async () => {
      if (calls++ === 0) throw new ApiError('Internal server error', 500);
      return three();
    };
    const c = await mount(<FlashSale />);
    const region = c.querySelector('section[aria-label="Giờ vàng"]')!;
    expect(region.textContent).toContain('Máy chủ đang bận, thử lại nhé.');
    expect(region.textContent).not.toContain('Internal server error');
    click(region.querySelector('button[aria-label="Thử lại Giờ vàng"]'));
    await flush(8);
    expect(c.textContent).toContain('Nước rửa chén');
    expect(c.querySelector('button[aria-label^="Thử lại"]')).toBeNull();
  });

  it('lần tải ĐẦU không vẽ gì (không khung chờ, không khối lỗi) cho tới khi có kết quả', async () => {
    activeResult = () => new Promise(() => undefined);
    expect((await mount(<FlashSale />)).textContent).toBe('');
  });

  it('tiêu đề h2 "Giờ vàng" kiểu promo, MỘT đồng hồ ở đầu khối (trên hàng thẻ), "Xem tất cả" dẫn tới /gio-vang, thẻ hiện -% / giá giờ vàng / giá gạch / đã bán', async () => {
    activeResult = async () => three();
    const c = await mount(<FlashSale />);
    const section = c.querySelector('section')!;
    expect(section.querySelector('h2')?.textContent).toBe('Giờ vàng');
    expect(section.querySelector('[data-testid="section-header"]')).not.toBeNull();
    expect(section.getAttribute('aria-labelledby')).toBe(section.querySelector('h2')?.id);
    const timers = section.querySelectorAll('[role="timer"]');
    expect(timers).toHaveLength(1);
    expect(timers[0]!.getAttribute('aria-label')).toMatch(/^Kết thúc sau/);
    expect(timers[0]!.querySelectorAll('[data-testid="countdown-cell"]')).toHaveLength(3);
    expect(section.querySelector('a[aria-label="Xem tất cả Giờ vàng"]')?.getAttribute('href')).toBe('/gio-vang');
    expect(c.textContent).toContain('-20%');
    expect(c.textContent).toContain('80.000đ');
    expect(struck(c)?.textContent).toBe('100.000đ');
    expect(c.textContent).toContain('Đã bán 20%');
    expect(c.querySelector('a[href="/san-pham/nuoc-rua-chen?v=v1"]')).not.toBeNull();
  });

  it('dưới 3 suất: ẩn cả khối (kệ mỏng không đáng một khối)', async () => {
    activeResult = async () => [active(), active({ itemId: 'x2', productSlug: 'sp-x2' })];
    expect((await mount(<FlashSale />)).textContent).toBe('');
  });

  it('một sản phẩm có hai phân loại cùng Giờ vàng chỉ một thẻ; kệ tối đa 8 thẻ', async () => {
    const many = Array.from({ length: 10 }, (_, i) => active({ itemId: `m${i}`, productSlug: `sp-${i}`, productName: `SP ${i}` }));
    activeResult = async () => [...many, active({ itemId: 'dup', productSlug: 'sp-0', variationId: 'v-other' })];
    const c = await mount(<FlashSale />);
    expect(c.querySelectorAll('a.tubu-tile-link')).toHaveLength(8);
    expect(c.querySelectorAll('a[href^="/san-pham/sp-0"]')).toHaveLength(1);
  });

  it('B-146: nhãn -% nền cam đặc như Mini App, không phải nền cam nhạt', async () => {
    activeResult = async () => three();
    const c = await mount(<FlashSale />);
    const badge = c.querySelector('span[style*="--color-flash-solid-bg"]');
    expect(badge?.textContent).toBe('-20%');
  });

  it('sản phẩm nhiều phân loại: tên phân loại ở dòng riêng một dòng, giống Mini App', async () => {
    activeResult = async () => three({ variationName: '500g' });
    const c = await mount(<FlashSale />);
    const line = c.querySelector('[data-ds-part="note"]') as HTMLElement;
    expect(line.textContent).toBe('500g');
    expect(line.style.whiteSpace).toBe('nowrap');
    expect(line.style.textOverflow).toBe('ellipsis');
    expect(c.textContent).not.toContain('Nước rửa chén · 500g');
  });

  it('có thẻ cần dòng phân loại thì mọi thẻ giữ chỗ dòng đó để giá cùng kệ thẳng hàng', async () => {
    activeResult = async () => [active({ variationName: '500g' }), ...three().slice(1).map((it) => ({ ...it, variationName: null }))];
    const c = await mount(<FlashSale />);
    expect(c.querySelectorAll('[data-ds-part="note"]').length).toBe(3);
  });

  it('giá Giờ vàng không rẻ hơn giá đang bán: liên kết không ép mở phân loại Giờ vàng', async () => {
    activeResult = async () => three({ flashPrice: 100000 });
    const c = await mount(<FlashSale />);
    expect(c.querySelector('a[href="/san-pham/nuoc-rua-chen"]')).not.toBeNull();
  });

  it('bán quá suất: thanh "đã bán" dừng ở "Đã bán hết", không in 150%', async () => {
    activeResult = async () => three({ soldCount: 15 });
    const c = await mount(<FlashSale />);
    expect(c.textContent).toContain('Đã bán hết');
    expect(c.textContent).not.toContain('150%');
    expect(c.querySelector('[data-testid="flash-sold-bar"]')?.getAttribute('data-state')).toBe('soldout');
  });

  // D7-29: tên SP không lòi dòng thừa (Q11: thẻ Giờ vàng ở Trang chủ đúng một dòng). Thanh "đã bán" chỉ để trang trí (aria-hidden): chữ mang thông tin.
  it('thanh "đã bán" luôn có chữ (kể cả chưa bán suất nào) và chỉ để trang trí; tên sản phẩm cao đúng một dòng', async () => {
    activeResult = async () => three({ soldCount: 4 });
    const c = await mount(<FlashSale />);
    expect(c.querySelector('[data-testid="flash-sold-bar"]')?.textContent).toContain('Đã bán 40%');
    expect(c.querySelector('[data-testid="flash-sold-track"]')?.getAttribute('aria-hidden')).toBe('true');
    const name = c.querySelector('a.tubu-tile-link > span') as HTMLElement;
    expect(name.style.webkitLineClamp).toBe('1');
    expect(name.style.minHeight).toBe(`${TILE_METRICS.nameFlash}px`);
    expect(name.style.lineHeight).toBe('20px');
    mounted!.unmount();
    resetFlashSales();
    activeResult = async () => three({ soldCount: 0 });
    const fresh = await mount(<FlashSale />);
    expect(fresh.querySelector('[data-testid="flash-sold-bar"]')?.textContent).toContain('Vừa mở bán');
  });

  it('flashPrice cao hơn giá đang bán → hiện giá đang bán, không nhãn % âm; giá gạch là giá niêm yết như thẻ ở lưới (một sản phẩm không hai giá); có salePrice thì % theo giá đang bán', async () => {
    activeResult = async () => three({ flashPrice: 90000, retailPrice: 100000, salePrice: 60000 });
    let c = await mount(<FlashSale />);
    expect(c.textContent).toContain('60.000đ');
    expect(c.textContent).not.toMatch(/-\d+%|-0%/);
    expect(struck(c)?.textContent).toBe('100.000đ');
    mounted!.unmount();
    resetFlashSales();
    activeResult = async () => three({ flashPrice: 120000, retailPrice: 100000, salePrice: null });
    c = await mount(<FlashSale />);
    expect(c.textContent).toContain('100.000đ');
    expect(struck(c)).toBeUndefined();
    mounted!.unmount();
    resetFlashSales();
    activeResult = async () => three({ flashPrice: 70000, retailPrice: 100000, salePrice: 80000 });
    c = await mount(<FlashSale />);
    expect(c.textContent).toContain('-13%');
    expect(struck(c)?.textContent).toBe('80.000đ');
  });

  it('mọi suất đã quá giờ kết thúc (chờ lần tải lại kế tiếp): khối ẩn, không hiện 00:00:00', async () => {
    activeResult = async () => three({ endAt: new Date(Date.now() - 1000).toISOString() });
    const c = await mount(<FlashSale />);
    expect(c.textContent).toBe('');
  });

  it('đồng hồ tiêu đề chỉ tính các suất còn giờ: suất sớm nhất đã hết giờ thì rời kệ và đếm theo suất kế tiếp', async () => {
    activeResult = async () => [
      active({ itemId: 'a', endAt: new Date(Date.now() - 1000).toISOString() }),
      ...[1, 2, 3].map((n) => active({ itemId: `b${n}`, productSlug: `sp-b${n}`, productName: `SP B${n}`, endAt: new Date(Date.now() + 2 * HOUR).toISOString() })),
    ];
    const c = await mount(<FlashSale />);
    expect(c.querySelectorAll('a.tubu-tile-link')).toHaveLength(3);
    expect(c.querySelector('[role="timer"]')?.getAttribute('aria-label')).toMatch(/^Kết thúc sau/);
    const cells = Array.from(c.querySelectorAll('[data-testid="countdown-cell"]')).map((e) => e.textContent);
    expect(cells[0]).toMatch(/^0[12]$/);
  });

  it('đồng hồ về 0: gọi onExpire đúng một lần để chỗ nối dữ liệu tính lại chống trùng (món hết giờ trở lại kệ khác)', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date('2026-10-28T10:00:00Z'));
    const onExpire = vi.fn();
    mounted = render(<FlashSaleBlock items={three({ endAt: '2026-10-28T10:01:00Z' }) as never} loading={false} onExpire={onExpire} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(onExpire).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });
});

describe('FlashSale — dòng "suất kế" và giữ chỗ khi tải', () => {
  const withStorage = (hint: string | null) => {
    try { localStorage.clear(); if (hint) localStorage.setItem(FLASH_HINT_KEY, hint); } catch { /* không có kho */ }
  };

  it('suất sắp mở trong 6 giờ: dòng có "Nhắc tôi" dẫn tới trang Giờ vàng; ghi dấu nhớ có dòng suất kế', async () => {
    withStorage(null);
    const startAt = new Date(Date.now() + 2 * HOUR).toISOString();
    activeResult = async () => three();
    upcomingResult = async () => [upcoming({ startAt }), upcoming({ itemId: 'u2', productSlug: 'sp-u2', startAt })];
    const c = await mount(<FlashSale />);
    const line = c.querySelector('[data-testid="flash-next-slot"]') as HTMLElement;
    expect(line.textContent).toMatch(/^\d{2}:\d{2} · 2 món sắp mởNhắc tôi$/);
    expect(line.getAttribute('href')).toBe('/gio-vang');
    expect(line.getBoundingClientRect().height).toBeGreaterThanOrEqual(0);
    expect((line as HTMLElement).style.minHeight).toBe(`${FLASH_NEXT_SLOT_HEIGHT}px`);
    expect(localStorage.getItem(FLASH_HINT_KEY)).toBe('2');
  });

  it('phiên còn đang kiểm tra (phase "loading"): chưa hỏi suất sắp mở; biết phiên rồi mới hỏi một lần', async () => {
    withStorage(null);
    mocks.phase = 'loading';
    activeResult = async () => three();
    await mount(<FlashSale />);
    expect(mocks.get.mock.calls.filter(([path]) => path === '/flash-sales/upcoming')).toHaveLength(0);
    mounted?.unmount();
    mocks.phase = 'guest';
    await mount(<FlashSale />);
    expect(mocks.get.mock.calls.filter(([path]) => path === '/flash-sales/upcoming')).toHaveLength(1);
  });

  it('suất kế xa hơn 6 giờ hoặc không có: không có dòng, dấu nhớ là "1"', async () => {
    withStorage(null);
    activeResult = async () => three();
    upcomingResult = async () => [upcoming({ startAt: new Date(Date.now() + 9 * HOUR).toISOString() })];
    const c = await mount(<FlashSale />);
    expect(c.querySelector('[data-testid="flash-next-slot"]')).toBeNull();
    expect(localStorage.getItem(FLASH_HINT_KEY)).toBe('1');
  });

  it('kệ không đợi suất sắp mở: có ngay khi có dữ liệu (HTML đầu vẫn có khối), dòng suất kế vào sau', async () => {
    withStorage(null);
    upcomingResult = () => new Promise(() => undefined);
    mocks.get.mockImplementation((path: string) => (path === '/flash-sales/active' ? Promise.resolve(three()) : upcomingResult()));
    const c = await mount(<FlashSale />);
    expect(c.textContent).toContain('Nước rửa chén');
    expect(c.querySelector('[data-testid="flash-next-slot"]')).toBeNull();
  });

  it('lần trước có dòng suất kế: giữ sẵn chỗ 44px trong lúc suất sắp mở còn đang tải', async () => {
    withStorage('2');
    upcomingResult = () => new Promise(() => undefined);
    mocks.get.mockImplementation((path: string) => (path === '/flash-sales/active' ? Promise.resolve(three()) : upcomingResult()));
    const c = await mount(<FlashSale />);
    const spacer = Array.from(c.querySelectorAll<HTMLElement>('section > div[aria-hidden="true"]')).find((e) => e.style.height === `${FLASH_NEXT_SLOT_HEIGHT}px`);
    expect(spacer).toBeTruthy();
  });

  it('khung chờ khi lần trước có Giờ vàng: cao đúng FLASH_SKELETON_HEIGHT, cộng 44px nếu lần trước có dòng suất kế', async () => {
    withStorage('1');
    activeResult = () => new Promise(() => undefined);
    let c = await mount(<FlashSale />);
    const heightOf = (root: HTMLElement) => (root.querySelector('[data-testid="flash-sale-loading"] > *') as HTMLElement).style.height;
    expect(heightOf(c)).toBe(`${FLASH_SKELETON_HEIGHT}px`);
    mounted!.unmount();
    withStorage('2');
    c = await mount(<FlashSale />);
    expect(heightOf(c)).toBe(`${FLASH_SKELETON_HEIGHT + FLASH_NEXT_SLOT_HEIGHT}px`);
  });
});

describe('UpcomingFlashSales', () => {
  beforeEach(() => {
    mocks.phase = 'authenticated';
  });

  it('khách chưa đăng nhập → không vẽ gì và không gọi API', async () => {
    mocks.phase = 'guest';
    upcomingResult = async () => [upcoming()];
    expect((await mount(<UpcomingFlashSales />)).textContent).toBe('');
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('còn thời gian: "Sau 59 phút" theo luật chữ (không "0h 59m"), ngắn để vừa thẻ 112px, và nút nhắc cao tối thiểu 44px', async () => {
    upcomingResult = async () => [upcoming()];
    const c = await mount(<UpcomingFlashSales />);
    expect(c.querySelector('h2')?.textContent).toContain('Sắp diễn ra');
    expect(c.textContent).toMatch(/Sau (\d+ giờ \d{2} phút|\d+ phút)/);
    expect(c.textContent).not.toMatch(/Bắt đầu sau/);
    expect(c.textContent).not.toMatch(/\d+h \d+m/);
    expect(byText(c, 'button', 'Nhắc tôi')).not.toBeNull();
    expect(smallTouchTargets(c)).toEqual([]);
  });

  it('đã tới giờ bắt đầu: không hiện "Bắt đầu sau 0h 00m", đổi thành "Đang diễn ra" và bỏ nút nhắc', async () => {
    upcomingResult = async () => [upcoming({ startAt: new Date(Date.now() - 1000).toISOString() })];
    const c = await mount(<UpcomingFlashSales />);
    expect(c.textContent).toContain('Đang diễn ra');
    expect(c.textContent).not.toContain('0h 00m');
    expect(byText(c, 'button', 'Nhắc tôi')).toBeNull();
  });

  it('"Nhắc tôi" gọi đúng POST /flash-sales/items/{id}/remind, đổi ngay thành "Đã đặt nhắc"; bấm khi đã nhắc thì DELETE cùng đường dẫn', async () => {
    let reminded = false;
    upcomingResult = async () => [upcoming({ reminded })];
    mocks.post.mockImplementation(async () => {
      reminded = true;
      return {};
    });
    mocks.del.mockImplementation(async () => {
      reminded = false;
      return {};
    });
    const c = await mount(<UpcomingFlashSales />);
    click(byText(c, 'button', 'Nhắc tôi'));
    await flush(8);
    expect(mocks.post).toHaveBeenCalledWith('/flash-sales/items/u1/remind');
    expect(byText(c, 'button', 'Đã đặt nhắc')).not.toBeNull();
    click(byText(c, 'button', 'Đã đặt nhắc'));
    await flush(8);
    expect(mocks.del).toHaveBeenCalledWith('/flash-sales/items/u1/remind');
    expect(byText(c, 'button', 'Nhắc tôi')).not.toBeNull();
  });

  it('đặt nhắc lỗi → hoàn lại nhãn cũ', async () => {
    upcomingResult = async () => [upcoming()];
    mocks.post.mockRejectedValue(new Error('boom'));
    const c = await mount(<UpcomingFlashSales />);
    await act(async () => {
      byText(c, 'button', 'Nhắc tôi')!.click();
    });
    await flush(8);
    expect(byText(c, 'button', 'Nhắc tôi')).not.toBeNull();
  });

  it('chạm thẻ → mở sản phẩm', async () => {
    upcomingResult = async () => [upcoming()];
    const c = await mount(<UpcomingFlashSales />);
    expect(c.querySelector('a[href="/san-pham/dau-goi"]')).not.toBeNull();
  });
});

describe('FlashSale — khổ máy tính', () => {
  it('thẻ giờ vàng rộng cố định --tile-w-sm ở mọi khổ (ít món thì hàng ngắn lại, thẻ không phình), không giãn theo số món', async () => {
    activeResult = async () => three();
    const c = await mount(<FlashSale />);
    const cell = c.querySelector('a[href="/san-pham/nuoc-rua-chen?v=v1"]')!.closest('[style*="--tile-w-sm"]') as HTMLElement;
    expect(cell.style.width).toBe('var(--tile-w-sm)');
    expect(cell.style.flex).toBe('0 0 auto');
  });

  it('thẻ chưa có ảnh dùng ô thay thế hình lá như thẻ sản phẩm', async () => {
    activeResult = async () => three({ thumbnail: null });
    const c = await mount(<FlashSale />);
    expect(c.querySelector('[data-testid="product-image-fallback"]')).not.toBeNull();
  });
});

describe('FlashSale — dữ liệu dựng sẵn từ máy chủ', () => {
  it('có suất trong HTML đầu: vẽ khối ngay ở lần render đầu, không qua khung chờ hay khoảng trống', () => {
    mocks.get.mockReturnValue(new Promise(() => {}));
    const r = render(<FlashSale initial={three()} />);
    mounted = r;
    expect(r.container.querySelector('section')?.textContent).toContain('Nước rửa chén');
    expect(r.container.querySelector('[data-testid="flash-sale-loading"]')).toBeNull();
  });
});
