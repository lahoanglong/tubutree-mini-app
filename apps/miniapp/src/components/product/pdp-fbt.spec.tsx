import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FbtBundle, FbtLine } from '@tubutree/app-core/commerce/frequently-bought';
import { frequentlyBoughtSummary } from '@tubutree/app-core/commerce/frequently-bought';

const mocks = vi.hoisted(() => ({ notify: vi.fn(), addAll: vi.fn(), haptic: vi.fn(), feedback: vi.fn() }));

vi.mock('zmp-ui', async (orig) => ({ ...(await orig<Record<string, unknown>>()), useNavigate: () => vi.fn() }));
vi.mock('../../utils/haptic', () => ({ haptic: mocks.haptic }));
vi.mock('../../utils/cart-feedback', () => ({ playCartFeedback: mocks.feedback }));
vi.mock('../../hooks/use-notify', () => ({ useNotify: () => ({ notify: mocks.notify }) }));
vi.mock('../../services/cart-batch', () => ({ addAllToCart: mocks.addAll }));

import { PdpFbt, useFbtCartProductIds } from './pdp-fbt';

const line = (n: number, over: Partial<FbtLine> = {}): FbtLine => ({
  key: `v${n}`, productId: `p${n}`, slug: `sp-${n}`, variationId: `v${n}`, name: `Món ${n}`, thumbnail: null, price: 50_000, compareAt: null, isCurrent: n === 0, ...over,
});
const bundleOf = (lines: FbtLine[]): FbtBundle => ({ lines, ...frequentlyBoughtSummary(lines, new Set(lines.map((l) => l.key))) });
const BUNDLE = bundleOf([line(0), line(1), line(2)]);

function renderHost(bundle: FbtBundle = BUNDLE) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const ui = (b: FbtBundle) => (
    <QueryClientProvider client={qc}>
      <PdpFbt bundle={b} />
    </QueryClientProvider>
  );
  const out = render(ui(bundle));
  return { ...out, qc, rerenderWith: (b: FbtBundle) => out.rerender(ui(b)) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.addAll.mockResolvedValue({});
});

describe('PdpFbt: thêm cả bộ', () => {
  it('mặc định chọn hết: một lệnh lô cho cả 3 phân loại (mỗi món 1), báo số món, chấm bay từ nút', async () => {
    renderHost();
    fireEvent.click(screen.getByTestId('fbt-add'));
    await waitFor(() =>
      expect(mocks.addAll).toHaveBeenCalledWith([
        { variationId: 'v0', quantity: 1 },
        { variationId: 'v1', quantity: 1 },
        { variationId: 'v2', quantity: 1 },
      ]),
    );
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith({ type: 'success', text: 'Đã thêm 3 món vào giỏ' }));
    expect(mocks.feedback).toHaveBeenCalledWith(screen.getByTestId('fbt-add'));
  });

  it('bỏ tick một món: lệnh chỉ gồm các món còn tick, theo thứ tự dòng; tổng trên nút đổi theo', async () => {
    renderHost();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Món 1, 50.000đ' }));
    expect(screen.getByTestId('fbt-add')).toHaveTextContent('Thêm 2 món vào giỏ · 100.000đ');
    fireEvent.click(screen.getByTestId('fbt-add'));
    await waitFor(() => expect(mocks.addAll).toHaveBeenCalledWith([{ variationId: 'v0', quantity: 1 }, { variationId: 'v2', quantity: 1 }]));
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith({ type: 'success', text: 'Đã thêm 2 món vào giỏ' }));
  });

  it('bỏ tick hết rồi tick lại một món: nút mở khoá và chỉ thêm món đó', async () => {
    renderHost();
    for (const n of [0, 1, 2]) fireEvent.click(screen.getByRole('checkbox', { name: `Món ${n}, 50.000đ` }));
    expect(screen.getByTestId('fbt-add')).toBeDisabled();
    fireEvent.click(screen.getByTestId('fbt-add'));
    expect(mocks.addAll).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Món 2, 50.000đ' }));
    fireEvent.click(screen.getByTestId('fbt-add'));
    await waitFor(() => expect(mocks.addAll).toHaveBeenCalledWith([{ variationId: 'v2', quantity: 1 }]));
  });

  it('"Chọn tất cả": ẩn khi chọn hết; bỏ tick một món thì hiện, bấm tick lại cả bộ (nút Thêm về đủ 3 món và tổng) rồi nút ẩn', () => {
    renderHost();
    expect(screen.queryByTestId('fbt-select-all')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Món 1, 50.000đ' }));
    expect(screen.getByTestId('fbt-add')).toHaveTextContent('Thêm 2 món vào giỏ · 100.000đ');
    fireEvent.click(screen.getByTestId('fbt-select-all'));
    expect(screen.getByTestId('fbt-add')).toHaveFocus();
    for (const n of [0, 1, 2]) expect(screen.getByRole('checkbox', { name: `Món ${n}, 50.000đ` })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('fbt-add')).toHaveTextContent('Thêm 3 món vào giỏ · 150.000đ');
    expect(screen.queryByTestId('fbt-select-all')).toBeNull();
  });

  it('"Chọn tất cả" sau khi bỏ tick hết: mở khoá nút Thêm và thêm đủ cả bộ', async () => {
    renderHost();
    for (const n of [0, 1, 2]) fireEvent.click(screen.getByRole('checkbox', { name: `Món ${n}, 50.000đ` }));
    expect(screen.getByTestId('fbt-add')).toBeDisabled();
    fireEvent.click(screen.getByTestId('fbt-select-all'));
    expect(screen.getByTestId('fbt-add')).not.toBeDisabled();
    expect(screen.getByTestId('fbt-add')).toHaveFocus();
    fireEvent.click(screen.getByTestId('fbt-add'));
    await waitFor(() =>
      expect(mocks.addAll).toHaveBeenCalledWith([
        { variationId: 'v0', quantity: 1 },
        { variationId: 'v1', quantity: 1 },
        { variationId: 'v2', quantity: 1 },
      ]),
    );
  });

  it('"Chọn tất cả" cũng tick lại món đang xem đã bỏ tick (khoá riêng) khi đổi phân loại', () => {
    const { rerenderWith } = renderHost();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Món 0, 50.000đ' }));
    rerenderWith(bundleOf([line(9, { name: 'Món 9', isCurrent: true }), line(1), line(2)]));
    expect(screen.getByRole('checkbox', { name: 'Món 9, 50.000đ' })).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(screen.getByTestId('fbt-select-all'));
    expect(screen.getByRole('checkbox', { name: 'Món 9, 50.000đ' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('fbt-add')).toHaveTextContent('Thêm 3 món vào giỏ · 150.000đ');
  });

  it('đang thêm: nút báo bận và bấm lần hai không gửi lệnh thứ hai; xong thì mở lại', async () => {
    let release: (v: unknown) => void = () => {};
    mocks.addAll.mockImplementation(() => new Promise((r) => { release = r; }));
    renderHost();
    fireEvent.click(screen.getByTestId('fbt-add'));
    await waitFor(() => expect(screen.getByTestId('fbt-add')).toHaveAttribute('aria-busy', 'true'));
    fireEvent.click(screen.getByTestId('fbt-add'));
    expect(mocks.addAll).toHaveBeenCalledTimes(1);
    await act(async () => release({}));
    await waitFor(() => expect(screen.getByTestId('fbt-add')).not.toHaveAttribute('aria-busy', 'true'));
  });

  it('chạm đúp nút Thêm trong cùng một khung hình (trước khi vẽ lại): chỉ một lệnh lô (W72A)', async () => {
    let release: (v: unknown) => void = () => {};
    mocks.addAll.mockImplementation(() => new Promise((r) => { release = r; }));
    renderHost();
    const add = screen.getByTestId('fbt-add');
    await act(async () => {
      fireEvent.click(add);
      fireEvent.click(add);
    });
    expect(mocks.addAll).toHaveBeenCalledTimes(1);
    await act(async () => release({}));
  });

  it('lỗi (tất cả-hoặc-không): báo câu cố định, không báo thành công, không chấm bay; lựa chọn của khách còn nguyên', async () => {
    mocks.addAll.mockRejectedValue(new Error('boom'));
    renderHost();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Món 2, 50.000đ' }));
    fireEvent.click(screen.getByTestId('fbt-add'));
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith({ type: 'error', text: 'Chưa thêm được vào giỏ. Bạn thử lại nhé.' }));
    expect(mocks.notify).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
    expect(mocks.feedback).not.toHaveBeenCalled();
    expect(screen.getByRole('checkbox', { name: 'Món 2, 50.000đ' })).toHaveAttribute('aria-checked', 'false');
  });

  it('đổi phân loại món đang xem (khoá dòng đổi): món bổ trợ giữ lựa chọn bỏ tick, dòng mới tự được tick', () => {
    const { rerenderWith } = renderHost();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Món 1, 50.000đ' }));
    rerenderWith(bundleOf([line(9, { name: 'Món 9', isCurrent: true }), line(1), line(2)]));
    expect(screen.getByRole('checkbox', { name: 'Món 9, 50.000đ' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('checkbox', { name: 'Món 1, 50.000đ' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('fbt-add')).toHaveTextContent('Thêm 2 món vào giỏ · 100.000đ');
  });
});

describe('PdpFbt: món đang xem bỏ tick theo khoá riêng', () => {
  it('bỏ tick món đang xem rồi đổi phân loại (khoá dòng đổi): vẫn bỏ tick, như web', () => {
    const { rerenderWith } = renderHost();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Món 0, 50.000đ' }));
    rerenderWith(bundleOf([line(9, { name: 'Món 9', isCurrent: true }), line(1), line(2)]));
    expect(screen.getByRole('checkbox', { name: 'Món 9, 50.000đ' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('fbt-add')).toHaveTextContent('Thêm 2 món vào giỏ · 100.000đ');
  });
});

describe('useFbtCartProductIds: giỏ lúc trang mở, đóng băng', () => {
  const hook = (init: { slug: string; items: { productId?: string }[] | undefined; settled: boolean }) =>
    renderHook((p: typeof init) => useFbtCartProductIds(p.slug, p.items, p.settled), { initialProps: init });

  it('chưa chờ xong giỏ (đang tải): null, trang chưa chọn món nào', () => {
    const { result } = hook({ slug: 'a', items: undefined, settled: false });
    expect(result.current).toBeNull();
  });

  it('khách chưa đăng nhập (settled, không giỏ): tập rỗng', () => {
    const { result } = hook({ slug: 'a', items: undefined, settled: true });
    expect(result.current).toEqual(new Set());
  });

  it('giỏ về: lấy productId của các dòng (bỏ dòng API cũ chưa trả productId)', () => {
    const { result, rerender } = hook({ slug: 'a', items: undefined, settled: false });
    rerender({ slug: 'a', items: [{ productId: 'p1' }, {}, { productId: 'p2' }], settled: true });
    expect(result.current).toEqual(new Set(['p1', 'p2']));
  });

  it('thêm cả bộ xong giỏ tải lại có món mới: tập vẫn như lúc trang mở (khối không biến mất giữa trang)', () => {
    const { result, rerender } = hook({ slug: 'a', items: [{ productId: 'p1' }], settled: true });
    const first = result.current;
    rerender({ slug: 'a', items: [{ productId: 'p1' }, { productId: 'p5' }, { productId: 'p6' }], settled: true });
    expect(result.current).toBe(first);
    expect(result.current).toEqual(new Set(['p1']));
  });

  it('đổi sản phẩm: chụp lại giỏ theo trang mới', () => {
    const { result, rerender } = hook({ slug: 'a', items: [{ productId: 'p1' }], settled: true });
    rerender({ slug: 'b', items: [{ productId: 'p1' }, { productId: 'p5' }], settled: true });
    expect(result.current).toEqual(new Set(['p1', 'p5']));
    rerender({ slug: 'c', items: undefined, settled: false });
    expect(result.current).toBeNull();
  });
});
