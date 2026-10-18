// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { headingProblems, smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// Chép ý notifications-page.spec.tsx (Mini App): một h1 ở mọi trạng thái, không gọi API khi chưa có phiên, thử lại, dấu chưa đọc,
// chạm tin thì đánh dấu đã đọc và mở chi tiết, nút hành động theo template, "Đọc tất cả".

const mocks = vi.hoisted(() => ({
  auth: { user: { id: 'u1' } as Record<string, unknown> | null, status: 'authenticated' as string, initialized: true, sessionUnavailable: false, retrySession: vi.fn() },
  get: vi.fn(),
  post: vi.fn(),
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: mocks.post } }));

import NotificationsPage from './page';

const SENT_AT = new Date(Date.now() - 5 * 60_000).toISOString();
const ORDER_UNREAD = {
  id: 'n1',
  templateCode: 'ORDER_CONFIRMED',
  payload: { body: 'Đơn TT001 đã được xác nhận', data: { order_code: 'TT001' } },
  status: 'SENT',
  sentAt: SENT_AT,
};
const POINTS_READ = { id: 'n2', templateCode: 'POINTS_EARNED', payload: { body: 'Bạn nhận thêm 50 điểm Xanh' }, status: 'READ', sentAt: SENT_AT };
const REMINDER = {
  id: 'n3',
  templateCode: 'REORDER_REMINDER',
  payload: { body: 'Dầu gội sắp hết', data: { product_slug: 'dau-goi', variation_id: 'v1' } },
  status: 'SENT',
  sentAt: SENT_AT,
};
const OPS = { id: 'n4', templateCode: 'OPS_GOMDON_ALERT', payload: { body: 'Gomdon lỗi', data: { order_code: 'KHAC1' } }, status: 'SENT', sentAt: SENT_AT };

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<NotificationsPage />);
  mounted.push(r);
  await flush(6);
  return r;
};
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const rowOf = (c: HTMLElement, text: string) => byText(c, 'button', text) as HTMLElement;
const openRow = async (c: HTMLElement, text: string) => {
  click(rowOf(c, text));
  await flush(4);
  return dialog()!;
};

beforeEach(() => {
  mocks.auth.user = { id: 'u1' };
  mocks.auth.status = 'authenticated';
  mocks.auth.initialized = true;
  mocks.auth.sessionUnavailable = false;
  mocks.get.mockReset().mockResolvedValue([ORDER_UNREAD, POINTS_READ]);
  mocks.post.mockReset().mockResolvedValue({ ok: true, count: 1 });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/tai-khoan/thong-bao: khung trang', () => {
  it('đúng một h1 "Thông báo" ở mọi trạng thái: đang tải, có tin, trống, lỗi', async () => {
    mocks.get.mockReturnValue(new Promise(() => undefined));
    const loading = await mount();
    expect(Array.from(loading.container.querySelectorAll('h1')).map((h) => h.textContent)).toEqual(['Thông báo']);
    expect(loading.container.querySelectorAll('[data-skeleton]').length).toBeGreaterThan(0);

    mocks.get.mockResolvedValue([ORDER_UNREAD]);
    const list = await mount();
    expect(list.container.textContent).toContain('Đơn TT001 đã được xác nhận');
    expect(headingProblems(list.container)).toEqual([]);

    mocks.get.mockResolvedValue([]);
    const empty = await mount();
    expect(empty.container.textContent).toContain('Chưa có thông báo nào');
    expect(empty.container.textContent).toContain('Cập nhật đơn hàng và ưu đãi sẽ hiện ở đây.');
    expect(headingProblems(empty.container)).toEqual([]);

    mocks.get.mockRejectedValue(new Error('boom'));
    const error = await mount();
    expect(byText(error.container, 'button', 'Thử lại')).not.toBeNull();
    expect(headingProblems(error.container)).toEqual([]);
  });

  it('đang khôi phục phiên: chưa gọi API (mở từ liên kết thông báo)', async () => {
    mocks.auth.status = 'idle';
    mocks.auth.initialized = false;
    await mount();
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('khách chưa đăng nhập: lời mời đăng nhập quay lại đúng trang, không gọi API', async () => {
    mocks.auth.status = 'idle';
    mocks.auth.user = null;
    const { container } = await mount();
    expect(container.querySelector('a[href*="/dang-nhap"]')?.getAttribute('href')).toContain(encodeURIComponent('/tai-khoan/thong-bao'));
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('mất kết nối lúc khôi phục phiên: nói đúng chuyện đó, không mời đăng nhập', async () => {
    mocks.auth.status = 'idle';
    mocks.auth.sessionUnavailable = true;
    const { container } = await mount();
    expect(container.textContent).toContain('Không kết nối được với Tubu Tree');
    expect(container.querySelector('a[href*="/dang-nhap"]')).toBeNull();
  });

  it('lỗi tải: "Thử lại" gọi lại API', async () => {
    mocks.get.mockRejectedValueOnce(new Error('boom')).mockResolvedValue([POINTS_READ]);
    const { container } = await mount();
    click(byText(container, 'button', 'Thử lại'));
    await flush(6);
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('Bạn nhận thêm 50 điểm Xanh');
  });

  it('mỗi tin là một nút; chỉ tin chưa đọc có dấu "chưa đọc"; không lỗi a11y', async () => {
    const { container } = await mount();
    expect(rowOf(container, 'Đơn TT001 đã được xác nhận').querySelector('[aria-label="chưa đọc"]')).not.toBeNull();
    expect(rowOf(container, 'Bạn nhận thêm 50 điểm Xanh').querySelector('[aria-label="chưa đọc"]')).toBeNull();
    expect(unnamedControls(container)).toEqual([]);
    expect(smallTouchTargets(container)).toEqual([]);
  });

  it('danh sách và tin hiển thị tiêu đề nhóm và thời gian tương đối', async () => {
    const { container } = await mount();
    expect(rowOf(container, 'Đơn TT001 đã được xác nhận').textContent).toContain('Đơn đã xác nhận');
    expect(rowOf(container, 'Đơn TT001 đã được xác nhận').textContent).toContain('5 phút trước');
  });
});

describe('/tai-khoan/thong-bao: chi tiết', () => {
  it('chạm tin chưa đọc: đánh dấu đã đọc (POST đúng đường dẫn) và mở chi tiết', async () => {
    const { container } = await mount();
    const d = await openRow(container, 'Đơn TT001 đã được xác nhận');
    expect(mocks.post).toHaveBeenCalledWith('/me/notifications/n1/read');
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(d.querySelector('h2')?.textContent).toBe('Chi tiết thông báo');
    expect(d.textContent).toContain('Đơn đã xác nhận');
    expect(d.textContent).toContain('Đơn TT001 đã được xác nhận');
  });

  it('đánh dấu đã đọc xong thì nạp lại danh sách', async () => {
    const { container } = await mount();
    await openRow(container, 'Đơn TT001 đã được xác nhận');
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });

  it('chạm tin đã đọc: không gọi đánh dấu đã đọc', async () => {
    const { container } = await mount();
    await openRow(container, 'Bạn nhận thêm 50 điểm Xanh');
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('nút Đóng trong chi tiết đóng hộp thoại', async () => {
    const { container } = await mount();
    const d = await openRow(container, 'Đơn TT001 đã được xác nhận');
    click(d.querySelector('button[aria-label="Đóng"]'));
    await flush(2);
    expect(dialog()).toBeNull();
  });

  it('tin đơn hàng: nút "Xem chi tiết đơn hàng" là link tới route web của đơn, bấm thì đóng chi tiết', async () => {
    const { container } = await mount();
    const d = await openRow(container, 'Đơn TT001 đã được xác nhận');
    const link = byText(d, 'a', 'Xem chi tiết đơn hàng')!;
    expect(link.getAttribute('href')).toBe('/tai-khoan/don-hang/TT001');
    click(link);
    await flush(2);
    expect(dialog()).toBeNull();
  });

  it('tin không có nút (chỉ điểm): chi tiết không có link hành động', async () => {
    mocks.get.mockResolvedValue([OPS]);
    const { container } = await mount();
    const d = await openRow(container, 'Gomdon lỗi');
    expect(d.querySelector('a')).toBeNull();
  });

  it('nhắc mua lại: nút "Mua lại ngay" dẫn tới trang sản phẩm (đích dự phòng khi chưa có sheet mua lại)', async () => {
    mocks.get.mockResolvedValue([REMINDER]);
    const { container } = await mount();
    const d = await openRow(container, 'Dầu gội sắp hết');
    expect(byText(d, 'a', 'Mua lại ngay')?.getAttribute('href')).toBe('/san-pham/dau-goi');
  });
});

describe('/tai-khoan/thong-bao: Đọc tất cả', () => {
  it('có tin chưa đọc: bấm gọi API một lần rồi nạp lại danh sách', async () => {
    const { container } = await mount();
    click(byText(container, 'button', 'Đọc tất cả'));
    await flush(6);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledWith('/me/notifications/read-all');
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });

  it('không còn tin chưa đọc hoặc danh sách trống: ẩn nút', async () => {
    mocks.get.mockResolvedValue([POINTS_READ]);
    const read = await mount();
    expect(byText(read.container, 'button', 'Đọc tất cả')).toBeNull();
    mocks.get.mockResolvedValue([]);
    const empty = await mount();
    expect(byText(empty.container, 'button', 'Đọc tất cả')).toBeNull();
  });
});
