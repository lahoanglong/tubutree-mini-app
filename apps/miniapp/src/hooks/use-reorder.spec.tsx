import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(), openSnackbar: vi.fn(), addToCart: vi.fn(), repurchaseOrder: vi.fn(), trackReorderCompleted: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => mocks.navigate,
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/shop-api', () => ({ addToCart: mocks.addToCart, repurchaseOrder: mocks.repurchaseOrder }));
vi.mock('../services/buy-flow-events', () => ({ trackReorderCompleted: mocks.trackReorderCompleted }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import { useReorder } from './use-reorder';
import type { ReorderLine, ReorderTarget } from '../components/reorder/reorder-types';

const CART = { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 200000, itemCount: 1 };
const line = (key: string): ReorderLine => ({
  key, variationId: `v-${key}`, productName: `SP ${key}`, variationName: '', thumbnail: null, unitPrice: 1000, defaultQuantity: 1, maxQuantity: 5, available: true,
});
const ITEM: ReorderTarget = { kind: 'item', line: line('v1') };
const ORDER: ReorderTarget = { kind: 'order', orderCode: 'TUBU1', lines: [line('a'), line('b')] };

function setup(source: Parameters<typeof useReorder>[0], opts?: Parameters<typeof useReorder>[1]) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { qc, ...renderHook(() => useReorder(source, opts), { wrapper }) };
}

describe('useReorder', () => {
  beforeEach(() => vi.clearAllMocks());

  it('1 SP từ kệ Home: addToCart với addSource=repurchase; cập nhật ["cart"]; snackbar có "Xem giỏ"; KHÔNG tự chuyển trang', async () => {
    mocks.addToCart.mockResolvedValue(CART);
    const { result, qc } = setup('home_rail');
    let summary;
    await act(async () => {
      summary = await result.current.submit(ITEM, [{ key: 'v1', variationId: 'v-v1', quantity: 2 }]);
    });
    expect(mocks.addToCart).toHaveBeenCalledWith('v-v1', 2, 'repurchase');
    expect(qc.getQueryData(['cart'])).toEqual(CART);
    expect(summary).toMatchObject({ addedUnits: 2 });
    expect(mocks.trackReorderCompleted).toHaveBeenCalledWith({ source: 'home_rail', added: 1, skipped: 0 });
    expect(mocks.openSnackbar).toHaveBeenCalledTimes(1);
    const snack = mocks.openSnackbar.mock.calls[0]![0];
    expect(snack).toMatchObject({ text: 'Đã thêm 2 món vào giỏ', type: 'success', action: { text: 'Xem giỏ', close: true } });
    snack.action.onClick();
    expect(mocks.navigate).toHaveBeenCalledWith('/cart');
  });

  it('từ thông báo nhắc: addSource=reorder_notification', async () => {
    mocks.addToCart.mockResolvedValue(CART);
    const { result } = setup('notification');
    await act(async () => {
      await result.current.submit(ITEM, [{ key: 'v1', variationId: 'v-v1', quantity: 1 }]);
    });
    expect(mocks.addToCart).toHaveBeenCalledWith('v-v1', 1, 'reorder_notification');
  });

  it('cả đơn: repurchaseOrder chỉ với dòng đã chọn; navigateToCart → sang /cart; dòng bị bỏ → snackbar warning', async () => {
    mocks.repurchaseOrder.mockResolvedValue({
      cart: CART,
      legacy: false,
      results: [
        { orderItemId: 'a', status: 'added', addedQuantity: 1 },
        { orderItemId: 'b', status: 'skipped', reason: 'OUT_OF_STOCK', addedQuantity: 0 },
      ],
    });
    const { result } = setup('order_detail', { navigateToCart: true });
    await act(async () => {
      await result.current.submit(ORDER, [
        { key: 'a', variationId: 'v-a', quantity: 1 },
        { key: 'b', variationId: 'v-b', quantity: 1 },
      ]);
    });
    expect(mocks.repurchaseOrder).toHaveBeenCalledWith('TUBU1', {
      items: [{ orderItemId: 'a', quantity: 1 }, { orderItemId: 'b', quantity: 1 }],
      addSource: 'repurchase',
    });
    expect(mocks.openSnackbar.mock.calls[0]![0]).toMatchObject({ type: 'warning', text: 'Đã thêm 1 món vào giỏ. Chưa thêm đủ: SP b (hết hàng)' });
    expect(mocks.openSnackbar.mock.calls[0]![0]).not.toHaveProperty('action');
    expect(mocks.navigate).toHaveBeenCalledWith('/cart');
    expect(mocks.trackReorderCompleted).toHaveBeenCalledWith({ source: 'order_detail', added: 1, skipped: 1 });
  });

  it('không thêm được món nào → snackbar lỗi, không chuyển trang dù navigateToCart', async () => {
    mocks.repurchaseOrder.mockResolvedValue({
      cart: CART, legacy: false, results: [{ orderItemId: 'a', status: 'skipped', reason: 'INACTIVE', addedQuantity: 0 }],
    });
    const { result } = setup('order_card', { navigateToCart: true });
    await act(async () => {
      await result.current.submit(ORDER, [{ key: 'a', variationId: 'v-a', quantity: 1 }]);
    });
    expect(mocks.openSnackbar.mock.calls[0]![0]).toMatchObject({ type: 'error' });
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('lỗi mạng → snackbar lỗi và submit reject (sheet giữ nguyên lựa chọn)', async () => {
    mocks.addToCart.mockRejectedValue(new Error('Network Error'));
    const { result } = setup('home_rail');
    await act(async () => {
      await expect(result.current.submit(ITEM, [{ key: 'v1', variationId: 'v-v1', quantity: 1 }])).rejects.toThrow('Network Error');
    });
    expect(mocks.openSnackbar.mock.calls[0]![0]).toMatchObject({ type: 'error' });
    expect(mocks.trackReorderCompleted).not.toHaveBeenCalled();
  });

  it('API cũ (legacy): coi như thêm đủ các dòng đã chọn, snackbar thành công chung chung', async () => {
    mocks.repurchaseOrder.mockResolvedValue({ cart: CART, legacy: true, results: [] });
    const { result } = setup('order_card');
    let summary;
    await act(async () => {
      summary = await result.current.submit(ORDER, [{ key: 'a', variationId: 'v-a', quantity: 2 }]);
    });
    expect(summary).toMatchObject({ addedUnits: 2, hasProblems: false });
    expect(mocks.openSnackbar.mock.calls[0]![0]).toMatchObject({ type: 'success', text: 'Đã thêm vào giỏ' });
  });

  it('dòng partial → snackbar warning nêu số lượng thêm được, vẫn tính là đã thêm', async () => {
    mocks.repurchaseOrder.mockResolvedValue({
      cart: CART, legacy: false, results: [{ orderItemId: 'a', status: 'partial', reason: 'EXCEEDS_STOCK', addedQuantity: 1 }],
    });
    const { result } = setup('orders_tab');
    await act(async () => {
      await result.current.submit(ORDER, [{ key: 'a', variationId: 'v-a', quantity: 3 }]);
    });
    expect(mocks.openSnackbar.mock.calls[0]![0]).toMatchObject({ type: 'warning', text: 'Đã thêm 1 món vào giỏ. Chưa thêm đủ: SP a (chỉ thêm được 1)' });
    expect(mocks.trackReorderCompleted).toHaveBeenCalledWith({ source: 'orders_tab', added: 1, skipped: 0 });
  });

  it.each([['item', ITEM], ['order', ORDER]] as const)('không chọn dòng nào (%s) → không gọi API, snackbar lỗi, submit reject', async (_kind, target) => {
    const { result } = setup('home_rail');
    await act(async () => {
      await expect(result.current.submit(target, [])).rejects.toThrow('Chưa chọn sản phẩm');
    });
    expect(mocks.addToCart).not.toHaveBeenCalled();
    expect(mocks.repurchaseOrder).not.toHaveBeenCalled();
    expect(mocks.openSnackbar.mock.calls[0]![0]).toMatchObject({ type: 'error' });
  });

  describe('chống bấm đúp đồng bộ', () => {
    const SEL = [{ key: 'v1', variationId: 'v-v1', quantity: 1 }];

    it('hai lần submit cùng tick → 1 request, 1 snackbar, 1 reorder_completed; cả hai cùng nhận kết quả', async () => {
      let resolve!: (c: typeof CART) => void;
      mocks.addToCart.mockReturnValue(new Promise((r) => { resolve = r; }));
      const { result } = setup('home_rail');
      let first!: Promise<unknown>;
      let second!: Promise<unknown>;
      act(() => {
        first = result.current.submit(ITEM, SEL);
        second = result.current.submit(ITEM, SEL);
      });
      await act(async () => { resolve(CART); });
      const [a, b] = await Promise.all([first, second]);
      expect(b).toBe(a);
      expect(mocks.addToCart).toHaveBeenCalledTimes(1);
      expect(mocks.openSnackbar).toHaveBeenCalledTimes(1);
      expect(mocks.trackReorderCompleted).toHaveBeenCalledTimes(1);
    });

    it('hai lần submit cùng tick khi lỗi → 1 request, 1 snackbar lỗi, cả hai promise đều reject (không unhandled)', async () => {
      mocks.repurchaseOrder.mockRejectedValue(new Error('Network Error'));
      const { result } = setup('order_detail');
      let first!: Promise<unknown>;
      let second!: Promise<unknown>;
      act(() => {
        first = result.current.submit(ORDER, [{ key: 'a', variationId: 'v-a', quantity: 1 }]);
        second = result.current.submit(ORDER, [{ key: 'a', variationId: 'v-a', quantity: 1 }]);
      });
      await act(async () => {
        await expect(first).rejects.toThrow('Network Error');
        await expect(second).rejects.toThrow('Network Error');
      });
      expect(mocks.repurchaseOrder).toHaveBeenCalledTimes(1);
      expect(mocks.openSnackbar).toHaveBeenCalledTimes(1);
    });

    it('sau khi thành công guard được nhả: lần submit sau gửi request mới', async () => {
      mocks.addToCart.mockResolvedValue(CART);
      const { result } = setup('home_rail');
      await act(async () => { await result.current.submit(ITEM, SEL); });
      await act(async () => { await result.current.submit(ITEM, SEL); });
      expect(mocks.addToCart).toHaveBeenCalledTimes(2);
      expect(mocks.trackReorderCompleted).toHaveBeenCalledTimes(2);
    });

    it('sau khi request lỗi guard được nhả: lần submit sau gửi request mới và thành công', async () => {
      mocks.addToCart.mockRejectedValueOnce(new Error('Network Error')).mockResolvedValueOnce(CART);
      const { result } = setup('home_rail');
      await act(async () => {
        await expect(result.current.submit(ITEM, SEL)).rejects.toThrow('Network Error');
      });
      await act(async () => { await result.current.submit(ITEM, SEL); });
      expect(mocks.addToCart).toHaveBeenCalledTimes(2);
      expect(mocks.trackReorderCompleted).toHaveBeenCalledTimes(1);
    });
  });
});
