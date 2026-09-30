import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComponentProps, ReactElement } from 'react';
import type * as UiForm from '../ui/form';
import type * as ZmpUi from 'zmp-ui';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(), openSnackbar: vi.fn(), repurchaseOrder: vi.fn(), addToCart: vi.fn(),
  trackReorderClicked: vi.fn(), trackReorderCompleted: vi.fn(),
  /** `checked` của MỌI lần render Checkbox theo thứ tự — để bắt "khung hình đầu" trước khi effect chạy. */
  checkboxRenders: [] as { label: string; checked: boolean }[],
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof ZmpUi>()),
  useNavigate: () => mocks.navigate,
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../../services/shop-api', () => ({ repurchaseOrder: mocks.repurchaseOrder, addToCart: mocks.addToCart }));
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
import { ReorderSheet } from './reorder-sheet';
import type { ReorderLine, ReorderTarget } from './reorder-types';

const CART = { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 200000, itemCount: 2 };
const line = (key: string, name: string, over: Partial<ReorderLine> = {}): ReorderLine => ({
  key, variationId: `v-${key}`, productName: name, variationName: 'Chanh', thumbnail: null, unitPrice: 50000,
  defaultQuantity: 2, maxQuantity: 5, available: true, ...over,
});
const ORDER: ReorderTarget = {
  kind: 'order',
  orderCode: 'TUBU1',
  lines: [line('a', 'Nước rửa chén'), line('b', 'Xà phòng', { available: false, maxQuantity: 0 })],
};

function renderSheet(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

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
    fireEvent.click(screen.getAllByRole('button', { name: 'Tăng số lượng' })[0]!);
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
    fireEvent.click(screen.getByRole('button', { name: 'Tăng số lượng' }));
    expect(mocks.trackReorderClicked).toHaveBeenCalledTimes(1);
  });

  it('target=null → không hiện gì', () => {
    renderSheet(<ReorderSheet target={null} source="order_card" onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: /Thêm vào giỏ/ })).toBeNull();
  });
});
