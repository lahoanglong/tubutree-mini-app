import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ComponentProps, type ReactElement } from 'react';
import type * as UiForm from '../ui/form';
import type * as ZmpUi from 'zmp-ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(), openSnackbar: vi.fn(), repurchaseOrder: vi.fn(), addToCart: vi.fn(),
  getCart: vi.fn().mockResolvedValue({ items: [] }),
  trackReorderClicked: vi.fn(), trackReorderCompleted: vi.fn(),
  /** `checked` của MỌI lần render Checkbox theo thứ tự — để bắt "khung hình đầu" trước khi effect chạy. */
  checkboxRenders: [] as { label: string; checked: boolean }[],
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof ZmpUi>()),
  useNavigate: () => mocks.navigate,
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../../services/shop-api', () => ({ repurchaseOrder: mocks.repurchaseOrder, addToCart: mocks.addToCart, getCart: mocks.getCart }));
vi.mock('../../services/buy-flow-events', () => ({
  trackReorderClicked: mocks.trackReorderClicked,
  trackReorderCompleted: mocks.trackReorderCompleted,
}));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../ui/form', async (importOriginal) => {
  const actual = await importOriginal<typeof UiForm>();
  return {
    ...actual,
    Checkbox: (props: ComponentProps<typeof actual.Checkbox>) => {
      mocks.checkboxRenders.push({ label: String((props as { children?: { props?: { children?: unknown } } }).children?.props?.children ?? ''), checked: Boolean(props.checked) });
      return <actual.Checkbox {...props} />;
    },
  };
});

import { vi as copy } from '../../i18n/vi';
import { useAuthStore } from '../../store/auth';
import { ReorderSheet } from './reorder-sheet';
import { itemReorderTarget, lineFromOrderItem, orderReorderTarget, type ReorderLine, type ReorderTarget } from './reorder-types';
import type { OrderItemView, PurchasedItem } from '../../services/shop-api';

const CART = { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 200000, itemCount: 2 };
const line = (key: string, name: string, over: Partial<ReorderLine> = {}): ReorderLine => ({
  key, variationId: `v-${key}`, productName: name, variationName: 'Chanh', thumbnail: null, unitPrice: 50000,
  defaultQuantity: 2, maxQuantity: 5, available: true, notices: [], ...over,
});
const ORDER: ReorderTarget = {
  kind: 'order',
  orderCode: 'TUBU1',
  lines: [line('a', 'Nước rửa chén'), line('b', 'Xà phòng', { available: false, maxQuantity: 0, notices: [{ kind: 'out', tone: 'danger', text: 'Tạm hết hàng' }] })],
};

function renderSheet(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const item = (id: string, productName: string, over: Partial<OrderItemView> = {}): OrderItemView => ({
  id, variationId: `v-${id}`, productName, productSlug: id, variationName: '', unitPrice: 60000, quantity: 1, total: 60000, backorderedQty: 0,
  stock: 50, available: true, discontinued: false, currentPrice: 60000, flashActive: false, ...over,
});

describe('ReorderSheet: câu báo từng món của đơn cũ', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hết hàng, ngừng bán, đã giảm số lượng, giá tăng: mỗi dòng nói rõ; đầu sheet nêu số món không thêm được', () => {
    const target = orderReorderTarget({
      code: 'TUBU2',
      items: [
        item('i1', 'Trà xanh', { stock: 0, available: false }),
        item('i2', 'Mật ong', { stock: 3, available: false, discontinued: true }),
        item('i3', 'Nước rửa chén', { quantity: 5, stock: 2, currentPrice: 65000 }),
        item('i4', 'Xà phòng'),
      ],
    });
    renderSheet(<ReorderSheet target={target} source="order_card" onClose={() => {}} />);
    expect(screen.getByTestId('reorder-skipped-note')).toHaveTextContent('2 món hết hàng hoặc ngừng bán sẽ không được thêm vào giỏ.');
    const notices = screen.getAllByTestId('reorder-line').map((row) => Array.from(row.querySelectorAll('[data-notice]')).map((n) => n.textContent));
    expect(notices).toEqual([
      ['Tạm hết hàng'],
      ['Ngừng bán'],
      ['Không đủ 5 như đơn trước, đã giảm số lượng', 'Giá tăng so với đơn trước (60.000đ)'],
      [],
    ]);
    expect(screen.getByRole('button', { name: 'Thêm vào giỏ (3)' })).toBeEnabled();
  });

  it('cả đơn không còn món nào bán được: câu đầu sheet riêng, CTA (0) bị khoá', () => {
    const target = orderReorderTarget({ code: 'TUBU3', items: [item('i1', 'Trà xanh', { stock: 0, available: false }), item('i2', 'Mật ong', { available: false, discontinued: true })] });
    renderSheet(<ReorderSheet target={target} source="order_card" onClose={() => {}} />);
    expect(screen.getByTestId('reorder-skipped-note')).toHaveTextContent('Các món trong đơn này đều đã hết hàng hoặc ngừng bán.');
    expect(screen.getByRole('button', { name: 'Thêm vào giỏ (0)' })).toBeDisabled();
  });

  it('mọi món còn bán, giá như cũ: không có câu báo nào', () => {
    renderSheet(<ReorderSheet target={orderReorderTarget({ code: 'TUBU4', items: [item('i1', 'Trà xanh')] })} source="order_card" onClose={() => {}} />);
    expect(screen.queryByTestId('reorder-skipped-note')).toBeNull();
    expect(document.querySelector('[data-notice]')).toBeNull();
  });
});

describe('ReorderSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkboxRenders.length = 0;
  });

  it('dòng hết hàng: mờ, checkbox bị khoá, không tính vào CTA; tạm tính theo dòng chọn', () => {
    renderSheet(<ReorderSheet target={ORDER} source="order_card" onClose={() => {}} />);
    expect(screen.getByRole('checkbox', { name: 'Chọn Xà phòng' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Chọn Nước rửa chén' })).toBeChecked();
    expect(screen.getByText('Tạm hết hàng')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Thêm vào giỏ (2)' })).toBeInTheDocument();
    expect(screen.getByText('100.000đ')).toBeInTheDocument();
  });

  it('bỏ chọn hết → CTA "(0)" bị vô hiệu', () => {
    renderSheet(<ReorderSheet target={ORDER} source="order_card" onClose={() => {}} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn Nước rửa chén' }));
    expect(screen.getByRole('button', { name: 'Thêm vào giỏ (0)' })).toBeDisabled();
  });

  it('+ số lượng cập nhật CTA; gửi đúng dòng khả dụng; thành công → đóng sheet', async () => {
    mocks.repurchaseOrder.mockResolvedValue({ cart: CART, legacy: false, results: [{ orderItemId: 'a', status: 'added', addedQuantity: 3 }] });
    const onClose = vi.fn();
    renderSheet(<ReorderSheet target={ORDER} source="order_card" onClose={onClose} />);
    fireEvent.click(screen.getAllByRole('button', { name: /^Tăng số lượng/ })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Thêm vào giỏ (3)' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mocks.repurchaseOrder).toHaveBeenCalledWith('TUBU1', { items: [{ orderItemId: 'a', quantity: 3 }], addSource: 'repurchase' });
  });

  it('lỗi mạng → KHÔNG đóng, giữ nguyên lựa chọn để bấm lại', async () => {
    mocks.repurchaseOrder.mockRejectedValue(new Error('Network Error'));
    const onClose = vi.fn();
    renderSheet(<ReorderSheet target={ORDER} source="order_card" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Thêm vào giỏ (2)' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Thêm vào giỏ (2)' })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: 'Chọn Nước rửa chén' })).toBeChecked();
  });

  it('chạm đúp CTA → chỉ MỘT request', async () => {
    let resolve!: (v: unknown) => void;
    mocks.repurchaseOrder.mockReturnValue(new Promise((r) => (resolve = r)));
    renderSheet(<ReorderSheet target={ORDER} source="order_card" onClose={() => {}} />);
    const cta = screen.getByRole('button', { name: 'Thêm vào giỏ (2)' });
    fireEvent.click(cta);
    fireEvent.click(cta);
    fireEvent.click(cta);
    // TanStack Query v5 awaits onMutate before calling mutationFn, so assert only after the flow settles.
    resolve({ cart: CART, legacy: false, results: [{ orderItemId: 'a', status: 'added', addedQuantity: 2 }] });
    await waitFor(() => expect(mocks.trackReorderCompleted).toHaveBeenCalled());
    expect(mocks.repurchaseOrder).toHaveBeenCalledTimes(1);
    expect(mocks.trackReorderCompleted).toHaveBeenCalledTimes(1);
  });

  it('bắn reorder_clicked đúng 1 lần mỗi lần mở, kèm mã đơn / variation', () => {
    const { rerender } = renderSheet(<ReorderSheet target={ORDER} source="order_card" onClose={() => {}} />);
    expect(mocks.trackReorderClicked).toHaveBeenCalledWith({ source: 'order_card', orderCode: 'TUBU1' });
    const item: ReorderTarget = { kind: 'item', line: line('v1', 'Nước rửa chén', { key: 'v1', variationId: 'v1', defaultQuantity: 1 }) };
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ReorderSheet target={item} source="home_rail" onClose={() => {}} />
      </QueryClientProvider>,
    );
    expect(mocks.trackReorderClicked).toHaveBeenLastCalledWith({ source: 'home_rail', variationId: 'v1' });
    expect(mocks.trackReorderClicked).toHaveBeenCalledTimes(2);
  });

  it('KHUNG HÌNH ĐẦU đã có dòng được chọn và CTA đúng số lượng (không nháy "(0)" rồi mới chọn)', () => {
    const addCta = vi.spyOn(copy.reorder, 'addCta');
    renderSheet(<ReorderSheet target={ORDER} source="order_card" onClose={() => {}} />);
    const firstA = mocks.checkboxRenders.find((r) => r.label.includes('Nước rửa chén'));
    expect(firstA?.checked).toBe(true);
    expect(addCta.mock.calls[0]?.[0]).toBe(2);
    expect(addCta.mock.calls.map((c) => c[0])).not.toContain(0);
    addCta.mockRestore();
  });

  it('đổi target khi sheet đang mở: lựa chọn của target mới có ngay ở lần render đầu, không lấy lại của target cũ', () => {
    const { rerender } = renderSheet(<ReorderSheet target={ORDER} source="order_card" onClose={() => {}} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn Nước rửa chén' })); // bỏ chọn ở target cũ
    mocks.checkboxRenders.length = 0;
    const next: ReorderTarget = { kind: 'order', orderCode: 'TUBU2', lines: [line('c', 'Dầu gội')] };
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ReorderSheet target={next} source="order_card" onClose={() => {}} />
      </QueryClientProvider>,
    );
    expect(mocks.checkboxRenders.find((r) => r.label.includes('Dầu gội'))?.checked).toBe(true);
    expect(screen.getByRole('button', { name: 'Thêm vào giỏ (2)' })).toBeInTheDocument();
  });

  it('đóng sheet (target → null): nội dung KHÔNG bị rút cạn trong lúc sheet còn trượt xuống', () => {
    const { rerender } = renderSheet(<ReorderSheet target={ORDER} source="order_card" onClose={() => {}} />);
    expect(screen.getByText('Từ đơn TUBU1')).toBeInTheDocument();
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ReorderSheet target={null} source="order_card" onClose={() => {}} />
      </QueryClientProvider>,
    );
    // ZaUI Sheet (unmountOnClose) giữ nội dung ~200ms để chạy animation trượt xuống.
    expect(screen.getByText('Nước rửa chén')).toBeInTheDocument();
    expect(screen.getByText('Từ đơn TUBU1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Thêm vào giỏ (2)' })).toBeInTheDocument();
  });

  it('mở lại cùng một đối tượng target sau khi đóng vẫn khởi tạo lại lựa chọn và tính reorder_clicked thêm 1 lần', () => {
    const { rerender } = renderSheet(<ReorderSheet target={ORDER} source="order_card" onClose={() => {}} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn Nước rửa chén' }));
    const wrap = (t: ReorderTarget | null) => (
      <QueryClientProvider client={new QueryClient()}>
        <ReorderSheet target={t} source="order_card" onClose={() => {}} />
      </QueryClientProvider>
    );
    rerender(wrap(null));
    rerender(wrap(ORDER));
    expect(screen.getByRole('checkbox', { name: 'Chọn Nước rửa chén' })).toBeChecked();
    expect(mocks.trackReorderClicked).toHaveBeenCalledTimes(2);
  });

  it('re-render với CÙNG target (đổi prop khác) không bắn lại reorder_clicked', () => {
    const { rerender } = renderSheet(<ReorderSheet target={ORDER} source="order_card" onClose={() => {}} />);
    expect(mocks.trackReorderClicked).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 3; i++) {
      rerender(
        <QueryClientProvider client={new QueryClient()}>
          <ReorderSheet target={ORDER} source="order_card" onClose={() => {}} navigateToCart />
        </QueryClientProvider>,
      );
    }
    fireEvent.click(screen.getByRole('button', { name: /^Tăng số lượng/ }));
    expect(mocks.trackReorderClicked).toHaveBeenCalledTimes(1);
  });

  it('dòng hết hàng chỉ mờ ảnh, chữ không bị opacity (đủ tương phản)', () => {
    renderSheet(<ReorderSheet target={ORDER} source="order_card" onClose={() => {}} />);
    const rows = screen.getAllByTestId('reorder-line');
    const unavailable = rows.find((r) => r.textContent?.includes(copy.reorder.unavailable))!;
    expect(unavailable.style.opacity).toBe('');
    const dimmed = Array.from(unavailable.querySelectorAll<HTMLElement>('div')).find((d) => d.style.opacity === '0.5')!;
    expect(dimmed).toBeTruthy();
    expect(dimmed.textContent).toBe('');
  });

  it('nút số lượng của mỗi dòng mang tên sản phẩm nên không trùng tên (như web)', () => {
    renderSheet(<ReorderSheet target={{ kind: 'order', orderCode: 'T', lines: [line('a', 'Nước rửa chén'), line('c', 'Dầu gội')] }} source="order_card" onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Tăng số lượng Nước rửa chén' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Giảm số lượng Dầu gội' })).toBeInTheDocument();
  });

  it('target=null → không hiện gì', () => {
    renderSheet(<ReorderSheet target={null} source="order_card" onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: /Thêm vào giỏ/ })).toBeNull();
  });
});

// Giá trên sheet phải là giá giỏ sẽ tính: Giờ vàng còn suất của chính khách → giá Giờ vàng cho cả dòng khi số lượng không vượt suất,
// vượt thì cả dòng giá đang bán (cùng luật priceFlashLine ở API). Bộ chọn số lượng không lộ tồn trên 20.
describe('ReorderSheet: giá hiệu lực khớp giỏ và trần tồn', () => {
  beforeEach(() => vi.clearAllMocks());
  const open = (target: ReorderTarget) => renderSheet(<ReorderSheet target={target} source="order_card" onClose={() => {}} />);
  const row = () => screen.getByTestId('reorder-line');
  const rowNotices = () => Array.from(row().querySelectorAll('[data-notice]')).map((n) => n.textContent);
  const plusOf = (name: string) => screen.getByRole('button', { name: `Tăng số lượng ${name}` });

  it('còn suất Giờ vàng: dòng và tạm tính theo giá Giờ vàng; vượt số suất thì cả dòng về giá đang bán, như giỏ', () => {
    open(orderReorderTarget({ code: 'TUBU5', items: [item('i1', 'Trà xanh', { quantity: 2, flashActive: true, flashPrice: 40000, flashAllowance: 3 })] }));
    expect(within(row()).getByText('40.000đ')).toBeInTheDocument();
    expect(screen.getByText('80.000đ')).toBeInTheDocument();
    expect(rowNotices()).toEqual(['Giá giảm so với đơn trước (60.000đ)']);
    fireEvent.click(plusOf('Trà xanh'));
    fireEvent.click(plusOf('Trà xanh'));
    expect(within(row()).getByText('60.000đ')).toBeInTheDocument();
    expect(screen.getByText('240.000đ')).toBeInTheDocument();
    expect(rowNotices()).toEqual([]);
  });

  it('khách đã dùng hết suất Giờ vàng: giá đang bán, không báo giảm giá', () => {
    open(orderReorderTarget({ code: 'TUBU6', items: [item('i1', 'Trà xanh', { flashActive: true, flashPrice: 40000, flashAllowance: 0 })] }));
    expect(within(row()).getByText('60.000đ')).toBeInTheDocument();
    expect(rowNotices()).toEqual([]);
  });

  it('đơn trước mua giá Giờ vàng, nay hết suất: giá đang bán và báo tăng so với giá đã trả', () => {
    open(orderReorderTarget({ code: 'TUBU7', items: [item('i1', 'Trà xanh', { unitPrice: 40000, flashSaleItemId: 'fi1', flashActive: true, flashPrice: null, flashAllowance: null })] }));
    expect(within(row()).getByText('60.000đ')).toBeInTheDocument();
    expect(rowNotices()).toEqual(['Giá tăng so với đơn trước (40.000đ)']);
  });

  it('API cũ chỉ có cờ flashActive: giữ giá đang bán và không so giá', () => {
    open(orderReorderTarget({ code: 'TUBU8', items: [item('i1', 'Trà xanh', { flashActive: true, currentPrice: 70000 })] }));
    expect(within(row()).getByText('70.000đ')).toBeInTheDocument();
    expect(rowNotices()).toEqual([]);
  });

  it('Mua lại một sản phẩm đã mua: giá Giờ vàng theo số lượng chọn', () => {
    const purchased: PurchasedItem = {
      variationId: 'v9', productId: 'p9', slug: 's9', productName: 'Dầu gội', variationName: '', brand: 'Tubu', thumbnail: null, price: 60000, salePrice: null,
      stock: 50, inStock: true, timesBought: 2, lastPurchasedAt: '2026-10-01T00:00:00.000Z', flashPrice: 45000, flashAllowance: 2,
    };
    open(itemReorderTarget(purchased));
    expect(within(row()).getByText('45.000đ')).toBeInTheDocument();
    fireEvent.click(plusOf('Dầu gội'));
    fireEvent.click(plusOf('Dầu gội'));
    expect(within(row()).getByText('60.000đ')).toBeInTheDocument();
    expect(screen.getByText('180.000đ')).toBeInTheDocument();
  });

  it.each([21, 99, 100_000])('tồn công khai %i (trên 20): bộ chọn không kẹp theo tồn, không nói "Chỉ còn", không in số tồn', (stock) => {
    expect(lineFromOrderItem(item('i1', 'Trà xanh', { quantity: 3, stock })).maxQuantity).toBe(99);
    open(orderReorderTarget({ code: 'TUBU9', items: [item('i1', 'Trà xanh', { quantity: 3, stock })] }));
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/Chỉ còn|còn lại/);
    expect(text).not.toContain(String(stock));
    expect(text).not.toContain(stock.toLocaleString('vi-VN'));
    expect(plusOf('Trà xanh')).toBeEnabled();
  });

  it.each([1, 12, 20])('tồn %i (từ 1 đến 20): trần của bộ chọn đúng bằng tồn', (stock) => {
    expect(lineFromOrderItem(item('i1', 'Trà xanh', { quantity: 1, stock })).maxQuantity).toBe(stock);
  });
});

// Giỏ gộp số lượng cùng biến thể rồi mới so với số suất Giờ vàng: sheet phải tính cả phần đã có sẵn trong giỏ, nếu không tấm Mua lại
// hiện giá Giờ vàng còn giỏ tính giá đang bán cho cả dòng.
describe('ReorderSheet: giá theo số lượng đã có trong giỏ', () => {
  const flashItem = () => item('i1', 'Trà xanh', { quantity: 2, flashActive: true, flashPrice: 40000, flashAllowance: 3 });
  const open = (target: ReorderTarget | null = orderReorderTarget({ code: 'TUBU10', items: [flashItem()] })) =>
    renderSheet(<ReorderSheet target={target} source="order_card" onClose={() => {}} />);
  const row = () => screen.getByTestId('reorder-line');

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCart.mockReset().mockResolvedValue({ items: [] });
    useAuthStore.setState({ status: 'authenticated' });
  });
  afterEach(() => useAuthStore.setState({ status: 'idle' }));

  it('giỏ đã có 2 món cùng biến thể, thêm 2: tổng 4 vượt suất 3 → dòng và tạm tính về giá đang bán như giỏ sẽ tính', async () => {
    mocks.getCart.mockResolvedValue({ items: [{ id: 'c1', variationId: 'v-i1', quantity: 2 }] });
    open();
    expect(await within(row()).findByText('60.000đ')).toBeInTheDocument();
    expect(screen.getByText('120.000đ')).toBeInTheDocument();
  });

  it('giỏ chưa có món đó: vẫn giá Giờ vàng', async () => {
    mocks.getCart.mockResolvedValue({ items: [{ id: 'c9', variationId: 'v-khac', quantity: 9 }] });
    open();
    await waitFor(() => expect(mocks.getCart).toHaveBeenCalled());
    expect(within(row()).getByText('40.000đ')).toBeInTheDocument();
    expect(screen.getByText('80.000đ')).toBeInTheDocument();
  });

  it('tải giỏ lỗi: giữ giá theo số lượng của sheet, không chặn khách', async () => {
    mocks.getCart.mockRejectedValue(new Error('Network Error'));
    open();
    await waitFor(() => expect(mocks.getCart).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Thêm vào giỏ (2)' })).not.toHaveAttribute('aria-busy'));
    expect(within(row()).getByText('40.000đ')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Thêm vào giỏ (2)' })).toBeEnabled();
  });

  it('chỉ tải giỏ khi sheet mở và đã đăng nhập', async () => {
    open(null);
    useAuthStore.setState({ status: 'idle' });
    open();
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.getCart).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Thêm vào giỏ (2)' })).not.toHaveAttribute('aria-busy');
  });

  it('đơn có hai dòng cùng biến thể: giỏ gộp 2 + 2 = 4 > 3 nên cả hai dòng tính giá đang bán', async () => {
    open(orderReorderTarget({
      code: 'TUBU11',
      items: [
        item('i1', 'Trà xanh', { variationId: 'v-same', quantity: 2, flashActive: true, flashPrice: 40000, flashAllowance: 3 }),
        item('i2', 'Trà xanh', { variationId: 'v-same', quantity: 2, flashActive: true, flashPrice: 40000, flashAllowance: 3 }),
      ],
    }));
    await waitFor(() => expect(mocks.getCart).toHaveBeenCalled());
    const prices = screen.getAllByTestId('reorder-line').map((r) => within(r).queryByText('60.000đ') !== null);
    expect(prices).toEqual([true, true]);
    expect(screen.getByText('240.000đ')).toBeInTheDocument();
  });

  it('giỏ chưa tải xong: nút Thêm khoá và chạm không gửi gì; giỏ về thì mở khoá, giá tính lại theo số lượng gộp, bấm gửi đúng một lần', async () => {
    let resolveCart!: (cart: unknown) => void;
    mocks.getCart.mockReturnValue(new Promise((r) => { resolveCart = r; }));
    mocks.repurchaseOrder.mockResolvedValue({ cart: CART, legacy: false, results: [{ orderItemId: 'i1', status: 'added', addedQuantity: 2 }] });
    const onClose = vi.fn();
    renderSheet(<ReorderSheet target={orderReorderTarget({ code: 'TUBU13', items: [flashItem()] })} source="order_card" onClose={onClose} />);
    await waitFor(() => expect(mocks.getCart).toHaveBeenCalled());

    const waiting = screen.getByRole('button', { name: 'Thêm vào giỏ (2)' });
    expect(waiting).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(waiting);
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.repurchaseOrder).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    resolveCart({ items: [{ id: 'c1', variationId: 'v-i1', quantity: 2 }] });
    expect(await within(row()).findByText('60.000đ')).toBeInTheDocument();
    expect(screen.getByText('120.000đ')).toBeInTheDocument();
    const ready = screen.getByRole('button', { name: 'Thêm vào giỏ (2)' });
    expect(ready).not.toHaveAttribute('aria-busy');
    fireEvent.click(ready);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mocks.repurchaseOrder).toHaveBeenCalledTimes(1);
  });

  it('thêm xong giỏ tải lại có phần vừa thêm: giá trên sheet không nhảy (số liệu giỏ đóng băng từ lúc bấm thêm)', async () => {
    mocks.getCart.mockResolvedValueOnce({ items: [] }).mockResolvedValue({ items: [{ id: 'c1', variationId: 'v-i1', quantity: 2 }] });
    mocks.repurchaseOrder.mockResolvedValue({ cart: CART, legacy: false, results: [{ orderItemId: 'i1', status: 'added', addedQuantity: 2 }] });
    const onClose = vi.fn();
    renderSheet(<ReorderSheet target={orderReorderTarget({ code: 'TUBU12', items: [flashItem()] })} source="order_card" onClose={onClose} />);
    await waitFor(() => expect(mocks.getCart).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Thêm vào giỏ (2)' })).not.toHaveAttribute('aria-busy'));
    fireEvent.click(screen.getByRole('button', { name: 'Thêm vào giỏ (2)' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.getCart).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(within(row()).getByText('40.000đ')).toBeInTheDocument();
    expect(screen.getByText('80.000đ')).toBeInTheDocument();
  });
});

const CHEAPER = { standing: 50000, flashPrice: null, flashAllowance: null, paidPrice: 60000, comparable: true };
const MANY: ReorderTarget = {
  kind: 'order',
  orderCode: 'TUBU8',
  lines: [
    line('a', 'Nước rửa chén'),
    line('b', 'Dầu gội', { defaultQuantity: 1 }),
    line('c', 'Xà phòng', { available: false, maxQuantity: 0, notices: [{ kind: 'out', tone: 'danger', text: 'Tạm hết hàng' }] }),
  ],
};
const toggleAllBox = () => screen.queryByRole('checkbox', { name: /^Chọn tất cả/ }) as HTMLInputElement | null;

describe('ReorderSheet: Chọn tất cả', () => {
  beforeEach(() => vi.clearAllMocks());

  it('từ 2 dòng còn hàng: ô "Chọn tất cả (2)" đang tick, nằm trong khung chạm 44px, có data-testid', () => {
    renderSheet(<ReorderSheet target={MANY} source="order_card" onClose={() => {}} />);
    const box = screen.getByRole('checkbox', { name: 'Chọn tất cả (2)' });
    expect(box).toBeChecked();
    expect(screen.getByTestId('reorder-toggle-all')).toBeInTheDocument();
    expect((box.closest('[data-testid="checkbox-hit-area"]') as HTMLElement).style.minHeight).toBe('44px');
  });

  it('chỉ 1 dòng còn hàng hay mua lại một sản phẩm: không có ô', () => {
    const { unmount } = renderSheet(<ReorderSheet target={ORDER} source="order_card" onClose={() => {}} />);
    expect(toggleAllBox()).toBeNull();
    expect(screen.queryByTestId('reorder-toggle-all')).toBeNull();
    unmount();
    renderSheet(<ReorderSheet target={{ kind: 'item', line: line('a', 'Nước rửa chén', { defaultQuantity: 1 }) }} source="order_card" onClose={() => {}} />);
    expect(toggleAllBox()).toBeNull();
  });

  it('bấm khi tất cả đang chọn → bỏ chọn hết, CTA (0) bị khoá; bấm lại → chọn lại dòng còn hàng, dòng hết hàng vẫn khoá và không chọn', () => {
    renderSheet(<ReorderSheet target={MANY} source="order_card" onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Thêm vào giỏ (3)' })).toBeInTheDocument();
    fireEvent.click(toggleAllBox()!);
    expect(toggleAllBox()).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Chọn Nước rửa chén' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Chọn Dầu gội' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Thêm vào giỏ (0)' })).toBeDisabled();
    fireEvent.click(toggleAllBox()!);
    expect(screen.getByRole('checkbox', { name: 'Chọn Nước rửa chén' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Chọn Dầu gội' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Chọn Xà phòng' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Chọn Xà phòng' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Thêm vào giỏ (3)' })).toBeInTheDocument();
  });

  it('bỏ tick một dòng → ô hết tick; bấm → chọn đủ lại và giữ số lượng đã chỉnh', () => {
    renderSheet(<ReorderSheet target={MANY} source="order_card" onClose={() => {}} />);
    fireEvent.click(screen.getAllByRole('button', { name: /^Tăng số lượng/ })[0]!);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn Dầu gội' }));
    expect(toggleAllBox()).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Thêm vào giỏ (3)' })).toBeInTheDocument();
    fireEvent.click(toggleAllBox()!);
    expect(toggleAllBox()).toBeChecked();
    expect(screen.getByRole('button', { name: 'Thêm vào giỏ (4)' })).toBeInTheDocument();
  });
});

describe('ReorderSheet: tiết kiệm so với lúc mua trước và số tabular', () => {
  beforeEach(() => vi.clearAllMocks());
  const SAVE: ReorderTarget = { kind: 'order', orderCode: 'TUBU9', lines: [line('a', 'Nước rửa chén', { pricing: CHEAPER })] };

  it('món đang chọn rẻ hơn lúc mua: ngay dưới Tạm tính có câu tiết kiệm, màu xanh, số tabular', () => {
    renderSheet(<ReorderSheet target={SAVE} source="order_card" onClose={() => {}} />);
    const n = screen.getByTestId('reorder-savings-note');
    expect(n).toHaveTextContent('Tiết kiệm 20.000đ so với lúc mua trước');
    expect(n.style.fontVariantNumeric).toBe('tabular-nums');
    expect(n.style.color).toContain('success');
    expect(n.previousElementSibling).toHaveTextContent('Tạm tính');
  });

  it('đổi số lượng cập nhật số tiền; bỏ chọn hết thì ẩn câu', () => {
    renderSheet(<ReorderSheet target={SAVE} source="order_card" onClose={() => {}} />);
    fireEvent.click(screen.getAllByRole('button', { name: /^Tăng số lượng/ })[0]!);
    expect(screen.getByTestId('reorder-savings-note')).toHaveTextContent('Tiết kiệm 30.000đ so với lúc mua trước');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn Nước rửa chén' }));
    expect(screen.queryByTestId('reorder-savings-note')).toBeNull();
  });

  it('giá không rẻ đi (không so được hay đắt lên): không có câu', () => {
    const { unmount } = renderSheet(<ReorderSheet target={ORDER} source="order_card" onClose={() => {}} />);
    expect(screen.queryByTestId('reorder-savings-note')).toBeNull();
    unmount();
    renderSheet(<ReorderSheet target={{ kind: 'order', orderCode: 'TUBU10', lines: [line('a', 'Nước rửa chén', { pricing: { ...CHEAPER, paidPrice: 40000 } })] }} source="order_card" onClose={() => {}} />);
    expect(screen.queryByTestId('reorder-savings-note')).toBeNull();
  });

  it('đơn giá và tạm tính đều có số tabular để không nhảy chữ số khi đổi số lượng', () => {
    renderSheet(<ReorderSheet target={SAVE} source="order_card" onClose={() => {}} />);
    expect(within(screen.getByTestId('reorder-line')).getByText('50.000đ').style.fontVariantNumeric).toBe('tabular-nums');
    expect(screen.getByText('100.000đ').style.fontVariantNumeric).toBe('tabular-nums');
  });
});

describe('ReorderSheet: dấu "một phần", chạm chữ, câu giá có số tabular, tiết kiệm theo tổng', () => {
  beforeEach(() => vi.clearAllMocks());
  const DEARER = { standing: 50000, flashPrice: null, flashAllowance: null, paidPrice: 40000, comparable: true };
  const MIXED: ReorderTarget = {
    kind: 'order',
    orderCode: 'TUBU11',
    lines: [line('a', 'Nước rửa chén', { pricing: CHEAPER }), line('b', 'Dầu gội', { defaultQuantity: 1, pricing: DEARER })],
  };

  it('Chọn tất cả ở trạng thái một phần khi chỉ chọn một số dòng còn hàng; chọn đủ hay bỏ hết thì bỏ dấu', () => {
    renderSheet(<ReorderSheet target={MANY} source="order_card" onClose={() => {}} />);
    expect(toggleAllBox()).not.toHaveAttribute('aria-checked', 'mixed');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn Dầu gội' }));
    expect(toggleAllBox()).toHaveAttribute('aria-checked', 'mixed');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn Nước rửa chén' }));
    expect(toggleAllBox()).not.toHaveAttribute('aria-checked', 'mixed');
    fireEvent.click(toggleAllBox()!);
    expect(toggleAllBox()).toBeChecked();
    expect(toggleAllBox()).not.toHaveAttribute('aria-checked', 'mixed');
  });

  it('chạm vào chữ "Chọn tất cả" cũng bật tắt, chữ nhìn thấy ẩn khỏi trình đọc màn hình để tên chỉ đọc một lần', () => {
    renderSheet(<ReorderSheet target={MANY} source="order_card" onClose={() => {}} />);
    const label = screen.getByTestId('reorder-toggle-all-label');
    expect(label).toHaveAttribute('aria-hidden', 'true');
    expect(label).toHaveTextContent('Chọn tất cả (2)');
    fireEvent.click(label);
    expect(toggleAllBox()).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Thêm vào giỏ (0)' })).toBeDisabled();
    fireEvent.click(label);
    expect(toggleAllBox()).toBeChecked();
  });

  it('câu giá đổi ("Giá giảm so với đơn trước (…)") có số tabular như các số tiền khác', () => {
    renderSheet(<ReorderSheet target={{ kind: 'order', orderCode: 'TUBU12', lines: [line('a', 'Nước rửa chén', { pricing: CHEAPER })] }} source="order_card" onClose={() => {}} />);
    expect((document.querySelector('[data-notice="priceDown"]') as HTMLElement).style.fontVariantNumeric).toBe('tabular-nums');
  });

  it('một dòng rẻ đi, một dòng đắt lên: tiết kiệm là phần tổng rẻ hơn lần trước; tổng không rẻ hơn thì không có câu', () => {
    renderSheet(<ReorderSheet target={MIXED} source="order_card" onClose={() => {}} />);
    expect(screen.getByTestId('reorder-savings-note')).toHaveTextContent('Tiết kiệm 10.000đ so với lúc mua trước');
    fireEvent.click(screen.getAllByRole('button', { name: /^Tăng số lượng/ })[1]!);
    expect(screen.queryByTestId('reorder-savings-note')).toBeNull();
  });
});

// W116A: lệnh Thêm vào giỏ báo xong muộn không đóng sheet mà khách đã đóng rồi MỞ LẠI (cùng đơn hay đơn khác) và đang chỉnh số lượng; thông báo, tải lại giỏ, nhả khoá vẫn chạy.
describe('ReorderSheet: mở lại sheet lúc lệnh Thêm vào giỏ cũ còn bay (W116A)', () => {
  const ORDER_B = orderReorderTarget({ code: 'TUBU9', items: [item('i1', 'Trà xanh')] });
  const ADDED = (key: string) => ({ cart: CART, legacy: false, results: [{ orderItemId: key, status: 'added', addedQuantity: 2 }] });
  const pending = <T,>() => {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };

  /** Cha giữ `target` như các trang thật: đóng = `setTarget(null)`, mở = nút ngoài sheet gán một đích. */
  function Harness({ onClose, navigateToCart }: { onClose: () => void; navigateToCart?: boolean }) {
    const [target, setTarget] = useState<ReorderTarget | null>(ORDER);
    return (
      <>
        <button type="button" onClick={() => setTarget(ORDER)}>mở đơn A</button>
        <button type="button" onClick={() => setTarget(ORDER_B)}>mở đơn B</button>
        <ReorderSheet
          target={target}
          source="order_card"
          navigateToCart={navigateToCart}
          onClose={() => {
            onClose();
            setTarget(null);
          }}
        />
      </>
    );
  }
  const closeSheet = () => fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Đóng' }));
  const sendFromFirstOpen = async (send: { promise: Promise<unknown> }, navigateToCart = false) => {
    mocks.repurchaseOrder.mockReturnValueOnce(send.promise);
    const onClose = vi.fn();
    renderSheet(<Harness onClose={onClose} navigateToCart={navigateToCart} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Thêm vào giỏ (2)' }));
    });
    expect(mocks.repurchaseOrder).toHaveBeenCalledTimes(1);
    closeSheet();
    expect(onClose).toHaveBeenCalledTimes(1);
    return onClose;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.repurchaseOrder.mockReset();
    mocks.checkboxRenders.length = 0;
    useAuthStore.setState({ status: 'idle' });
  });

  it('khách đóng rồi mở lại CÙNG đơn và chỉnh số lượng: lệnh cũ xong muộn không đóng sheet mới, số lượng đang chỉnh còn nguyên, thông báo + tải lại giỏ vẫn chạy', async () => {
    const send = pending<unknown>();
    const onClose = await sendFromFirstOpen(send);
    fireEvent.click(screen.getByRole('button', { name: 'mở đơn A' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Tăng số lượng/ }));
    expect(screen.getByRole('button', { name: 'Thêm vào giỏ (3)' })).toBeInTheDocument();

    await act(async () => send.resolve(ADDED('a')));
    await waitFor(() => expect(mocks.trackReorderCompleted).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' })));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Thêm vào giỏ (3)' })).toBeInTheDocument();
    // Khoá đã nhả: sheet mới gửi được lệnh của chính nó.
    mocks.repurchaseOrder.mockResolvedValueOnce(ADDED('a'));
    fireEvent.click(screen.getByRole('button', { name: 'Thêm vào giỏ (3)' }));
    await waitFor(() => expect(mocks.repurchaseOrder).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
  });

  it('khách đóng rồi mở Mua lại cho đơn KHÁC: lệnh của đơn cũ xong muộn không đóng sheet của đơn mới, số lượng đang chỉnh còn nguyên', async () => {
    const send = pending<unknown>();
    const onClose = await sendFromFirstOpen(send);
    fireEvent.click(screen.getByRole('button', { name: 'mở đơn B' }));
    expect(await screen.findByRole('button', { name: 'Thêm vào giỏ (1)' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Tăng số lượng/ }));
    expect(screen.getByRole('button', { name: 'Thêm vào giỏ (2)' })).toBeInTheDocument();

    await act(async () => send.resolve(ADDED('a')));
    await waitFor(() => expect(mocks.trackReorderCompleted).toHaveBeenCalledTimes(1));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Thêm vào giỏ (2)' })).toBeInTheDocument();
  });

  it('đối chứng: khách đóng sheet mà không mở lại, lệnh xong thì vẫn gọi onClose như cũ', async () => {
    const send = pending<unknown>();
    const onClose = await sendFromFirstOpen(send);
    await act(async () => send.resolve(ADDED('a')));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
  });

  it('đối chứng: sheet mở suốt lúc lệnh bay, xong thì gọi onClose đúng một lần', async () => {
    const send = pending<unknown>();
    mocks.repurchaseOrder.mockReturnValueOnce(send.promise);
    const onClose = vi.fn();
    renderSheet(<Harness onClose={onClose} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Thêm vào giỏ (2)' }));
    });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => send.resolve(ADDED('a')));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  describe('navigateToCart bật (kệ Mua lại, thẻ đơn, chi tiết đơn)', () => {
    it('khách đóng rồi mở lại CÙNG đơn và chỉnh số lượng: lệnh cũ xong muộn KHÔNG nhảy sang giỏ, sheet mới còn mở với số lượng đang chỉnh; báo thành công có nút "Xem giỏ"', async () => {
      const send = pending<unknown>();
      const onClose = await sendFromFirstOpen(send, true);
      fireEvent.click(screen.getByRole('button', { name: 'mở đơn A' }));
      fireEvent.click(await screen.findByRole('button', { name: /^Tăng số lượng/ }));
      expect(screen.getByRole('button', { name: 'Thêm vào giỏ (3)' })).toBeInTheDocument();

      await act(async () => send.resolve(ADDED('a')));
      await waitFor(() => expect(mocks.trackReorderCompleted).toHaveBeenCalledTimes(1));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });
      expect(mocks.navigate).not.toHaveBeenCalled();
      expect(mocks.openSnackbar).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'success', action: expect.objectContaining({ text: copy.reorder.viewCart }) }),
      );
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Thêm vào giỏ (3)' })).toBeInTheDocument();
    });

    it('khách đóng sheet mà không mở lại: lệnh xong thì sang giỏ như cũ', async () => {
      const send = pending<unknown>();
      const onClose = await sendFromFirstOpen(send, true);
      await act(async () => send.resolve(ADDED('a')));
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
      expect(mocks.navigate).toHaveBeenCalledTimes(1);
      expect(mocks.navigate).toHaveBeenCalledWith('/cart');
    });

    it('sheet mở suốt lúc lệnh bay: xong thì sang giỏ đúng một lần như cũ', async () => {
      const send = pending<unknown>();
      mocks.repurchaseOrder.mockReturnValueOnce(send.promise);
      const onClose = vi.fn();
      renderSheet(<Harness onClose={onClose} navigateToCart />);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Thêm vào giỏ (2)' }));
      });
      await act(async () => send.resolve(ADDED('a')));
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(mocks.navigate).toHaveBeenCalledTimes(1);
      expect(mocks.navigate).toHaveBeenCalledWith('/cart');
    });
  });
});
