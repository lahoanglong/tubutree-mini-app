// @vitest-environment jsdom
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

// Chép ý nghĩa new-customer-gift.spec của Mini App (D2-07b): khối "Quà khách mới".
const mocks = vi.hoisted(() => ({ get: vi.fn(), phase: 'authenticated', restoring: false }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get } }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase, useAuthRestoring: () => mocks.restoring }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));

import { HOME_GIFT_HEIGHT } from '@tubutree/app-core/home-layout';
import { HomeRestoreHintContext } from '@/lib/home-restore-context';
import { hintOfSlug } from '@/lib/home-restore-hint';
import { NewCustomerGift } from './new-customer-gift';

// Số cố ý KHÁC mọi mặc định trong mã: nếu khối còn viết cứng 30.000đ/199.000đ/10.000đ/12% thì test đỏ.
const CONFIG = {
  freeshipThreshold: 350_000,
  subscribeDiscountPct: 0.17,
  affiliateWalletMultiplier: 1,
  cashbackHoldDays: 30,
  newCustomer: {
    welcomeVoucher: { amount: 25_000, minOrder: 150_000 },
    firstOrderFreeShip: { enabled: false, minSubtotal: 0 },
  },
  loyalty: { earnPct: 2, vndPerPoint: 50, vndPerPointRedeem: 1_000 },
};
const VOUCHER = { code: 'WELCOME-U1', type: 'AMOUNT' as const, value: 25_000, minOrder: 150_000, endAt: '2026-11-17T10:00:00.000Z' };
const OFFER = { isNewCustomer: true, welcomeVoucher: VOUCHER };

let config: unknown;
let offer: unknown;
const never = () => new Promise(() => undefined);
const failure = () => Promise.reject(new Error('boom'));
const paths = () => mocks.get.mock.calls.map(([p]) => p as string);

let mounted: Rendered | null = null;
const mount = async () => {
  mounted = render(<NewCustomerGift />);
  await flush(8);
  return mounted.container;
};
const region = (c: HTMLElement) => c.querySelector('section[aria-label="Quà khách mới"]');
/** Dải gọn chỉ hiện tóm tắt; chi tiết (mã, hạn, 3 lợi ích) mở bằng "Xem quyền lợi". */
const open = async (c: HTMLElement) => {
  click(region(c)!.querySelector('button[aria-expanded]'));
  await flush(2);
  return region(c)!;
};

beforeEach(() => {
  mocks.phase = 'authenticated';
  mocks.restoring = false;
  config = CONFIG;
  offer = OFFER;
  mocks.get.mockReset().mockImplementation((path: string) => {
    const v = path === '/config/public' ? config : path === '/me/new-customer-offer' ? offer : undefined;
    if (v === undefined) return Promise.reject(new Error(`đường dẫn lạ ${path}`));
    return typeof v === 'function' ? (v as () => Promise<unknown>)() : Promise.resolve(v);
  });
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  delete (window as { matchMedia?: unknown }).matchMedia;
});

describe('NewCustomerGift — khối "Quà khách mới" ở Trang chủ (D2-07b)', () => {
  it('khách chưa có đơn + có voucher: hiện voucher (mức, đơn tối thiểu, hạn) và 3 lợi ích, số đọc từ cấu hình', async () => {
    const text = (await open(await mount())).textContent!;
    expect(text).toContain('Mã giảm giá chào mừng 25.000đ');
    expect(text).toContain('Cho đơn từ 150.000đ');
    expect(text).toContain('Dùng đến 17/11/2026');
    expect(text).toContain('Miễn phí giao hàng cho đơn từ 350.000đ');
    expect(text).toContain('Mỗi đơn tích 2% tiền hàng thành Điểm Xanh, 1 điểm = 1.000đ');
    expect(text).toContain('Đặt định kỳ giảm 17% mỗi đơn');
    expect(text).not.toMatch(/30\.000|199\.000|10\.000đ|12%/);
  });

  it('thu gọn đúng HOME_GIFT_HEIGHT: icon, tiêu đề, câu lợi ích MỘT dòng cắt "…" và nút hành động cùng một hàng cao cố định 64px (không xuống dòng làm dải cao thêm)', async () => {
    const r = region(await mount())!;
    const headline = Array.from(r.querySelectorAll<HTMLElement>('div')).find((d) => d.textContent === 'Mã 25.000đ · cho đơn từ 150.000đ')!;
    const cta = Array.from(r.querySelectorAll('a')).find((a) => a.textContent?.includes('Chọn sản phẩm') || a.textContent?.includes('Nhận'))!;
    expect(headline.style.whiteSpace).toBe('nowrap');
    expect(headline.style.textOverflow).toBe('ellipsis');
    const row = cta.parentElement!;
    expect(row.contains(headline)).toBe(true);
    expect(row.style.height).toBe(`${HOME_GIFT_HEIGHT}px`);
    expect(HOME_GIFT_HEIGHT).toBe(64);
  });

  it('có `fallback`: khách đã đăng nhập không còn ưu đãi khách mới thì vẽ nó (thẻ thành viên) thay vì trả về trống', async () => {
    offer = { isNewCustomer: false, welcomeVoucher: null };
    mounted = render(<NewCustomerGift fallback={<div data-testid="gift-fallback" />} />);
    await flush(8);
    expect(mounted.container.querySelector('[data-testid="gift-fallback"]')).not.toBeNull();
    expect(region(mounted.container)).toBeNull();
  });

  it('dải gọn: tóm tắt mã chào mừng trên một dòng; chi tiết còn gập ở điện thoại (ẩn bằng CSS, vẫn có trong HTML cho khổ rộng)', async () => {
    const root = region(await mount())!;
    expect(root.textContent).toContain('Mã 25.000đ · cho đơn từ 150.000đ');
    const details = root.querySelector<HTMLElement>('[data-testid="new-customer-gift-details"]')!;
    expect(details.className.split(' ')).toEqual(expect.arrayContaining(['hidden', 'lg:block']));
  });

  it('khách vãng lai: từ md chi tiết luôn mở, nút gập chỉ có ở điện thoại (md:hidden), tiêu đề là chữ tĩnh; ba lợi ích xếp 3 cột ở md và 1 cột khi aside chỉ còn 4 cột (lg)', async () => {
    mocks.phase = 'guest';
    const root = region(await mount())!;
    const toggle = root.querySelector<HTMLElement>('button[aria-expanded]')!;
    expect(toggle.parentElement!.className).toBe('md:hidden');
    const staticTitle = Array.from(root.querySelectorAll<HTMLElement>('div.hidden.md\\:flex')).find((d) => d.textContent === 'Quà khách mới');
    expect(staticTitle).toBeDefined();
    const details = root.querySelector<HTMLElement>('[data-testid="new-customer-gift-details"]')!;
    expect(details.className.split(' ')).toEqual(['hidden', 'md:block']);
    const list = root.querySelector<HTMLElement>('ul')!;
    expect(list.className).toContain('md:grid-cols-3');
    expect(list.className).toContain('lg:flex-col');
  });

  // Khách có phiên chỉ thành "khách mới" sau khi phiên và ưu đãi về, khi HTML đầu đã vẽ dải 64px: ở md–lg dải nằm trên mọi khối nên mở sẵn chi tiết
  // (hay khung chờ cao hơn) đẩy cả trang xuống (CLS 0,18 ở 768px). Khách có phiên giữ dải gọn như điện thoại tới lg.
  it('khách đã đăng nhập: dải gọn tới lg (nút gập lg:hidden, chi tiết hidden lg:block), không mở sẵn từ md', async () => {
    const root = region(await mount())!;
    expect(root.querySelector<HTMLElement>('button[aria-expanded]')!.parentElement!.className).toBe('lg:hidden');
    expect(root.querySelector('div.hidden.md\\:flex')).toBeNull();
    expect(Array.from(root.querySelectorAll<HTMLElement>('div.hidden.lg\\:flex')).some((d) => d.textContent === 'Quà khách mới')).toBe(true);
    expect(root.querySelector<HTMLElement>('[data-testid="new-customer-gift-details"]')!.className.split(' ')).toEqual(['hidden', 'lg:block']);
  });

  it('khung chờ: khách vãng lai cao theo bản mở từ md (md:h-64); khách có phiên hay đang khôi phục giữ 64px tới lg (lg:h-64)', async () => {
    const loadingClass = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-testid="new-customer-gift-loading"]')!.className;
    offer = never;
    expect(loadingClass(await mount())).toBe('lg:h-64');
    mounted!.unmount();
    mocks.phase = 'loading';
    mocks.restoring = true;
    expect(loadingClass(await mount())).toBe('lg:h-64');
    mounted!.unmount();
    mocks.phase = 'guest';
    mocks.restoring = false;
    config = never;
    expect(loadingClass(await mount())).toBe('md:h-64');
  });

  // HTML vãng lai (`/`, cookie phiên mất nhưng localStorage còn cờ): sau hydrate mới thấy "đang khôi phục", rồi phiên hỏng về lại vãng lai. Kiểu dải đổi giữa chừng
  // thì khung chờ 64px thay dải đã mở ~200px ở md, cả trang dồn lên rồi lại bị đẩy xuống.
  it('kiểu dải chốt theo lần dựng đầu: vãng lai rồi mới thấy cờ phiên vẫn giữ khung chờ md:h-64 và chi tiết mở từ md', async () => {
    mocks.phase = 'guest';
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // Mỗi lượt một phần tử mới: cùng một phần tử thì React bỏ qua lượt dựng lại.
    const ui = () => <QueryClientProvider client={client}><NewCustomerGift /></QueryClientProvider>;
    mounted = render(<NewCustomerGift />, client);
    await flush(8);
    expect(region(mounted.container)!.querySelector<HTMLElement>('[data-testid="new-customer-gift-details"]')!.className.split(' ')).toEqual(['hidden', 'md:block']);
    mocks.phase = 'loading';
    mocks.restoring = true;
    act(() => mounted!.root.render(ui()));
    await flush(2);
    expect(mounted.container.querySelector<HTMLElement>('[data-testid="new-customer-gift-loading"]')!.className).toBe('md:h-64');
    mocks.phase = 'guest';
    mocks.restoring = false;
    act(() => mounted!.root.render(ui()));
    await flush(2);
    expect(region(mounted.container)!.querySelector<HTMLElement>('[data-testid="new-customer-gift-details"]')!.className.split(' ')).toEqual(['hidden', 'md:block']);
  });

  it('trang dựng sẵn cho khách có cookie phiên mà khôi phục hỏng (về khách vãng lai): vẫn giữ dải gọn tới lg như HTML đầu', async () => {
    mocks.phase = 'guest';
    mounted = render(
      <HomeRestoreHintContext.Provider value={hintOfSlug('unknown')}>
        <NewCustomerGift />
      </HomeRestoreHintContext.Provider>,
    );
    await flush(8);
    const root = region(mounted.container)!;
    expect(root.querySelector<HTMLElement>('button[aria-expanded]')!.parentElement!.className).toBe('lg:hidden');
    expect(root.querySelector<HTMLElement>('[data-testid="new-customer-gift-details"]')!.className.split(' ')).toEqual(['hidden', 'lg:block']);
  });

  // HTML server dựng cả nút gập lẫn chi tiết (lớp md:/lg: chọn phần hiện); trong trình duyệt phần đang ẩn ở khổ hiện tại rời DOM (trần 1.200 nút ở điện thoại).
  it('trình duyệt dưới khổ mở sẵn: không dựng tiêu đề tĩnh và chi tiết chưa mở; bấm nút gập thì chi tiết mới dựng', async () => {
    mocks.phase = 'guest';
    window.matchMedia = ((media: string) => ({ matches: false, media, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia;
    const c = await mount();
    expect(region(c)!.querySelector('[data-testid="new-customer-gift-details"]')).toBeNull();
    expect(region(c)!.querySelector('div.hidden.md\\:flex')).toBeNull();
    const details = (await open(c)).querySelector<HTMLElement>('[data-testid="new-customer-gift-details"]')!;
    expect(details.className).toBe('');
    expect(details.textContent).toContain('Đặt định kỳ giảm 17% mỗi đơn');
  });

  it('trình duyệt từ khổ mở sẵn: không dựng nút gập (đang ẩn), chi tiết và tiêu đề tĩnh có sẵn', async () => {
    mocks.phase = 'guest';
    const queries: string[] = [];
    window.matchMedia = ((media: string) => {
      queries.push(media);
      return { matches: true, media, addEventListener: () => undefined, removeEventListener: () => undefined };
    }) as unknown as typeof window.matchMedia;
    const root = region(await mount())!;
    expect(queries).toContain('(min-width: 768px)');
    expect(root.querySelector('button[aria-expanded]')).toBeNull();
    expect(root.querySelector('[data-testid="new-customer-gift-details"]')).not.toBeNull();
    expect(Array.from(root.querySelectorAll<HTMLElement>('div.hidden.md\\:flex')).some((d) => d.textContent === 'Quà khách mới')).toBe(true);
  });

  it('khách có phiên hỏi điểm gãy lg (dải gọn tới lg), không phải md', async () => {
    const queries: string[] = [];
    window.matchMedia = ((media: string) => {
      queries.push(media);
      return { matches: false, media, addEventListener: () => undefined, removeEventListener: () => undefined };
    }) as unknown as typeof window.matchMedia;
    const root = region(await mount())!;
    expect(new Set(queries)).toEqual(new Set(['(min-width: 1024px)']));
    expect(root.querySelector('button[aria-expanded]')).not.toBeNull();
    expect(root.querySelector('[data-testid="new-customer-gift-details"]')).toBeNull();
  });

  it('mở bằng nút gập ở điện thoại: chi tiết hết lớp hidden', async () => {
    const c = await mount();
    await open(c);
    const details = region(c)!.querySelector<HTMLElement>('[data-testid="new-customer-gift-details"]')!;
    expect(details.className).not.toContain('hidden');
  });

  it('voucher theo phần trăm và miễn phí giao', async () => {
    offer = { isNewCustomer: true, welcomeVoucher: { ...VOUCHER, type: 'PERCENT', value: 15 } };
    expect((await open(await mount())).textContent).toContain('Mã giảm giá chào mừng 15%');
    mounted!.unmount();
    offer = { isNewCustomer: true, welcomeVoucher: { ...VOUCHER, type: 'FREESHIP' } };
    expect((await open(await mount())).textContent).toContain('Mã miễn phí giao hàng chào mừng');
  });

  it('freeship đơn đầu bật → lợi ích giao hàng nói đơn đầu (kèm ngưỡng nếu có), thay cho ngưỡng freeship thường', async () => {
    config = { ...CONFIG, newCustomer: { ...CONFIG.newCustomer, firstOrderFreeShip: { enabled: true, minSubtotal: 0 } } };
    let text = (await open(await mount())).textContent!;
    expect(text).toContain('Miễn phí giao hàng cho đơn đầu tiên');
    expect(text).not.toContain('đơn từ 350.000đ');
    mounted!.unmount();
    config = { ...CONFIG, newCustomer: { ...CONFIG.newCustomer, firstOrderFreeShip: { enabled: true, minSubtotal: 99_000 } } };
    text = (await open(await mount())).textContent!;
    expect(text).toContain('Miễn phí giao hàng cho đơn đầu tiên từ 99.000đ');
  });

  it('voucher không có đơn tối thiểu → không in "Cho đơn từ 0đ"', async () => {
    offer = { isNewCustomer: true, welcomeVoucher: { ...VOUCHER, minOrder: null } };
    const text = (await open(await mount())).textContent!;
    expect(text).toContain('Mã giảm giá chào mừng 25.000đ');
    expect(text).not.toContain('Cho đơn từ');
  });

  it('khách mới nhưng chưa có voucher: chỉ còn 3 lợi ích, không có dòng voucher', async () => {
    offer = { isNewCustomer: true, welcomeVoucher: null };
    const text = (await open(await mount())).textContent!;
    expect(text).not.toContain('Mã giảm giá chào mừng');
    expect(text).toContain('Đặt định kỳ giảm 17% mỗi đơn');
  });

  it('khách đã có đơn (theo API) → không hiện gì', async () => {
    offer = { isNewCustomer: false, welcomeVoucher: null };
    const c = await mount();
    expect(paths()).toContain('/me/new-customer-offer');
    expect(c.textContent).toBe('');
  });

  it('đang tải ưu đãi hoặc cấu hình: giữ chỗ bằng khung chờ cao bằng dải thật, không hiện số', async () => {
    offer = never;
    let c = await mount();
    const loading = c.querySelector<HTMLElement>('[data-testid="new-customer-gift-loading"]');
    expect(loading).not.toBeNull();
    // Lề giữa khối do vỏ khối đặt (home-view): khung chờ có đệm dọc riêng thì cao hơn dải thật, các khối dưới nhảy khi dải thật thay vào.
    expect(loading!.className).not.toMatch(/(^|\s)(p|pt|pb|py)-/);
    expect(loading!.style.padding).toBe('');
    expect(region(c)).toBeNull();
    mounted!.unmount();
    offer = OFFER;
    config = never;
    c = await mount();
    expect(c.querySelector('[data-testid="new-customer-gift-loading"]')).not.toBeNull();
  });

  it('lỗi tải ưu đãi hoặc cấu hình → ẩn khối (khối quảng bá phụ, không đáng một thẻ lỗi), không bịa số', async () => {
    offer = failure;
    expect((await mount()).textContent).toBe('');
    mounted!.unmount();
    offer = OFFER;
    config = failure;
    expect((await mount()).textContent).toBe('');
  });

  it('API cũ chưa trả loyalty/newCustomer → lợi ích thiếu số bị bỏ, không bịa', async () => {
    const { loyalty: _l, newCustomer: _n, ...old } = CONFIG;
    config = old;
    const text = (await open(await mount())).textContent!;
    expect(text).not.toContain('Điểm Xanh');
    expect(text).toContain('Miễn phí giao hàng cho đơn từ 350.000đ');
    expect(text).toContain('Đặt định kỳ giảm 17% mỗi đơn');
  });

  it('chưa đăng nhập: không gọi API khách, hứa mã chào mừng theo cấu hình công khai kèm nút "Nhận quà" dẫn tới /dang-nhap, vẫn hiện 3 lợi ích', async () => {
    mocks.phase = 'guest';
    const c = await mount();
    const link = Array.from(c.querySelectorAll('a')).find((a) => a.textContent === 'Nhận quà')!;
    expect(link.getAttribute('href')).toBe('/dang-nhap');
    expect(link.getAttribute('aria-label')).toBe('Nhận quà bằng Zalo');
    const text = (await open(c)).textContent!;
    expect(text).toContain('Mã giảm giá chào mừng 25.000đ');
    expect(text).toContain('Đăng nhập để nhận mã và giữ điểm');
    expect(text).toContain('Đặt định kỳ giảm 17% mỗi đơn');
    expect(paths()).not.toContain('/me/new-customer-offer');
  });

  it('chưa đăng nhập và cấu hình chưa có mã chào mừng: không hứa số, nút vẫn mở trang mua sắm', async () => {
    mocks.phase = 'guest';
    const { newCustomer: _n, ...noPromise } = CONFIG;
    config = noPromise;
    const c = await mount();
    expect(region(c)!.textContent).not.toContain('Mã ');
    expect(Array.from(c.querySelectorAll('a')).find((a) => a.textContent === 'Chọn sản phẩm')!.getAttribute('href')).toBe('/san-pham');
  });

  it('đang khôi phục phiên: chỉ khung chờ (không hiện bản khách vãng lai rồi biến mất); mất mạng lúc khôi phục: thu lại; đều không gọi API khách', async () => {
    mocks.phase = 'loading';
    mocks.restoring = true;
    let c = await mount();
    expect(c.querySelector('[data-testid="new-customer-gift-loading"]')).not.toBeNull();
    expect(region(c)).toBeNull();
    mounted!.unmount();
    mocks.phase = 'unavailable';
    mocks.restoring = false;
    c = await mount();
    expect(c.textContent).toBe('');
    mounted!.unmount();
    expect(paths()).not.toContain('/me/new-customer-offer');
  });

  it('chưa biết phiên nhưng KHÔNG có cờ phiên (khách vãng lai ở HTML server): vẫn hiện dải quà và 3 lợi ích, không gọi API khách', async () => {
    mocks.phase = 'loading';
    mocks.restoring = false;
    const text = (await open(await mount())).textContent ?? '';
    expect(text).toContain('Đặt định kỳ giảm 17% mỗi đơn');
    expect(paths()).not.toContain('/me/new-customer-offer');
  });

  it('có cấu hình dựng sẵn từ server: vẫn hiện ngay từ bản đó nhưng trình duyệt vẫn tải /config/public (bản ISR có thể cũ)', async () => {
    mocks.phase = 'guest';
    const stale = { ...CONFIG, freeshipThreshold: 100_000 };
    let release: (v: unknown) => void = () => undefined;
    config = () => new Promise((resolve) => (release = resolve));
    mounted = render(<NewCustomerGift initialConfig={stale as never} />);
    await flush(4);
    await open(mounted.container);
    expect(region(mounted.container)?.textContent).toContain('100.000');
    expect(paths()).toContain('/config/public');
    release(CONFIG);
    await flush(8);
    expect(region(mounted.container)?.textContent).toContain('350.000');
  });

  it('nút "Chọn sản phẩm" mở trang mua sắm /san-pham', async () => {
    const c = await mount();
    const link = Array.from(c.querySelectorAll('a')).find((a) => a.textContent === 'Chọn sản phẩm')!;
    expect(link.getAttribute('href')).toBe('/san-pham');
  });
});
