import { renderHook, act, waitFor } from '@testing-library/react';
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
import { HttpError } from '../services/http';
import { LOCK_REFRESH_WAIT_MS } from '../utils/settle-within';
import type { ReorderLine, ReorderTarget } from '../components/reorder/reorder-types';

const CART = { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 200000, itemCount: 1 };
const line = (key: string): ReorderLine => ({
  key, variationId: `v-${key}`, productName: `SP ${key}`, variationName: '', thumbnail: null, unitPrice: 1000, defaultQuantity: 1, maxQuantity: 5, available: true, notices: [],
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

  it('1 SP từ kệ Home: addToCart với addSource=repurchase; tải lại ["cart"] (không ghi giỏ không kèm gian hàng vào cache); snackbar có "Xem giỏ"; KHÔNG tự chuyển trang', async () => {
    mocks.addToCart.mockResolvedValue(CART);
    const { result, qc } = setup('home_rail');
    qc.setQueryData(['cart', 'shop-a'], { ...CART, comboDiscount: 5000 });
    let summary;
    await act(async () => {
      summary = await result.current.submit(ITEM, [{ key: 'v1', variationId: 'v-v1', quantity: 2 }]);
    });
    expect(mocks.addToCart).toHaveBeenCalledWith('v-v1', 2, 'repurchase');
    expect(qc.getQueryData(['cart', null])).toBeUndefined();
    expect(qc.getQueryState(['cart', 'shop-a'])?.isInvalidated).toBe(true);
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

  it('R-26: thêm đủ và navigateToCart → sang /cart, không snackbar che nút Thanh toán', async () => {
    mocks.repurchaseOrder.mockResolvedValue({ cart: CART, legacy: false, results: [{ orderItemId: 'a', status: 'added', addedQuantity: 1 }] });
    const { result } = setup('order_detail', { navigateToCart: true });
    await act(async () => {
      await result.current.submit(ORDER, [{ key: 'a', variationId: 'v-a', quantity: 1 }]);
    });
    expect(mocks.openSnackbar).not.toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith('/cart');
  });

  describe('stillCurrent (nơi gửi đã bị đóng rồi mở lại trong lúc chờ)', () => {
    const ADDED = { cart: CART, legacy: false, results: [{ orderItemId: 'a', status: 'added', addedQuantity: 1 }] };

    it('trả false và navigateToCart bật: KHÔNG sang giỏ, rơi xuống snackbar có nút "Xem giỏ"; nút đó vẫn sang giỏ', async () => {
      mocks.repurchaseOrder.mockResolvedValue(ADDED);
      const { result } = setup('order_detail', { navigateToCart: true });
      await act(async () => {
        await result.current.submit(ORDER, [{ key: 'a', variationId: 'v-a', quantity: 1 }], () => false);
      });
      expect(mocks.navigate).not.toHaveBeenCalled();
      expect(mocks.openSnackbar).toHaveBeenCalledTimes(1);
      const snack = mocks.openSnackbar.mock.calls[0]![0];
      expect(snack).toMatchObject({ type: 'success', action: { text: 'Xem giỏ', close: true } });
      snack.action.onClick();
      expect(mocks.navigate).toHaveBeenCalledWith('/cart');
    });

    it('hỏi LÚC lệnh xong, không phải lúc gửi', async () => {
      let resolveSend!: (v: unknown) => void;
      mocks.repurchaseOrder.mockReturnValue(new Promise((res) => { resolveSend = res; }));
      let current = true;
      const { result } = setup('order_detail', { navigateToCart: true });
      let done!: Promise<unknown>;
      await act(async () => {
        done = result.current.submit(ORDER, [{ key: 'a', variationId: 'v-a', quantity: 1 }], () => current);
      });
      current = false;
      await act(async () => {
        resolveSend(ADDED);
        await done;
      });
      expect(mocks.navigate).not.toHaveBeenCalled();
    });

    it('trả true: sang giỏ như cũ', async () => {
      mocks.repurchaseOrder.mockResolvedValue(ADDED);
      const { result } = setup('order_detail', { navigateToCart: true });
      await act(async () => {
        await result.current.submit(ORDER, [{ key: 'a', variationId: 'v-a', quantity: 1 }], () => true);
      });
      expect(mocks.openSnackbar).not.toHaveBeenCalled();
      expect(mocks.navigate).toHaveBeenCalledWith('/cart');
    });
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

// W113A: mua lại bị máy chủ từ chối vì đơn/món đã đổi (400/404/409) thì `inFlight` giữ tới khi giỏ, đơn và kệ Mua lại làm mới về (tối đa LOCK_REFRESH_WAIT_MS), kẻo bấm lại trên số cũ nhận đúng lỗi đó.
// Mất mạng, quá hạn, 401, 5xx không nói gì về trạng thái thật: không tải lại, nhả ngay.
describe('useReorder — máy chủ từ chối thì giữ khoá tới khi dữ liệu làm mới về (W113A)', () => {
  const SEL = [{ key: 'v1', variationId: 'v-v1', quantity: 1 }];
  const ORDER_SEL = [{ key: 'a', variationId: 'v-a', quantity: 1 }];
  const deferred = () => {
    let resolve!: (v?: unknown) => void;
    const promise = new Promise((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };
  const serverError = (message: string, status: number) => new HttpError(message, undefined, { status, data: { message }, headers: {} });
  const outcome = (p: Promise<unknown>) => p.then(() => 'ok', () => 'rejected');
  const setupLive = (refresh: () => Promise<unknown>) => {
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries').mockImplementation((() => refresh()) as never);
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    return { invalidate, ...renderHook(() => useReorder('home_rail'), { wrapper }) };
  };
  const CASES = [
    { name: 'một món (kệ Mua lại)', target: ITEM, selections: SEL, write: mocks.addToCart, keys: [['cart'], ['purchased-items'], ['orders']] },
    { name: 'cả đơn', target: ORDER, selections: ORDER_SEL, write: mocks.repurchaseOrder, keys: [['cart'], ['purchased-items'], ['orders'], ['order', 'TUBU1']] },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.addToCart.mockReset();
    mocks.repurchaseOrder.mockReset();
  });

  describe.each(CASES)('$name', (c) => {
    const succeed = () =>
      c.write.mockResolvedValue(c.target.kind === 'item' ? CART : { cart: CART, legacy: false, results: [{ orderItemId: 'a', status: 'added', addedQuantity: 1 }] });

    it.each([
      [400, 'Đơn này không mua lại được'],
      [404, 'Không tìm thấy đơn'],
      [409, 'Vừa có thay đổi, bạn thử lại nhé'],
    ])('bị từ chối %i: báo lỗi một lần, tải lại đúng khoá, giữ khoá tới khi dữ liệu về rồi mới nhả', async (status, message) => {
      c.write.mockRejectedValueOnce(serverError(message, status));
      succeed();
      const refresh = deferred();
      const { result, invalidate } = setupLive(() => refresh.promise);
      let first!: Promise<unknown>;
      act(() => {
        first = result.current.submit(c.target, c.selections);
      });
      const firstOutcome = outcome(first);
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: message, type: 'error' })));
      expect(mocks.openSnackbar).toHaveBeenCalledTimes(1);
      expect(invalidate.mock.calls.map(([filter]) => filter)).toEqual(c.keys.map((queryKey) => ({ queryKey })));
      // Đã báo lỗi mà dữ liệu chưa về: vẫn bận, chạm thêm nhận lại đúng lời hứa đang bay và không gửi lần hai.
      expect(result.current.isPending).toBe(true);
      let second!: Promise<unknown>;
      act(() => {
        second = result.current.submit(c.target, c.selections);
      });
      expect(second).toBe(first);
      expect(c.write).toHaveBeenCalledTimes(1);
      await act(async () => refresh.resolve());
      await expect(firstOutcome).resolves.toBe('rejected');
      await waitFor(() => expect(result.current.isPending).toBe(false));
      expect(mocks.openSnackbar).toHaveBeenCalledTimes(1);
      await act(async () => {
        await result.current.submit(c.target, c.selections);
      });
      expect(c.write).toHaveBeenCalledTimes(2);
    });

    it.each([
      ['mất mạng', new HttpError('Network Error', 'ERR_NETWORK')],
      ['hết thời gian', new HttpError('timeout', 'ECONNABORTED')],
      ['máy chủ lỗi 503', serverError('Service Unavailable', 503)],
      ['hết phiên 401', serverError('Unauthorized', 401)],
    ])('%s: không giữ khoá chờ tải lại, khoá nhả ngay', async (_label, error) => {
      c.write.mockRejectedValueOnce(error);
      succeed();
      const { result, invalidate } = setupLive(() => new Promise(() => undefined));
      await act(async () => {
        await expect(result.current.submit(c.target, c.selections)).rejects.toBe(error);
      });
      expect(mocks.openSnackbar).toHaveBeenCalledTimes(1);
      expect(invalidate).not.toHaveBeenCalled();
      expect(result.current.isPending).toBe(false);
      await act(async () => {
        await result.current.submit(c.target, c.selections);
      });
      expect(c.write).toHaveBeenCalledTimes(2);
    });

    it('tải lại treo mãi: khoá nhả đúng sau LOCK_REFRESH_WAIT_MS', async () => {
      c.write.mockRejectedValueOnce(serverError('Vừa có thay đổi, bạn thử lại nhé', 409));
      succeed();
      const { result } = setupLive(() => new Promise(() => undefined));
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        let first!: Promise<unknown>;
        act(() => {
          first = result.current.submit(c.target, c.selections);
        });
        const firstOutcome = outcome(first);
        await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledTimes(1));
        await act(async () => {
          await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 500);
        });
        expect(result.current.isPending).toBe(true);
        let second!: Promise<unknown>;
        act(() => {
          second = result.current.submit(c.target, c.selections);
        });
        expect(second).toBe(first);
        await act(async () => {
          await vi.advanceTimersByTimeAsync(600);
        });
        await expect(firstOutcome).resolves.toBe('rejected');
        await waitFor(() => expect(result.current.isPending).toBe(false));
      } finally {
        vi.useRealTimers();
      }
      await act(async () => {
        await result.current.submit(c.target, c.selections);
      });
      expect(c.write).toHaveBeenCalledTimes(2);
    });
  });
});
