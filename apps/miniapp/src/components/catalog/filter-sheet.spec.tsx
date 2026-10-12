import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchCatalog: vi.fn() }));
vi.mock('../../services/shop-api', () => ({ fetchCatalog: mocks.fetchCatalog }));

import { EMPTY_SEARCH_STATE, type SearchState } from '../../utils/search-state';
import { FilterSheet, applyLabel } from './filter-sheet';

const BRANDS = [{ brand: 'Tubu', count: 28 }, { brand: 'Mộc An', count: 2 }];
const page = (total: number, filtersIgnored = false) => ({ data: [], meta: { page: 1, limit: 1, total }, filtersIgnored });

function renderSheet(props: { open: boolean; state?: SearchState; onApply?: () => void; onClose?: () => void }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const all = { state: EMPTY_SEARCH_STATE, onApply: vi.fn(), onClose: vi.fn(), brands: BRANDS, ...props };
  const ui = (p: typeof all) => (
    <QueryClientProvider client={qc}>
      <FilterSheet open={p.open} onClose={p.onClose} state={p.state} brands={p.brands} onApply={p.onApply} />
    </QueryClientProvider>
  );
  const r = render(ui(all));
  return { ...all, rerender: (p: Partial<typeof all>) => r.rerender(ui({ ...all, ...p })) };
}

describe('applyLabel', () => {
  it('đang gõ/đếm → "Xem kết quả"; có số → "Xem n sản phẩm"; lỗi hoặc API cũ → "Áp dụng"', () => {
    expect(applyLabel({ settled: false, isError: false })).toBe('Xem kết quả');
    expect(applyLabel({ settled: true, data: page(1234), isError: false })).toBe('Xem 1.234 sản phẩm');
    expect(applyLabel({ settled: true, isError: true })).toBe('Áp dụng');
    expect(applyLabel({ settled: true, data: page(9, true), isError: false })).toBe('Áp dụng');
  });

  it('settled nhưng chưa có dữ liệu cũng chưa lỗi (đang tải) → "Xem kết quả"', () => {
    expect(applyLabel({ settled: true, isError: false })).toBe('Xem kết quả');
  });
});

describe('FilterSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchCatalog.mockResolvedValue(page(7));
  });

  it('mở với nháp lấy từ trạng thái hiện tại (chip đang bật)', async () => {
    renderSheet({ open: true, state: { ...EMPTY_SEARCH_STATE, inStock: true, brands: ['Tubu'] } });
    expect(await screen.findByRole('button', { name: 'Chỉ hiện còn hàng' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Tubu' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Mộc An' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('chọn giá + còn hàng + từ 4★ + thương hiệu → đếm bằng limit=1 → "Xem n sản phẩm" → onApply(nháp)', async () => {
    const p = renderSheet({ open: true });
    fireEvent.click(await screen.findByRole('button', { name: '100k–200k' }));
    fireEvent.click(screen.getByRole('button', { name: 'Chỉ hiện còn hàng' }));
    fireEvent.click(screen.getByRole('button', { name: 'Từ 4★ trở lên' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tubu' }));
    mocks.fetchCatalog.mockResolvedValue(page(3));
    const apply = await screen.findByRole('button', { name: 'Xem 3 sản phẩm' }, { timeout: 2000 });
    expect(mocks.fetchCatalog).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, limit: 1, minPrice: 100000, maxPrice: 200000, inStock: true, minRating: 4, brand: 'Tubu' }),
    );
    fireEvent.click(apply);
    expect(p.onApply).toHaveBeenCalledWith({ brands: ['Tubu'], minPrice: 100000, maxPrice: 200000, inStock: true, minRating: 4 });
  });

  it('chạm lại khoảng giá đang chọn → bỏ chọn', async () => {
    renderSheet({ open: true, state: { ...EMPTY_SEARCH_STATE, maxPrice: 100000 } });
    const chip = await screen.findByRole('button', { name: 'Dưới 100k' });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'false');
  });

  it('khoảng giá tuỳ ý từ URL (không trùng khoảng định sẵn) vẫn hiện thành chip đang chọn và bỏ chọn được', async () => {
    const p = renderSheet({ open: true, state: { ...EMPTY_SEARCH_STATE, minPrice: 120000, maxPrice: 340000 } });
    const chip = await screen.findByRole('button', { name: '120k–340k' });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(chip);
    expect(screen.queryByRole('button', { name: '120k–340k' })).not.toBeInTheDocument();
    mocks.fetchCatalog.mockResolvedValue(page(5));
    fireEvent.click(await screen.findByRole('button', { name: 'Xem 5 sản phẩm' }, { timeout: 2000 }));
    expect(p.onApply).toHaveBeenCalledWith({ brands: [], minPrice: undefined, maxPrice: undefined, inStock: false, minRating: undefined });
  });

  it('"Xoá bộ lọc" đưa nháp về rỗng (sheet vẫn mở)', async () => {
    renderSheet({ open: true, state: { ...EMPTY_SEARCH_STATE, inStock: true, minRating: 4, minPrice: 100000, maxPrice: 200000, brands: ['Tubu'] } });
    fireEvent.click(await screen.findByRole('button', { name: 'Xoá bộ lọc' }));
    expect(screen.getByRole('button', { name: 'Chỉ hiện còn hàng' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Từ 4★ trở lên' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: '100k–200k' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Tubu' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('đóng không áp dụng rồi mở lại → nháp chưa áp dụng bị bỏ, lấy lại từ trạng thái NGAY khung hình đầu', async () => {
    const p = renderSheet({ open: true });
    fireEvent.click(await screen.findByRole('button', { name: 'Chỉ hiện còn hàng' }));
    expect(screen.getByRole('button', { name: 'Chỉ hiện còn hàng' })).toHaveAttribute('aria-pressed', 'true');
    p.rerender({ open: false });
    // Đang trượt xuống: nội dung vẫn còn nguyên (không trống).
    expect(screen.getByRole('button', { name: 'Chỉ hiện còn hàng' })).toBeInTheDocument();
    p.rerender({ open: true });
    // Đồng bộ, không waitFor: không có khung hình nào còn nháp cũ.
    expect(screen.getByRole('button', { name: 'Chỉ hiện còn hàng' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('API cũ (filtersIgnored) → nút "Áp dụng", không hiện số sai', async () => {
    mocks.fetchCatalog.mockResolvedValue(page(30, true));
    renderSheet({ open: true, state: { ...EMPTY_SEARCH_STATE, inStock: true } });
    expect(await screen.findByRole('button', { name: 'Áp dụng' }, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Xem \d/ })).not.toBeInTheDocument();
  });

  it('đếm lỗi → nút "Áp dụng" và vẫn bấm được', async () => {
    mocks.fetchCatalog.mockRejectedValue(new Error('boom'));
    const p = renderSheet({ open: true, state: { ...EMPTY_SEARCH_STATE, inStock: true } });
    const apply = await screen.findByRole('button', { name: 'Áp dụng' }, { timeout: 2000 });
    expect(apply).not.toBeDisabled();
    fireEvent.click(apply);
    expect(p.onApply).toHaveBeenCalledTimes(1);
  });

  it('sửa nháp → nút về "Xem kết quả" ngay (không giữ số cũ), rồi hiện số của nháp MỚI, không phải của nháp cũ', async () => {
    let resolveSlow: (v: ReturnType<typeof page>) => void = () => undefined;
    mocks.fetchCatalog.mockImplementation((q: { inStock?: boolean }) =>
      q.inStock ? new Promise((r) => { resolveSlow = r; }) : Promise.resolve(page(7)),
    );
    renderSheet({ open: true });
    expect(await screen.findByRole('button', { name: 'Xem 7 sản phẩm' }, { timeout: 2000 })).toBeInTheDocument();

    // Nháp A (còn hàng) — trả lời CHẬM.
    fireEvent.click(screen.getByRole('button', { name: 'Chỉ hiện còn hàng' }));
    expect(screen.getByRole('button', { name: 'Xem kết quả' })).toBeInTheDocument();
    await waitFor(() => expect(mocks.fetchCatalog).toHaveBeenCalledWith(expect.objectContaining({ inStock: true })), { timeout: 2000 });

    // Nháp B (bỏ còn hàng) quay về khoá cũ đã có cache → số 7; rồi trả lời trễ của A không ghi đè.
    fireEvent.click(screen.getByRole('button', { name: 'Chỉ hiện còn hàng' }));
    expect(await screen.findByRole('button', { name: 'Xem 7 sản phẩm' }, { timeout: 2000 })).toBeInTheDocument();
    resolveSlow(page(999));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByRole('button', { name: 'Xem 7 sản phẩm' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /999/ })).not.toBeInTheDocument();
  });

  it('chạm đúp nút áp dụng → onApply chỉ một lần; sửa nháp rồi áp dụng lại thì gửi tiếp', async () => {
    const p = renderSheet({ open: true });
    const apply = await screen.findByRole('button', { name: 'Xem 7 sản phẩm' }, { timeout: 2000 });
    fireEvent.click(apply);
    fireEvent.click(apply);
    expect(p.onApply).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Chỉ hiện còn hàng' }));
    fireEvent.click(screen.getByRole('button', { name: /^(Xem|Áp dụng)/ }));
    expect(p.onApply).toHaveBeenCalledTimes(2);
    expect(p.onApply).toHaveBeenLastCalledWith(expect.objectContaining({ inStock: true }));
  });

  it('đóng → không gọi đếm', async () => {
    renderSheet({ open: false });
    // Đủ thời gian để debounce 250ms (nếu có lỗi bật query lúc đóng) kịp chạy.
    await new Promise((r) => setTimeout(r, 400));
    expect(mocks.fetchCatalog).not.toHaveBeenCalled();
  });

  it('danh sách thương hiệu dài nằm trong khung cuộn riêng (không đẩy nút áp dụng ra ngoài màn hình)', async () => {
    renderSheet({ open: true });
    const group = await screen.findByRole('group', { name: 'Thương hiệu' });
    const scroller = group.querySelector('[data-testid="filter-brand-scroll"]') as HTMLElement;
    expect(scroller).not.toBeNull();
    expect(scroller.style.overflowY).toBe('auto');
    expect(scroller.style.maxHeight).not.toBe('');
  });

  it('không có thương hiệu → không hiện nhóm Thương hiệu', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <FilterSheet open onClose={vi.fn()} state={EMPTY_SEARCH_STATE} brands={[]} onApply={vi.fn()} />
      </QueryClientProvider>,
    );
    await screen.findByRole('group', { name: 'Khoảng giá' });
    expect(screen.queryByRole('group', { name: 'Thương hiệu' })).not.toBeInTheDocument();
  });
});
