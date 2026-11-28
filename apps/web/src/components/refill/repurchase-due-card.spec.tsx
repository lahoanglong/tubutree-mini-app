// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { click, flush, remount, render, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';
import { ApiError } from '@/lib/client-api';
import { REPURCHASE_DUE_DISMISS_STORAGE_KEY, resetRepurchaseDueMemoryForTest } from '@tubutree/app-core/refill/repurchase-due-card';

// Thẻ Mua lại hàng tiêu hao (web, w36-01): cùng chữ, cùng luật ẩn với Mini components/refill/repurchase-due-card.
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), track: vi.fn(), feedback: vi.fn(), phase: 'authenticated' }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: mocks.post } }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('@/lib/analytics', () => ({ trackWebEvent: mocks.track }));
vi.mock('@/lib/cart-feedback', () => ({ playCartFeedback: mocks.feedback }));

import RepurchaseDueCard from './repurchase-due-card';

const item = {
  key: 'o1:v-refill',
  days: 31,
  boughtName: 'Nước rửa chén Fuwa3e 500ml',
  kind: 'refill',
  variationId: 'v-refill',
  productId: 'p-refill',
  slug: 'refill-fuwa3e-1l',
  productName: 'Túi Refill nước rửa chén Fuwa3e 1L',
  variationName: '',
  thumbnail: null,
  price: 89_000,
  listPrice: 99_000,
};

let mounted: Rendered[] = [];
const scanOffer = {
  productId: 'p-scan',
  slug: 'refill-scan-2l',
  name: 'Túi Refill nước rửa chén 2L',
  thumbnail: null,
  variationId: 'v-scan',
  price: 120_000,
  compareAt: null,
  sizeLabel: '2L',
  inStock: true,
  tubu: true,
};
const landingDto = {
  enabled: true,
  pairs: [{ bottle: { productId: 'b-scan', slug: 'chai-scan', name: 'Nước rửa chén 500ml', thumbnail: null, price: 68_000, compareAt: null, sizeLabel: '500ml', inStock: true }, refill: scanOffer, savingPct: 20 }],
};
const scanOnly = (days: number) =>
  mocks.get.mockImplementation(async (path: string) => {
    if (path === '/me/repurchase-due') return { item: null, scanDays: days };
    if (path === '/catalog/refill-pairs/landing') return landingDto;
    return null;
  });
const mount = async (surface: 'account' | 'cart_empty' | 'refill_landing' = 'account') => {
  const r = render(<RepurchaseDueCard surface={surface} />);
  mounted.push(r);
  await flush(4);
  return r.container;
};
const card = (c: Element) => c.querySelector('[data-testid="repurchase-due-card"]');
const notice = (c: Element) => c.querySelector('[data-testid="repurchase-due-notice"]');
const buttonNamed = (c: Element, name: string) =>
  [...c.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? b.textContent?.trim()) === name) as HTMLButtonElement | undefined;
const ADD = 'Thêm vào giỏ · 89.000đ';

beforeEach(() => {
  window.localStorage.clear();
  resetRepurchaseDueMemoryForTest();
  mocks.phase = 'authenticated';
  mocks.track.mockReset();
  mocks.feedback.mockReset();
  mocks.get.mockReset().mockImplementation(async (path: string) => (path === '/me/repurchase-due' ? { item } : null));
  mocks.post.mockReset().mockResolvedValue({ items: [{ id: 'ci1' }] });
});
afterEach(() => {
  mounted.forEach((r) => r.unmount());
  mounted = [];
});

describe('RepurchaseDueCard (web)', () => {
  it('có món: vùng "Gợi ý mua lại", tiêu đề, thân gói Refill, MỘT nút kèm giá và × có nhãn, chạm 44px; ghi view một lần', async () => {
    const c = await mount();
    const region = card(c)!;
    expect(region.getAttribute('aria-label')).toBe('Gợi ý mua lại');
    expect(region.textContent).toContain('Đã 31 ngày từ khi bạn nhận Nước rửa chén Fuwa3e 500ml');
    expect(region.textContent).toContain('Châm lại bằng Túi Refill nước rửa chén Fuwa3e 1L, tiết kiệm hơn và bớt một chai nhựa.');
    expect(buttonNamed(c, ADD)).toBeTruthy();
    expect(buttonNamed(c, 'Ẩn gợi ý này')).toBeTruthy();
    expect(region.querySelectorAll('button')).toHaveLength(2);
    expect(unnamedControls(c)).toEqual([]);
    expect(smallTouchTargets(c)).toEqual([]);
    expect(mocks.track.mock.calls.filter((x) => x[0] === 'repurchase_due_view')).toEqual([['repurchase_due_view', { surface: 'account', variationId: 'v-refill' }]]);
  });

  it('thêm một chạm: POST /cart/items đúng phân loại, SL 1, nguồn repurchase_due; chạm đúp một lệnh; xong ghi add, thẻ biến mất, báo "Đã thêm" kèm "Xem giỏ"', async () => {
    let resolve!: (v: unknown) => void;
    mocks.post.mockImplementation(() => new Promise((r) => (resolve = r)));
    const c = await mount();
    const add = buttonNamed(c, ADD)!;
    await act(async () => {
      add.click();
      add.click();
    });
    await flush(1);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post.mock.calls[0]![0]).toBe('/cart/items');
    expect(mocks.post.mock.calls[0]![1]).toEqual({ variationId: 'v-refill', quantity: 1, addSource: 'repurchase_due' });
    await act(async () => resolve({ items: [{ id: 'ci1' }] }));
    await flush(2);
    expect(mocks.track).toHaveBeenCalledWith('repurchase_due_add', { surface: 'account', variationId: 'v-refill' });
    expect(card(c)).toBeNull();
    const n = notice(c)!;
    expect(n.closest('[role="status"]')).not.toBeNull();
    expect(n.textContent).toContain('Đã thêm');
    expect(n.querySelector('a')?.getAttribute('href')).toBe('/gio-hang');
    expect(n.querySelector('a')?.textContent).toBe('Xem giỏ');
  });

  it('thêm xong rời màn rồi quay lại trong 5 phút (cùng bộ nhớ đệm): thẻ không mời lại món vừa thêm', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const r = render(<RepurchaseDueCard surface="account" />, client);
    mounted.push(r);
    await flush(4);
    click(buttonNamed(r.container, ADD)!);
    await flush(3);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    remount(r, <RepurchaseDueCard surface="account" />, client);
    await flush(4);
    expect(card(r.container)).toBeNull();
    expect(buttonNamed(r.container, ADD)).toBeUndefined();
  });

  it('ở giỏ trống: báo "Đã thêm" không kèm lối "Xem giỏ"', async () => {
    const c = await mount('cart_empty');
    click(buttonNamed(c, ADD)!);
    await flush(3);
    expect(notice(c)?.textContent).toBe('Đã thêm');
    expect(notice(c)?.querySelector('a')).toBeNull();
  });

  it('máy chủ từ chối (hết hàng): lời lỗi role=alert, không ghi add, tải lại thẻ, thẻ còn', async () => {
    mocks.post.mockRejectedValueOnce(new ApiError('Sản phẩm đã hết hàng', 409));
    const c = await mount();
    const gets = mocks.get.mock.calls.length;
    click(buttonNamed(c, ADD)!);
    await flush(4);
    expect(notice(c)?.getAttribute('role')).toBe('alert');
    expect(notice(c)?.textContent).toContain('hết hàng');
    expect(mocks.track).not.toHaveBeenCalledWith('repurchase_due_add', expect.anything());
    expect(mocks.get.mock.calls.length).toBeGreaterThan(gets);
    expect(card(c)).not.toBeNull();
  });

  it('× ẩn thẻ, ghi dismiss với surface, nhớ khoá orderId:variationId: mở lại vẫn ẩn', async () => {
    const c = await mount('cart_empty');
    click(buttonNamed(c, 'Ẩn gợi ý này')!);
    await flush(1);
    expect(card(c)).toBeNull();
    expect(mocks.track).toHaveBeenCalledWith('repurchase_due_dismiss', { surface: 'cart_empty', variationId: 'v-refill' });
    expect(Object.keys(JSON.parse(window.localStorage.getItem(REPURCHASE_DUE_DISMISS_STORAGE_KEY)!))).toEqual(['o1:v-refill']);
    resetRepurchaseDueMemoryForTest();
    expect(card(await mount())).toBeNull();
  });

  it('khách chưa đăng nhập: không gọi API, không vẽ (kể cả vùng báo); cờ tắt (item null): không vẽ', async () => {
    mocks.phase = 'guest';
    expect((await mount()).innerHTML).toBe('');
    expect(mocks.get).not.toHaveBeenCalled();
    mocks.phase = 'authenticated';
    mocks.get.mockResolvedValueOnce({ item: null });
    expect((await mount()).innerHTML).toBe('');
  });

  describe('w55-01: "Sắp hết hàng? Đặt lại 1 chạm"', () => {
    it('giỏ trống và trang Refill nói tiêu đề ngắn + câu theo số ngày; Tài khoản giữ chữ w36-01', async () => {
      const cart = card(await mount('cart_empty'))!;
      expect(cart.textContent).toContain('Sắp hết hàng? Đặt lại 1 chạm');
      expect(cart.textContent).toContain('Nước rửa chén Fuwa3e 500ml đã 31 ngày. Châm lại bằng Túi Refill nước rửa chén Fuwa3e 1L.');
      expect(cart.querySelectorAll('button')).toHaveLength(2);
      const landing = card(await mount('refill_landing'))!;
      expect(landing.textContent).toContain('Sắp hết hàng? Đặt lại 1 chạm');
      const account = card(await mount('account'))!;
      expect(account.textContent).toContain('Đã 31 ngày từ khi bạn nhận Nước rửa chén Fuwa3e 500ml');
    });

    it('trang Refill: thẻ không thêm lề trang lần hai, báo "Đã thêm" có lối "Xem giỏ", ghi surface refill_landing', async () => {
      const c = await mount('refill_landing');
      const region = card(c)!;
      expect(region.className).not.toContain('px-4');
      expect(region.className).not.toContain('pt-3');
      expect((region as HTMLElement).style.marginTop).toBe('var(--space-stack-md)');
      await act(async () => buttonNamed(c, ADD)!.click());
      await flush(2);
      expect(mocks.track).toHaveBeenCalledWith('repurchase_due_add', { surface: 'refill_landing', variationId: 'v-refill' });
      expect(notice(c)!.querySelector('a')?.getAttribute('href')).toBe('/gio-hang');
    });

    it('giỏ trống, chỉ có đơn sàn đã quét (scanDays): ghép gói Refill đầu trang Tiết kiệm, thêm một chạm đúng nguồn repurchase_due', async () => {
      scanOnly(24);
      const c = await mount('cart_empty');
      expect(card(c)!.textContent).toContain('Đơn sàn của bạn giao 24 ngày trước. Châm lại bằng Túi Refill nước rửa chén 2L.');
      await act(async () => buttonNamed(c, 'Thêm vào giỏ · 120.000đ')!.click());
      await flush(2);
      expect(mocks.post.mock.calls[0]![1]).toEqual({ variationId: 'v-scan', quantity: 1, addSource: 'repurchase_due' });
      expect(mocks.track).toHaveBeenCalledWith('repurchase_due_view', { surface: 'cart_empty', variationId: 'v-scan' });
      expect(notice(c)!.querySelector('a')).toBeNull();
    });

    it('mốc đơn sàn chỉ dùng ở giỏ trống: Tài khoản và trang Refill không vẽ, cũng không tải trang Refill', async () => {
      scanOnly(24);
      expect((await mount('account')).innerHTML).toBe('');
      expect((await mount('refill_landing')).innerHTML).toBe('');
      expect(mocks.get.mock.calls.some(([p]) => p === '/catalog/refill-pairs/landing')).toBe(false);
    });

    it('có món theo đơn trực tiếp thì không tải trang Refill dù có scanDays', async () => {
      mocks.get.mockImplementation(async (path: string) => (path === '/me/repurchase-due' ? { item, scanDays: 24 } : null));
      expect(card(await mount('cart_empty'))).not.toBeNull();
      expect(mocks.get.mock.calls.some(([p]) => p === '/catalog/refill-pairs/landing')).toBe(false);
    });
  });
});
