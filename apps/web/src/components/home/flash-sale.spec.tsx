// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets } from '@/test-utils/a11y';
import { ApiError } from '@/lib/client-api';

// Chép ý nghĩa flash-sale.spec của Mini App: giờ vàng đang chạy, sắp diễn ra + nhắc, tải lại sau lỗi, giá khớp giá thật.
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), del: vi.fn(), phase: 'guest' }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: mocks.post, delete: mocks.del } }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase }));

import { FlashSale, UpcomingFlashSales } from './flash-sale';

const HOUR = 3_600_000;
const active = (over: Record<string, unknown> = {}) => ({
  itemId: 'i1', variationId: 'v1', productSlug: 'nuoc-rua-chen', productName: 'Nước rửa chén', thumbnail: null,
  retailPrice: 100000, flashPrice: 80000, quota: 10, soldCount: 2, endAt: new Date(Date.now() + HOUR).toISOString(), ...over,
});
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

describe('FlashSale', () => {
  it('không có đợt giờ vàng nào → không vẽ gì', async () => {
    expect((await mount(<FlashSale />)).textContent).toBe('');
  });

  it('tải lỗi → khối có tiêu đề, thông báo và "Thử lại" thay vì biến mất; thử lại thành công hiện đợt giờ vàng', async () => {
    let calls = 0;
    activeResult = async () => {
      if (calls++ === 0) throw new ApiError('Có chút trục trặc, thử lại nhé', 500);
      return [active()];
    };
    const c = await mount(<FlashSale />);
    const region = c.querySelector('section[aria-label="Ưu đãi giờ vàng"]')!;
    expect(region.textContent).toContain('Có chút trục trặc, thử lại nhé');
    click(region.querySelector('button[aria-label="Thử lại Ưu đãi giờ vàng"]'));
    await flush(8);
    expect(c.textContent).toContain('Nước rửa chén');
    expect(c.querySelector('button[aria-label^="Thử lại"]')).toBeNull();
  });

  it('lần tải ĐẦU không vẽ gì (không khung chờ, không khối lỗi) cho tới khi có kết quả', async () => {
    activeResult = () => new Promise(() => undefined);
    expect((await mount(<FlashSale />)).textContent).toBe('');
  });

  it('tiêu đề h2, đồng hồ đếm ngược có tên truy cập, thẻ hiện -% / giá giờ vàng / giá gạch / đã bán và dẫn tới trang sản phẩm', async () => {
    activeResult = async () => [active()];
    const c = await mount(<FlashSale />);
    expect(c.querySelector('h2')?.textContent).toContain('Ưu đãi giờ vàng');
    expect(c.querySelector('[role="timer"]')?.getAttribute('aria-label')).toMatch(/^Còn \d+h \d{2}m$/);
    expect(c.textContent).toContain('-20%');
    expect(c.textContent).toContain('80.000đ');
    expect(c.querySelector('s, del, .line-through')?.textContent).toBe('100.000đ');
    expect(c.textContent).toContain('Đã bán 20%');
    expect(c.querySelector('a[href="/san-pham/nuoc-rua-chen?v=v1"]')).not.toBeNull();
  });

  it('sản phẩm nhiều phân loại: tên thẻ kèm tên phân loại, giống Mini App', async () => {
    activeResult = async () => [active({ variationName: '500g' })];
    const c = await mount(<FlashSale />);
    expect(c.textContent).toContain('Nước rửa chén · 500g');
  });

  it('giá Giờ vàng không rẻ hơn giá đang bán: liên kết không ép mở phân loại Giờ vàng', async () => {
    activeResult = async () => [active({ flashPrice: 100000 })];
    const c = await mount(<FlashSale />);
    expect(c.querySelector('a[href="/san-pham/nuoc-rua-chen"]')).not.toBeNull();
  });

  it('bán quá suất: chữ và thanh "đã bán" cùng dừng ở 100%, không in 150%', async () => {
    activeResult = async () => [active({ soldCount: 15 })];
    const c = await mount(<FlashSale />);
    expect(c.textContent).toContain('Đã bán 100%');
    expect(c.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('100');
  });

  // D7-32: thanh tiến độ cần tên truy cập (axe aria-progressbar-name); D7-29: tên SP cao đúng 2 dòng, không lòi dòng 3.
  it('thanh "đã bán" có tên truy cập; tên sản phẩm cao đúng hai dòng', async () => {
    activeResult = async () => [active({ soldCount: 4 })];
    const c = await mount(<FlashSale />);
    expect(c.querySelector('[role="progressbar"]')?.getAttribute('aria-label')).toBe('Đã bán 40%');
    const name = c.querySelector('p.line-clamp-2')!;
    expect(name.className).toContain('h-8');
    expect(name.className).toContain('leading-4');
    expect(name.className).not.toContain('min-h-');
  });

  it('flashPrice cao hơn giá đang bán → hiện giá đang bán, không nhãn % âm, không gạch giá; có salePrice thì % theo giá đang bán', async () => {
    activeResult = async () => [active({ flashPrice: 90000, retailPrice: 100000, salePrice: 60000 })];
    let c = await mount(<FlashSale />);
    expect(c.textContent).toContain('60.000đ');
    expect(c.textContent).not.toMatch(/-\d+%|-0%/);
    expect(c.querySelector('.line-through')).toBeNull();
    mounted!.unmount();
    activeResult = async () => [active({ flashPrice: 70000, retailPrice: 100000, salePrice: 80000 })];
    c = await mount(<FlashSale />);
    expect(c.textContent).toContain('-13%');
    expect(c.querySelector('.line-through')?.textContent).toBe('80.000đ');
  });

  it('đã quá giờ kết thúc (chờ lần tải lại kế tiếp): ẩn đồng hồ, không hiện "Còn 0h 00m"', async () => {
    activeResult = async () => [active({ endAt: new Date(Date.now() - 1000).toISOString() })];
    const c = await mount(<FlashSale />);
    expect(c.querySelector('[role="timer"]')).toBeNull();
    expect(c.textContent).not.toContain('0h 00m');
  });

  it('đồng hồ tiêu đề chỉ tính các suất còn giờ: suất sớm nhất đã hết giờ thì đếm theo suất kế tiếp', async () => {
    activeResult = async () => [
      active({ itemId: 'a', endAt: new Date(Date.now() - 1000).toISOString() }),
      active({ itemId: 'b', productSlug: 'sp-b', endAt: new Date(Date.now() + 2 * HOUR).toISOString() }),
    ];
    const c = await mount(<FlashSale />);
    expect(c.querySelector('[role="timer"]')?.getAttribute('aria-label')).toMatch(/^Còn 2h 00m$|^Còn 1h 5\dm$/);
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

  it('còn thời gian: "Bắt đầu sau Xh YYm" và nút nhắc cao tối thiểu 44px', async () => {
    upcomingResult = async () => [upcoming()];
    const c = await mount(<UpcomingFlashSales />);
    expect(c.querySelector('h2')?.textContent).toContain('Sắp diễn ra');
    expect(c.textContent).toMatch(/Bắt đầu sau \d+h \d{2}m/);
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
  it('thẻ giờ vàng rộng cố định từ md (ít món thì hàng ngắn lại, thẻ không phình), không giãn theo số món', async () => {
    activeResult = async () => [active()];
    const c = await mount(<FlashSale />);
    const tile = c.querySelector('a[href="/san-pham/nuoc-rua-chen?v=v1"]')!;
    expect(tile.className).toContain('sm:w-44');
    expect(tile.className).toContain('lg:w-48');
    expect(tile.className).not.toContain('md:flex-1');
    expect(tile.parentElement!.className).not.toContain('md:flex-1');
  });

  it('thẻ chưa có ảnh dùng ô thay thế hình lá như thẻ sản phẩm', async () => {
    activeResult = async () => [{ ...active(), thumbnail: null }];
    const c = await mount(<FlashSale />);
    expect(c.querySelector('[data-testid="product-image-fallback"]')).not.toBeNull();
  });
});
