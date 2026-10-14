// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { byText, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';
import type { AdminReturnPreview, AdminReturnRequest } from '@/lib/admin-client';

const mocks = vi.hoisted(() => ({ preview: vi.fn(), review: vi.fn(), received: vi.fn() }));
vi.mock('@/lib/admin-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/admin-client')>()),
  previewReturnRequest: mocks.preview,
  reviewReturnRequest: mocks.review,
  markReturnReceived: mocks.received,
}));

import { ReturnRow, approvedRefundText } from './return-request-row';

const REQ = (over: Partial<AdminReturnRequest> = {}): AdminReturnRequest => ({
  id: 'r1',
  orderId: 'o1',
  userId: 'u1',
  reason: 'Vỏ chai bị nứt',
  reasonCode: 'DEFECTIVE',
  reasonLabel: 'Sản phẩm lỗi, hỏng',
  images: [],
  status: 'REQUESTED',
  refundMethod: 'WALLET',
  bankName: null,
  bankAccountNo: null,
  bankAccountName: null,
  shopFault: null,
  fullReturn: false,
  refundAmount: null,
  shippingRefund: 0,
  receivedAt: null,
  items: [
    {
      orderItemId: 'i1',
      quantity: 1,
      refundAmount: 0,
      productName: 'Nước giặt',
      variationName: 'Chai 1L',
      orderedQuantity: 3,
    },
  ],
  adminNote: null,
  reviewedBy: null,
  reviewedAt: null,
  createdAt: '2026-10-13T03:00:00Z',
  order: {
    id: 'o1',
    code: 'TB-1',
    total: 282_000,
    status: 'DELIVERED',
    paymentMethod: 'COD',
    pancakeOrderId: null,
  },
  user: { id: 'u1', fullName: 'Nguyễn Văn A', phone: '0912345678' },
  ...over,
});

const PREVIEW = (over: Partial<AdminReturnPreview> = {}): AdminReturnPreview => ({
  requestId: 'r1',
  shopFault: true,
  defaultShopFault: true,
  isFull: false,
  goods: 89_000,
  shipping: 15_000,
  refund: 104_000,
  moneyRefundable: true,
  destination: { method: 'WALLET' },
  pointsUsedBack: 0,
  pointsEarnedBack: 89,
  lines: [
    {
      orderItemId: 'i1',
      productName: 'Nước giặt',
      variationName: 'Chai 1L',
      quantity: 1,
      orderedQuantity: 3,
      refundAmount: 89_000,
    },
  ],
  pancakeTask: false,
  ...over,
});

let mounted: Rendered[] = [];
const mount = async (item: AdminReturnRequest) => {
  const r = render(<ReturnRow item={item} />);
  mounted.push(r);
  await flush();
  return r.container;
};
const btn = (c: HTMLElement, text: string) => byText(c, 'button', text) as HTMLButtonElement | null;

beforeEach(() => {
  mocks.preview.mockReset().mockResolvedValue(PREVIEW());
  mocks.review.mockReset().mockResolvedValue(REQ({ status: 'APPROVED' }));
  mocks.received
    .mockReset()
    .mockResolvedValue(REQ({ status: 'APPROVED', receivedAt: '2026-10-14T00:00:00Z' }));
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('ReturnRow — duyệt đổi/trả theo dòng (ADMINOPS-6, D3)', () => {
  it('hiện dòng khách xin trả kèm số lượng/đã mua, lý do chọn sẵn và nơi khách muốn nhận tiền', async () => {
    const c = await mount(
      REQ({
        refundMethod: 'BANK',
        bankName: 'VCB',
        bankAccountNo: '0071000123456',
        bankAccountName: 'LE VAN C',
      }),
    );
    const text = c.textContent ?? '';
    expect(text).toContain('Nước giặt · Chai 1L');
    expect(text).toContain('Trả 1/3');
    expect(text).toContain('Sản phẩm lỗi, hỏng');
    expect(text).toContain('Vỏ chai bị nứt');
    expect(text).toContain('Khách muốn nhận: chuyển khoản VCB 0071000123456 (LE VAN C)');
  });

  it('bấm "Duyệt hoàn tiền" → xem số tiền BE tính sẵn từng dòng, phí ship, điểm; xác nhận gửi kèm số đã xem', async () => {
    const c = await mount(REQ());
    expect(mocks.preview).not.toHaveBeenCalled();
    click(btn(c, 'Duyệt hoàn tiền'));
    await flush();
    expect(mocks.preview).toHaveBeenCalledWith('r1', undefined);
    const box = c.querySelector(
      '[role="group"][aria-label="Xác nhận duyệt đổi/trả"]',
    ) as HTMLElement;
    const text = box.textContent ?? '';
    expect(text).toContain('Nước giặt · Chai 1L ×1');
    expect(text).toContain('89.000đ');
    expect(text).toContain('Phí ship hoàn15.000đ');
    expect(text).toContain('Tổng hoàn104.000đ');
    expect(text).toContain('Về Ví Tubu của khách (cộng ngay khi duyệt)');
    expect(text).toContain('Thu hồi 89 Điểm Xanh đã tích');
    expect(text).toContain('Kho chỉ cộng lại khi bấm "Đã nhận hàng về".');
    click(btn(box, 'Xác nhận hoàn 104.000đ'));
    await flush();
    expect(mocks.review).toHaveBeenCalledWith('r1', true, undefined, {
      shopFault: true,
      expectedRefund: 104_000,
    });
  });

  it('bỏ "Lỗi do Tubu" → tính lại không hoàn phí ship và gửi shopFault=false', async () => {
    mocks.preview.mockImplementation(async (_id: string, shopFault?: boolean) =>
      shopFault === false ? PREVIEW({ shopFault: false, shipping: 0, refund: 89_000 }) : PREVIEW(),
    );
    const c = await mount(REQ());
    click(btn(c, 'Duyệt hoàn tiền'));
    await flush();
    const toggle = c.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    click(toggle);
    await flush();
    expect(mocks.preview).toHaveBeenLastCalledWith('r1', false);
    click(btn(c, 'Xác nhận hoàn 89.000đ'));
    await flush();
    expect(mocks.review).toHaveBeenCalledWith('r1', true, undefined, {
      shopFault: false,
      expectedRefund: 89_000,
    });
  });

  it('đơn Tubu giao qua Pancake: nhắc xử lý phiếu trả trên Pancake; hoàn về ngân hàng: nói rõ vào hàng chờ chuyển khoản', async () => {
    mocks.preview.mockResolvedValue(
      PREVIEW({
        pancakeTask: true,
        destination: {
          method: 'BANK',
          bankName: 'VCB',
          accountNumber: '0071000123456',
          accountName: 'LE VAN C',
        },
      }),
    );
    const c = await mount(REQ());
    click(btn(c, 'Duyệt hoàn tiền'));
    await flush();
    const text = c.textContent ?? '';
    expect(text).toContain(
      'Chuyển khoản về VCB 0071000123456 (LE VAN C) — vào tab "Hoàn tiền khách" sau khi duyệt',
    );
    expect(text).toContain(
      'Đơn giao qua Pancake: sau khi duyệt, tạo phiếu trả/nhận hàng về trên Pancake.',
    );
  });

  it('BE báo số tiền đã đổi (409): hiện lời BE, tải lại số mới, không đóng bước xác nhận', async () => {
    mocks.review.mockRejectedValueOnce(
      new Error(
        'Số tiền hoàn đã đổi thành 50.000đ (đơn vừa có thay đổi). Vui lòng xem lại trước khi duyệt.',
      ),
    );
    const c = await mount(REQ());
    click(btn(c, 'Duyệt hoàn tiền'));
    await flush();
    click(btn(c, 'Xác nhận hoàn 104.000đ'));
    await flush();
    expect(c.querySelector('[role="alert"]')?.textContent).toContain(
      'Số tiền hoàn đã đổi thành 50.000đ',
    );
    expect(mocks.preview).toHaveBeenCalledTimes(2);
    expect(c.querySelector('[aria-label="Xác nhận duyệt đổi/trả"]')).not.toBeNull();
  });

  it('từ chối bắt buộc ghi lý do để báo khách', async () => {
    const c = await mount(REQ());
    click(btn(c, 'Từ chối'));
    await flush();
    expect(mocks.review).not.toHaveBeenCalled();
    expect(c.querySelector('[role="alert"]')?.textContent).toBe(
      'Ghi lý do từ chối để báo cho khách (tối thiểu 3 ký tự).',
    );
    typeInto(c.querySelector('input[placeholder^="Ghi chú duyệt"]'), 'Ảnh không rõ');
    click(btn(c, 'Từ chối'));
    await flush();
    expect(mocks.review).toHaveBeenCalledWith('r1', false, 'Ảnh không rõ');
  });

  it('quyền nhân viên: KHO không có nút duyệt/từ chối, CSKH không có nút "Đã nhận hàng về" (API chặn theo nhóm việc)', async () => {
    const kho = render(<ReturnRow item={REQ()} canReview={false} />);
    mounted.push(kho);
    await flush();
    expect(btn(kho.container, 'Duyệt hoàn tiền')).toBeNull();
    expect(btn(kho.container, 'Từ chối')).toBeNull();
    expect(kho.container.textContent).toContain('Chờ CSKH hoặc admin duyệt.');

    const cskh = render(<ReturnRow item={REQ({ status: 'APPROVED', refundAmount: 89_000, reviewedAt: '2026-10-13T05:00:00Z' })} canReceive={false} />);
    mounted.push(cskh);
    await flush();
    expect(btn(cskh.container, 'Đã nhận hàng về')).toBeNull();
    expect(cskh.container.textContent).toContain('Chưa nhận hàng trả về — kho chưa cộng.');
  });

  it('đã duyệt, chưa nhận hàng: hiện số đã hoàn và nút "Đã nhận hàng về" (cộng kho); đã nhận thì không còn nút', async () => {
    const approved = REQ({
      status: 'APPROVED',
      refundAmount: 89_000,
      shippingRefund: 15_000,
      reviewedAt: '2026-10-13T05:00:00Z',
      items: [
        {
          orderItemId: 'i1',
          quantity: 1,
          refundAmount: 89_000,
          productName: 'Nước giặt',
          variationName: 'Chai 1L',
          orderedQuantity: 3,
        },
      ],
    });
    const c = await mount(approved);
    expect(c.textContent).toContain(
      'Đã hoàn 104.000đ (tiền hàng 89.000đ + phí ship 15.000đ) về Ví Tubu',
    );
    click(btn(c, 'Đã nhận hàng về'));
    await flush();
    expect(mocks.received).toHaveBeenCalledWith('r1');
    expect(unnamedControls(c)).toEqual([]);
    expect(smallTouchTargets(c).filter((x) => !x.includes('min-h-[44px]'))).toEqual([]);

    const done = await mount({ ...approved, receivedAt: '2026-10-14T00:00:00Z' });
    expect(btn(done, 'Đã nhận hàng về')).toBeNull();
    expect(done.textContent).toContain('Đã nhận hàng về lúc');
  });

  it('đơn gian hàng tự giao (D4): hàng về gian hàng — xem trước nói rõ, đã duyệt không có nút "Đã nhận hàng về" của kho Tubu', async () => {
    const order = { id: 'o1', code: 'TB-1', total: 282_000, status: 'DELIVERED', paymentMethod: 'COD', pancakeOrderId: null, fulfiller: 'MERCHANT', fulfillerStorefront: { title: 'Mật ong Linh' } };
    mocks.preview.mockResolvedValue(PREVIEW({ returnTo: { kind: 'MERCHANT', name: 'Mật ong Linh' } }));
    const c = await mount(REQ({ order }));
    expect(c.textContent).toContain('Mật ong Linh tự giao');
    click(btn(c, 'Duyệt hoàn tiền'));
    await flush();
    expect(c.textContent).toContain('Hàng trả về Mật ong Linh, không về kho Tubu');
    // Đơn gian hàng tự giao: lỗi (nếu có) là của gian hàng, không phải của Tubu.
    expect(c.textContent).toContain('Lỗi do gian hàng Mật ong Linh (hoàn cả phí ship dù chỉ trả một phần)');
    expect(c.textContent).not.toContain('Lỗi do Tubu');

    const approved = await mount(REQ({ order, status: 'APPROVED', refundAmount: 89_000, reviewedAt: '2026-10-13T05:00:00Z' }));
    expect(btn(approved, 'Đã nhận hàng về')).toBeNull();
    expect(approved.textContent).toContain('chờ gian hàng xác nhận đã nhận');
    const received = await mount(REQ({ order, status: 'APPROVED', refundAmount: 89_000, receivedAt: '2026-10-14T00:00:00Z' }));
    expect(received.textContent).toContain('Mật ong Linh đã nhận hàng trả lúc');
  });
});

// R2-LIFECYCLE-6: chuyển khoản chưa xong không được ghi "Đã hoàn"; khách đổi sang Ví thì nói Ví.
describe('approvedRefundText — theo khoản hoàn thật', () => {
  const base = REQ({ status: 'APPROVED', refundMethod: 'BANK', bankName: 'MB', bankAccountNo: '123456', refundAmount: 42_000, shippingRefund: 0 });
  const refund = (method: 'WALLET' | 'MANUAL_TRANSFER', status: 'PENDING' | 'PROCESSING' | 'COMPLETED') => ({
    method,
    status,
    amount: 42_000,
    bankName: 'MB',
    bankAccountNo: '123456',
  });
  it('khoản chuyển khoản còn chờ / đang chuyển / đã chuyển', () => {
    expect(approvedRefundText({ ...base, refund: refund('MANUAL_TRANSFER', 'PENDING') }, 42_000)).toBe(
      'Chờ chuyển khoản 42.000đ (tiền hàng 42.000đ + phí ship 0đ) — xử lý ở tab "Hoàn tiền khách"',
    );
    expect(approvedRefundText({ ...base, refund: refund('MANUAL_TRANSFER', 'PROCESSING') }, 42_000)).toContain('Đang chuyển khoản 42.000đ');
    expect(approvedRefundText({ ...base, refund: refund('MANUAL_TRANSFER', 'COMPLETED') }, 42_000)).toBe(
      'Đã chuyển khoản 42.000đ (tiền hàng 42.000đ + phí ship 0đ) cho khách',
    );
  });
  it('khách đã đổi sang Ví → "Đã hoàn … về Ví Tubu" dù lúc gửi chọn ngân hàng; API cũ không có khoản thì theo lựa chọn lúc gửi', () => {
    expect(approvedRefundText({ ...base, refund: refund('WALLET', 'COMPLETED') }, 42_000)).toBe(
      'Đã hoàn 42.000đ (tiền hàng 42.000đ + phí ship 0đ) về Ví Tubu',
    );
    expect(approvedRefundText(base, 42_000)).toContain('Chờ chuyển khoản');
  });
});
