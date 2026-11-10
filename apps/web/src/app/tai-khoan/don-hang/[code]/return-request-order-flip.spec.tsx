// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { ApiError } from '@/lib/client-api';

// Yêu cầu đổi/trả bị từ chối vì đơn vừa đổi trạng thái (Wave 92B, sửa theo review): lần tải lại đưa đơn sang RETURNED nên trang gỡ form,
// lời máy chủ phải còn trên màn ở khối thao tác (form là nơi duy nhất hiện lời đó trước đây). Dùng trang thật, trạng thái đơn đổi theo máy chủ.
// Cùng file: danh sách yêu cầu tải lại khi form đang mở thì "còn trả được" đổi theo, số lượng khách chọn bị kẹp lại, phần khách đã nhập giữ nguyên.

const mocks = vi.hoisted(() => ({
  order: null as Record<string, unknown> | null,
  returns: [] as unknown[],
  requestReturn: vi.fn(),
  estimate: vi.fn(),
}));
vi.mock('@/lib/core-http', () => ({ coreHttp: { post: vi.fn() } }));
vi.mock('@/lib/cart-key', () => ({ cartStorefrontSlug: () => null, useCartKey: () => ['cart', null] }));
vi.mock('@/lib/balances', () => ({ invalidateBalances: vi.fn() }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u1' }, status: 'authenticated', initialized: true }),
}));
vi.mock('next/navigation', () => ({
  useParams: () => ({ code: 'TB-9' }),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getPublicSupport: async () => ({ hotline: '0984 606 774', email: 'tubutree@gmail.com' }),
}));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  fetchOrder: async () => mocks.order,
  getCart: async () => ({ items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 199000, itemCount: 0 }),
  requestReturn: mocks.requestReturn,
  estimateReturn: mocks.estimate,
  fetchMyReturns: async () => mocks.returns,
  fetchMyRefunds: async () => [],
  fetchRefundBank: async () => null,
}));

import OrderDetailPage from './page';

const DELIVERED = {
  id: 'o9', code: 'TB-9', status: 'DELIVERED', subtotal: 300000, discount: 0, shippingFee: 0, total: 300000,
  paymentMethod: 'COD', paymentStatus: 'PAID', createdAt: '2026-10-01T03:00:00Z', deliveredAt: new Date(Date.now() - 864e5).toISOString(),
  items: [{ id: 'i1', productName: 'Dầu gội', variationName: '500ml', unitPrice: 150000, quantity: 2, total: 300000, thumbnail: null }],
  shippingAddress: null, shippingPartner: null, shippingCode: null, trackingLink: null, shippingHistory: null,
};
const PENDING = { id: 'r0', orderId: 'o9', status: 'PENDING', reason: 'x', items: [{ orderItemId: 'i1', quantity: 2 }], createdAt: '2026-10-06T00:00:00Z' };
const MESSAGE = 'Đơn này đã có yêu cầu đổi/trả được xử lý.';
const FORM = 'form[aria-labelledby="return-form-title"]';

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<OrderDetailPage />);
  mounted.push(r);
  await flush(8);
  return r.container;
};
const btn = (c: HTMLElement, text: string) =>
  Array.from(c.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === text) as HTMLButtonElement | undefined;
const pressMenu = (c: HTMLElement, text: string) => {
  click(c.querySelector<HTMLButtonElement>('button[aria-label="Thêm thao tác"]'));
  click(Array.from(document.body.querySelectorAll<HTMLElement>('[role="group"] [role="button"]')).find((n) => (n.textContent ?? '').trim() === text) ?? null);
};
const radio = (c: HTMLElement, label: RegExp) =>
  Array.from(c.querySelectorAll<HTMLInputElement>('input[type="radio"]')).find((r) => label.test(r.closest('label')?.textContent ?? '')) ?? null;
const alerts = (c: HTMLElement) => Array.from(c.querySelectorAll('[role="alert"]')).filter((n) => (n.textContent ?? '').includes(MESSAGE));
const actions = (c: HTMLElement) => c.querySelector<HTMLElement>('section[aria-label="Thao tác với đơn hàng"]')!;

/** Mở form, chọn lý do, gửi: máy chủ trả `fail` (lúc đó cũng đổi trạng thái đơn như thật nếu `flip`). */
const submit = async (c: HTMLElement, fail: Error, flip: boolean) => {
  mocks.requestReturn.mockImplementation(async () => {
    if (flip) {
      mocks.order = { ...DELIVERED, status: 'RETURNED' };
      mocks.returns = [PENDING];
    }
    throw fail;
  });
  pressMenu(c, 'Yêu cầu đổi/trả');
  click(radio(c, /^Sản phẩm lỗi, hỏng$/));
  click(btn(c, 'Gửi yêu cầu')!);
  await flush(12);
};

beforeEach(() => {
  mocks.order = { ...DELIVERED };
  mocks.returns = [];
  mocks.requestReturn.mockReset().mockResolvedValue({ id: 'r1' });
  mocks.estimate.mockReset().mockResolvedValue({ isFull: false, goods: 0, shipping: 0, refund: 0, moneyRefundable: false, pointsUsedBack: 0, lines: [] });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('form đổi/trả bị gỡ vì đơn đổi trạng thái giữa lúc gửi', () => {
  it('400 và đơn sang RETURNED: form biến mất nhưng lời máy chủ còn hiện (role=alert) trong khối thao tác', async () => {
    const c = await mount();
    await submit(c, new ApiError(MESSAGE, 400), true);
    expect(mocks.requestReturn).toHaveBeenCalledTimes(1);
    expect(c.querySelector(FORM)).toBeNull();
    expect(c.textContent).toContain('Yêu cầu đổi/trả đang xử lý');
    expect(alerts(c)).toHaveLength(1);
    expect(actions(c).contains(alerts(c)[0]!)).toBe(true);
  });

  it('khách làm việc khác (Mua lại) thì lời báo tắt', async () => {
    const c = await mount();
    await submit(c, new ApiError(MESSAGE, 409), true);
    expect(alerts(c)).toHaveLength(1);
    click(btn(c, 'Mua lại đơn này')!);
    await flush(4);
    expect(alerts(c)).toHaveLength(0);
  });
});

describe('form còn mở: lời báo chỉ hiện một chỗ', () => {
  it('đơn không đổi trạng thái: đúng một dòng báo (trong form), không nhân đôi ở khối thao tác', async () => {
    const c = await mount();
    await submit(c, new ApiError(MESSAGE, 400), false);
    expect(c.querySelector(FORM)).not.toBeNull();
    expect(alerts(c)).toHaveLength(1);
    expect(c.querySelector(FORM)!.contains(alerts(c)[0]!)).toBe(true);
  });

  it('bấm Đóng sau lỗi: lời báo không còn nằm lại ở khối thao tác', async () => {
    const c = await mount();
    await submit(c, new ApiError(MESSAGE, 400), false);
    click(btn(c, 'Đóng')!);
    await flush(4);
    expect(c.querySelector(FORM)).toBeNull();
    expect(alerts(c)).toHaveLength(0);
  });

  it('gửi lại thành công sau lỗi: không còn lời lỗi cũ, hiện lời đã gửi', async () => {
    const c = await mount();
    await submit(c, new ApiError(MESSAGE, 409), false);
    expect(c.textContent).toContain(MESSAGE);
    mocks.requestReturn.mockReset().mockResolvedValue({ id: 'r1' });
    click(btn(c, 'Gửi yêu cầu')!);
    await flush(8);
    expect(c.querySelector(FORM)).toBeNull();
    expect(c.textContent).toContain('Đã gửi yêu cầu đổi/trả');
    expect(c.textContent).not.toContain(MESSAGE);
  });
});

describe('danh sách yêu cầu tải lại khi form đang mở', () => {
  const TWO_LINES = {
    ...DELIVERED,
    items: [
      { id: 'i1', productName: 'Dầu gội', variationName: '500ml', unitPrice: 150000, quantity: 3, total: 450000, thumbnail: null },
      { id: 'i2', productName: 'Dầu xả', variationName: '250ml', unitPrice: 90000, quantity: 1, total: 90000, thumbnail: null },
    ],
  };
  const approved = (orderItemId: string, quantity: number) => ({
    id: 'r0', orderId: 'o9', status: 'APPROVED', reason: 'x', refundAmount: 1, items: [{ orderItemId, quantity, refundAmount: 1 }], createdAt: '2026-10-06T00:00:00Z',
  });
  const boxes = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLInputElement>(`${FORM} input[type="checkbox"]`));
  const plus = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('button[aria-label="Tăng số lượng Dầu gội"]');

  /** Khách chọn Dầu gội x3, lý do, mô tả; lần gửi bị từ chối 409 và đúng lúc đó đã có yêu cầu được duyệt trả `taken` cái. */
  const openAndReject = async (taken: number) => {
    mocks.order = TWO_LINES;
    const c = await mount();
    pressMenu(c, 'Yêu cầu đổi/trả');
    click(boxes(c)[0]!);
    click(plus(c));
    click(plus(c));
    click(radio(c, /^Sản phẩm lỗi, hỏng$/));
    typeInto(c.querySelector('textarea'), 'Vỏ bị móp');
    mocks.requestReturn.mockImplementation(async () => {
      mocks.returns = [approved('i1', taken)];
      throw new ApiError(MESSAGE, 409);
    });
    click(btn(c, 'Gửi yêu cầu')!);
    await flush(12);
    return c;
  };

  it('số còn trả được giảm: dòng cập nhật, số lượng kẹp lại, lựa chọn và phần đã nhập của khách giữ nguyên', async () => {
    const c = await openAndReject(2);
    expect(c.querySelector(FORM)!.textContent).toContain('500ml · còn trả được 1');
    expect(plus(c)).toBeNull();
    expect(boxes(c).map((b) => b.checked)).toEqual([true, false]);
    expect(c.querySelector('textarea')!.value).toBe('Vỏ bị móp');
    expect(radio(c, /^Sản phẩm lỗi, hỏng$/)!.checked).toBe(true);
    mocks.requestReturn.mockReset().mockResolvedValue({ id: 'r1' });
    click(btn(c, 'Gửi yêu cầu')!);
    await flush(8);
    expect(mocks.requestReturn.mock.calls[0]![1].items).toEqual([{ orderItemId: 'i1', quantity: 1 }]);
  });

  it('số còn trả được giảm nhưng chưa tới số khách chọn: giữ nguyên số lượng khách chọn', async () => {
    const c = await openAndReject(0);
    expect(c.querySelector(FORM)!.textContent).toContain('500ml · còn trả được 3');
    expect(c.querySelector(FORM)!.textContent).toContain('3');
    mocks.requestReturn.mockReset().mockResolvedValue({ id: 'r1' });
    click(btn(c, 'Gửi yêu cầu')!);
    await flush(8);
    expect(mocks.requestReturn.mock.calls[0]![1].items).toEqual([{ orderItemId: 'i1', quantity: 3 }]);
  });

  it('bỏ chọn rồi chọn lại một dòng: giữ số lượng khách đã chọn', async () => {
    mocks.order = TWO_LINES;
    const c = await mount();
    pressMenu(c, 'Yêu cầu đổi/trả');
    click(boxes(c)[0]!);
    click(plus(c));
    click(plus(c));
    const qty = () => c.querySelector('[role="group"][aria-label="Số lượng trả Dầu gội"] span.tabular-nums')?.textContent;
    expect(qty()).toBe('3');
    click(boxes(c)[0]!);
    expect(qty()).toBeUndefined();
    click(boxes(c)[0]!);
    expect(qty()).toBe('3');
  });

  it('dòng đã trả hết thì biến khỏi form; nếu hết mọi dòng thì báo và không cho gửi', async () => {
    const c = await openAndReject(3);
    const form = c.querySelector(FORM)!;
    expect(form.textContent).not.toContain('Dầu gội · ');
    expect(boxes(c)).toHaveLength(1);
    expect(form.textContent).toContain('Dầu xả');
    expect(boxes(c)[0]!.checked).toBe(false);
    mocks.requestReturn.mockReset().mockImplementation(async () => {
      mocks.returns = [approved('i1', 3), approved('i2', 1)];
      throw new ApiError(MESSAGE, 409);
    });
    click(boxes(c)[0]!);
    click(btn(c, 'Gửi yêu cầu')!);
    await flush(12);
    expect(c.querySelector(FORM)!.textContent).toContain('Mọi sản phẩm của đơn đã được trả.');
    expect(btn(c, 'Gửi yêu cầu')!.disabled).toBe(true);
  });
});
