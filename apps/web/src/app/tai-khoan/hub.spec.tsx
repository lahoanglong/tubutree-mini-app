// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { headingProblems, smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// Chép ý profile-hub.spec.tsx, profile-brand-owner.spec.tsx và profile.spec.ts (Mini App): thẻ đầu, ba số dư, menu theo nhóm,
// mục theo vai trò/cờ, đại lý và chủ nhãn đổi theo dữ liệu, mã giới thiệu có nút chép. Mục trỏ route pending bị ẩn.

const mocks = vi.hoisted(() => ({
  auth: {
    user: { id: 'u1', fullName: 'Nguyễn An', avatarUrl: null as string | null, role: 'CUSTOMER', referralCode: 'AN1', pointsBalance: 0, pointsConvertedBalance: 0, walletBalance: 0 } as Record<string, unknown>,
    status: 'authenticated',
    initialized: true,
    sessionUnavailable: false,
    logout: vi.fn(),
    retrySession: vi.fn(),
  },
  routes: {} as Record<string, () => unknown>,
  calls: [] as string[],
  notReady: new Set<string>(),
  meName: 'Nguyễn An' as string | null,
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/lib/route-map', () => ({ isWebRouteReady: (p: string) => !mocks.notReady.has(p) }));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string) => {
      mocks.calls.push(path);
      const h = mocks.routes[path];
      if (!h) throw new Error(`no route ${path}`);
      return h();
    },
  },
}));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getMe: async () => ({ fullName: mocks.meName, phone: '0912345678', pointsBalance: 1800, pointsConvertedBalance: 0, walletBalance: 50000 }),
  fetchOrdersPage: async () => ({ data: [], meta: { page: 1, limit: 20, total: 0 } }),
}));

import AccountPage from './page';
import { ApiError } from '@/lib/client-api';

const defaults = (): Record<string, () => unknown> => ({
  '/me/loyalty': () => ({ tier: { name: 'Hạt Giống' }, pointsBalance: 1800, pointsConvertedBalance: 0 }),
  '/me/coupons': () => [{ id: 'c1' }, { id: 'c2' }],
  '/me/notifications': () => [{ id: 'n1', status: 'SENT' }, { id: 'n2', status: 'READ' }, { id: 'n3', status: 'FAILED' }],
  '/config/public': () => ({ aiAdvisorEnabled: false, loyalty: { marketplaceClaimEnabled: false } }),
  '/brand/owner/me': () => {
    throw new ApiError('Không tìm thấy', 404);
  },
  '/dealer/me': () => ({ status: 'NONE', isDealer: false }),
});

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<AccountPage />);
  mounted.push(r);
  await flush(8);
  return r.container;
};
const link = (c: HTMLElement, href: string) => c.querySelector<HTMLAnchorElement>(`a[href="${href}"]`);
const headings2 = (c: HTMLElement) => Array.from(c.querySelectorAll('h2')).map((h) => h.textContent);

beforeEach(() => {
  mocks.auth.user = { id: 'u1', fullName: 'Nguyễn An', avatarUrl: null, role: 'CUSTOMER', referralCode: 'AN1', pointsBalance: 0, pointsConvertedBalance: 0, walletBalance: 0 };
  mocks.auth.logout.mockReset();
  mocks.routes = defaults();
  mocks.calls = [];
  mocks.notReady = new Set();
  mocks.meName = 'Nguyễn An';
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

describe('hub /tai-khoan — thẻ đầu và mã giới thiệu', () => {
  it('thẻ đầu dẫn tới /tai-khoan/ho-so: tên, hạng thành viên và "Sửa hồ sơ"', async () => {
    const c = await mount();
    const head = link(c, '/tai-khoan/ho-so')!;
    expect(head).not.toBeNull();
    expect(head.textContent).toContain('Nguyễn An');
    expect(head.textContent).toContain('Hạt Giống');
    expect(head.textContent).toContain('Sửa hồ sơ');
  });

  it('chưa tải được hạng: hiện "Mầm Xanh" như Mini App; khách chưa có tên: "Khách Tubu"', async () => {
    mocks.routes['/me/loyalty'] = () => {
      throw new Error('offline');
    };
    mocks.auth.user = { ...mocks.auth.user, fullName: null };
    mocks.meName = null;
    const c = await mount();
    expect(link(c, '/tai-khoan/ho-so')!.textContent).toContain('Mầm Xanh');
    expect(c.querySelector('section[aria-label="Thông tin tài khoản"]')!.textContent).toContain('Khách Tubu');
  });

  it('hiện ảnh đại diện khi có', async () => {
    mocks.auth.user = { ...mocks.auth.user, avatarUrl: 'https://img.test/a.jpg' };
    const c = await mount();
    expect(link(c, '/tai-khoan/ho-so')!.querySelector('img')?.getAttribute('src')).toBe('https://img.test/a.jpg');
  });

  it('nút "Mã giới thiệu" chép mã và báo đã chép', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const c = await mount();
    const btn = byText(c, 'button', 'Mã giới thiệu: AN1')!;
    expect(btn.textContent).toContain('Sao chép');
    click(btn);
    await flush(3);
    expect(writeText).toHaveBeenCalledWith('AN1');
    expect(c.querySelector('[role="status"]')?.textContent).toContain('Đã sao chép mã giới thiệu');
  });

  it('không chép được thì nói mã để khách tự chép', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    const c = await mount();
    click(byText(c, 'button', 'Mã giới thiệu: AN1'));
    await flush(3);
    expect(c.querySelector('[role="status"]')?.textContent).toContain('Không sao chép được — mã của bạn: AN1');
  });

  it('chưa có mã giới thiệu: không có nút', async () => {
    mocks.auth.user = { ...mocks.auth.user, referralCode: '' };
    const c = await mount();
    expect(byText(c, 'button', 'Mã giới thiệu')).toBeNull();
  });
});

describe('hub /tai-khoan — ba số dư', () => {
  it('Điểm Xanh, Ví Tubu, Mã giảm giá; Mã giảm giá đếm số mã và dẫn tới trang Điểm Xanh như Mini App', async () => {
    const c = await mount();
    const tiles = Array.from(c.querySelectorAll('a')).filter((a) => /Điểm Xanh|Ví Tubu|Mã giảm giá/.test(a.textContent ?? '') && a.closest('section[aria-label="Thông tin tài khoản"]'));
    expect(tiles.map((a) => a.getAttribute('href'))).toEqual(['/tai-khoan/diem-xanh', '/tai-khoan/vi-tubu', '/tai-khoan/diem-xanh']);
    expect(tiles[2]!.textContent).toContain('2 mã');
    expect(tiles[2]!.textContent).toContain('Mã giảm giá');
  });

  it('chưa tải được mã giảm giá: dấu "—", không đoán số', async () => {
    mocks.routes['/me/coupons'] = () => {
      throw new Error('offline');
    };
    const c = await mount();
    const tile = Array.from(c.querySelectorAll('a')).find((a) => a.textContent?.includes('Mã giảm giá'))!;
    expect(tile.textContent).toContain('—');
  });
});

describe('hub /tai-khoan — menu theo nhóm', () => {
  it('các nhóm là h2, vẫn đúng một h1, OrdersSection còn nguyên', async () => {
    const c = await mount();
    expect(headings2(c)).toEqual(expect.arrayContaining(['Mua sắm', 'Tài sản', 'Hợp tác', 'Khác']));
    expect(headingProblems(c)).toEqual([]);
    expect(c.textContent).toContain('Đơn hàng của tôi');
  });

  it('Sổ địa chỉ, Ví Tubu, Điểm Xanh là liên kết; mục trỏ route pending thì ẩn', async () => {
    mocks.notReady = new Set(['/mua-chung', '/tai-khoan/thong-bao']);
    const c = await mount();
    expect(link(c, '/tai-khoan/dia-chi')).not.toBeNull();
    expect(link(c, '/mua-chung')).toBeNull();
    expect(link(c, '/tai-khoan/thong-bao')).toBeNull();
  });

  it('mục Thông báo hiện số chưa đọc (không tính đã đọc)', async () => {
    const c = await mount();
    const row = link(c, '/tai-khoan/thong-bao')!;
    expect(row.textContent).toContain('Thông báo');
    expect(row.textContent).toContain('2');
    expect(row.getAttribute('aria-label')).toContain('2 chưa đọc');
  });

  it('mọi mục menu cao >= 44px và có tên truy cập', async () => {
    const c = await mount();
    expect(smallTouchTargets(c)).toEqual([]);
    expect(unnamedControls(c)).toEqual([]);
  });

  it('không có mục "sàn ngoài" khi cờ cashback tắt', async () => {
    const c = await mount();
    expect(c.textContent).not.toContain('sàn ngoài');
  });
});

describe('hub /tai-khoan — mục theo vai trò và cờ', () => {
  it('khách thường không có nhóm Công việc', async () => {
    expect(headings2(await mount())).not.toContain('Công việc');
  });

  it('STAFF thấy Nhân viên và Bảng lương, không thấy Quản trị', async () => {
    mocks.auth.user = { ...mocks.auth.user, role: 'STAFF' };
    const c = await mount();
    expect(link(c, '/nhan-vien')).not.toBeNull();
    expect(link(c, '/nhan-vien/bang-luong')).not.toBeNull();
    expect(link(c, '/admin')).toBeNull();
  });

  it('ADMIN thấy thêm Quản trị', async () => {
    mocks.auth.user = { ...mocks.auth.user, role: 'ADMIN' };
    const c = await mount();
    expect(link(c, '/admin')).not.toBeNull();
    expect(link(c, '/nhan-vien')).not.toBeNull();
  });

  it('Trợ lý AI chỉ hiện khi máy chủ báo aiAdvisorEnabled', async () => {
    expect(link(await mount(), '/tu-van')).toBeNull();
    mocks.routes['/config/public'] = () => ({ aiAdvisorEnabled: true });
    expect(link(await mount(), '/tu-van')).not.toBeNull();
  });

  it('Tích điểm đơn sàn (marketplaceClaimEnabled): là nút mở thông báo "cần mở trên Zalo", không phải liên kết', async () => {
    mocks.routes['/config/public'] = () => ({ loyalty: { marketplaceClaimEnabled: true } });
    const c = await mount();
    const btn = byText(c, 'button', 'Tích điểm đơn sàn')!;
    expect(btn).not.toBeNull();
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(c.textContent).not.toContain('Tính năng này cần mở Tubu Tree trên Zalo');
    click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(c.textContent).toContain('Tính năng này cần mở Tubu Tree trên Zalo');
    click(btn);
    expect(c.textContent).not.toContain('Tính năng này cần mở Tubu Tree trên Zalo');
  });

  it('cờ tích điểm tắt hoặc API cũ chưa trả: không có mục', async () => {
    mocks.routes['/config/public'] = () => ({ loyalty: {} });
    expect(byText(await mount(), 'button', 'Tích điểm đơn sàn')).toBeNull();
  });
});

describe('hub /tai-khoan — đại lý và chủ nhãn', () => {
  it('đại lý đã duyệt: "Kênh đại lý" kèm hạng; đang chờ: "Hồ sơ đại lý"; chưa có: "Đăng ký đại lý"', async () => {
    expect(link(await mount(), '/dai-ly')!.textContent).toContain('Đăng ký đại lý');
    mocks.routes['/dealer/me'] = () => ({ status: 'APPROVED', isDealer: true, tier: { name: 'Bạc' } });
    const approved = link(await mount(), '/dai-ly')!;
    expect(approved.textContent).toContain('Kênh đại lý');
    expect(approved.textContent).toContain('Bạc');
    mocks.routes['/dealer/me'] = () => ({ status: 'PENDING', isDealer: false });
    const pending = link(await mount(), '/dai-ly')!;
    expect(pending.textContent).toContain('Hồ sơ đại lý');
    expect(pending.textContent).toContain('Đang chờ duyệt');
  });

  it('API trả 404 (không sở hữu nhãn) là bình thường: không có mục, không báo lỗi', async () => {
    const c = await mount();
    expect(link(c, '/chu-thuong-hieu')).toBeNull();
    expect(c.querySelector('[role="alert"]')).toBeNull();
  });

  it('chủ nhãn thật thấy "Quản lý nhãn hàng" kèm tên nhãn', async () => {
    mocks.routes['/brand/owner/me'] = () => ({ id: 'b1', name: 'Nhãn A' });
    const row = link(await mount(), '/chu-thuong-hieu')!;
    expect(row.textContent).toContain('Quản lý nhãn hàng');
    expect(row.textContent).toContain('Nhãn A');
  });

  it('lỗi khác 404 (500) không bị nuốt thành "chủ nhãn" mà cũng không làm vỡ hub', async () => {
    mocks.routes['/brand/owner/me'] = () => {
      throw new ApiError('lỗi', 500);
    };
    const c = await mount();
    expect(link(c, '/chu-thuong-hieu')).toBeNull();
    expect(link(c, '/tai-khoan/dia-chi')).not.toBeNull();
  });
});

describe('hub /tai-khoan — đăng xuất và trạng thái phiên', () => {
  it('nút Đăng xuất gọi logout', async () => {
    const c = await mount();
    click(byText(c, 'button', 'Đăng xuất'));
    expect(mocks.auth.logout).toHaveBeenCalledTimes(1);
  });

  it('khách chưa đăng nhập không gọi API riêng tư', async () => {
    mocks.auth.status = 'idle';
    const c = await mount();
    mocks.auth.status = 'authenticated';
    expect(c.textContent).toContain('Đăng nhập để xem tài khoản');
    expect(mocks.calls).toEqual([]);
  });
});
