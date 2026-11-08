// @vitest-environment jsdom
import { act, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogPage } from '@tubutree/app-core/api/catalog';
import { click, render, type Rendered } from '@/test-utils/dom';

// Chép ý filter-sheet.spec.tsx (Mini App): nhãn nút áp dụng, nháp lấy từ trạng thái, đếm theo khoá, chống đua mạng,
// chống chạm đúp, aria-busy khi đang đếm (nút KHÔNG bao giờ disabled). Sheet web không dựng khi đóng nên ca "đóng/mở lại"
// đi qua một host có nút bật/tắt riêng (harness không có rerender).

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get } }));

import { ApiError } from '@/lib/client-api';
import { EMPTY_SEARCH_STATE, type FilterDraft, type SearchState } from '@/lib/search-state';
import { FilterSheet, applyLabel } from './filter-sheet';

const BRANDS = [{ brand: 'Tubu', count: 28 }, { brand: 'Mộc An', count: 2 }];
const raw = (total: number) => ({ data: [], meta: { page: 1, limit: 1, total } });
const catalogPage = (total: number, filtersIgnored = false): CatalogPage => ({ ...raw(total), filtersIgnored });

let mounted: Rendered | null = null;

function Host({ initialOpen = true, state = EMPTY_SEARCH_STATE, brands = BRANDS, onApply }: { initialOpen?: boolean; state?: SearchState; brands?: typeof BRANDS; onApply: (d: FilterDraft) => void }) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <>
      <button type="button" data-testid="toggle" onClick={() => setOpen((o) => !o)}>bật tắt</button>
      <FilterSheet open={open} onClose={() => setOpen(false)} state={state} brands={brands} onApply={onApply} />
    </>
  );
}

function mount(props: { initialOpen?: boolean; state?: SearchState; brands?: typeof BRANDS } = {}) {
  const onApply = vi.fn();
  mounted = render(<Host {...props} onApply={onApply} />);
  return { onApply, toggle: () => click(mounted!.container.querySelector('[data-testid="toggle"]')) };
}

const allButtons = () => Array.from(document.body.querySelectorAll<HTMLButtonElement>('button'));
const btn = (text: string) => allButtons().find((b) => b.textContent?.trim() === text) ?? null;
const must = (text: string) => {
  const b = btn(text);
  if (!b) throw new Error(`không thấy nút "${text}"`);
  return b;
};
const applyBtn = () => {
  const b = allButtons().find((x) => /^(Xem|Áp dụng)/.test(x.textContent?.trim() ?? ''));
  if (!b) throw new Error('không thấy nút áp dụng');
  return b;
};
const pressed = (text: string) => must(text).getAttribute('aria-pressed');

async function until(pred: () => boolean, ms = 2000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('hết giờ chờ điều kiện');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
}
const waitForLabel = (text: string) => until(() => btn(text) !== null);
const settle = (ms: number) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

beforeEach(() => {
  mocks.get.mockReset().mockResolvedValue(raw(7));
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('applyLabel', () => {
  it('đang gõ/đếm → "Xem kết quả"; có số → "Xem n sản phẩm"; lỗi hoặc API cũ → "Áp dụng"', () => {
    expect(applyLabel({ settled: false, isError: false })).toBe('Xem kết quả');
    expect(applyLabel({ settled: true, data: catalogPage(1234), isError: false })).toBe('Xem 1.234 sản phẩm');
    expect(applyLabel({ settled: true, isError: true })).toBe('Áp dụng');
    expect(applyLabel({ settled: true, data: catalogPage(9, true), isError: false })).toBe('Áp dụng');
  });

  it('settled nhưng chưa có dữ liệu cũng chưa lỗi (đang tải) → "Xem kết quả"', () => {
    expect(applyLabel({ settled: true, isError: false })).toBe('Xem kết quả');
  });
});

describe('FilterSheet (web)', () => {
  it('mở với nháp lấy từ trạng thái hiện tại (chip đang bật)', async () => {
    mount({ state: { ...EMPTY_SEARCH_STATE, inStock: true, brands: ['Tubu'] } });
    await waitForLabel('Xem 7 sản phẩm');
    expect(pressed('Chỉ hiện còn hàng')).toBe('true');
    expect(pressed('Tubu')).toBe('true');
    expect(pressed('Mộc An')).toBe('false');
  });

  it('chọn giá + còn hàng + từ 4★ + thương hiệu → đếm bằng limit=1 → "Xem n sản phẩm" → onApply(nháp)', async () => {
    const p = mount();
    await waitForLabel('Xem 7 sản phẩm');
    click(must('100k–200k'));
    click(must('Chỉ hiện còn hàng'));
    click(must('Từ 4★ trở lên'));
    click(must('Tubu'));
    mocks.get.mockResolvedValue(raw(3));
    await waitForLabel('Xem 3 sản phẩm');
    expect(mocks.get).toHaveBeenLastCalledWith('/products', {
      query: expect.objectContaining({ page: 1, limit: 1, minPrice: 100000, maxPrice: 200000, inStock: 'true', minRating: 4, brand: 'Tubu' }),
    });
    click(applyBtn());
    expect(p.onApply).toHaveBeenCalledWith({ brands: ['Tubu'], minPrice: 100000, maxPrice: 200000, inStock: true, minRating: 4 });
  });

  it('chạm lại khoảng giá đang chọn → bỏ chọn', async () => {
    mount({ state: { ...EMPTY_SEARCH_STATE, maxPrice: 100000 } });
    await waitForLabel('Xem 7 sản phẩm');
    expect(pressed('Dưới 100k')).toBe('true');
    click(must('Dưới 100k'));
    expect(pressed('Dưới 100k')).toBe('false');
  });

  it('khoảng giá tuỳ ý từ URL (không trùng khoảng định sẵn) vẫn hiện thành chip đang chọn và bỏ chọn được', async () => {
    const p = mount({ state: { ...EMPTY_SEARCH_STATE, minPrice: 120000, maxPrice: 340000 } });
    await waitForLabel('Xem 7 sản phẩm');
    expect(pressed('120k–340k')).toBe('true');
    click(must('120k–340k'));
    expect(btn('120k–340k')).toBeNull();
    mocks.get.mockResolvedValue(raw(5));
    await waitForLabel('Xem 5 sản phẩm');
    click(applyBtn());
    expect(p.onApply).toHaveBeenCalledWith({ brands: [], minPrice: undefined, maxPrice: undefined, inStock: false, minRating: undefined });
  });

  it('"Xoá bộ lọc" đưa nháp về rỗng (sheet vẫn mở)', async () => {
    mount({ state: { ...EMPTY_SEARCH_STATE, inStock: true, minRating: 4, minPrice: 100000, maxPrice: 200000, brands: ['Tubu'] } });
    await waitForLabel('Xem 7 sản phẩm');
    click(must('Xoá bộ lọc'));
    expect(pressed('Chỉ hiện còn hàng')).toBe('false');
    expect(pressed('Từ 4★ trở lên')).toBe('false');
    expect(pressed('100k–200k')).toBe('false');
    expect(pressed('Tubu')).toBe('false');
  });

  it('đóng không áp dụng rồi mở lại → nháp chưa áp dụng bị bỏ, lấy lại từ trạng thái NGAY khung hình đầu', async () => {
    const p = mount();
    await waitForLabel('Xem 7 sản phẩm');
    click(must('Chỉ hiện còn hàng'));
    expect(pressed('Chỉ hiện còn hàng')).toBe('true');
    p.toggle();
    expect(btn('Chỉ hiện còn hàng')).toBeNull();
    p.toggle();
    // Đồng bộ, không chờ: không có khung hình nào còn nháp cũ.
    expect(pressed('Chỉ hiện còn hàng')).toBe('false');
  });

  it('API cũ (filtersIgnored) → nút "Áp dụng", không hiện số sai', async () => {
    mocks.get.mockImplementation(async (_path: string, o: { query: Record<string, unknown> }) => {
      if ('inStock' in o.query) throw new ApiError('Bad Request', 400);
      return raw(30);
    });
    mount({ state: { ...EMPTY_SEARCH_STATE, inStock: true } });
    await waitForLabel('Áp dụng');
    expect(allButtons().some((b) => /^Xem \d/.test(b.textContent ?? ''))).toBe(false);
  });

  it('đếm lỗi → nút "Áp dụng" và vẫn bấm được', async () => {
    mocks.get.mockRejectedValue(new ApiError('boom', 500));
    const p = mount({ state: { ...EMPTY_SEARCH_STATE, inStock: true } });
    await waitForLabel('Áp dụng');
    const apply = applyBtn();
    expect(apply.disabled).toBe(false);
    click(apply);
    expect(p.onApply).toHaveBeenCalledTimes(1);
  });

  it('sửa nháp → nút về "Xem kết quả" ngay (không giữ số cũ), rồi hiện số của nháp MỚI, không phải của nháp cũ', async () => {
    let resolveSlow: (v: ReturnType<typeof raw>) => void = () => undefined;
    mocks.get.mockImplementation((_path: string, o: { query: Record<string, unknown> }) =>
      o.query.inStock ? new Promise((r) => { resolveSlow = r; }) : Promise.resolve(raw(7)),
    );
    mount();
    await waitForLabel('Xem 7 sản phẩm');

    // Nháp A (còn hàng) — trả lời CHẬM.
    click(must('Chỉ hiện còn hàng'));
    expect(btn('Xem kết quả')).not.toBeNull();
    await until(() => mocks.get.mock.calls.some((c) => (c[1] as { query: Record<string, unknown> }).query.inStock === 'true'));

    // Nháp B (bỏ còn hàng) quay về khoá cũ đã có cache → số 7; rồi trả lời trễ của A không ghi đè.
    click(must('Chỉ hiện còn hàng'));
    await waitForLabel('Xem 7 sản phẩm');
    resolveSlow(raw(999));
    await settle(50);
    expect(btn('Xem 7 sản phẩm')).not.toBeNull();
    expect(allButtons().some((b) => /999/.test(b.textContent ?? ''))).toBe(false);
  });

  describe('aria-busy của nút áp dụng (nút không bao giờ disabled)', () => {
    it('đang tải số đếm lần đầu (khoá đã ổn định, chưa có dữ liệu) → aria-busy="true"; có số thì gỡ', async () => {
      let resolveCount: (v: ReturnType<typeof raw>) => void = () => undefined;
      mocks.get.mockImplementation(() => new Promise((r) => { resolveCount = r; }));
      mount();
      const loading = must('Xem kết quả');
      expect(loading.getAttribute('aria-busy')).toBe('true');
      expect(loading.disabled).toBe(false);
      expect(loading.hasAttribute('aria-disabled')).toBe(false);
      await act(async () => resolveCount(raw(4)));
      await waitForLabel('Xem 4 sản phẩm');
      expect(applyBtn().hasAttribute('aria-busy')).toBe(false);
    });

    it('sửa nháp: khoá chưa ổn định (đang chờ debounce) → aria-busy="true" dù đang có số cũ; số mới về thì gỡ', async () => {
      mount();
      await waitForLabel('Xem 7 sản phẩm');
      expect(applyBtn().hasAttribute('aria-busy')).toBe(false);
      mocks.get.mockResolvedValue(raw(3));
      click(must('Chỉ hiện còn hàng'));
      const waiting = must('Xem kết quả');
      expect(waiting.getAttribute('aria-busy')).toBe('true');
      expect(waiting.disabled).toBe(false);
      expect(waiting.hasAttribute('aria-disabled')).toBe(false);
      await waitForLabel('Xem 3 sản phẩm');
      expect(applyBtn().hasAttribute('aria-busy')).toBe(false);
    });

    it('đếm lỗi → "Áp dụng" không còn báo bận', async () => {
      mocks.get.mockRejectedValue(new ApiError('boom', 500));
      mount({ state: { ...EMPTY_SEARCH_STATE, inStock: true } });
      await waitForLabel('Áp dụng');
      expect(applyBtn().hasAttribute('aria-busy')).toBe(false);
    });
  });

  it('chạm đúp nút áp dụng → onApply chỉ một lần; sửa nháp rồi áp dụng lại thì gửi tiếp', async () => {
    const p = mount();
    await waitForLabel('Xem 7 sản phẩm');
    const apply = applyBtn();
    click(apply);
    click(apply);
    expect(p.onApply).toHaveBeenCalledTimes(1);
    click(must('Chỉ hiện còn hàng'));
    click(applyBtn());
    expect(p.onApply).toHaveBeenCalledTimes(2);
    expect(p.onApply).toHaveBeenLastCalledWith(expect.objectContaining({ inStock: true }));
  });

  it('đóng rồi mở lại sau khi đã áp dụng → nháp mới áp dụng được lần nữa (chống chạm đúp được đặt lại)', async () => {
    const p = mount();
    await waitForLabel('Xem 7 sản phẩm');
    click(applyBtn());
    expect(p.onApply).toHaveBeenCalledTimes(1);
    p.toggle();
    p.toggle();
    await waitForLabel('Xem 7 sản phẩm');
    click(applyBtn());
    expect(p.onApply).toHaveBeenCalledTimes(2);
  });

  it('đóng → không gọi đếm', async () => {
    mount({ initialOpen: false });
    // Đủ thời gian để debounce 250ms (nếu có lỗi bật query lúc đóng) kịp chạy.
    await settle(400);
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('danh sách thương hiệu dài nằm trong khung cuộn riêng (không đẩy nút áp dụng ra ngoài màn hình)', async () => {
    mount();
    await waitForLabel('Xem 7 sản phẩm');
    const group = document.body.querySelector('[role="group"][aria-label="Thương hiệu"]')!;
    const scroller = group.querySelector<HTMLElement>('[data-testid="filter-brand-scroll"]');
    expect(scroller).not.toBeNull();
    expect(scroller!.className).toContain('overflow-y-auto');
    expect(scroller!.className).toContain('max-h-[30vh]');
  });

  it('không có thương hiệu → không hiện nhóm Thương hiệu', async () => {
    mount({ brands: [] });
    await waitForLabel('Xem 7 sản phẩm');
    expect(document.body.querySelector('[role="group"][aria-label="Khoảng giá"]')).not.toBeNull();
    expect(document.body.querySelector('[role="group"][aria-label="Thương hiệu"]')).toBeNull();
  });
});
