// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { headingProblems, smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// Chép ý notifications-page.spec.tsx (Mini App): một h1 ở mọi trạng thái, không gọi API khi chưa có phiên, thử lại, dấu chưa đọc,
// chạm tin thì đánh dấu đã đọc và mở chi tiết, nút hành động theo template, "Đọc tất cả".

const mocks = vi.hoisted(() => ({
  auth: { user: { id: 'u1' } as Record<string, unknown> | null, status: 'authenticated' as string, initialized: true, sessionUnavailable: false, retrySession: vi.fn() },
  get: vi.fn(),
  post: vi.fn(),
  push: vi.fn(),
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));
vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/cart-key', () => ({ cartStorefrontSlug: () => null }));
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
// Trang còn gọi `/me/notifications/unread-count`; các ca đếm lần nạp danh sách chỉ tính đường dẫn danh sách.
const listCalls = () => mocks.get.mock.calls.filter(([p]) => p === '/me/notifications');
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
  mocks.push.mockReset();
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
    expect(listCalls()).toHaveLength(2);
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

  it('chạm tin "Tubu Tree trả lời bạn": đánh dấu đã đọc và vào thẳng trang chat web, không mở chi tiết', async () => {
    mocks.get.mockResolvedValue([
      { id: 'n5', templateCode: 'SUPPORT_CHAT_REPLY', payload: { body: 'Tubu Tree đã trả lời bạn: Dạ shop kiểm tra ạ', data: { route: '/chat' } }, status: 'SENT', sentAt: SENT_AT },
    ]);
    const { container } = await mount();
    click(rowOf(container, 'Dạ shop kiểm tra ạ'));
    await flush(4);
    expect(mocks.post).toHaveBeenCalledWith('/me/notifications/n5/read');
    expect(mocks.push).toHaveBeenCalledWith('/ho-tro/chat');
    expect(dialog()).toBeNull();
  });

  it('đánh dấu đã đọc xong thì nạp lại danh sách', async () => {
    const { container } = await mount();
    await openRow(container, 'Đơn TT001 đã được xác nhận');
    expect(listCalls()).toHaveLength(2);
    expect(mocks.get.mock.calls.filter(([p]) => p === '/me/notifications/unread-count')).toHaveLength(2);
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
});

describe('/tai-khoan/thong-bao: nhắc mua lại (REORDER_REMINDER)', () => {
  const PURCHASED = {
    variationId: 'v1', productId: 'p1', slug: 'dau-goi', productName: 'Dầu gội', variationName: '500ml', brand: 'Tubu', thumbnail: null,
    price: 90000, salePrice: null, stock: 5, inStock: true, timesBought: 3, lastPurchasedAt: '2026-09-01T00:00:00Z',
  };
  const CART = { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 199000, itemCount: 1 };
  const route = (items: unknown[] | Error) =>
    mocks.get.mockImplementation(async (path: string) => {
      if (path === '/me/purchased-items') {
        if (items instanceof Error) throw items;
        return { items, nextCursor: null };
      }
      return [REMINDER];
    });
  const open = async () => {
    const { container } = await mount();
    const d = await openRow(container, 'Dầu gội sắp hết');
    return { container, d, cta: byText(d, 'button', 'Mua lại ngay') as HTMLElement };
  };
  const lookups = () => mocks.get.mock.calls.filter(([p]) => p === '/me/purchased-items');

  it('nút "Mua lại ngay" là nút (không phải liên kết cứng) vì phải tra sản phẩm trước', async () => {
    route([PURCHASED]);
    const { d, cta } = await open();
    expect(cta).not.toBeNull();
    expect(byText(d, 'a', 'Mua lại ngay')).toBeNull();
  });

  it('còn mua được: tra đúng variation, đóng chi tiết, mở sheet 1 sản phẩm; thêm vào giỏ gửi addSource reorder_notification', async () => {
    route([PURCHASED]);
    mocks.post.mockResolvedValue(CART);
    const { cta } = await open();
    click(cta);
    await flush(6);
    expect(lookups()).toHaveLength(1);
    expect(lookups()[0]![1]).toEqual({ query: { variationId: 'v1', limit: 1 } });
    expect(dialog()?.textContent).toContain('Dầu gội');
    expect(dialog()?.textContent).not.toContain('Chi tiết thông báo');
    click(byText(dialog()!, 'button', 'Thêm vào giỏ (1)'));
    await flush(6);
    expect(mocks.post).toHaveBeenCalledWith('/cart/items', { variationId: 'v1', quantity: 1, addSource: 'reorder_notification' }, undefined);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('API trả sản phẩm khác (bỏ qua bộ lọc) → không mở sheet sai SP, điều hướng dự phòng', async () => {
    route([{ ...PURCHASED, variationId: 'v-other' }]);
    const { cta } = await open();
    click(cta);
    await flush(6);
    expect(mocks.push).toHaveBeenCalledWith('/san-pham/dau-goi');
    expect(document.body.textContent).not.toContain('Thêm vào giỏ');
  });

  it('hết hàng, lỗi tra cứu hoặc thiếu variation_id → điều hướng dự phòng', async () => {
    route([{ ...PURCHASED, stock: 0, inStock: false }]);
    click((await open()).cta);
    await flush(6);
    expect(mocks.push).toHaveBeenLastCalledWith('/san-pham/dau-goi');

    mocks.push.mockReset();
    route(new Error('404'));
    click((await open()).cta);
    await flush(6);
    expect(mocks.push).toHaveBeenLastCalledWith('/san-pham/dau-goi');

    mocks.push.mockReset();
    mocks.get.mockReset().mockResolvedValue([{ ...REMINDER, id: 'n5', payload: { body: 'Dầu gội sắp hết', data: { product_slug: 'dau-goi' } } }]);
    click((await open()).cta);
    await flush(6);
    expect(lookups()).toHaveLength(0);
    expect(mocks.push).toHaveBeenLastCalledWith('/san-pham/dau-goi');
  });

  it('chạm đúp "Mua lại ngay" ngay trong một nhịp render → chỉ một lần tra cứu', async () => {
    route([PURCHASED]);
    const { cta } = await open();
    act(() => {
      cta.click();
      cta.click();
    });
    await flush(6);
    expect(lookups()).toHaveLength(1);
  });

  it('đang tra cứu: nút hiện vòng xoay; đóng chi tiết trước khi tra xong → không mở sheet, không điều hướng', async () => {
    let resolve!: (v: unknown) => void;
    const pending = new Promise((r) => {
      resolve = r;
    });
    mocks.get.mockImplementation(async (path: string) => (path === '/me/purchased-items' ? pending : [REMINDER]));
    const { cta } = await open();
    click(cta);
    await flush(2);
    expect(cta.querySelector('svg.animate-spin')).not.toBeNull();
    expect(cta.hasAttribute('disabled')).toBe(true);
    const close = dialog()!.querySelector<HTMLElement>('button[aria-label*="Đóng"], button[aria-label*="đóng"]');
    expect(close).not.toBeNull();
    click(close!);
    await flush(4);
    await act(async () => {
      resolve({ items: [PURCHASED], nextCursor: null });
    });
    await flush(6);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('Thêm vào giỏ');
  });

  it('thêm đủ từ thông báo: sheet đóng và trang báo "Đã thêm 1 món vào giỏ" kèm lối vào giỏ', async () => {
    route([PURCHASED]);
    mocks.post.mockResolvedValue(CART);
    const { container, cta } = await open();
    const live = container.querySelector('[role="status"]');
    expect(live).not.toBeNull();
    expect(live?.textContent).toBe('');
    click(cta);
    await flush(6);
    click(byText(dialog()!, 'button', 'Thêm vào giỏ (1)'));
    await flush(6);
    expect(dialog()).toBeNull();
    const status = container.querySelector('[role="status"]');
    expect(status).toBe(live);
    expect(status?.className).toContain('fixed');
    expect(status?.textContent).toContain('Đã thêm 1 món vào giỏ');
    expect(status?.querySelector('a')?.getAttribute('href')).toBe('/gio-hang');
  });
});

describe('/tai-khoan/thong-bao: Đọc tất cả', () => {
  it('có tin chưa đọc: bấm gọi API một lần rồi nạp lại danh sách', async () => {
    const { container } = await mount();
    click(byText(container, 'button', 'Đọc tất cả'));
    await flush(6);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledWith('/me/notifications/read-all');
    expect(listCalls()).toHaveLength(2);
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

describe('/tai-khoan/thong-bao: E-84 tải thêm tin', () => {
  const rows = (from: number, n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `p${from + i}`, templateCode: 'POINTS_EARNED', payload: { body: `Tin số ${from + i}` }, status: 'READ',
      sentAt: new Date(Date.UTC(2026, 9, 28, 3, 0, 0) - (from + i) * 1000).toISOString(),
    }));

  it('trang đầu xin 20 tin; đủ 20 thì có "Xem thêm", bấm nạp trang 2 theo con trỏ của tin cuối, hết thì ẩn nút', async () => {
    const first = rows(0, 20);
    mocks.get.mockImplementation(async (path: string) => {
      if (path === '/me/notifications/unread-count') return { count: 0 };
      return listCalls().length === 1 ? first : rows(20, 5);
    });
    const { container } = await mount();
    expect(listCalls()[0]).toEqual(['/me/notifications', { query: { limit: 20 } }]);
    expect(container.textContent).toContain('Tin số 0');
    click(byText(container, 'button', 'Xem thêm'));
    await flush(6);
    expect(listCalls()[1]).toEqual(['/me/notifications', { query: { before: first[19]!.sentAt, beforeId: 'p19', limit: 20 } }]);
    expect(container.textContent).toContain('Tin số 24');
    expect(container.textContent).toContain('Tin số 0');
    expect(byText(container, 'button', 'Xem thêm')).toBeNull();
  });

  it('trang đầu ít hơn 20 tin: không có "Xem thêm"', async () => {
    mocks.get.mockResolvedValue(rows(0, 3));
    const { container } = await mount();
    expect(byText(container, 'button', 'Xem thêm')).toBeNull();
  });
});

describe('/tai-khoan/thong-bao: nút theo loại tin (E-4, E-5, E-32, E-81, E-90)', () => {
  const tin = (templateCode: string, body: string, data?: Record<string, string>) => ({ id: `t-${templateCode}`, templateCode, payload: { body, data }, status: 'READ', sentAt: SENT_AT });
  const linkOf = async (item: ReturnType<typeof tin>, label: string) => {
    mocks.get.mockResolvedValue([item]);
    const { container } = await mount();
    const d = await openRow(container, item.payload.body);
    return { d, link: byText(d, 'a', label) };
  };

  it('tin cho chủ gian hàng: "Mở đơn cần xử lý" tới /merchant?tab=fulfil, không có nút xem đơn', async () => {
    const { d, link } = await linkOf(tin('MERCHANT_ORDER_NEW', 'Gian hàng của bạn có đơn mới TB1', { order_code: 'TB1' }), 'Mở đơn cần xử lý');
    expect(link?.getAttribute('href')).toBe('/merchant?tab=fulfil');
    expect(byText(d, 'a', 'Xem chi tiết đơn hàng')).toBeNull();
    expect(d.textContent).toContain('Gian hàng đối tác');
  });

  it('tin hoa hồng: tiêu đề "Hoa hồng CTV", "Xem hoa hồng" giữ ?tab=commission sang /ctv', async () => {
    const { link } = await linkOf(tin('COMMISSION_NEW', 'Có đơn mới từ link của bạn'), 'Xem hoa hồng');
    expect(link?.getAttribute('href')).toBe('/ctv?tab=commission');
  });

  it('tin hạng: "Xem cách giữ hạng" tới trang Điểm Xanh', async () => {
    const { d, link } = await linkOf(tin('TIER_DROP_NOTICE', 'Hạng Vàng của bạn được giữ đến 30/11'), 'Xem cách giữ hạng');
    expect(link?.getAttribute('href')).toBe('/tai-khoan/diem-xanh');
    expect(d.textContent).toContain('Hạng thành viên');
  });

  it('tin mời đánh giá có order_id: "Viết đánh giá" mở thẳng form (tham số danh-gia), tiêu đề "Mời đánh giá"', async () => {
    const { d, link } = await linkOf(tin('REVIEW_REQUEST', 'Đơn TT001 đã đến tay bạn.', { order_code: 'TT001', order_id: 'o1', product_slug: 'sua-tam' }), 'Viết đánh giá');
    expect(link?.getAttribute('href')).toBe('/san-pham/sua-tam?danh-gia=o1#danh-gia');
    expect(d.textContent).toContain('Mời đánh giá');
    expect(byText(d, 'a', 'Xem chi tiết đơn hàng')).toBeNull();
  });

  it('tin mời đánh giá cũ (thiếu order_id): "Viết đánh giá" về chi tiết đơn', async () => {
    const { link } = await linkOf(tin('REVIEW_REQUEST', 'Đơn TT001 đã đến tay bạn.', { order_code: 'TT001', product_slug: 'sua-tam' }), 'Viết đánh giá');
    expect(link?.getAttribute('href')).toBe('/tai-khoan/don-hang/TT001');
  });

  it('mua chung thành công có product_slug: "Dùng mã, mua ngay" mở sản phẩm', async () => {
    const { link } = await linkOf(tin('GROUP_BUY_SUCCESS', 'Nhóm mua chung đã đủ người!', { product_slug: 'nuoc-rua-chen' }), 'Dùng mã, mua ngay');
    expect(link?.getAttribute('href')).toBe('/san-pham/nuoc-rua-chen');
  });

  it('cảnh báo cầu nối Zalo: "Mở Chat CSKH" tới tab Chat CSKH của trang quản trị', async () => {
    const { link } = await linkOf(tin('OPS_ZALO_BRIDGE_DOWN', 'Cầu nối Zalo mất kết nối'), 'Mở Chat CSKH');
    expect(link?.getAttribute('href')).toBe('/admin?tab=supportChat');
  });
});

describe('/tai-khoan/thong-bao: đếm chưa đọc của cả hộp thư và lỗi "Xem thêm"', () => {
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `p${i}`, templateCode: 'POINTS_EARNED', payload: { body: `Tin số ${i}` }, status: 'READ',
      sentAt: new Date(Date.UTC(2026, 9, 28, 3, 0, 0) - i * 1000).toISOString(),
    }));
  const route = (count: number | null, extra?: (path: string) => unknown) =>
    mocks.get.mockImplementation(async (path: string) => {
      if (path === '/me/notifications/unread-count') {
        if (count === null) throw new Error('chưa có');
        return { count };
      }
      return extra?.(path) ?? rows(20);
    });

  it('20 tin trang đầu đều đã đọc nhưng máy chủ báo còn 3 tin chưa đọc: vẫn có "Đọc tất cả", bấm thì gọi đọc hết', async () => {
    route(3);
    const { container } = await mount();
    click(byText(container, 'button', 'Đọc tất cả'));
    await flush(6);
    expect(mocks.post).toHaveBeenCalledWith('/me/notifications/read-all');
  });

  it('máy chủ báo 0 chưa đọc: ẩn nút', async () => {
    route(0);
    const { container } = await mount();
    expect(container.textContent).toContain('Tin số 0');
    expect(byText(container, 'button', 'Đọc tất cả')).toBeNull();
  });

  it('"Xem thêm" lỗi: báo bằng role=alert, giữ danh sách và nút để thử lại', async () => {
    let listCalls = 0;
    mocks.get.mockImplementation(async (path: string) => {
      if (path === '/me/notifications/unread-count') return { count: 0 };
      listCalls += 1;
      if (listCalls === 1) return rows(20);
      throw new Error('mạng');
    });
    const { container } = await mount();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    click(byText(container, 'button', 'Xem thêm'));
    await flush(6);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Không tải thêm được thông báo. Vui lòng thử lại.');
    expect(container.textContent).toContain('Tin số 0');
    expect(byText(container, 'button', 'Xem thêm')).not.toBeNull();
  });
});
