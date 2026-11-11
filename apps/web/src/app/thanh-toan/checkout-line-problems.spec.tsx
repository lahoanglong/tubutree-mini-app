// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { ApiError, NetworkError } from '@/lib/client-api';

const ADDR = {
  id: 'a1', recipient: 'An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Ba Đình', street: '1 Phố Huế',
  provinceCode: '84_VN01', districtCode: '', wardCode: '84_VN01_00004', isDefault: true,
};
const line = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id, variationId: `v-${id}`, productName: name, variationName: null, slug: id, thumbnail: null, unitPrice: 100000, quantity: 1, stock: 5, total: 100000, ...over,
});
const QUOTE = { subtotal: 100000, discount: 0, pointsUsed: 0, pointsDiscount: 0, shippingFee: 30000, total: 130000, pointsEarned: 0, pointsBalance: 0, redeemablePoints: 0 };

const m = vi.hoisted(() => ({
  items: [] as Record<string, unknown>[],
  quote: vi.fn(),
  cart: vi.fn(),
  updateCartItem: vi.fn(),
  removeCartItem: vi.fn(),
  placeOrder: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u', walletBalance: 0 }, status: 'authenticated' }) }));
vi.mock('@/lib/geo-client', () => ({ getProvinces: async () => [], getCommunes: async () => [] }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: (...args: unknown[]) => m.cart(...args),
  getMe: async () => ({ pointsBalance: 0, walletBalance: 0 }),
  getMyCoupons: async () => [],
  getAddresses: async () => [ADDR],
  checkoutQuote: (...args: unknown[]) => m.quote(...args),
  placeOrder: (...args: unknown[]) => m.placeOrder(...args),
  updateCartItem: (...args: unknown[]) => m.updateCartItem(...args),
  removeCartItem: (...args: unknown[]) => m.removeCartItem(...args),
}));

import CheckoutPage from './page';

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<CheckoutPage />);
  mounted.push(r);
  await flush(8);
  return r;
};
const problems = (r: Rendered) => Array.from(r.container.querySelectorAll('[data-testid="checkout-line-problem"]'));
const placeButton = (r: Rendered) => byText(r.container, 'button', 'Đặt hàng') as HTMLButtonElement;

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  m.quote.mockReset().mockResolvedValue(QUOTE);
  m.updateCartItem.mockReset().mockResolvedValue({});
  m.removeCartItem.mockReset().mockResolvedValue({});
  m.placeOrder.mockReset();
  m.items = [];
  m.cart.mockReset().mockImplementation(async () => ({
    items: m.items, couponCode: null, subtotal: 100000, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: m.items.length,
  }));
});
afterEach(() => {
  mounted.forEach((x) => x.unmount());
  mounted = [];
});

describe('/thanh-toan — lỗi theo từng dòng hàng (hk)', () => {
  it('dòng vượt tồn: chữ "Còn 2 sản phẩm" ngay dưới dòng, nút "Giảm còn 2" sửa tại màn rồi tải lại giỏ và báo giá', async () => {
    m.items = [line('i1', 'Dầu gội', { quantity: 4, stock: 2 })];
    const r = await mount();
    expect(problems(r).length).toBeGreaterThan(0);
    expect(problems(r)[0]!.textContent).toContain('Còn 2 sản phẩm');
    expect(r.container.querySelector('[data-testid="checkout-cart-issue"]')).toBeNull();
    expect(placeButton(r).disabled).toBe(true);
    const carts = m.cart.mock.calls.length;
    const quotes = m.quote.mock.calls.length;
    click(byText(problems(r)[0]!, 'button', 'Giảm còn 2')!);
    await flush(8);
    expect(m.updateCartItem).toHaveBeenCalledWith('i1', 2);
    expect(m.cart.mock.calls.length).toBeGreaterThan(carts);
    expect(m.quote.mock.calls.length).toBeGreaterThan(quotes);
  });

  it('dòng hết hàng: "Hết hàng" và "Bỏ khỏi đơn" gọi removeCartItem đúng dòng; dòng còn hàng không có nút sửa', async () => {
    m.items = [line('i1', 'Dầu gội', { stock: 0 }), line('i2', 'Mật ong')];
    const r = await mount();
    const first = problems(r)[0]!;
    expect(first.textContent).toContain('Hết hàng');
    expect(new Set(problems(r).map((p) => p.textContent)).size).toBe(1);
    click(byText(first, 'button', 'Bỏ khỏi đơn')!);
    await flush(8);
    expect(m.removeCartItem).toHaveBeenCalledWith('i1');
    expect(m.updateCartItem).not.toHaveBeenCalled();
  });

  it('sửa nhanh bị máy chủ từ chối: câu lỗi hiện ngay dòng đó, không mất dòng', async () => {
    m.items = [line('i1', 'Dầu gội', { stock: 0 })];
    m.removeCartItem.mockRejectedValue(new ApiError('Giỏ hàng không còn sản phẩm này.', 404));
    const r = await mount();
    click(byText(problems(r)[0]!, 'button', 'Bỏ khỏi đơn')!);
    await flush(8);
    expect(problems(r)[0]!.textContent).toContain('Giỏ hàng không còn sản phẩm này.');
  });

  it('bấm "Bỏ khỏi đơn" hai lần liền: nút còn bận tới khi giỏ mới về, chỉ xoá một lần (không gọi lần hai rồi nhận 404)', async () => {
    m.items = [line('i1', 'Dầu gội', { stock: 0 }), line('i2', 'Mật ong')];
    const r = await mount();
    let release: () => void = () => undefined;
    m.cart.mockImplementation(() => new Promise((resolve) => {
      release = () => resolve({ items: [line('i2', 'Mật ong')], couponCode: null, subtotal: 100000, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: 1 });
    }));
    const btn = byText(problems(r)[0]!, 'button', 'Bỏ khỏi đơn') as HTMLButtonElement;
    click(btn);
    await flush(6);
    expect(m.removeCartItem).toHaveBeenCalledTimes(1);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    click(btn);
    await flush(4);
    expect(m.removeCartItem).toHaveBeenCalledTimes(1);
    release();
    await flush(8);
    expect(problems(r)).toHaveLength(0);
    expect(m.removeCartItem).toHaveBeenCalledTimes(1);
  });

  it('sửa nhanh bị từ chối (tồn đã đổi): câu lỗi hiện ở dòng đó và giỏ được tải lại để nút "Giảm còn n" theo tồn mới', async () => {
    m.items = [line('i1', 'Dầu gội', { quantity: 4, stock: 1 })];
    m.updateCartItem.mockRejectedValue(new ApiError('Kho đã đổi, bạn thử lại nhé.', 400));
    const r = await mount();
    const carts = m.cart.mock.calls.length;
    m.items = [line('i1', 'Dầu gội', { quantity: 4, stock: 2 })];
    click(byText(problems(r)[0]!, 'button', 'Giảm còn 1')!);
    await flush(8);
    expect(m.cart.mock.calls.length).toBeGreaterThan(carts);
    expect(byText(problems(r)[0]!, 'button', 'Giảm còn 2')).toBeTruthy();
  });

  it('còn dòng cần sửa: ghi lý do khoá nút ở dải đáy', async () => {
    m.items = [line('i1', 'Dầu gội', { stock: 0 })];
    const r = await mount();
    expect(r.container.textContent).toContain('Sửa sản phẩm đang báo lỗi để đặt tiếp.');
  });

  it('dòng lỗi nằm sau dòng thứ 6: danh sách trong khung Đơn hàng tự mở ra để thấy dòng lỗi', async () => {
    m.items = [1, 2, 3, 4, 5, 6, 7].map((n) => line(`i${n}`, `Món ${n}`, n === 7 ? { stock: 0 } : {}));
    const r = await mount();
    const region = r.container.querySelector('[role="region"][aria-label="Sản phẩm trong đơn"]')!;
    expect(region.querySelectorAll('[data-testid="checkout-line"]')).toHaveLength(7);
    expect(region.querySelector('[data-testid="checkout-line-problem"]')).not.toBeNull();
  });
});

describe('/thanh-toan — sửa nhanh dòng hàng: khoá tới khi giỏ mới về, bị từ chối thì tải lại rồi mới nhả', () => {
  const cartOf = () => ({ items: m.items, couponCode: null, subtotal: 100000, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: m.items.length });
  const holdCart = () => {
    let open: () => void = () => undefined;
    m.cart.mockImplementation(
      () =>
        new Promise((resolve) => {
          open = () => resolve(cartOf());
        }),
    );
    return { release: () => open() };
  };
  const holdQuote = () => {
    let open: () => void = () => undefined;
    m.quote.mockImplementation(
      () =>
        new Promise((resolve) => {
          open = () => resolve(QUOTE);
        }),
    );
    return { release: () => open() };
  };
  const fixBtn = (r: Rendered, label: string, nth = 0) => byText(problems(r)[nth]!, 'button', label) as HTMLButtonElement;
  const isBusy = (b: HTMLElement) => b.getAttribute('aria-busy') === 'true';
  const alertOf = (r: Rendered, nth = 0) => problems(r)[nth]!.querySelector('span')!.textContent;

  it('hai cú chạm cùng khung hình vào "Bỏ khỏi đơn": chỉ xoá một lần, nút báo bận bằng aria (không disabled thật)', async () => {
    m.items = [line('i1', 'Dầu gội', { stock: 0 }), line('i2', 'Mật ong')];
    const r = await mount();
    const gate = holdCart();
    const btn = fixBtn(r, 'Bỏ khỏi đơn');
    act(() => {
      btn.click();
      btn.click();
    });
    await flush(6);
    expect(m.removeCartItem).toHaveBeenCalledTimes(1);
    expect(isBusy(btn)).toBe(true);
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(btn.disabled).toBe(false);
    gate.release();
    await flush(8);
  });

  it.each([400, 404, 409, 422])('%i: lời lỗi hiện ngay dòng đó, giỏ và báo giá được tải lại, nút giữ bận tới khi cả hai về; chạm lần hai không gửi', async (status) => {
    m.items = [line('i1', 'Dầu gội', { quantity: 4, stock: 1 })];
    m.updateCartItem.mockRejectedValue(new ApiError('Kho đã đổi, bạn thử lại nhé.', status));
    const r = await mount();
    const carts = m.cart.mock.calls.length;
    const quotes = m.quote.mock.calls.length;
    const cartGate = holdCart();
    const quoteGate = holdQuote();
    click(fixBtn(r, 'Giảm còn 1'));
    await flush(6);
    expect(alertOf(r)).toBe('Kho đã đổi, bạn thử lại nhé.');
    expect(m.cart.mock.calls.length).toBe(carts + 1);
    expect(m.quote.mock.calls.length).toBe(quotes + 1);
    expect(isBusy(fixBtn(r, 'Giảm còn 1'))).toBe(true);
    await act(async () => {
      fixBtn(r, 'Giảm còn 1').click();
      fixBtn(r, 'Giảm còn 1').click();
    });
    expect(m.updateCartItem).toHaveBeenCalledTimes(1);
    m.items = [line('i1', 'Dầu gội', { quantity: 4, stock: 2 })];
    cartGate.release();
    await flush(8);
    expect(isBusy(fixBtn(r, 'Giảm còn 2'))).toBe(true);
    quoteGate.release();
    await flush(8);
    expect(isBusy(fixBtn(r, 'Giảm còn 2'))).toBe(false);
  });

  // Lỗi không phải từ chối (quá hạn, 502, 401...) có thể đã ghi ở máy chủ: giỏ vẫn tải lại ở nền (như Mini), nhưng nút nhả ngay và báo giá không tải lại.
  it.each([401, 403, 500, 502, 503])('%i: giỏ tải lại ở nền, báo giá không, nút nhả ngay dù giỏ còn treo, giữ lời lỗi', async (status) => {
    m.items = [line('i1', 'Dầu gội', { stock: 0 })];
    m.removeCartItem.mockRejectedValue(new ApiError('Máy chủ bận.', status));
    const r = await mount();
    const carts = m.cart.mock.calls.length;
    const quotes = m.quote.mock.calls.length;
    const before = alertOf(r);
    holdCart();
    click(fixBtn(r, 'Bỏ khỏi đơn'));
    await flush(6);
    expect(m.cart.mock.calls.length).toBe(carts + 1);
    expect(m.quote.mock.calls.length).toBe(quotes);
    expect(isBusy(fixBtn(r, 'Bỏ khỏi đơn'))).toBe(false);
    expect(alertOf(r)).not.toBe(before);
  });

  it('mất mạng: giỏ tải lại ở nền, báo giá không, nút nhả ngay', async () => {
    m.items = [line('i1', 'Dầu gội', { stock: 0 })];
    m.removeCartItem.mockRejectedValue(new NetworkError(false));
    const r = await mount();
    const carts = m.cart.mock.calls.length;
    const quotes = m.quote.mock.calls.length;
    holdCart();
    click(fixBtn(r, 'Bỏ khỏi đơn'));
    await flush(6);
    expect(m.cart.mock.calls.length).toBe(carts + 1);
    expect(m.quote.mock.calls.length).toBe(quotes);
    expect(isBusy(fixBtn(r, 'Bỏ khỏi đơn'))).toBe(false);
  });

  it('bị từ chối mà giỏ tải lại treo quá 4 giây: nhả nút', async () => {
    m.items = [line('i1', 'Dầu gội', { stock: 0 })];
    m.removeCartItem.mockRejectedValue(new ApiError('Giỏ hàng không còn sản phẩm này.', 404));
    const r = await mount();
    holdCart();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      click(fixBtn(r, 'Bỏ khỏi đơn'));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_900);
      });
      expect(isBusy(fixBtn(r, 'Bỏ khỏi đơn'))).toBe(true);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(isBusy(fixBtn(r, 'Bỏ khỏi đơn'))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sửa được mà giỏ/báo giá tải lại treo quá 4 giây: nhả nút, không giữ mãi', async () => {
    m.items = [line('i1', 'Dầu gội', { stock: 0 }), line('i2', 'Mật ong')];
    const r = await mount();
    holdCart();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      click(fixBtn(r, 'Bỏ khỏi đơn'));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_900);
      });
      expect(isBusy(fixBtn(r, 'Bỏ khỏi đơn'))).toBe(true);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(isBusy(fixBtn(r, 'Bỏ khỏi đơn'))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('hai dòng khác nhau: chạm dòng thứ hai khi dòng đầu còn bay vẫn gửi, và cả hai nút cùng báo bận', async () => {
    m.items = [line('i1', 'Dầu gội', { stock: 0 }), line('i2', 'Mật ong', { stock: 0 })];
    const r = await mount();
    const gate = holdCart();
    click(fixBtn(r, 'Bỏ khỏi đơn', 0));
    await flush(4);
    click(fixBtn(r, 'Bỏ khỏi đơn', 1));
    await flush(4);
    expect(m.removeCartItem.mock.calls.map((c) => c[0])).toEqual(['i1', 'i2']);
    expect(isBusy(fixBtn(r, 'Bỏ khỏi đơn', 0))).toBe(true);
    expect(isBusy(fixBtn(r, 'Bỏ khỏi đơn', 1))).toBe(true);
    m.items = [];
    gate.release();
    await flush(8);
  });

  it('chạm lại sau lỗi: lời lỗi cũ của dòng đó mất khi lệnh mới bắt đầu', async () => {
    m.items = [line('i1', 'Dầu gội', { quantity: 4, stock: 1 })];
    m.updateCartItem.mockRejectedValueOnce(new ApiError('Kho đã đổi, bạn thử lại nhé.', 409));
    const r = await mount();
    click(fixBtn(r, 'Giảm còn 1'));
    await flush(8);
    expect(alertOf(r)).toBe('Kho đã đổi, bạn thử lại nhé.');
    m.updateCartItem.mockImplementation(() => new Promise(() => undefined));
    click(fixBtn(r, 'Giảm còn 1'));
    await flush(6);
    expect(alertOf(r)).not.toBe('Kho đã đổi, bạn thử lại nhé.');
  });

  it('lỗi của dòng này không hiện ở dòng khác', async () => {
    m.items = [line('i1', 'Dầu gội', { stock: 0 }), line('i2', 'Mật ong', { stock: 0 })];
    m.removeCartItem.mockRejectedValue(new ApiError('Dòng này vừa đổi.', 422));
    const r = await mount();
    click(fixBtn(r, 'Bỏ khỏi đơn', 1));
    await flush(8);
    expect(alertOf(r, 1)).toBe('Dòng này vừa đổi.');
    expect(alertOf(r, 0)).not.toBe('Dòng này vừa đổi.');
  });

  it('lỗi của dòng này còn nguyên khi chạm sửa dòng khác (chỉ chạm lại chính dòng đó mới xoá)', async () => {
    m.items = [line('i1', 'Dầu gội', { stock: 0 }), line('i2', 'Mật ong', { stock: 0 })];
    m.removeCartItem.mockRejectedValueOnce(new ApiError('Dòng này vừa đổi.', 422));
    const r = await mount();
    click(fixBtn(r, 'Bỏ khỏi đơn', 0));
    await flush(8);
    expect(alertOf(r, 0)).toBe('Dòng này vừa đổi.');
    m.removeCartItem.mockImplementation(() => new Promise(() => undefined));
    click(fixBtn(r, 'Bỏ khỏi đơn', 1));
    await flush(6);
    expect(alertOf(r, 0)).toBe('Dòng này vừa đổi.');
  });

  describe('sửa nhanh sau một lần đặt hàng đã lỗi', () => {
    const OK_LINE = () => line('i1', 'Dầu gội');
    const PROBLEM_LINE = () => line('i2', 'Mật ong', { stock: 0 });
    const mountWithClient = async () => {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
      const r = render(<CheckoutPage />, qc);
      mounted.push(r);
      await flush(8);
      return { r, qc };
    };
    const placeBtn = (r: Rendered) => byText(r.container, 'button', /^(Đặt hàng|Thử lại ·)/) as HTMLButtonElement;
    // Giỏ đổi ở nơi khác sau lần đặt lỗi: dòng hết hàng hiện ra mà lời lỗi đặt hàng vẫn còn.
    const cartGainsProblemLine = async (qc: QueryClient) => {
      m.items = [OK_LINE(), PROBLEM_LINE()];
      await act(async () => {
        await qc.invalidateQueries({ queryKey: ['cart'] });
      });
      await flush(6);
    };

    it('lời lỗi đặt hàng lần trước mất khi sửa được dòng (không để lời cũ nằm cạnh giỏ đã sửa)', async () => {
      m.items = [OK_LINE()];
      m.placeOrder.mockRejectedValue(new ApiError('Đơn bị từ chối vì phí vận chuyển.', 400));
      const { r, qc } = await mountWithClient();
      click(placeBtn(r));
      await flush(8);
      expect(r.container.textContent).toContain('Đơn bị từ chối vì phí vận chuyển.');
      await cartGainsProblemLine(qc);
      m.items = [OK_LINE()];
      click(fixBtn(r, 'Bỏ khỏi đơn'));
      await flush(10);
      expect(m.removeCartItem).toHaveBeenCalledWith('i2');
      expect(r.container.textContent).not.toContain('Đơn bị từ chối vì phí vận chuyển.');
    });

    it('lần đặt trước chưa rõ kết quả (mất mạng) rồi khách sửa dòng: bấm Đặt hàng không gửi lại đơn cũ mà báo kiểm tra Đơn hàng', async () => {
      m.items = [OK_LINE()];
      m.placeOrder.mockRejectedValue(new NetworkError(false));
      const { r, qc } = await mountWithClient();
      click(placeBtn(r));
      await flush(8);
      expect(m.placeOrder).toHaveBeenCalledTimes(1);
      await cartGainsProblemLine(qc);
      m.items = [OK_LINE()];
      click(fixBtn(r, 'Bỏ khỏi đơn'));
      await flush(10);
      click(placeBtn(r));
      await flush(8);
      expect(m.placeOrder).toHaveBeenCalledTimes(1);
      expect(r.container.textContent).toContain('Đơn trước có thể đã được tạo');
    });
  });
});

describe('/thanh-toan — sửa nhanh dòng hàng: rời trang rồi quay lại khi lệnh còn bay', () => {
  it('gắn lại trang cùng bộ nhớ truy vấn lúc lệnh xoá còn bay: nút vẫn báo bận và bấm lần hai không gửi lệnh thứ hai', async () => {
    m.items = [line('i1', 'Dầu gội'), line('i2', 'Mật ong', { stock: 0 })];
    let finish: () => void = () => undefined;
    m.removeCartItem.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({});
        }),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const first = render(<CheckoutPage />, qc);
    await flush(8);
    click(byText(problems(first)[0]!, 'button', 'Bỏ khỏi đơn')!);
    await flush(4);
    expect(m.removeCartItem).toHaveBeenCalledTimes(1);
    first.unmount();
    const second = render(<CheckoutPage />, qc);
    mounted.push(second);
    await flush(8);
    const btn = byText(problems(second)[0]!, 'button', 'Bỏ khỏi đơn') as HTMLButtonElement;
    expect(btn.getAttribute('aria-busy')).toBe('true');
    await act(async () => {
      btn.click();
      btn.click();
    });
    await flush(4);
    expect(m.removeCartItem).toHaveBeenCalledTimes(1);
    finish();
    await flush(8);
  });
});

