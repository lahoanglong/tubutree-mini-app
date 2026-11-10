// @vitest-environment jsdom
import { act } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductCard } from '@tubutree/app-core/api/catalog';
import { ApiError } from '@/lib/client-api';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({
  phase: 'authenticated' as string,
  push: vi.fn(),
  get: vi.fn(),
  addAll: vi.fn(),
  getCart: vi.fn(),
  getProductStock: vi.fn(),
  flash: [] as unknown[],
}));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }), usePathname: () => '/san-pham/sp-0' }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: vi.fn() } }));
vi.mock('@/lib/shop-combo', () => ({ addAllToCart: mocks.addAll }));
vi.mock('@/lib/cart-key', () => ({ cartStorefrontSlug: () => null, useCartKey: () => ['cart', null], cartKey: () => ['cart', null] }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: mocks.getCart,
  getProductStock: mocks.getProductStock,
}));
vi.mock('@/lib/use-flash-sales', () => ({
  useActiveFlashSales: () => mocks.flash,
  useRunningFlash: () => ({ flash: (mocks.flash as { endAt?: string }[]).filter((f) => !f.endAt || Date.parse(f.endAt) > Date.now()), now: Date.now() }),
}));

import { PdpSelectionProvider } from '@/components/pdp-selection';
import { PdpFbt } from './pdp-fbt';

const card = (n: number, over: Partial<ProductCard> = {}): ProductCard => ({
  id: `p${n}`, slug: `sp-${n}`, brand: 'Tubu', name: `Món ${n}`, thumbnail: null, basePrice: 50_000, salePrice: null, isFeatured: false, inStock: true, repVariationId: `v${n}`, ...over,
});
const VARIATIONS = [
  { id: 'v0a', retailPrice: 100_000, salePrice: null, stock: 10 },
  { id: 'v0b', retailPrice: 180_000, salePrice: 150_000, stock: 5 },
];
const CART = { items: [], itemCount: 3, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 199_000, couponCode: null };

let mounted: Rendered[] = [];
const mount = async (over: Partial<React.ComponentProps<typeof PdpFbt>> = {}, selected = 'v0a') => {
  const r = render(
    <PdpSelectionProvider initialId={selected}>
      <PdpFbt productId="p0" slug="sp-0" name="Dầu gội bưởi" thumbnail={null} variations={VARIATIONS} initialBoughtTogether={[card(1), card(2), card(3)]} {...over} />
    </PdpSelectionProvider>,
  );
  mounted.push(r);
  await flush(6);
  return r.container;
};
const rows = (c: ParentNode) => Array.from(c.querySelectorAll<HTMLElement>('[data-testid="fbt-row"]'));
const boxes = (c: ParentNode) => Array.from(c.querySelectorAll<HTMLInputElement>('[data-testid="fbt-row"] input[type="checkbox"]'));
const addBtn = (c: ParentNode) => c.querySelector<HTMLButtonElement>('[data-testid="fbt-add"]')!;
const status = (c: ParentNode) => c.querySelector('[data-testid="fbt-status"]')!;

beforeEach(() => {
  mocks.phase = 'authenticated';
  mocks.flash = [];
  mocks.push.mockReset();
  mocks.get.mockReset().mockRejectedValue(new Error('offline'));
  mocks.addAll.mockReset().mockResolvedValue(CART);
  mocks.getCart.mockReset().mockResolvedValue({ items: [] });
  mocks.getProductStock.mockReset().mockRejectedValue(new Error('offline'));
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('PdpFbt (web): hiện và ẩn', () => {
  it('món đang xem (phân loại khách chọn) + 2 món bổ trợ đầu danh sách; mặc định chọn hết; nằm sẵn trong HTML server', async () => {
    const c = await mount();
    expect(rows(c).map((r) => r.dataset.variationId)).toEqual(['v0a', 'v1', 'v2']);
    expect(boxes(c).every((b) => b.checked)).toBe(true);
    expect(addBtn(c).textContent).toBe('Thêm 3 món vào giỏ · 200.000đ');
  });

  it('đổi phân loại ở khối mua: dòng món đang xem theo phân loại mới (giá sale, tiết kiệm), không tải lại bộ', async () => {
    const c = await mount({}, 'v0b');
    expect(rows(c)[0]!.dataset.variationId).toBe('v0b');
    expect(rows(c)[0]!.textContent).toContain('150.000đ');
    expect(c.querySelector('[data-testid="fbt-save"]')?.textContent).toBe('Tiết kiệm 30.000đ');
    expect(addBtn(c).textContent).toBe('Thêm 3 món vào giỏ · 250.000đ');
  });

  it('ẩn hẳn: không còn món bổ trợ (rỗng, hết hàng, món đang xem lặp)', async () => {
    expect((await mount({ initialBoughtTogether: [] })).innerHTML).toBe('');
    expect((await mount({ initialBoughtTogether: [card(1, { inStock: false }), card(0)] })).innerHTML).toBe('');
  });

  it('ẩn hẳn: gian hàng tạm nghỉ, hoặc phân loại đang chọn hết hàng (tồn thật về muộn hơn HTML)', async () => {
    expect((await mount({ blockedReason: 'Gian hàng tạm nghỉ' })).innerHTML).toBe('');
    mocks.getProductStock.mockResolvedValue({ v0a: 0, v0b: 5 });
    expect((await mount()).innerHTML).toBe('');
  });

  it('ẩn hẳn: chưa có phân loại nào được chọn', async () => {
    expect((await mount({}, '')).innerHTML).toBe('');
  });

  it('món bổ trợ đã có trong giỏ lúc giỏ tải xong thì không gợi ý lại', async () => {
    mocks.getCart.mockResolvedValue({ items: [{ productId: 'p1', variationId: 'v1', quantity: 1 }] });
    const c = await mount();
    expect(rows(c).map((r) => r.dataset.variationId)).toEqual(['v0a', 'v2', 'v3']);
  });

  it('khách chưa đăng nhập vẫn thấy khối (không đòi giỏ)', async () => {
    mocks.phase = 'guest';
    const c = await mount();
    expect(rows(c)).toHaveLength(3);
    expect(mocks.getCart).not.toHaveBeenCalled();
  });

  it('Giờ vàng đang chạy của món bổ trợ: ghi giá Giờ vàng và thêm đúng phân loại của suất', async () => {
    mocks.flash = [{ itemId: 'f', productSlug: 'sp-1', variationId: 'v1-flash', flashPrice: 30_000, endAt: new Date(Date.now() + 3_600_000).toISOString() }];
    const c = await mount();
    expect(rows(c)[1]!.dataset.variationId).toBe('v1-flash');
    expect(rows(c)[1]!.textContent).toContain('30.000đ');
  });
});

describe('PdpFbt (web): giá và tên của món đang xem', () => {
  const flashOnCurrent = () => [{ itemId: 'f0', productSlug: 'sp-0', variationId: 'v0a', flashPrice: 70_000, perUserLimit: 1, endAt: new Date(Date.now() + 3_600_000).toISOString() }];

  it('còn suất Giờ vàng (giỏ chưa có món): dòng món đang xem ghi giá Giờ vàng', async () => {
    mocks.flash = flashOnCurrent();
    const c = await mount();
    expect(rows(c)[0]!.textContent).toContain('70.000đ');
    expect(addBtn(c).textContent).toBe('Thêm 3 món vào giỏ · 170.000đ');
  });

  it('giỏ đã đủ suất (giới hạn 1, giỏ có 1): thêm nữa vượt suất nên giỏ tính giá thường, dòng ghi giá thường', async () => {
    mocks.flash = flashOnCurrent();
    mocks.getCart.mockResolvedValue({ items: [{ productId: 'p0', variationId: 'v0a', quantity: 1 }] });
    const c = await mount();
    expect(rows(c)[0]!.textContent).not.toContain('70.000đ');
    expect(addBtn(c).textContent).toBe('Thêm 3 món vào giỏ · 200.000đ');
  });

  it('sản phẩm nhiều phân loại: dòng món đang xem ghi kèm phân loại đang chọn, như Mini App', async () => {
    const named = [
      { id: 'v0a', name: '500ml', retailPrice: 100_000, salePrice: null, stock: 10 },
      { id: 'v0b', name: '1L', retailPrice: 180_000, salePrice: 150_000, stock: 5 },
    ];
    const c = await mount({ variations: named }, 'v0b');
    expect(rows(c)[0]!.textContent).toContain('Dầu gội bưởi · 1L');
  });
});

describe('PdpFbt (web): thêm cả bộ', () => {
  it('thêm các món đã chọn theo một lệnh lô tất cả-hoặc-không, mỗi món một đơn vị; kết quả đọc ở vùng báo "Đã thêm 3 món vào giỏ"', async () => {
    const c = await mount();
    click(addBtn(c));
    await flush(6);
    expect(mocks.addAll).toHaveBeenCalledTimes(1);
    expect(mocks.addAll).toHaveBeenCalledWith([
      { variationId: 'v0a', quantity: 1 },
      { variationId: 'v1', quantity: 1 },
      { variationId: 'v2', quantity: 1 },
    ]);
    expect(status(c).textContent).toContain('Đã thêm 3 món vào giỏ');
  });

  it('bỏ tick một món: chỉ thêm các món còn tick, tổng và nhãn nút đổi theo', async () => {
    const c = await mount();
    click(boxes(c)[1]!);
    await flush(2);
    expect(addBtn(c).textContent).toBe('Thêm 2 món vào giỏ · 150.000đ');
    click(addBtn(c));
    await flush(6);
    expect(mocks.addAll).toHaveBeenCalledWith([
      { variationId: 'v0a', quantity: 1 },
      { variationId: 'v2', quantity: 1 },
    ]);
  });

  it('bỏ tick hết: nút khoá và đổi thành lời mời, bấm không gọi API', async () => {
    const c = await mount();
    for (const b of boxes(c)) click(b);
    await flush(2);
    expect(addBtn(c).textContent).toBe('Chọn món muốn thêm');
    expect(addBtn(c).disabled).toBe(true);
    click(addBtn(c));
    expect(mocks.addAll).not.toHaveBeenCalled();
  });

  it('"Chọn tất cả": ẩn khi chọn hết; bỏ tick một món thì hiện, bấm tick lại cả bộ (nút Thêm về đủ 3 món và tổng) rồi nút ẩn', async () => {
    const c = await mount();
    const selectAll = () => c.querySelector<HTMLButtonElement>('[data-testid="fbt-select-all"]');
    expect(selectAll()).toBeNull();
    click(boxes(c)[1]!);
    await flush(2);
    expect(addBtn(c).textContent).toBe('Thêm 2 món vào giỏ · 150.000đ');
    expect(selectAll()).not.toBeNull();
    click(selectAll()!);
    await flush(2);
    expect(document.activeElement).toBe(addBtn(c));
    expect(boxes(c).map((b) => b.checked)).toEqual([true, true, true]);
    expect(addBtn(c).textContent).toBe('Thêm 3 món vào giỏ · 200.000đ');
    expect(selectAll()).toBeNull();
  });

  it('"Chọn tất cả" sau khi bỏ tick hết: mở khoá nút Thêm và thêm đủ cả bộ', async () => {
    const c = await mount();
    for (const b of boxes(c)) click(b);
    await flush(2);
    expect(addBtn(c).disabled).toBe(true);
    click(c.querySelector<HTMLButtonElement>('[data-testid="fbt-select-all"]')!);
    await flush(2);
    expect(addBtn(c).disabled).toBe(false);
    expect(document.activeElement).toBe(addBtn(c));
    click(addBtn(c));
    await flush(6);
    expect(mocks.addAll).toHaveBeenCalledWith([
      { variationId: 'v0a', quantity: 1 },
      { variationId: 'v1', quantity: 1 },
      { variationId: 'v2', quantity: 1 },
    ]);
  });

  it('bỏ tick món đang xem rồi đổi phân loại: vẫn bỏ tick (khoá riêng theo "món đang xem", không theo mã phân loại)', async () => {
    const c = await mount();
    click(boxes(c)[0]!);
    await flush(2);
    expect(boxes(c).map((b) => b.checked)).toEqual([false, true, true]);
  });

  it('máy chủ từ chối cả lô (hết hàng): hiện đúng lời nghiệp vụ ở vùng báo, nút mở khoá, không nói đã thêm', async () => {
    mocks.addAll.mockRejectedValue(new ApiError('Sản phẩm Món 1 đã hết hàng', 400));
    const c = await mount();
    click(addBtn(c));
    await flush(6);
    expect(status(c).textContent).toContain('Sản phẩm Món 1 đã hết hàng');
    expect(status(c).textContent).not.toContain('Đã thêm');
    expect(addBtn(c).disabled).toBe(false);
  });

  it('lỗi mạng: câu cố định, vì lệnh tất cả-hoặc-không không được nói "chưa rõ đã xong chưa"', async () => {
    mocks.addAll.mockRejectedValue(new ApiError('Network', 503));
    const c = await mount();
    click(addBtn(c));
    await flush(6);
    expect(status(c).textContent).toBe('Chưa thêm được vào giỏ. Bạn thử lại nhé.');
  });

  it('lỗi là role=alert (đọc ngay) nằm trong vùng báo có sẵn; thành công chỉ là role=status, không có alert', async () => {
    mocks.addAll.mockRejectedValueOnce(new ApiError('Sản phẩm Món 1 đã hết hàng', 400));
    const c = await mount();
    const region = status(c);
    click(addBtn(c));
    await flush(6);
    expect(status(c)).toBe(region);
    expect(region.querySelector('[role="alert"]')?.textContent).toContain('Sản phẩm Món 1 đã hết hàng');
    click(addBtn(c));
    await flush(6);
    expect(region.textContent).toContain('Đã thêm 3 món vào giỏ');
    expect(region.querySelector('[role="alert"]')).toBeNull();
  });

  it('bấm "Thêm" hai lần trong cùng một act: chỉ MỘT lệnh lô; nút báo aria-busy, giữ focus, không disabled thật', async () => {
    mocks.addAll.mockImplementation(() => new Promise(() => undefined));
    const c = await mount();
    const btn = addBtn(c);
    btn.focus();
    act(() => {
      btn.click();
      btn.click();
    });
    await flush(2);
    expect(mocks.addAll).toHaveBeenCalledTimes(1);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.disabled).toBe(false);
    expect(document.activeElement).toBe(btn);
  });

  it('khách chưa đăng nhập: sang đăng nhập kèm đường quay lại trang sản phẩm, chưa ghi gì vào giỏ', async () => {
    mocks.phase = 'guest';
    const c = await mount();
    click(addBtn(c));
    await flush(2);
    expect(mocks.push).toHaveBeenCalledWith('/dang-nhap?returnTo=%2Fsan-pham%2Fsp-0');
    expect(mocks.addAll).not.toHaveBeenCalled();
  });

  it('vùng báo luôn có mặt (role=status) kể cả khi chưa có kết quả, để lần đổi chữ sau được đọc ra', async () => {
    const c = await mount();
    expect(status(c).getAttribute('role')).toBe('status');
    expect(status(c).textContent).toBe('');
  });
});

describe('PdpFbt (web): lệnh lô bị máy chủ từ chối vì trạng thái đã đổi (W98B)', () => {
  const setup = async (reload: Promise<void> | null) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries').mockImplementation(() => (reload ?? Promise.resolve()) as Promise<void>);
    const r = render(
      <PdpSelectionProvider initialId="v0a">
        <PdpFbt productId="p0" slug="sp-0" name="Dầu gội bưởi" thumbnail={null} variations={VARIATIONS} initialBoughtTogether={[card(1), card(2), card(3)]} />
      </PdpSelectionProvider>,
      qc,
    );
    mounted.push(r);
    await flush(6);
    const c = r.container;
    invalidate.mockClear();
    return { c, invalidate };
  };
  const keysOf = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map((call) => JSON.stringify((call[0] as { queryKey: unknown }).queryKey));

  it.each([400, 404, 409])('HTTP %i: tải lại danh sách "Khách thường mua cùng" (đúng khoá), giữ khoá tới khi về (chạm lại không gọi API) rồi nhả', async (status) => {
    let release!: () => void;
    const reload = new Promise<void>((r) => (release = r));
    mocks.addAll.mockRejectedValue(new ApiError('Sản phẩm đã hết hàng', status));
    const { c, invalidate } = await setup(reload);
    click(addBtn(c));
    await flush(6);
    expect(keysOf(invalidate)).toEqual([JSON.stringify(['bought-together', 'sp-0'])]);
    expect(mocks.addAll).toHaveBeenCalledTimes(1);
    click(addBtn(c));
    await flush(4);
    expect(mocks.addAll).toHaveBeenCalledTimes(1);
    await act(async () => release());
    await flush(6);
    mocks.addAll.mockResolvedValue({});
    click(addBtn(c));
    await flush(6);
    expect(mocks.addAll).toHaveBeenCalledTimes(2);
  });

  it.each([401, 500, 503])('HTTP %i (lỗi tạm): không tải lại, nhả khoá ngay', async (status) => {
    mocks.addAll.mockRejectedValue(new ApiError('Máy chủ bận', status));
    const { c, invalidate } = await setup(new Promise<void>(() => undefined));
    click(addBtn(c));
    await flush(6);
    expect(invalidate).not.toHaveBeenCalled();
    mocks.addAll.mockResolvedValue({});
    click(addBtn(c));
    await flush(6);
    expect(mocks.addAll).toHaveBeenCalledTimes(2);
  });
});
