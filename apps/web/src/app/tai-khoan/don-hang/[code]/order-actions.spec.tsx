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
  orderGate: null as Promise<void> | null,
  orderFetches: 0,
  push: vi.fn(),
  cancel: vi.fn(),
  corePost: vi.fn(),
  getCart: vi.fn(),
  requestReturn: vi.fn(),
  estimate: vi.fn(),
  returns: [] as unknown[],
  returnsError: false,
  refunds: [] as unknown[],
  refundBank: null as Record<string, string> | null,
  chooseDestination: vi.fn(),
  invalidateBalances: vi.fn(),
  /** Có thì thay bản nén tức thời (giữ ảnh ở trạng thái đang xử lý tới khi test nhả). */
  compress: null as null | ((f: File) => Promise<string>),
}));
vi.mock('@/lib/image-compress', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/image-compress')>()),
  readAndCompressImage: async (f: File) => (mocks.compress ? mocks.compress(f) : `data:image/jpeg;base64,${f.name}`),
}));
vi.mock('@/lib/core-http', () => ({ coreHttp: { post: mocks.corePost } }));
vi.mock('@/lib/cart-key', () => ({ cartStorefrontSlug: () => null, useCartKey: () => ['cart', null] }));
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
  fetchOrder: () => {
    mocks.orderFetches += 1;
    return mocks.orderGate ? mocks.orderGate.then(() => mocks.order) : Promise.resolve(mocks.order);
  },
  // Sheet Mua lại khoá nút thêm tới khi giỏ tải xong: không mock thì đi fetch thật tới API không có, báo lỗi sau một khoảng phụ thuộc tải máy.
  getCart: () => mocks.getCart(),
  cancelOrder: mocks.cancel,
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
import { ReturnRequestForm } from './return-request-form';

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
// Nút phụ nằm trong menu "Thêm thao tác" (BottomSheet dựng ở document.body, ngoài container).
const moreBtn = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('button[aria-label="Thêm thao tác"]');
const menuRow = (text: string) =>
  Array.from(document.body.querySelectorAll<HTMLElement>('[role="group"] [role="button"]')).find((n) => (n.textContent ?? '').trim() === text);
const menuHas = (c: HTMLElement, text: string) => {
  const more = moreBtn(c);
  if (!more) return false;
  click(more);
  const found = !!menuRow(text);
  const close = document.body.querySelector<HTMLButtonElement>('button[aria-label="Đóng"]');
  if (close) click(close);
  return found;
};
const pressMenu = (c: HTMLElement, text: string) => {
  click(moreBtn(c)!);
  click(menuRow(text)!);
};
const confirmCancelBtn = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('[role="alertdialog"] button')).find((b) => b.textContent === 'Huỷ đơn') ?? null;
const radio = (c: HTMLElement, label: RegExp) =>
  Array.from(c.querySelectorAll<HTMLInputElement>('input[type="radio"]')).find((r) => label.test(r.closest('label')?.textContent ?? '')) ?? null;
const field = (c: HTMLElement, label: string) =>
  Array.from(c.querySelectorAll<HTMLInputElement>('input, textarea')).find((i) =>
    Array.from(i.labels ?? []).some((l) => (l.firstChild?.textContent ?? '').trim() === label),
  ) ?? null;

const pickReason = (c: HTMLElement, label = /Đổi ý/) => {
  const r = radio(c, label);
  if (r && !r.checked) click(r);
};
const confirmWithReason = (c: HTMLElement) => {
  pickReason(c);
  click(confirmCancelBtn(c));
};

beforeEach(() => {
  mocks.user = { id: 'u1' };
  mocks.order = { ...BASE };
  mocks.orderGate = null;
  mocks.orderFetches = 0;
  mocks.push.mockReset();
  mocks.cancel.mockReset().mockResolvedValue({ ...BASE, status: 'CANCELLED' });
  mocks.corePost.mockReset();
  mocks.getCart.mockReset().mockResolvedValue({ items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 199000, itemCount: 0 });
  mocks.requestReturn.mockReset().mockResolvedValue({ id: 'r1' });
  mocks.estimate.mockReset().mockResolvedValue({ isFull: false, goods: 90000, shipping: 0, refund: 90000, moneyRefundable: true, pointsUsedBack: 0, lines: [] });
  mocks.returns = [];
  mocks.returnsError = false;
  mocks.refunds = [];
  mocks.refundBank = null;
  mocks.chooseDestination.mockReset();
  mocks.invalidateBalances.mockReset();
  mocks.compress = null;
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('chi tiết đơn — hành trình đơn (BUYERWEB-13)', () => {
  it('đơn COD hiện 4 bước (bỏ chờ thanh toán), bước hiện tại có aria-current="step"', async () => {
    mocks.order = { ...BASE, status: 'PACKED' };
    const { container } = await mount();
    const steps = Array.from(container.querySelectorAll('ol[aria-label="Hành trình đơn hàng"] > li'));
    expect(steps.map((s) => s.getAttribute('data-step'))).toEqual(['Đã xác nhận', 'Đang đóng gói', 'Đang giao', 'Giao thành công']);
    expect(steps.map((s) => s.getAttribute('aria-current'))).toEqual([null, 'step', null, null]);
  });

  it('đơn đã huỷ/hoàn: không dựng hành trình', async () => {
    mocks.order = { ...BASE, status: 'CANCELLED' };
    const { container } = await mount();
    expect(container.querySelector('#order-track-title')).toBeNull();
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
    // Thanh tiến trình 4 bước cũng có nhãn "Đang giao hàng": thứ tự mốc chỉ xét trong danh sách mốc vận chuyển.
    const text = container.querySelector('ul[aria-label="Mốc vận chuyển"]')?.textContent ?? '';
    expect(container.querySelector('ul[aria-label="Mốc vận chuyển"]')).not.toBeNull();
    expect(text.indexOf('Đang cập nhật')).toBeLessThan(text.indexOf('Đang giao hàng'));
    expect(text.indexOf('Đang giao hàng')).toBeLessThan(text.indexOf('Đã tạo vận đơn'));
    expect(text).toMatch(/10:00 01\/10/);
    expect(text).not.toContain('WEIRD_42');
  });
});

describe('chi tiết đơn — huỷ đơn (BUYERWEB-13)', () => {
  it('đơn Đã xác nhận có nút Huỷ đơn; bấm phải xác nhận, "Giữ đơn" thì không gọi API', async () => {
    const { container } = await mount();
    click(btn(container, 'Huỷ đơn')!);
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
    click(btn(container, 'Huỷ đơn')!);
    expect(document.activeElement).toBe(btn(container, 'Giữ đơn'));
    const dialog = container.querySelector('[role="alertdialog"]')!;
    const described = dialog.getAttribute('aria-describedby')!.split(' ').map((id) => document.getElementById(id)?.textContent);
    expect(described[0]).toContain('không thể khôi phục');
    expect(described[1]).toContain('được hoàn ngay vào Ví Tubu');
  });

  it('WEB-13: "Giữ đơn" trả focus về nút "Huỷ đơn" đã bấm', async () => {
    const { container } = await mount();
    click(btn(container, 'Huỷ đơn')!);
    click(btn(container, 'Giữ đơn')!);
    await flush();
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement).toBe(btn(container, 'Huỷ đơn'));
  });

  it('WEB-13: huỷ xong (nút Huỷ đơn đã ẩn) focus chuyển sang dòng báo kết quả, không rơi về <body>', async () => {
    const { container } = await mount();
    click(btn(container, 'Huỷ đơn')!);
    confirmWithReason(container);
    await flush(8);
    const status = container.querySelector('[role="status"]')!;
    expect(status.textContent).toContain('Đã huỷ đơn hàng');
    expect(document.activeElement).toBe(status);
  });

  it('WEB-13: BE từ chối huỷ: focus về nút "Huỷ đơn" (lời từ chối đã đọc qua role=alert)', async () => {
    mocks.cancel.mockRejectedValue(new Error('Đơn đã bàn giao vận chuyển.'));
    const { container } = await mount();
    click(btn(container, 'Huỷ đơn')!);
    confirmWithReason(container);
    await flush(8);
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('Đơn đã bàn giao vận chuyển.');
    expect(document.activeElement).toBe(btn(container, 'Huỷ đơn'));
  });

  it('xác nhận huỷ: gọi API đúng mã đơn rồi báo đã huỷ', async () => {
    const { container } = await mount();
    click(btn(container, 'Huỷ đơn')!);
    confirmWithReason(container);
    await flush(8);
    expect(mocks.cancel).toHaveBeenCalledWith('TB-9', undefined, { cancelReasonCode: 'CHANGED_MIND' });
    expect(container.textContent).toContain('Đã huỷ đơn hàng');
  });

  it('chưa chọn lý do: báo chọn lý do và không gọi API; chọn "Lý do khác" thì có ô viết thêm và gửi kèm', async () => {
    const { container } = await mount();
    click(btn(container, 'Huỷ đơn')!);
    expect(container.querySelector('textarea[aria-label="Mô tả lý do huỷ"]')).toBeNull();
    click(confirmCancelBtn(container));
    await flush();
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Bạn chọn lý do huỷ giúp Tubu nhé');
    pickReason(container, /Lý do khác/);
    typeInto(container.querySelector('textarea[aria-label="Mô tả lý do huỷ"]'), ' Con ốm ');
    click(confirmCancelBtn(container));
    await flush(8);
    expect(mocks.cancel).toHaveBeenCalledWith('TB-9', undefined, { cancelReasonCode: 'OTHER', cancelReasonText: 'Con ốm' });
  });

  it('huỷ xong làm mới số dư Điểm Xanh/Ví (tiền và điểm hoàn về) — R2-BUYERWEB-3', async () => {
    const { container } = await mount();
    click(btn(container, 'Huỷ đơn')!);
    confirmWithReason(container);
    await flush(8);
    expect(mocks.invalidateBalances).toHaveBeenCalled();
  });

  describe('trạng thái đơn đổi ngay từ phản hồi huỷ, không chờ tải lại (như Mini App)', () => {
    // Giữ lượt tải lại đơn sau khi huỷ: nếu trang vẫn đổi trạng thái thì nó lấy từ phản hồi huỷ.
    const holdRefetch = () => {
      let release!: () => void;
      mocks.orderGate = new Promise<void>((r) => (release = r));
      return release;
    };
    const timelineStates = (c: HTMLElement) => Array.from(c.querySelectorAll('li[data-step]')).map((li) => li.getAttribute('data-state'));

    it('dải trạng thái và hành trình rẽ sang "Đã huỷ" khi phản hồi huỷ về', async () => {
      const { container } = await mount();
      expect(timelineStates(container)).not.toContain('cancelled');
      const release = holdRefetch();
      click(btn(container, 'Huỷ đơn')!);
      confirmWithReason(container);
      await flush(8);
      expect(container.querySelector('[data-testid="status-hero"]')?.textContent).toContain('Đã huỷ');
      expect(timelineStates(container)).toContain('cancelled');
      release();
      await flush(4);
    });

    it('đơn chờ chuyển khoản vừa huỷ: nút "Thanh toán ngay" biến mất ngay', async () => {
      mocks.order = { ...BASE, status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', paymentDeadline: '2099-01-01T03:00:00Z' };
      mocks.cancel.mockResolvedValue({ ...mocks.order, status: 'CANCELLED' });
      const { container } = await mount();
      expect(btn(container, 'Thanh toán ngay')).toBeDefined();
      const release = holdRefetch();
      pressMenu(container, 'Huỷ đơn');
      confirmWithReason(container);
      await flush(8);
      expect(container.textContent).toContain('Đã huỷ đơn hàng');
      expect(btn(container, 'Thanh toán ngay')).toBeUndefined();
      release();
      await flush(4);
    });

    it('phản hồi huỷ không kèm đủ dòng hàng: danh sách sản phẩm giữ nguyên dòng đang có', async () => {
      mocks.cancel.mockResolvedValue({ ...BASE, status: 'CANCELLED', items: [] });
      const { container } = await mount();
      const release = holdRefetch();
      click(btn(container, 'Huỷ đơn')!);
      confirmWithReason(container);
      await flush(8);
      expect(container.querySelector('[data-testid="status-hero"]')?.textContent).toContain('Đã huỷ');
      expect(container.textContent).toContain('Dầu gội');
      release();
      await flush(4);
    });

    it('vẫn tải lại đơn sau khi huỷ để lấy bản đầy đủ', async () => {
      const { container } = await mount();
      const before = mocks.orderFetches;
      click(btn(container, 'Huỷ đơn')!);
      confirmWithReason(container);
      await flush(8);
      expect(mocks.orderFetches).toBeGreaterThan(before);
    });
  });

  describe('khoá bấm đúp xác nhận huỷ', () => {
    const openConfirm = async () => {
      const r = await mount();
      click(btn(r.container, 'Huỷ đơn')!);
      pickReason(r.container);
      return { ...r, confirm: confirmCancelBtn(r.container) as HTMLButtonElement };
    };

    it('hai cú bấm "Huỷ đơn" sát nhau trước khi vẽ lại: chỉ gọi API một lần', async () => {
      mocks.cancel.mockImplementation(() => new Promise(() => {}));
      const { confirm } = await openConfirm();
      await act(async () => {
        click(confirm);
        click(confirm);
      });
      expect(mocks.cancel).toHaveBeenCalledTimes(1);
    });

    it('đang huỷ: nút báo aria-busy + aria-disabled nhưng không `disabled` (giữ focus), bấm thêm không gửi lần nữa', async () => {
      mocks.cancel.mockImplementation(() => new Promise(() => {}));
      const { confirm } = await openConfirm();
      expect(confirm.hasAttribute('aria-busy')).toBe(false);
      expect(confirm.hasAttribute('aria-disabled')).toBe(false);
      confirm.focus();
      click(confirm);
      await flush();
      expect(confirm.textContent).toBe('Đang huỷ…');
      expect(confirm.getAttribute('aria-busy')).toBe('true');
      expect(confirm.getAttribute('aria-disabled')).toBe('true');
      expect(confirm.disabled).toBe(false);
      expect(document.activeElement).toBe(confirm);
      click(confirm);
      await flush();
      expect(mocks.cancel).toHaveBeenCalledTimes(1);
    });

    it('BE từ chối rồi khách mở lại: nút hết bận và huỷ lần hai gửi được', async () => {
      mocks.cancel.mockRejectedValueOnce(new Error('Đơn đã bàn giao vận chuyển.'));
      const { container, confirm } = await openConfirm();
      click(confirm);
      await flush(8);
      expect(mocks.cancel).toHaveBeenCalledTimes(1);
      click(btn(container, 'Huỷ đơn')!);
      const again = confirmCancelBtn(container) as HTMLButtonElement;
      expect(again.hasAttribute('aria-busy')).toBe(false);
      expect(again.hasAttribute('aria-disabled')).toBe(false);
      click(again);
      await flush(8);
      expect(mocks.cancel).toHaveBeenCalledTimes(2);
    });

    it('chưa chọn lý do mà bấm đúp: không gửi và không kẹt khoá, chọn lý do rồi gửi được', async () => {
      const r = await mount();
      click(btn(r.container, 'Huỷ đơn')!);
      const confirm = confirmCancelBtn(r.container) as HTMLButtonElement;
      await act(async () => {
        click(confirm);
        click(confirm);
      });
      expect(mocks.cancel).not.toHaveBeenCalled();
      pickReason(r.container);
      click(confirm);
      await flush(8);
      expect(mocks.cancel).toHaveBeenCalledTimes(1);
    });
  });

  it('D2: đơn chuyển khoản đã trả → mặc định hoàn về Ví Tubu', async () => {
    mocks.order = { ...BASE, paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID' };
    const { container } = await mount();
    click(btn(container, 'Huỷ đơn')!);
    expect(container.querySelector('[role="alertdialog"] [role="radiogroup"]')?.getAttribute('aria-label')).toBe('Nơi nhận tiền hoàn');
    confirmWithReason(container);
    await flush(8);
    expect(mocks.cancel).toHaveBeenCalledWith('TB-9', { refundMethod: 'WALLET' }, { cancelReasonCode: 'CHANGED_MIND' });
  });

  it('MONEY-9: chọn tài khoản ngân hàng → điền sẵn tài khoản gần nhất, thiếu số thì báo lỗi và không gọi API', async () => {
    mocks.order = { ...BASE, paymentMethod: 'ZALOPAY', paymentStatus: 'PAID' };
    mocks.refundBank = { bankName: 'Techcombank', accountNumber: '190312345678', accountName: 'NGUYEN VAN A' };
    const { container } = await mount();
    click(btn(container, 'Huỷ đơn')!);
    click(radio(container, /Tài khoản ngân hàng/));
    await flush(8);
    expect(field(container, 'Số tài khoản')?.value).toBe('190312345678');
    typeInto(field(container, 'Số tài khoản'), '12');
    confirmWithReason(container);
    await flush();
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Số tài khoản nhận tiền hoàn chỉ gồm chữ số, từ 6 đến 24 số.');
    typeInto(field(container, 'Số tài khoản'), '1903 1234 5678');
    confirmWithReason(container);
    await flush(8);
    expect(mocks.cancel).toHaveBeenCalledWith('TB-9', {
      refundMethod: 'BANK', bankName: 'Techcombank', accountNumber: '1903 1234 5678', accountName: 'NGUYEN VAN A',
    }, { cancelReasonCode: 'CHANGED_MIND' });
  });

  it('MONEY-6: đơn chuyển khoản chưa ghi nhận tiền → cảnh báo đừng huỷ vội, tiền về muộn vẫn được hoàn', async () => {
    mocks.order = { ...BASE, status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' };
    const { container } = await mount();
    pressMenu(container, 'Huỷ đơn');
    const note = container.querySelector('[role="alertdialog"] [role="note"]');
    expect(note?.textContent).toContain('Nếu bạn vừa chuyển khoản');
    expect(note?.textContent).toContain('Tiền về sau khi huỷ vẫn được hoàn');
  });

  it('đơn trả bằng Ví: báo hoàn ngay về Ví, không có lựa chọn ngân hàng', async () => {
    mocks.order = { ...BASE, paymentMethod: 'WALLET', paymentStatus: 'PAID' };
    const { container } = await mount();
    click(btn(container, 'Huỷ đơn')!);
    expect(container.querySelector('[role="radiogroup"]')).toBeNull();
    expect(container.textContent).toContain('300.000đ được hoàn ngay vào Ví Tubu.');
  });

  it('BE từ chối (đơn vừa vào quy trình giao): hiện nguyên văn lời BE', async () => {
    mocks.cancel.mockRejectedValue(new Error('Đơn đã vào quy trình giao, vui lòng liên hệ Zalo OA để được hỗ trợ.'));
    const { container } = await mount();
    click(btn(container, 'Huỷ đơn')!);
    confirmWithReason(container);
    await flush(8);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('đã vào quy trình giao');
  });

  it('R3-CANCEL-2: BE từ chối "đã bàn giao" → tải lại đơn, nút Huỷ đơn biến mất, lời BE vẫn còn', async () => {
    mocks.order = { ...BASE, status: 'PACKED' };
    mocks.cancel.mockImplementation(async () => {
      mocks.order = { ...BASE, status: 'PACKED', shippingPartner: 'GHN', shippingCode: 'GHN1933', canCancel: false };
      throw new Error('Đơn đã bàn giao cho đơn vị vận chuyển, vui lòng liên hệ hotline hoặc Zalo OA của Tubu để được hỗ trợ.');
    });
    const { container } = await mount();
    click(btn(container, 'Huỷ đơn')!);
    confirmWithReason(container);
    await flush(12);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('đã bàn giao');
    expect(btn(container, 'Huỷ đơn')).toBeUndefined();
  });

  it('huỷ lỗi rồi đơn chuyển SHIPPING: thanh nút chỉ còn "Liên hệ Tubu", không còn nút huỷ', async () => {
    mocks.order = { ...BASE, status: 'PACKED' };
    mocks.cancel.mockImplementation(async () => {
      mocks.order = { ...BASE, status: 'SHIPPING', shippingPartner: 'GHN', shippingCode: 'GHN1933', canCancel: false };
      throw new Error('Đơn đã bàn giao cho đơn vị vận chuyển.');
    });
    const { container } = await mount();
    expect(btn(container, 'Huỷ đơn')).toBeDefined();
    click(btn(container, 'Huỷ đơn')!);
    confirmWithReason(container);
    await flush(12);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(btn(container, 'Huỷ đơn')).toBeUndefined();
    expect(btn(container, 'Liên hệ Tubu')).toBeDefined();
  });

  it('đơn đang đóng gói (chưa bàn giao vận chuyển) vẫn huỷ được — D1, BUYERWEB-5', async () => {
    mocks.order = { ...BASE, status: 'PACKED' };
    const { container } = await mount();
    expect(btn(container, 'Huỷ đơn')).toBeDefined();
  });

  it.each([['SHIPPING'], ['DELIVERED']])('đơn %s: không có nút Huỷ đơn (vẫn còn dòng hotline)', async (status) => {
    mocks.order = { ...BASE, status };
    const { container } = await mount();
    expect(btn(container, 'Huỷ đơn')).toBeUndefined();
    expect(container.textContent).toContain('Cần hỗ trợ?');
  });

  it('R3-CANCEL-2: đơn đang đóng gói mà kho đã đặt hãng (mã GHN) — chip "Đã đặt đơn vị vận chuyển", không có nút Huỷ đơn', async () => {
    mocks.order = { ...BASE, status: 'PACKED', shippingPartner: 'GHN', shippingCode: 'GHN1933', canCancel: false };
    const { container } = await mount();
    expect(btn(container, 'Huỷ đơn')).toBeUndefined();
    expect(container.textContent).toContain('Đã đặt đơn vị vận chuyển');
    expect(container.textContent).toContain('Cần hỗ trợ?');
  });

  it('R3-CANCEL-2: API báo canCancel=false thì ẩn nút dù trạng thái còn trong mốc huỷ', async () => {
    mocks.order = { ...BASE, status: 'CONFIRMED', canCancel: false };
    const { container } = await mount();
    expect(btn(container, 'Huỷ đơn')).toBeUndefined();
  });

  it('đơn CTV lên hộ khách đã trả tiền: CTV không thấy nút Huỷ đơn', async () => {
    mocks.order = { ...BASE, placedForCustomer: true, paymentStatus: 'PAID', referrerUserId: 'u1' };
    const { container } = await mount();
    expect(btn(container, 'Huỷ đơn')).toBeUndefined();
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

  const CART = { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 199000, itemCount: 2 };
  const sheetCta = () => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((b) => /^Thêm vào giỏ \(\d+\)$/.test(b.textContent ?? ''));
  const SETTLE = { timeout: 5_000, interval: 20 };
  /** Chờ tới khi điều kiện đúng thay vì đếm nhịp: giỏ và mutation xong sau số nhịp thay đổi theo tải máy, nên số nhịp cố định lúc đỏ lúc xanh. */
  const settled = (check: () => void) =>
    vi.waitFor(async () => {
      await flush(1);
      check();
    }, SETTLE);
  /** Mở sheet rồi chờ nút thêm hết khoá (giỏ tải xong): bấm khi nút còn khoá bị bỏ qua, nên không thể bấm ngay sau khi sheet hiện chữ. */
  const openSheet = async (container: HTMLElement) => {
    click(btn(container, 'Mua lại đơn này')!);
    await settled(() => {
      expect(sheetCta(), 'nút "Thêm vào giỏ (n)" của sheet').toBeDefined();
      expect(sheetCta()!.disabled).toBe(false);
    });
  };

  it('"Mua lại đơn này" mở sheet chọn dòng (như Mini App), chưa gọi API', async () => {
    mocks.order = delivered;
    const { container } = await mount();
    await openSheet(container);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Từ đơn TB-9');
    expect(sheetCta()!.textContent).toBe('Thêm vào giỏ (2)');
    expect(mocks.corePost).not.toHaveBeenCalled();
  });

  it('thêm đủ: gửi repurchase đúng dòng đã chọn rồi chuyển sang giỏ hàng', async () => {
    mocks.order = delivered;
    mocks.corePost.mockResolvedValue({ cart: CART, results: [{ orderItemId: 'i1', status: 'added', addedQuantity: 2 }] });
    const { container } = await mount();
    await openSheet(container);
    click(sheetCta()!);
    await settled(() => {
      expect(mocks.corePost).toHaveBeenCalledWith('/orders/TB-9/repurchase', { items: [{ orderItemId: 'i1', quantity: 2 }], addSource: 'repurchase' });
      expect(mocks.push).toHaveBeenCalledWith('/gio-hang');
    });
  });

  it('mua lại: tải lại giỏ thay vì ghi giỏ không kèm gian hàng (không combo) vào cache', async () => {
    const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    const setData = vi.spyOn(QueryClient.prototype, 'setQueryData');
    mocks.order = delivered;
    mocks.corePost.mockResolvedValue({ cart: CART, results: [{ orderItemId: 'i1', status: 'added', addedQuantity: 2 }] });
    const { container } = await mount();
    await openSheet(container);
    click(sheetCta()!);
    await settled(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['cart'] }));
    expect(setData.mock.calls.some(([key]) => Array.isArray(key) && key[0] === 'cart')).toBe(false);
    invalidate.mockRestore();
    setData.mockRestore();
  });

  it('không thêm được dòng nào: sheet ở lại, nêu tên món và lý do, không chuyển trang', async () => {
    mocks.order = delivered;
    mocks.corePost.mockResolvedValue({ cart: CART, results: [{ orderItemId: 'i1', status: 'skipped', reason: 'INACTIVE', addedQuantity: 0 }] });
    const { container } = await mount();
    await openSheet(container);
    click(sheetCta()!);
    await settled(() => expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Dầu gội (ngừng bán)'));
    expect(mocks.push).not.toHaveBeenCalled();
    expect(document.querySelector('a[href="/gio-hang"]')).not.toBeNull();
  });
});

describe('chi tiết đơn — yêu cầu đổi/trả (BUYERWEB-13)', () => {
  const delivered = { ...BASE, status: 'DELIVERED', deliveredAt: new Date(Date.now() - 864e5).toISOString() };

  it('đơn chưa giao không có nút đổi/trả', async () => {
    const { container } = await mount();
    expect(menuHas(container, 'Yêu cầu đổi/trả')).toBe(false);
  });

  it('BUYERMINI-11 (web): chọn dòng + lý do chọn sẵn → gửi đúng dòng, số lượng, mã lý do, nhận về Ví', async () => {
    mocks.order = delivered;
    const { container } = await mount();
    pressMenu(container, 'Yêu cầu đổi/trả');
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

  it('mở form từ menu: cuộn form vào tầm nhìn và chuyển focus vào tiêu đề form (form nằm cuối trang, khách đang ở đầu trang)', async () => {
    const scroll = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scroll;
    try {
      mocks.order = delivered;
      const { container } = await mount();
      pressMenu(container, 'Yêu cầu đổi/trả');
      const title = container.querySelector<HTMLElement>('#return-form-title')!;
      expect(title).not.toBeNull();
      expect(scroll).toHaveBeenCalled();
      expect(scroll.mock.contexts.at(-1)).toBe(title);
      expect(document.activeElement).toBe(title);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
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
      pressMenu(container, 'Yêu cầu đổi/trả');
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
      pressMenu(container, 'Yêu cầu đổi/trả');
      await flush(6);
      click(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
      await flush(4);
      expect(estimateText(container)).toBeNull();
    });

    it('đơn không có tiền để hoàn (moneyRefundable=false) → không hiện số', async () => {
      mocks.order = delivered;
      mocks.estimate.mockResolvedValue({ isFull: false, goods: 0, shipping: 0, refund: 0, moneyRefundable: false, pointsUsedBack: 0, lines: [] });
      const { container } = await mount();
      pressMenu(container, 'Yêu cầu đổi/trả');
      await flush(6);
      expect(estimateText(container)).toBeNull();
    });

    it('API ước tính lỗi → form vẫn gửi được, không hiện số', async () => {
      mocks.order = delivered;
      mocks.estimate.mockRejectedValue(new Error('boom'));
      const { container } = await mount();
      pressMenu(container, 'Yêu cầu đổi/trả');
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
    pressMenu(container, 'Yêu cầu đổi/trả');
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
    pressMenu(container, 'Yêu cầu đổi/trả');
    click(radio(container, /^Sản phẩm lỗi, hỏng$/));
    click(btn(container, 'Gửi yêu cầu')!);
    await flush(8);
    expect(mocks.requestReturn.mock.calls[0]![1]).not.toHaveProperty('images');
  });

  it('D3: tăng số lượng tới số còn trả được (đã trừ phần đã duyệt trước)', async () => {
    mocks.order = { ...delivered, items: [{ ...BASE.items[0], quantity: 3 }] };
    mocks.returns = [{ id: 'r0', orderId: 'o9', status: 'APPROVED', reason: 'x', refundAmount: 100000, items: [{ orderItemId: 'i1', quantity: 1, refundAmount: 100000 }], createdAt: '2026-10-06T00:00:00Z' }];
    const { container } = await mount();
    pressMenu(container, 'Trả thêm sản phẩm');
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
    pressMenu(container, 'Yêu cầu đổi/trả');
    click(btn(container, 'Gửi yêu cầu')!);
    await flush();
    expect(container.querySelector('form [role="alert"]')?.textContent).toBe('Chọn lý do đổi/trả.');
    click(radio(container, /^Lý do khác$/));
    typeInto(field(container, 'Mô tả thêm'), 'ab');
    click(btn(container, 'Gửi yêu cầu')!);
    await flush();
    expect(container.querySelector('form [role="alert"]')?.textContent).toBe('Bạn mô tả lý do đổi/trả (ít nhất 5 ký tự) nhé.');
    typeInto(field(container, 'Mô tả thêm'), '  Bao bì bị rách khi nhận  ');
    click(btn(container, 'Gửi yêu cầu')!);
    await flush(8);
    expect(mocks.requestReturn.mock.calls[0]![1]).toMatchObject({ reasonCode: 'OTHER', reason: 'Bao bì bị rách khi nhận' });
  });

  it('MONEY-9: đơn COD trả hàng chọn hoàn về ngân hàng → gửi kèm tài khoản', async () => {
    mocks.order = delivered;
    const { container } = await mount();
    pressMenu(container, 'Yêu cầu đổi/trả');
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
    pressMenu(container, 'Yêu cầu đổi/trả');
    click(radio(container, /^Sản phẩm lỗi, hỏng$/));
    click(btn(container, 'Gửi yêu cầu')!);
    await flush(8);
    expect(container.querySelector('form[aria-labelledby="return-form-title"]')).not.toBeNull();
    expect(container.textContent).toContain('Quá hạn đổi/trả (7 ngày từ khi nhận hàng).');
  });

  describe('khoá bấm đúp "Gửi yêu cầu"', () => {
    const openForm = async () => {
      mocks.order = delivered;
      const r = await mount();
      pressMenu(r.container, 'Yêu cầu đổi/trả');
      click(radio(r.container, /^Sản phẩm lỗi, hỏng$/));
      return { ...r, submit: btn(r.container, 'Gửi yêu cầu') as HTMLButtonElement };
    };

    it('hai cú bấm sát nhau trước khi vẽ lại: chỉ gửi một yêu cầu', async () => {
      mocks.requestReturn.mockImplementation(() => new Promise(() => {}));
      const { submit } = await openForm();
      await act(async () => {
        click(submit);
        click(submit);
      });
      expect(mocks.requestReturn).toHaveBeenCalledTimes(1);
    });

    it('đang gửi: nút báo aria-busy + aria-disabled nhưng không `disabled` (giữ focus), gửi form lần nữa không thêm yêu cầu', async () => {
      mocks.requestReturn.mockImplementation(() => new Promise(() => {}));
      const { container, submit } = await openForm();
      expect(submit.hasAttribute('aria-busy')).toBe(false);
      expect(submit.hasAttribute('aria-disabled')).toBe(false);
      submit.focus();
      click(submit);
      await flush();
      expect(submit.textContent).toBe('Đang gửi…');
      expect(submit.getAttribute('aria-busy')).toBe('true');
      expect(submit.getAttribute('aria-disabled')).toBe('true');
      expect(submit.disabled).toBe(false);
      expect(document.activeElement).toBe(submit);
      click(submit);
      act(() => {
        container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      await flush();
      expect(mocks.requestReturn).toHaveBeenCalledTimes(1);
    });

    it('BE từ chối: nút hết bận (bỏ aria-busy, aria-disabled), nhãn về "Gửi yêu cầu" và gửi lại được', async () => {
      mocks.requestReturn.mockRejectedValueOnce(new Error('Quá hạn đổi/trả (7 ngày từ khi nhận hàng).'));
      const { container, submit } = await openForm();
      click(submit);
      await flush(8);
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('Quá hạn đổi/trả');
      expect(submit.hasAttribute('aria-busy')).toBe(false);
      expect(submit.hasAttribute('aria-disabled')).toBe(false);
      expect(submit.textContent).toBe('Gửi yêu cầu');
      click(submit);
      await flush(8);
      expect(mocks.requestReturn).toHaveBeenCalledTimes(2);
    });

    it('chọn hoàn về ngân hàng mà chưa điền tài khoản: báo lỗi, không gửi và không kẹt khoá', async () => {
      mocks.order = delivered;
      const { container } = await mount();
      pressMenu(container, 'Yêu cầu đổi/trả');
      click(radio(container, /^Sản phẩm lỗi, hỏng$/));
      click(radio(container, /Tài khoản ngân hàng/));
      const submit = btn(container, 'Gửi yêu cầu') as HTMLButtonElement;
      click(submit);
      await flush();
      expect(mocks.requestReturn).not.toHaveBeenCalled();
      expect(submit.hasAttribute('aria-busy')).toBe(false);
      typeInto(field(container, 'Tên ngân hàng'), 'VCB');
      typeInto(field(container, 'Số tài khoản'), '0071000123456');
      typeInto(field(container, 'Chủ tài khoản'), 'Le Van C');
      click(submit);
      await flush(8);
      expect(mocks.requestReturn).toHaveBeenCalledTimes(1);
    });

    it('không còn dòng nào để trả (mọi dòng đã được duyệt trả hết): form báo vậy và nút Gửi yêu cầu khoá hẳn', async () => {
      const done = [{ id: 'r0', orderId: 'o9', status: 'APPROVED', reason: 'DAMAGED', createdAt: '2026-10-02T03:00:00Z', items: [{ orderItemId: 'i1', quantity: 2 }] }];
      const r = render(<ReturnRequestForm order={delivered as never} returns={done as never} onDone={() => {}} onClose={() => {}} />);
      mounted.push(r);
      await flush();
      expect(r.container.textContent).toContain('Mọi sản phẩm của đơn đã được trả.');
      const submit = btn(r.container, 'Gửi yêu cầu') as HTMLButtonElement;
      expect(submit.disabled).toBe(true);
    });

    it('đang xử lý ảnh minh chứng: nút Gửi khoá và đổi nhãn, bấm hay gửi form không tạo yêu cầu thiếu ảnh; xong thì gửi kèm ảnh vừa xử lý', async () => {
      let finish!: (v: string) => void;
      mocks.compress = () => new Promise<string>((resolve) => (finish = resolve));
      const { container, submit } = await openForm();
      const input = container.querySelector<HTMLInputElement>('form input[type="file"]')!;
      Object.defineProperty(input, 'files', { value: [new File(['x'], 'vo.jpg', { type: 'image/jpeg' })], configurable: true });
      act(() => {
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await flush(2);
      expect(submit.disabled).toBe(true);
      expect(submit.textContent).toBe('Đang tải ảnh…');
      click(submit);
      act(() => {
        container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      await flush(4);
      expect(mocks.requestReturn).not.toHaveBeenCalled();

      await act(async () => finish('data:image/jpeg;base64,xong'));
      await flush(2);
      expect(submit.disabled).toBe(false);
      expect(submit.textContent).toBe('Gửi yêu cầu');
      click(submit);
      await flush(8);
      expect(mocks.requestReturn).toHaveBeenCalledTimes(1);
      expect(mocks.requestReturn.mock.calls[0]![1].images).toEqual(['data:image/jpeg;base64,xong']);
    });

    it('đang gửi: ô thêm ảnh và nút xoá ảnh khoá, nút Gửi không đổi nhãn sang "Đang tải ảnh…"', async () => {
      mocks.requestReturn.mockImplementation(() => new Promise(() => {}));
      const { container, submit } = await openForm();
      const add = () => btn(container, 'Thêm ảnh') as HTMLButtonElement;
      expect(add().disabled).toBe(false);
      click(submit);
      await flush();
      expect(add().disabled).toBe(true);
      expect(submit.textContent).toBe('Đang gửi…');
    });

    it('thiếu lý do mà bấm đúp: không gửi và không kẹt khoá, chọn lý do rồi gửi được', async () => {
      mocks.order = delivered;
      const { container } = await mount();
      pressMenu(container, 'Yêu cầu đổi/trả');
      const submit = btn(container, 'Gửi yêu cầu') as HTMLButtonElement;
      await act(async () => {
        click(submit);
        click(submit);
      });
      expect(mocks.requestReturn).not.toHaveBeenCalled();
      click(radio(container, /^Sản phẩm lỗi, hỏng$/));
      click(submit);
      await flush(8);
      expect(mocks.requestReturn).toHaveBeenCalledTimes(1);
    });
  });

  it.each([
    ['REQUESTED', 'đang xử lý'],
    ['REJECTED', 'bị từ chối: Ảnh không rõ'],
  ])('đang có yêu cầu %s cho mọi dòng: hiện trạng thái', async (status, expected) => {
    mocks.order = delivered;
    mocks.returns = [{ id: 'r1', orderId: 'o9', status, reason: 'x', adminNote: status === 'REJECTED' ? 'Ảnh không rõ' : null, createdAt: '2026-10-06T00:00:00Z' }];
    const { container } = await mount();
    if (status === 'REQUESTED') expect(menuHas(container, 'Yêu cầu đổi/trả')).toBe(false);
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
    expect(menuHas(container, 'Trả thêm sản phẩm')).toBe(false);
    expect(menuHas(container, 'Yêu cầu đổi/trả')).toBe(false);
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
    expect(menuHas(container, 'Yêu cầu đổi/trả')).toBe(true);
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
    mocks.order = { ...BASE, status: 'PENDING_PAYMENT', paymentMethod: 'ZALOPAY', paymentStatus: 'UNPAID', paymentDeadline: '2099-10-14T03:00:00Z' };
    const { container } = await mount();
    expect(container.textContent).toContain('Thanh toán trước 10:00 14/10/2099');
  });
});

describe('chi tiết đơn — truy cập', () => {
  it('đủ h1/h2/h3 không nhảy cấp, mọi điều khiển có tên, vùng chạm 44px (đơn đã giao, form đổi/trả mở)', async () => {
    mocks.order = { ...BASE, status: 'DELIVERED', deliveredAt: new Date(Date.now() - 864e5).toISOString(), shippingHistory: [{ at: '2026-10-02T03:00:00Z', status: 'delivered', code: 'X' }] };
    const { container } = await mount();
    pressMenu(container, 'Yêu cầu đổi/trả');
    await flush();
    expect(byText(container, 'h3', 'Yêu cầu đổi/trả')).not.toBeNull();
    expect(headingProblems(container)).toEqual([]);
    expect(unnamedControls(container)).toEqual([]);
    expect(smallTouchTargets(container)).toEqual([]);
  });
});

describe('chi tiết đơn — từ md, "Thanh toán ngay" cuộn tới khung QR nhúng', () => {
  it('cuộn tới khung QR rồi chuyển focus vào khung (người dùng bàn phím không đứng lại ở nút), không rời trang', async () => {
    const scroll = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scroll;
    try {
      mocks.order = { ...BASE, status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', paymentDeadline: '2099-01-01T03:00:00Z' };
      const { container } = await mount();
      const panel = container.querySelector<HTMLElement>('#order-pay-panel')!;
      expect(panel).not.toBeNull();
      const bar = container.querySelector('[data-testid="order-action-bar"]') as HTMLElement;
      click(btn(bar, 'Thanh toán ngay')!);
      expect(scroll.mock.contexts.at(-1)).toBe(panel);
      expect(document.activeElement).toBe(panel);
      expect(mocks.push).not.toHaveBeenCalled();
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });
});

describe('chi tiết đơn — điện thoại (như Mini App)', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('max-width'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const PENDING = { ...BASE, status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', paymentDeadline: '2099-01-01T03:00:00Z' };
  const bar = (c: HTMLElement) => c.querySelector('[data-testid="order-action-bar"]') as HTMLElement;
  // Nút nhìn thấy ở thanh (bỏ nút "Thêm thao tác" chỉ có icon).
  const barLabels = (c: HTMLElement) =>
    Array.from(bar(c).querySelectorAll('button')).map((b) => b.getAttribute('aria-label') ?? b.textContent?.trim()).filter((t) => t !== 'Thêm thao tác');

  it('đơn chờ chuyển khoản: không nhúng khung QR, dải trạng thái có hạn, thanh đáy "Huỷ đơn | Thanh toán ngay" tới trang chuyển khoản', async () => {
    mocks.order = { ...PENDING };
    const { container } = await mount();
    expect(container.querySelector('img[src*="vietqr"]')).toBeNull();
    expect(container.textContent).not.toContain('Chuyển khoản trước');
    expect(container.querySelector('[data-testid="status-hero"]')?.textContent).toContain('Thanh toán trước 10:00 01/01/2099');
    expect(container.querySelector('[data-testid="status-hero"]')?.textContent).toContain('Đơn đang chờ bạn thanh toán.');
    expect(barLabels(container)).toEqual(['Thanh toán ngay']);
    expect(menuHas(container, 'Huỷ đơn')).toBe(true);
    click(btn(bar(container), 'Thanh toán ngay')!);
    expect(mocks.push).toHaveBeenCalledWith('/thanh-toan/chuyen-khoan/TB-9');
  });

  it('đơn chờ chuyển khoản đã quá hạn: không còn nút "Thanh toán ngay"', async () => {
    mocks.order = { ...PENDING, paymentDeadline: '2020-01-01T03:00:00Z' };
    const { container } = await mount();
    expect(barLabels(container)).toEqual(['Liên hệ Tubu']);
  });

  it('đơn đã giao: thanh đáy chỉ có "Mua lại đơn này", "Yêu cầu đổi/trả" nằm trong menu Thêm thao tác', async () => {
    mocks.order = { ...BASE, status: 'DELIVERED', deliveredAt: new Date(Date.now() - 864e5).toISOString() };
    const { container } = await mount();
    expect(barLabels(container)).toEqual(['Mua lại đơn này']);
    expect(menuHas(container, 'Yêu cầu đổi/trả')).toBe(true);
  });

  it('huỷ đơn mở Sheet đáy (dialog), focus vào "Giữ đơn", đóng thì focus về nút "Huỷ đơn" đã bấm', async () => {
    mocks.order = { ...BASE };
    const { container } = await mount();
    const opener = btn(container, 'Huỷ đơn')!;
    opener.focus();
    click(opener);
    await flush();
    const dialog = document.querySelector('[role="alertdialog"][aria-modal="true"]')!;
    expect(dialog.textContent).toContain('Bạn muốn huỷ đơn này?');
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.getElementById('cancel-note')?.textContent).toContain('không thể khôi phục');
    expect(dialog.getAttribute('aria-describedby')).toContain('cancel-note');
    expect(document.activeElement?.textContent).toBe('Giữ đơn');
    click(Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Giữ đơn')!);
    await flush();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it('xác nhận huỷ trong Sheet gọi API với lý do đã chọn', async () => {
    mocks.order = { ...BASE };
    const { container } = await mount();
    click(btn(container, 'Huỷ đơn')!);
    await flush();
    const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement;
    pickReason(dialog);
    click(Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Huỷ đơn')!);
    await flush(12);
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
  });
  it('đang gửi huỷ: Sheet không đóng được (không nút X, Esc không đóng), nút "Huỷ đơn" ở thanh đáy khoá nên không gửi POST lần hai', async () => {
    mocks.order = { ...BASE };
    mocks.cancel.mockImplementation(() => new Promise(() => {}));
    const { container } = await mount();
    click(btn(container, 'Huỷ đơn')!);
    await flush();
    const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement;
    pickReason(dialog);
    click(Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Huỷ đơn')!);
    await flush(4);
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
    expect(dialog.querySelector('button[aria-label="Đóng"]')).toBeNull();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(btn(bar(container), 'Huỷ đơn')!.disabled).toBe(true);
    click(btn(bar(container), 'Huỷ đơn')!);
    await flush(4);
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
  });

  it('đơn chờ chuyển khoản không huỷ được (canCancel=false): vẫn có thanh đáy với "Thanh toán ngay"', async () => {
    mocks.order = { ...PENDING, canCancel: false };
    const { container } = await mount();
    expect(barLabels(container)).toEqual(['Thanh toán ngay']);
  });

  it('yêu cầu cũ bị từ chối: vẫn hiện trạng thái và vẫn có thể yêu cầu đổi/trả mới trong menu', async () => {
    mocks.order = { ...BASE, status: 'DELIVERED', deliveredAt: new Date(Date.now() - 864e5).toISOString() };
    mocks.returns = [{ id: 'r0', orderId: 'o9', status: 'REJECTED', reason: 'DAMAGED', createdAt: '2026-10-02T03:00:00Z', items: [{ orderItemId: 'i1', quantity: 1 }] }];
    const { container } = await mount();
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(menuHas(container, 'Yêu cầu đổi/trả')).toBe(true);
  });
});
