// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';

// Bản web của components/offers/offers-flash.spec.tsx (Mini App): Giờ vàng hôm nay ở Ưu đãi, 4 thẻ, một đồng hồ, giữ chỗ theo gợi ý.
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: vi.fn(), delete: vi.fn() } }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'guest', useAuthRestoring: () => false }));

import { FLASH_HINT_KEY, FLASH_SKELETON_HEIGHT } from '@tubutree/app-core/home-layout';
import { resetFlashSales } from '@/lib/use-flash-sales';
import { OffersFlash } from './offers-flash';

const HOUR = 3_600_000;
const item = (n: number, over: Record<string, unknown> = {}) => ({
  itemId: `i${n}`, variationId: 'v1', productSlug: `p${n}`, productName: `Sản phẩm ${n}`, thumbnail: null,
  retailPrice: 100000, flashPrice: 80000, quota: 10, soldCount: 2, endAt: new Date(Date.now() + HOUR).toISOString(), ...over,
});
const many = (n: number) => Array.from({ length: n }, (_, i) => item(i));

let active: () => Promise<unknown>;
let mounted: Rendered | null = null;
const mount = async () => {
  mounted = render(<OffersFlash />);
  await flush(8);
  return mounted.container;
};

beforeEach(() => {
  resetFlashSales();
  localStorage.clear();
  active = async () => [];
  mocks.get.mockReset().mockImplementation(() => active());
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('OffersFlash (web) — Giờ vàng hôm nay ở trang Ưu đãi', () => {
  it('không có suất nào đang chạy: không vẽ gì', async () => {
    const c = await mount();
    expect(c.innerHTML).toBe('');
  });

  it('6 suất: đúng 4 thẻ (maxItems của kệ offers.flash), một đồng hồ, "Xem tất cả Giờ vàng" tới /gio-vang', async () => {
    active = async () => many(6);
    const c = await mount();
    const region = c.querySelector('section[aria-labelledby]')!;
    expect(region.querySelectorAll('[data-testid="flash-sold-bar"]')).toHaveLength(4);
    expect(region.querySelectorAll('[role="timer"]')).toHaveLength(1);
    expect(region.querySelector('a[aria-label="Xem tất cả Giờ vàng"]')!.getAttribute('href')).toBe('/gio-vang');
  });

  it('một sản phẩm hai phân loại cùng Giờ vàng chỉ một thẻ; suất đã hết giờ không hiện', async () => {
    active = async () => [item(1), item(1, { itemId: 'i1b', variationId: 'v2' }), item(2, { endAt: new Date(Date.now() - 1000).toISOString() })];
    const c = await mount();
    expect(c.querySelectorAll('[data-testid="flash-sold-bar"]')).toHaveLength(1);
  });

  it('lỗi tải: ẩn khối, không báo lỗi (Trang chủ đã có khối lỗi Giờ vàng)', async () => {
    active = async () => {
      throw new Error('boom');
    };
    const c = await mount();
    expect(c.innerHTML).toBe('');
  });

  it('lần mở trước có Giờ vàng: lúc tải giữ chỗ đúng chiều cao khung chờ; chưa nhớ thì im lặng', async () => {
    let release: (v: unknown) => void = () => undefined;
    active = () => new Promise((r) => (release = r));
    localStorage.setItem(FLASH_HINT_KEY, '1');
    mounted = render(<OffersFlash />);
    await flush(2);
    const frame = mounted.container.querySelector<HTMLElement>('[data-testid="flash-sale-loading"]')!;
    expect(frame.firstElementChild).toHaveProperty('style.height', `${FLASH_SKELETON_HEIGHT}px`);
    release([]);
    await flush(6);
    expect(mounted.container.innerHTML).toBe('');
    mounted.unmount();
    resetFlashSales();
    localStorage.clear();
    active = () => new Promise(() => undefined);
    mounted = render(<OffersFlash />);
    await flush(2);
    expect(mounted.container.innerHTML).toBe('');
  });
});
