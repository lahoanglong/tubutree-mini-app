// @vitest-environment jsdom
import { act } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { headingProblems, smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// BUYERWEB-13: chi tiết đơn trên web chỉ có dòng gọi hotline — không timeline/hành trình, không hủy, đổi trả, mua lại
// dù API đã có sẵn (Mini App có đủ).

const mocks = vi.hoisted(() => ({
  user: { id: 'u1' } as Record<string, unknown> | null,
  order: null as Record<string, unknown> | null,
  push: vi.fn(),
  cancel: vi.fn(),
  repurchase: vi.fn(),
  requestReturn: vi.fn(),
  estimate: vi.fn(),
  returns: [] as unknown[],
  returnsError: false,
  refunds: [] as unknown[],
  refundBank: null as Record<string, string> | null,
  chooseDestination: vi.fn(),
  invalidateBalances: vi.fn(),
}));
vi.mock('@/lib/image-compress', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/image-compress')>()),
  readAndCompressImage: async (f: File) => `data:image/jpeg;base64,${f.name}`,
}));
vi.mock('@/lib/balances', () => ({ invalidateBalances: mocks.invalidateBalances }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: mocks.user, status: 'authenticated', initialized: true }),
}));
vi.mock('next/navigation', () => ({
  useParams: () => ({ code: 'TB-9' }),
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getPublicSupport: async () => ({ hotline: '0984 606 774', email: 'tubutree@gmail.com' }),
}));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  fetchOrder: async () => mocks.order,
  cancelOrder: mocks.cancel,
  repurchaseOrder: mocks.repurchase,
  requestReturn: mocks.requestReturn,
  estimateReturn: mocks.estimate,
  fetchMyReturns: async () => {
    if (mocks.returnsError) throw new Error('boom');
    return mocks.returns;
  },
  fetchMyRefunds: async () => mocks.refunds,
  fetchRefundBank: async () => mocks.refundBank,
  chooseRefundDestination: mocks.chooseDestination,
  getBankQr: async () => ({
    orderCode: 'TB-9', amount: 1, paymentStatus: 'UNPAID',
    bank: { bin: '1', name: 'B', accountNo: '1', accountName: 'A' }, memo: 'TB-9', qrString: 'x', qrImageUrl: 'https://img.vietqr.io/x.png',
  }),
}));

import OrderDetailPage from './page';

const BASE = {
  id: 'o9', code: 'TB-9', status: 'CONFIRMED', subtotal: 300000, discount: 0, shippingFee: 0, total: 300000,
  paymentMethod: 'COD', paymentStatus: 'UNPAID', createdAt: '2026-10-01T03:00:00Z', deliveredAt: null,
  items: [{ id: 'i1', productName: 'Dầu gội', variationName: '500ml', unitPrice: 150000, quantity: 2, total: 300000, thumbnail: null }],
  shippingAddress: null, shippingPartner: null, shippingCode: null, trackingLink: null, shippingHistory: null,
};

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<OrderDetailPage />);
  mounted.push(r);
  await flush(8);
  return r;
};
const btn = (c: HTMLElement, text: string) =>
  Array.from(c.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === text) as HTMLButtonElement | undefined;
const confirmCancelBtn = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('[role="alertdialog"] button')).find((b) => b.textContent === 'Hủy đơn') ?? null;
const radio = (c: HTMLElement, label: RegExp) =>
  Array.from(c.querySelectorAll<HTMLInputElement>('input[type="radio"]')).find((r) => label.test(r.closest('label')?.textContent ?? '')) ?? null;
const field = (c: HTMLElement, label: string) =>
  Array.from(c.querySelectorAll<HTMLInputElement>('input, textarea')).find((i) =>
    Array.from(i.labels ?? []).some((l) => (l.firstChild?.textContent ?? '').trim() === label),
  ) ?? null;

beforeEach(() => {
  mocks.user = { id: 'u1' };
  mocks.order = { ...BASE };
  mocks.push.mockReset();
  mocks.cancel.mockReset().mockResolvedValue({ ...BASE, status: 'CANCELLED' });
  mocks.repurchase.mockReset();
  mocks.requestReturn.mockReset().mockResolvedValue({ id: 'r1' });
  mocks.estimate.mockReset().mockResolvedValue({ isFull: false, goods: 90000, shipping: 0, refund: 90000, moneyRefundable: true, pointsUsedBack: 0, lines: [] });
  mocks.returns = [];
  mocks.returnsError = false;
  mocks.refunds = [];
  mocks.refundBank = null;
  mocks.chooseDestination.mockReset();
  mocks.invalidateBalances.mockReset();
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('chi tiết đơn — hành trình đơn (BUYERWEB-13)', () => {
  it('hiện 5 bước, bước hiện tại có aria-current="step"', async () => {
    mocks.order = { ...BASE, status: 'PACKED' };
    const { container } = await mount();
    const steps = Array.from(container.querySelectorAll('ol[class=""] li, section[aria-labelledby="order-timeline-title"] li'));
    expect(steps.map((s) => s.textContent?.replace(/ — (đã qua|hiện tại)/, ''))).toEqual([
      'Đã đặt hàng', 'Đã xác nhận', 'Đang đóng gói', 'Đang giao', 'Đã giao',
    ]);
    expect(steps.map((s) => s.getAttribute('aria-current'))).toEqual([null, null, 'step', null, null]);
  });

  it('đơn đã hủy/hoàn: không dựng hành trình', async () => {
    mocks.order = { ...BASE, status: 'CANCELLED' };
    const { container } = await mount();
    expect(container.querySelector('#order-timeline-title')).toBeNull();
  });

  it('hành trình vận chuyển: mới nhất trước, nhãn tiếng Việt, kèm giờ giờ VN, mã lạ không in thô', async () => {
    mocks.order = {
      ...BASE, status: 'SHIPPING', shippingPartner: 'BestExpress', shippingCode: 'BE1',
      shippingHistory: [
        { at: '2026-10-01T03:00:00Z', status: 'created', code: 'BE1' },
        { at: '2026-10-02T03:00:00Z', status: 'delivering', code: 'BE1' },
        { at: '2026-10-02T05:00:00Z', status: 'WEIRD_42', code: 'BE1' },
      ],
    };
    const { container } = await mount();
    const text = container.textContent ?? '';
    expect(text).toContain('Hành trình vận chuyển');
    expect(text.indexOf('Đang cập nhật')).toBeLessThan(text.indexOf('Đang giao hàng'));
    expect(text.indexOf('Đang giao hàng')).toBeLessThan(text.indexOf('Đã tạo vận đơn'));
    expect(text).toContain('10:00 01/10/2026');
    expect(text).not.toContain('WEIRD_42');
  });
});

describe('chi tiết đơn — hủy đơn (BUYERWEB-13)', () => {
  it('đơn Đã xác nhận có nút Hủy đơn; bấm phải xác nhận, "Giữ đơn" thì không gọi API', async () => {
    const { container } = await mount();
    click(btn(container, 'Hủy đơn')!);
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull();
    click(btn(container, 'Giữ đơn')!);
    await flush();
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('WEB-13: mở hộp xác nhận thì focus vào "Giữ đơn" (lựa chọn an toàn); mô tả hộp trỏ tới câu hậu quả và nơi nhận tiền hoàn', async () => {
    mocks.order = { ...BASE, paymentMethod: 'WALLET', paymentStatus: 'PAID' };
    const { container } = await mount();
    expect(document.activeElement).toBe(document.body);
    click(btn(container, 'Hủy đơn')!);
    expect(document.activeElement).toBe(btn(container, 'Giữ đơn'));
    const dialog = container.querySelector('[role="alertdialog"]')!;
    const described = dialog.getAttribute('aria-describedby')!.split(' ').map((id) => document.getElementById(id)?.textContent);
    expect(described[0]).toContain('không thể khôi phục');
    expect(described[1]).toContain('được hoàn ngay vào Ví Tubu');
  });

  it('WEB-13: "Giữ đơn" trả focus về nút "Hủy đơn" đã bấm', async () => {
    const { container } = await mount();
    click(btn(container, 'Hủy đơn')!);
    click(btn(container, 'Giữ đơn')!);
    await flush();
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement).toBe(btn(container, 'Hủy đơn'));
  });

  it('WEB-13: hủy xong (nút Hủy đơn đã ẩn) focus chuyển sang dòng báo kết quả, không rơi về <body>', async () => {
    const { container } = await mount();
    click(btn(container, 'Hủy đơn')!);
    click(confirmCancelBtn(container));
    await flush(8);
    const status = container.querySelector('[role="status"]')!;
    expect(status.textContent).toContain('Đã hủy đơn hàng');
    expect(document.activeElement).toBe(status);
  });

  it('WEB-13: BE từ chối hủy: focus về nút "Hủy đơn" (lời từ chối đã đọc qua role=alert)', async () => {
    mocks.cancel.mockRejectedValue(new Error('Đơn đã bàn giao vận chuyển.'));
    const { container } = await mount();
    click(btn(container, 'Hủy đơn')!);
    click(confirmCancelBtn(container));
    await flush(8);
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('Đơn đã bàn giao vận chuyển.');
    expect(document.activeElement).toBe(btn(container, 'Hủy đơn'));
  });

  it('xác nhận hủy: gọi API đúng mã đơn rồi báo đã hủy', async () => {
    const { container } = await mount();
    click(btn(container, 'Hủy đơn')!);
    click(confirmCancelBtn(container));
    await flush(8);
    expect(mocks.cancel).toHaveBeenCalledWith('TB-9', undefined);
    expect(container.textContent).toContain('Đã hủy đơn hàng');
  });

  it('hủy xong làm mới số dư Điểm Xanh/Ví (tiền và điểm hoàn về) — R2-BUYERWEB-3', async () => {
    const { container } = await mount();
    click(btn(container, 'Hủy đơn')!);
    click(confirmCancelBtn(container));
    await flush(8);
    expect(mocks.invalidateBalances).toHaveBeenCalled();
  });

  it('D2: đơn chuyển khoản đã trả → mặc định hoàn về Ví Tubu', async () => {
    mocks.order = { ...BASE, paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID' };
    const { container } = await mount();
    click(btn(container, 'Hủy đơn')!);
    expect(container.querySelector('[role="alertdialog"] [role="radiogroup"]')?.getAttribute('aria-label')).toBe('Nơi nhận tiền hoàn');
    click(confirmCancelBtn(container));
    await flush(8);
    expect(mocks.cancel).toHaveBeenCalledWith('TB-9', { refundMethod: 'WALLET' });
  });

  it('MONEY-9: chọn tài khoản ngân hàng → điền sẵn tài khoản gần nhất, thiếu số thì báo lỗi và không gọi API', async () => {
    mocks.order = { ...BASE, paymentMethod: 'ZALOPAY', paymentStatus: 'PAID' };
    mocks.refundBank = { bankName: 'Techcombank', accountNumber: '190312345678', accountName: 'NGUYEN VAN A' };
    const { container } = await mount();
    click(btn(container, 'Hủy đơn')!);
    click(radio(container, /Tài khoản ngân hàng/));
    await flush(8);
    expect(field(container, 'Số tài khoản')?.value).toBe('190312345678');
    typeInto(field(container, 'Số tài khoản'), '12');
    click(confirmCancelBtn(container));
    await flush();
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Số tài khoản chỉ gồm chữ số, từ 6 đến 24 số.');
    typeInto(field(container, 'Số tài khoản'), '1903 1234 5678');
    click(confirmCancelBtn(container));
    await flush(8);
    expect(mocks.cancel).toHaveBeenCalledWith('TB-9', {
      refundMethod: 'BANK', bankName: 'Techcombank', accountNumber: '1903 1234 5678', accountName: 'NGUYEN VAN A',
    });
  });

  it('MONEY-6: đơn chuyển khoản chưa ghi nhận tiền → cảnh báo đừng huỷ vội, tiền về muộn vẫn được hoàn', async () => {
    mocks.order = { ...BASE, status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' };
    const { container } = await mount();
    click(btn(container, 'Hủy đơn')!);
    const note = container.querySelector('[role="alertdialog"] [role="note"]');
    expect(note?.textContent).toContain('Nếu bạn vừa chuyển khoản');
    expect(note?.textContent).toContain('Tiền về sau khi huỷ vẫn được hoàn');
  });

  it('đơn trả bằng Ví: báo hoàn ngay về Ví, không có lựa chọn ngân hàng', async () => {
    mocks.order = { ...BASE, paymentMethod: 'WALLET', paymentStatus: 'PAID' };
    const { container } = await mount();
    click(btn(container, 'Hủy đơn')!);
    expect(container.querySelector('[role="radiogroup"]')).toBeNull();
    expect(container.textContent).toContain('300.000đ được hoàn ngay vào Ví Tubu.');
  });

  it('BE từ chối (đơn vừa vào quy trình giao): hiện nguyên văn lời BE', async () => {
    mocks.cancel.mockRejectedValue(new Error('Đơn đã vào quy trình giao, vui lòng liên hệ Zalo OA để được hỗ trợ.'));
    const { container } = await mount();
    click(btn(container, 'Hủy đơn')!);
    click(confirmCancelBtn(container));
    await flush(8);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('đã vào quy trình giao');
  });

  it('R3-CANCEL-2: BE từ chối "đã bàn giao" → tải lại đơn, nút Hủy đơn biến mất, lời BE vẫn còn', async () => {
    mocks.order = { ...BASE, status: 'PACKED' };
    mocks.cancel.mockImplementation(async () => {
      mocks.order = { ...BASE, status: 'PACKED', shippingPartner: 'GHN', shippingCode: 'GHN1933', canCancel: false };
      throw new Error('Đơn đã bàn giao cho đơn vị vận chuyển, vui lòng liên hệ hotline hoặc Zalo OA của Tubu để được hỗ trợ.');
    });
    const { container } = await mount();
    click(btn(container, 'Hủy đơn')!);
    click(confirmCancelBtn(container));
    await flush(12);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('đã bàn giao');
    expect(btn(container, 'Hủy đơn')).toBeUndefined();
  });

  it('đơn đang đóng gói (chưa bàn giao vận chuyển) vẫn hủy được — D1, BUYERWEB-5', async () => {
    mocks.order = { ...BASE, status: 'PACKED' };
    const { container } = await mount();
    expect(btn(container, 'Hủy đơn')).toBeDefined();
  });

  it.each([['SHIPPING'], ['DELIVERED']])('đơn %s: không có nút Hủy đơn (vẫn còn dòng hotline)', async (status) => {
    mocks.order = { ...BASE, status };
    const { container } = await mount();
    expect(btn(container, 'Hủy đơn')).toBeUndefined();
    expect(container.textContent).toContain('Cần hủy hoặc đổi đơn?');
  });

  it('R3-CANCEL-2: đơn đang đóng gói mà kho đã đặt hãng (mã GHN) — chip "Đã đặt đơn vị vận chuyển", không có nút Hủy đơn', async () => {
    mocks.order = { ...BASE, status: 'PACKED', shippingPartner: 'GHN', shippingCode: 'GHN1933', canCancel: false };
    const { container } = await mount();
    expect(btn(container, 'Hủy đơn')).toBeUndefined();
    expect(container.textContent).toContain('Đã đặt đơn vị vận chuyển');
    expect(container.textContent).toContain('Cần hủy hoặc đổi đơn?');
  });

  it('R3-CANCEL-2: API báo canCancel=false thì ẩn nút dù trạng thái còn trong mốc hủy', async () => {
    mocks.order = { ...BASE, status: 'CONFIRMED', canCancel: false };
    const { container } = await mount();
    expect(btn(container, 'Hủy đơn')).toBeUndefined();
  });

  it('đơn CTV lên hộ khách đã trả tiền: CTV không thấy nút Hủy đơn', async () => {
    mocks.order = { ...BASE, placedForCustomer: true, paymentStatus: 'PAID', referrerUserId: 'u1' };
    const { container } = await mount();
    expect(btn(container, 'Hủy đơn')).toBeUndefined();
  });
});

describe('chi tiết đơn — mua lại (BUYERWEB-13)', () => {
  const delivered = { ...BASE, status: 'DELIVERED', deliveredAt: new Date(Date.now() - 864e5).toISOString() };

  it('chỉ đơn đã kết thúc có "Mua lại đơn này"', async () => {
    const open = await mount();
    expect(btn(open.container, 'Mua lại đơn này')).toBeUndefined();
    mocks.order = delivered;
    const done = await mount();
    expect(btn(done.container, 'Mua lại đơn này')).toBeDefined();
  });

  it('thêm đủ: chuyển sang giỏ hàng', async () => {
    mocks.order = delivered;
    mocks.repurchase.mockResolvedValue({ cart: { items: [], itemCount: 2 }, results: [{ orderItemId: 'a', status: 'added', addedQuantity: 2 }] });
    const { container } = await mount();
    click(btn(container, 'Mua lại đơn này')!);
    await flush(8);
    expect(mocks.repurchase).toHaveBeenCalledWith('TB-9');
    expect(mocks.push).toHaveBeenCalledWith('/gio-hang');
  });

  it('mua lại: tải lại giỏ thay vì ghi giỏ không kèm gian hàng (không combo) vào cache', async () => {
    const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    const setData = vi.spyOn(QueryClient.prototype, 'setQueryData');
    mocks.order = delivered;
    mocks.repurchase.mockResolvedValue({ cart: { items: [], itemCount: 2 }, results: [{ orderItemId: 'a', status: 'added', addedQuantity: 2 }] });
    const { container } = await mount();
    click(btn(container, 'Mua lại đơn này')!);
    await flush(8);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['cart'] });
    expect(setData.mock.calls.some(([key]) => Array.isArray(key) && key[0] === 'cart')).toBe(false);
    invalidate.mockRestore();
    setData.mockRestore();
  });

  it('thêm được một phần: ở lại trang, nói rõ bao nhiêu dòng chưa thêm được và có lối vào giỏ', async () => {
    mocks.order = delivered;
    mocks.repurchase.mockResolvedValue({
      cart: { items: [], itemCount: 1 },
      results: [{ orderItemId: 'a', status: 'added', addedQuantity: 1 }, { orderItemId: 'b', status: 'skipped', reason: 'OUT_OF_STOCK', addedQuantity: 0 }],
    });
    const { container } = await mount();
    click(btn(container, 'Mua lại đơn này')!);
    await flush(8);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Đã thêm 1 sản phẩm vào giỏ. 1 sản phẩm đã hết hàng');
    expect(container.querySelector('a[href="/gio-hang"]')).not.toBeNull();
  });

  it('không thêm được dòng nào: báo hết hàng/ngừng bán, không chuyển trang', async () => {
    mocks.order = delivered;
    mocks.repurchase.mockResolvedValue({ cart: { items: [], itemCount: 0 }, results: [{ orderItemId: 'b', status: 'skipped', reason: 'INACTIVE', addedQuantity: 0 }] });
    const { container } = await mount();
    click(btn(container, 'Mua lại đơn này')!);
    await flush(8);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(container.textContent).toContain('đã hết hàng hoặc ngừng bán');
  });
});

describe('chi tiết đơn — yêu cầu đổi/trả (BUYERWEB-13)', () => {
  const delivered = { ...BASE, status: 'DELIVERED', deliveredAt: new Date(Date.now() - 864e5).toISOString() };

  it('đơn chưa giao không có nút đổi/trả', async () => {
    const { container } = await mount();
    expect(btn(container, 'Yêu cầu đổi/trả')).toBeUndefined();
  });

  it('BUYERMINI-11 (web): chọn dòng + lý do chọn sẵn → gửi đúng dòng, số lượng, mã lý do, nhận về Ví', async () => {
    mocks.order = delivered;
    const { container } = await mount();
    click(btn(container, 'Yêu cầu đổi/trả')!);
    const box = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(box.checked).toBe(true);
    click(radio(container, /^Sản phẩm lỗi, hỏng$/));
    click(btn(container, 'Gửi yêu cầu')!);
    await flush(8);
    expect(mocks.requestReturn).toHaveBeenCalledWith('TB-9', {
      reasonCode: 'DEFECTIVE',
      reason: undefined,
      items: [{ orderItemId: 'i1', quantity: 1 }],
      refundMethod: 'WALLET',
    });
    expect(container.querySelector('form[aria-labelledby="return-form-title"]')).toBeNull();
    expect(container.textContent).toContain('Đã gửi yêu cầu đổi/trả');
  });

  // R3-UI-6: Mini App hiện "Dự kiến hoàn" theo D3 trước khi gửi; web phải cho khách thấy cùng con số (cùng API).
  describe('ước tính tiền hoàn (R3-UI-6)', () => {
    const estimateText = (c: HTMLElement) => c.querySelector('[data-testid="return-estimate"]')?.textContent ?? null;

    it('chọn dòng thì hỏi API ước tính và hiện "Dự kiến hoàn", cập nhật khi đổi lý do (phí ship chỉ khi lỗi shop/trả cả đơn)', async () => {
      mocks.order = delivered;
      mocks.estimate.mockImplementation(async (_code: string, body: { reasonCode?: string }) =>
        body.reasonCode === 'DEFECTIVE'
          ? { isFull: false, goods: 90000, shipping: 15000, refund: 105000, moneyRefundable: true, pointsUsedBack: 12, lines: [] }
          : { isFull: false, goods: 90000, shipping: 0, refund: 90000, moneyRefundable: true, pointsUsedBack: 0, lines: [] },
      );
      const { container } = await mount();
      click(btn(container, 'Yêu cầu đổi/trả')!);
      await flush(6);
      expect(mocks.estimate).toHaveBeenCalledWith('TB-9', { items: [{ orderItemId: 'i1', quantity: 1 }], reasonCode: undefined });
      expect(estimateText(container)).toContain('Dự kiến hoàn 90.000đ');
      click(radio(container, /^Sản phẩm lỗi, hỏng$/));
      await flush(6);
      expect(mocks.estimate).toHaveBeenLastCalledWith('TB-9', { items: [{ orderItemId: 'i1', quantity: 1 }], reasonCode: 'DEFECTIVE' });
      expect(estimateText(container)).toContain('Dự kiến hoàn 105.000đ');
      expect(estimateText(container)).toContain('gồm 15.000đ phí vận chuyển');
      expect(estimateText(container)).toContain('hoàn lại 12 Điểm Xanh đã dùng');
      expect(estimateText(container)).toContain('Tubu xác nhận số cuối cùng khi duyệt');
    });

    it('bỏ chọn hết dòng → không hiện ước tính', async () => {
      mocks.order = delivered;
      const { container } = await mount();
      click(btn(container, 'Yêu cầu đổi/trả')!);
      await flush(6);
      click(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
      await flush(4);
      expect(estimateText(container)).toBeNull();
    });

    it('đơn không có tiền để hoàn (moneyRefundable=false) → không hiện số', async () => {
      mocks.order = delivered;
      mocks.estimate.mockResolvedValue({ isFull: false, goods: 0, shipping: 0, refund: 0, moneyRefundable: false, pointsUsedBack: 0, lines: [] });
      const { container } = await mount();
      click(btn(container, 'Yêu cầu đổi/trả')!);
      await flush(6);
      expect(estimateText(container)).toBeNull();
    });

    it('API ước tính lỗi → form vẫn gửi được, không hiện số', async () => {
      mocks.order = delivered;
      mocks.estimate.mockRejectedValue(new Error('boom'));
      const { container } = await mount();
      click(btn(container, 'Yêu cầu đổi/trả')!);
      await flush(6);
      expect(estimateText(container)).toBeNull();
      click(radio(container, /^Sản phẩm lỗi, hỏng$/));
      click(btn(container, 'Gửi yêu cầu')!);
      await flush(8);
      expect(mocks.requestReturn).toHaveBeenCalled();
    });
  });

  it('R2-LIFECYCLE-10: form có ô tải ảnh minh chứng thay cho lời dặn gửi email; ảnh đi cùng yêu cầu', async () => {
    mocks.order = delivered;
    const { container } = await mount();
    click(btn(container, 'Yêu cầu đổi/trả')!);
    const form = container.querySelector('form[aria-labelledby="return-form-title"]')!;
    expect(form.textContent).not.toContain('email');
    expect(form.textContent).toContain('Ảnh minh chứng (khuyến khích, tối đa 3)');
    const input = form.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'vo.jpg', { type: 'image/jpeg' })], configurable: true });
    act(() => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush(4);
    expect(form.querySelectorAll('li img')).toHaveLength(1);
    click(radio(container, /^Sản phẩm lỗi, hỏng$/));
    click(btn(container, 'Gửi yêu cầu')!);
    await flush(8);
    expect(mocks.requestReturn.mock.calls[0]![1].images).toEqual(['data:image/jpeg;base64,vo.jpg']);
  });

  it('không đính ảnh thì body không có khoá images', async () => {
    mocks.order = delivered;
    const { container } = await mount();
    click(btn(container, 'Yêu cầu đổi/trả')!);
    click(radio(container, /^Sản phẩm lỗi, hỏng$/));
    click(btn(container, 'Gửi yêu cầu')!);
    await flush(8);
    expect(mocks.requestReturn.mock.calls[0]![1]).not.toHaveProperty('images');
  });

  it('D3: tăng số lượng tới số còn trả được (đã trừ phần đã duyệt trước)', async () => {
    mocks.order = { ...delivered, items: [{ ...BASE.items[0], quantity: 3 }] };
    mocks.returns = [{ id: 'r0', orderId: 'o9', status: 'APPROVED', reason: 'x', refundAmount: 100000, items: [{ orderItemId: 'i1', quantity: 1, refundAmount: 100000 }], createdAt: '2026-10-06T00:00:00Z' }];
    const { container } = await mount();
    click(btn(container, 'Trả thêm sản phẩm')!);
    const plus = container.querySelector<HTMLButtonElement>('button[aria-label="Tăng số lượng Dầu gội"]')!;
    click(plus);
    click(plus);
    expect(plus.disabled).toBe(true);
    expect(container.textContent).toContain('còn trả được 2');
    click(radio(container, /^Giao sai sản phẩm$/));
    click(btn(container, 'Gửi yêu cầu')!);
    await flush(8);
    expect(mocks.requestReturn.mock.calls[0]![1].items).toEqual([{ orderItemId: 'i1', quantity: 2 }]);
  });

  it('chưa chọn lý do / "Lý do khác" thiếu mô tả: báo lỗi, không gửi', async () => {
    mocks.order = delivered;
    const { container } = await mount();
    click(btn(container, 'Yêu cầu đổi/trả')!);
    click(btn(container, 'Gửi yêu cầu')!);
    await flush();
    expect(container.querySelector('form [role="alert"]')?.textContent).toBe('Chọn lý do đổi/trả.');
    click(radio(container, /^Lý do khác$/));
    typeInto(field(container, 'Mô tả thêm'), 'ab');
    click(btn(container, 'Gửi yêu cầu')!);
    await flush();
    expect(container.querySelector('form [role="alert"]')?.textContent).toBe('Mô tả lý do (tối thiểu 5 ký tự).');
    typeInto(field(container, 'Mô tả thêm'), '  Bao bì bị rách khi nhận  ');
    click(btn(container, 'Gửi yêu cầu')!);
    await flush(8);
    expect(mocks.requestReturn.mock.calls[0]![1]).toMatchObject({ reasonCode: 'OTHER', reason: 'Bao bì bị rách khi nhận' });
  });

  it('MONEY-9: đơn COD trả hàng chọn hoàn về ngân hàng → gửi kèm tài khoản', async () => {
    mocks.order = delivered;
    const { container } = await mount();
    click(btn(container, 'Yêu cầu đổi/trả')!);
    click(radio(container, /^Bể vỡ, móp méo khi vận chuyển$/));
    click(radio(container, /Tài khoản ngân hàng/));
    typeInto(field(container, 'Tên ngân hàng'), 'VCB');
    typeInto(field(container, 'Số tài khoản'), '0071000123456');
    typeInto(field(container, 'Chủ tài khoản'), 'Le Van C');
    click(btn(container, 'Gửi yêu cầu')!);
    await flush(8);
    expect(mocks.requestReturn.mock.calls[0]![1]).toMatchObject({
      refundMethod: 'BANK', bankName: 'VCB', accountNumber: '0071000123456', accountName: 'Le Van C',
    });
  });

  it('BE từ chối (quá hạn đổi/trả): giữ form và hiện nguyên văn lời BE', async () => {
    mocks.order = delivered;
    mocks.requestReturn.mockRejectedValue(new Error('Quá hạn đổi/trả (7 ngày từ khi nhận hàng).'));
    const { container } = await mount();
    click(btn(container, 'Yêu cầu đổi/trả')!);
    click(radio(container, /^Sản phẩm lỗi, hỏng$/));
    click(btn(container, 'Gửi yêu cầu')!);
    await flush(8);
    expect(container.querySelector('form[aria-labelledby="return-form-title"]')).not.toBeNull();
    expect(container.textContent).toContain('Quá hạn đổi/trả (7 ngày từ khi nhận hàng).');
  });

  it.each([
    ['REQUESTED', 'đang xử lý'],
    ['REJECTED', 'bị từ chối: Ảnh không rõ'],
  ])('đang có yêu cầu %s cho mọi dòng: hiện trạng thái', async (status, expected) => {
    mocks.order = delivered;
    mocks.returns = [{ id: 'r1', orderId: 'o9', status, reason: 'x', adminNote: status === 'REJECTED' ? 'Ảnh không rõ' : null, createdAt: '2026-10-06T00:00:00Z' }];
    const { container } = await mount();
    if (status === 'REQUESTED') expect(btn(container, 'Yêu cầu đổi/trả')).toBeUndefined();
    expect(container.textContent).toContain(expected);
  });

  it('D3: yêu cầu đã duyệt nói rõ dòng trả, số tiền, nơi nhận và trạng thái nhận hàng; trả hết thì không còn nút', async () => {
    mocks.order = delivered;
    mocks.returns = [{
      id: 'r1', orderId: 'o9', status: 'APPROVED', reason: 'x', refundAmount: 285000, shippingRefund: 15000, refundMethod: 'WALLET',
      receivedAt: null, items: [{ orderItemId: 'i1', quantity: 2, refundAmount: 285000 }], createdAt: '2026-10-06T00:00:00Z',
    }];
    const { container } = await mount();
    const text = container.textContent ?? '';
    expect(text).toContain('Đổi/trả đã duyệt — đã hoàn 300.000đ vào Ví Tubu');
    expect(text).toContain('Trả: Dầu gội ×2');
    expect(text).toContain('Tubu sẽ liên hệ để nhận lại hàng.');
    expect(btn(container, 'Trả thêm sản phẩm')).toBeUndefined();
    expect(btn(container, 'Yêu cầu đổi/trả')).toBeUndefined();
  });

  it('R6-BUYER-9: mỗi yêu cầu trả gộp khoản hoàn vào một dòng (không lặp khối Hoàn tiền) và dòng sản phẩm ghi "Đã trả x/y"', async () => {
    mocks.order = {
      ...delivered,
      items: [
        { id: 'i1', productName: 'Dầu gội', variationName: '500ml', unitPrice: 150000, quantity: 2, total: 300000, thumbnail: null },
        { id: 'i2', productName: 'Xà phòng', variationName: '', unitPrice: 50000, quantity: 1, total: 50000, thumbnail: null },
      ],
    };
    mocks.returns = [{
      id: 'r1', orderId: 'o9', status: 'APPROVED', reason: 'x', refundAmount: 150000, refundMethod: 'WALLET',
      items: [{ orderItemId: 'i1', quantity: 1, refundAmount: 150000 }], createdAt: '2026-10-06T00:00:00Z',
    }];
    mocks.refunds = [{
      id: 'rf9', orderId: 'o9', orderCode: 'TB-9', kind: 'RETURN', refKey: 'r1', amount: 150000, method: 'WALLET', status: 'COMPLETED',
      bankName: null, bankAccountNo: null, bankAccountName: null, bankRef: null, completedAt: '2026-10-07T03:00:00Z', createdAt: '2026-10-06T00:00:00Z',
      canChooseDestination: false,
    }];
    const { container } = await mount();
    const text = container.textContent ?? '';
    expect(text).toContain('Đổi/trả đã duyệt — đã hoàn 150.000đ vào Ví Tubu');
    expect(text).toContain('Đã cộng vào Ví Tubu lúc');
    expect(container.querySelector('#refunds-title')).toBeNull();
    expect(text.match(/150\.000đ vào Ví Tubu/g)).toHaveLength(1);
    expect(text).toContain('Đã duyệt trả 1/2');
    expect(text).not.toContain('Đã duyệt trả 0/');
    expect(text).not.toContain('Đã duyệt trả 1/1');
  });

  it('R6-BUYER-9: khoản hoàn trả hàng còn chờ chọn nơi nhận vẫn chọn được ngay trên dòng yêu cầu', async () => {
    mocks.order = delivered;
    mocks.returns = [{
      id: 'r1', orderId: 'o9', status: 'APPROVED', reason: 'x', refundAmount: 150000, refundMethod: 'BANK',
      items: [{ orderItemId: 'i1', quantity: 1, refundAmount: 150000 }], createdAt: '2026-10-06T00:00:00Z',
    }];
    mocks.refunds = [{
      id: 'rf9', orderId: 'o9', orderCode: 'TB-9', kind: 'RETURN', refKey: 'r1', amount: 150000, method: 'MANUAL_TRANSFER', status: 'PENDING',
      bankName: null, bankAccountNo: null, bankAccountName: null, bankRef: null, completedAt: null, createdAt: '2026-10-06T00:00:00Z',
      canChooseDestination: true,
    }];
    const { container } = await mount();
    expect(container.querySelector('#refunds-title')).toBeNull();
    expect(btn(container, 'Chọn nơi nhận tiền')).toBeDefined();
  });

  it('không tải được danh sách yêu cầu cũ: vẫn cho gửi (BE chặn trùng bằng lời rõ ràng)', async () => {
    mocks.order = delivered;
    mocks.returnsError = true;
    const { container } = await mount();
    expect(btn(container, 'Yêu cầu đổi/trả')).toBeDefined();
  });
});

describe('chi tiết đơn — hoàn tiền và hạn thanh toán (D2, BUYERMINI-7/8)', () => {
  const LATE = {
    id: 'rf1', orderId: 'o9', orderCode: 'TB-9', kind: 'LATE_PAYMENT', amount: 197000, method: 'MANUAL_TRANSFER', status: 'PENDING',
    bankName: null, bankAccountNo: null, bankAccountName: null, bankRef: null, completedAt: null, createdAt: '2026-10-14T00:00:00Z',
    canChooseDestination: true,
  };

  it('tiền về sau khi huỷ: nhắc chọn nơi nhận; chọn Ví Tubu gọi API và báo đã hoàn', async () => {
    mocks.order = { ...BASE, status: 'CANCELLED', paymentMethod: 'BANK_TRANSFER' };
    mocks.refunds = [LATE];
    mocks.chooseDestination.mockResolvedValue({ ...LATE, method: 'WALLET', status: 'COMPLETED', canChooseDestination: false });
    const { container } = await mount();
    expect(container.textContent).toContain('Tiền về sau khi đơn đã huỷ: chờ bạn chọn nơi nhận · 197.000đ');
    click(btn(container, 'Chọn nơi nhận tiền')!);
    click(btn(container, 'Xác nhận')!);
    await flush(8);
    expect(mocks.chooseDestination).toHaveBeenCalledWith('rf1', { refundMethod: 'WALLET' });
    expect(mocks.invalidateBalances).toHaveBeenCalled();
    expect(container.textContent).toContain('Đã hoàn 197.000đ vào Ví Tubu.');
  });

  it('đã chuyển khoản: hiện tài khoản che số và mã giao dịch, không còn nút chọn', async () => {
    mocks.order = { ...BASE, status: 'CANCELLED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'REFUNDED' };
    mocks.refunds = [{ ...LATE, kind: 'CANCEL', status: 'COMPLETED', bankName: 'VCB', bankAccountNo: '0071000123456', bankRef: 'FT9', canChooseDestination: false }];
    const { container } = await mount();
    expect(container.textContent).toContain('Về VCB ••• 3456 · Mã GD FT9');
    expect(btn(container, 'Chọn nơi nhận tiền')).toBeUndefined();
  });

  it('BUYERMINI-8 (web): đơn ZaloPay đang chờ tiền hiện hạn thanh toán giờ VN (chuyển khoản hiện trong khung QR)', async () => {
    mocks.order = { ...BASE, status: 'PENDING_PAYMENT', paymentMethod: 'ZALOPAY', paymentStatus: 'UNPAID', paymentDeadline: '2026-10-14T03:00:00Z' };
    const { container } = await mount();
    expect(container.textContent).toContain('Thanh toán trước 10:00 14/10/2026 — quá hạn đơn sẽ tự huỷ.');
  });
});

describe('chi tiết đơn — truy cập', () => {
  it('đủ h1/h2/h3 không nhảy cấp, mọi điều khiển có tên, vùng chạm 44px (đơn đã giao, form đổi/trả mở)', async () => {
    mocks.order = { ...BASE, status: 'DELIVERED', deliveredAt: new Date(Date.now() - 864e5).toISOString(), shippingHistory: [{ at: '2026-10-02T03:00:00Z', status: 'delivered', code: 'X' }] };
    const { container } = await mount();
    click(btn(container, 'Yêu cầu đổi/trả')!);
    await flush();
    expect(byText(container, 'h3', 'Yêu cầu đổi/trả')).not.toBeNull();
    expect(headingProblems(container)).toEqual([]);
    expect(unnamedControls(container)).toEqual([]);
    expect(smallTouchTargets(container)).toEqual([]);
  });
});
