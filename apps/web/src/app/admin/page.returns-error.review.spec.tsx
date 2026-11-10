// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import AdminPage from './page';
import { answerConfirm, byText, click, confirmDialog, flush, render, selectValue, typeInto, type Rendered } from '@/test-utils/dom';
import type { AdminReturnRequest } from '@/lib/admin-client';

// W96B sửa theo review (A3): lời lỗi Từ chối / "Đã nhận hàng về" của yêu cầu đổi/trả nằm ở ReturnsTab (như DealersTab), không trong hàng:
// tab lọc mặc định "Chờ duyệt" nên khi máy chủ báo yêu cầu đã được xử lý (admin khác làm trước), lần tải lại làm hàng rời bộ lọc và lời lỗi nằm trong hàng sẽ mất theo.
// Dựng ReturnsTab thật qua trang Quản trị (không chỉ một ReturnRow).

class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

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
  items: [{ orderItemId: 'i1', quantity: 1, refundAmount: 0, productName: 'Nước giặt', variationName: 'Chai 1L', orderedQuantity: 3 }],
  adminNote: null,
  reviewedBy: null,
  reviewedAt: null,
  createdAt: '2026-10-13T03:00:00Z',
  order: { id: 'o1', code: 'TB-1', total: 282_000, status: 'DELIVERED', paymentMethod: 'COD', pancakeOrderId: null },
  user: { id: 'u1', fullName: 'Nguyễn Văn A', phone: '0912345678' },
  ...over,
});

const mocks = vi.hoisted(() => ({
  /** Danh sách mà lần tải kế tiếp của listReturnRequests trả về (đổi giữa chừng để mô phỏng admin khác đã xử lý). */
  rows: [] as unknown[],
  listCalls: 0,
  review: vi.fn(),
  received: vi.fn(),
}));

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { role: 'ADMIN' }, status: 'authenticated', initialized: true }),
  useViewerRole: () => 'ADMIN',
}));
vi.mock('@/lib/admin-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/admin-client')>();
  return {
    ...actual,
    getDashboardStats: async () => ({}),
    countRecyclingAttention: async () => 0,
    countPancakeAttention: async () => 0,
    listDealerRewardClaims: async () => ({ data: [], meta: { total: 0, page: 1, limit: 1 } }),
    listPayouts: async () => ({ data: [], meta: { total: 0, page: 1, limit: 1 } }),
    listCustomerRefunds: async () => ({ data: [], meta: { total: 0, page: 1, limit: 1 } }),
    getOpsInbox: async () => ({ generatedAt: '2026-10-14T03:00:00.000Z', items: [] }),
    getTodaySummary: async () => ({ orders: { today: 0, yesterday: 0, week: 0 }, revenue: { today: 0, yesterday: 0, week: 0 }, newUsers: { today: 0, yesterday: 0, week: 0 } }),
    getRetentionDaily: async () => [],
    getOpsAccess: async () => ({ role: 'ADMIN', staffPermissions: [] }),
    listReturnRequests: async () => {
      mocks.listCalls += 1;
      return { data: mocks.rows, meta: { total: mocks.rows.length, page: 1, limit: 20 } };
    },
    reviewReturnRequest: (...args: unknown[]) => mocks.review(...args),
    markReturnReceived: (...args: unknown[]) => mocks.received(...args),
  };
});

let mounted: Rendered | null = null;
const mount = async () => {
  window.history.replaceState(null, '', '/admin?tab=returns');
  mounted = render(<AdminPage />, new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }));
  await flush();
  return mounted.container;
};
const btn = (c: HTMLElement, text: string | RegExp) => byText(c, 'button', text) as HTMLButtonElement;
const alerts = (c: HTMLElement) => [...c.querySelectorAll('[role="alert"]')].map((a) => a.textContent);
const hasRow = (c: HTMLElement, code: string) => c.textContent?.includes(`Đơn: ${code}`) ?? false;

beforeEach(() => {
  mocks.rows = [REQ()];
  mocks.listCalls = 0;
  mocks.review.mockReset();
  mocks.received.mockReset();
  window.localStorage.setItem(
    'tubu_admin_nav_open',
    JSON.stringify(['Hay dùng', 'Tổng quan', 'Bán hàng', 'Khách hàng', 'Khuyến mãi và điểm', 'Đổi rác và game', 'Đại lý và đối tác', 'Nội dung', 'Nhân sự', 'Cài đặt']),
  );
});
afterEach(() => {
  window.localStorage.removeItem('tubu_admin_nav_open');
  mounted?.unmount();
  mounted = null;
});

describe('ReturnsTab: lời lỗi của Từ chối giữ ở cấp tab', () => {
  const reject = async (c: HTMLElement) => {
    typeInto(c.querySelector('input[aria-label="Ghi chú duyệt / lý do từ chối"]'), 'Quá hạn đổi trả');
    click(btn(c, /^Từ chối$/));
    await flush();
    expect(confirmDialog()).not.toBeNull();
    answerConfirm(true);
    await flush();
  };

  // API trả 400 "Yêu cầu đã được xử lý." khi admin khác làm trước; 409 là xung đột số tiền/đơn. Cả hai là dữ liệu cũ của hàng này.
  it.each([400, 409])('bị từ chối %i vì yêu cầu đã được xử lý: hàng rời bộ lọc sau lần tải lại nhưng lời lỗi vẫn còn trên trang', async (status) => {
    mocks.review.mockRejectedValue(new HttpError('Yêu cầu đã được xử lý.', status));
    const c = await mount();
    expect(hasRow(c, 'TB-1')).toBe(true);
    mocks.rows = [];
    await reject(c);
    expect(mocks.review).toHaveBeenCalledTimes(1);
    expect(mocks.listCalls).toBe(2);
    expect(hasRow(c, 'TB-1')).toBe(false);
    expect(alerts(c)).toEqual(['Yêu cầu đã được xử lý.']);
  });

  it('lệnh khác bắt đầu thì xoá lời lỗi cũ (không dính lại)', async () => {
    mocks.rows = [REQ(), REQ({ id: 'r2', orderId: 'o2', order: { id: 'o2', code: 'TB-2', total: 100_000, status: 'DELIVERED', paymentMethod: 'COD', pancakeOrderId: null } })];
    mocks.review.mockRejectedValueOnce(new HttpError('Máy chủ đang bận.', 500));
    let release!: () => void;
    mocks.review.mockReturnValueOnce(new Promise<void>((r) => (release = r)));
    const c = await mount();
    await reject(c);
    expect(alerts(c)).toEqual(['Máy chủ đang bận.']);
    const second = [...c.querySelectorAll('input[aria-label="Ghi chú duyệt / lý do từ chối"]')][1]!;
    typeInto(second, 'Hàng đã qua sử dụng');
    click([...c.querySelectorAll('button')].filter((b) => /^Từ chối$/.test(b.textContent ?? ''))[1]!);
    await flush();
    answerConfirm(true);
    await flush();
    expect(mocks.review).toHaveBeenCalledTimes(2);
    expect(alerts(c)).toEqual([]);
    release();
    await flush();
  });
});

describe('ReturnsTab: lời lỗi của "Đã nhận hàng về" giữ ở cấp tab', () => {
  it('lệnh khác bắt đầu thì xoá lời lỗi cũ của "Đã nhận hàng về" (không dính lại)', async () => {
    mocks.rows = [
      REQ({ status: 'APPROVED', refundAmount: 89_000 }),
      REQ({ id: 'r2', orderId: 'o2', status: 'APPROVED', refundAmount: 50_000, order: { id: 'o2', code: 'TB-2', total: 100_000, status: 'DELIVERED', paymentMethod: 'COD', pancakeOrderId: null } }),
    ];
    mocks.received.mockRejectedValueOnce(new HttpError('Máy chủ đang bận.', 500));
    let release!: () => void;
    mocks.received.mockReturnValueOnce(new Promise<void>((r) => (release = r)));
    const c = await mount();
    selectValue(c.querySelector('select[aria-label="Lọc yêu cầu đổi/trả theo trạng thái"]'), 'TO_RECEIVE');
    await flush();
    const receiveButtons = () => [...c.querySelectorAll('button')].filter((b) => /^Đã nhận hàng về$/.test(b.textContent ?? ''));
    click(receiveButtons()[0]!);
    await flush();
    answerConfirm(true);
    await flush();
    expect(alerts(c)).toEqual(['Máy chủ đang bận.']);
    click(receiveButtons()[1]!);
    await flush();
    answerConfirm(true);
    await flush();
    expect(mocks.received).toHaveBeenCalledTimes(2);
    expect(alerts(c)).toEqual([]);
    release();
    await flush();
  });

  it.each([400, 409])('bị từ chối %i: hàng rời bộ lọc "Chờ nhận hàng về" sau lần tải lại nhưng lời lỗi vẫn còn', async (status) => {
    mocks.rows = [REQ({ status: 'APPROVED', refundAmount: 89_000 })];
    mocks.received.mockRejectedValue(new HttpError('Yêu cầu chưa được duyệt hoặc đã ghi nhận nhận hàng trước đó.', status));
    const c = await mount();
    selectValue(c.querySelector('select[aria-label="Lọc yêu cầu đổi/trả theo trạng thái"]'), 'TO_RECEIVE');
    await flush();
    expect(hasRow(c, 'TB-1')).toBe(true);
    click(btn(c, /^Đã nhận hàng về$/));
    await flush();
    mocks.rows = [];
    answerConfirm(true);
    await flush();
    expect(mocks.received).toHaveBeenCalledTimes(1);
    expect(hasRow(c, 'TB-1')).toBe(false);
    expect(alerts(c)).toEqual(['Yêu cầu chưa được duyệt hoặc đã ghi nhận nhận hàng trước đó.']);
  });
});
