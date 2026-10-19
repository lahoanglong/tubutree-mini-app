// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { headingProblems, smallTouchTargets, unlabeledFields, unnamedControls } from '@/test-utils/a11y';

// Mini App brand-owner.spec.tsx: hai tab (Hồ sơ & khuyến mãi, Doanh thu), lưu thông tin nhãn, thêm/sửa/xoá khuyến mãi gắn mã,
// ngày kết thúc trước ngày bắt đầu, xác nhận xoá, kỳ báo cáo, đúng một h1. Không kiểm vai trò ở client: máy chủ trả 404/403.

type Call = { method: string; path: string; body?: unknown; query?: Record<string, unknown> };

const m = vi.hoisted(() => ({
  phase: 'authenticated' as string,
  search: new URLSearchParams(),
  replace: vi.fn(),
  calls: [] as Call[],
  data: {} as Record<string, unknown>,
  fail: new Map<string, unknown>(),
  failOnce: new Set<string>(),
  write: new Map<string, unknown>(),
}));

vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => m.phase }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn(), user: { role: 'CUSTOMER' } }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: m.replace, push: vi.fn() }),
  usePathname: () => '/chu-thuong-hieu',
  useSearchParams: () => m.search,
}));
vi.mock('@/components/brand-owner/brand-image-field', () => ({
  BrandImageField: ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
    <button type="button" className="min-h-11" onClick={() => onChange('https://res.cloudinary.com/x/new.jpg')}>
      {value ? `Đã chọn ${label}` : label}
    </button>
  ),
}));
vi.mock('@/lib/core-http', () => {
  const run = async (method: string, path: string, body?: unknown, query?: Record<string, unknown>) => {
    m.calls.push({ method, path, body, query });
    const key = `${method} ${path}`;
    if (m.fail.has(key)) throw m.fail.get(key);
    if (m.failOnce.has(key)) {
      m.failOnce.delete(key);
      throw new Error('Mất kết nối');
    }
    if (method === 'GET') {
      if (!(path in m.data)) throw new Error(`chưa mock ${path}`);
      return m.data[path];
    }
    return m.write.get(key) ?? {};
  };
  return {
    coreHttp: {
      get: (path: string, opts?: { query?: Record<string, unknown> }) => run('GET', path, undefined, opts?.query),
      post: (path: string, body?: unknown) => run('POST', path, body),
      patch: (path: string, body?: unknown) => run('PATCH', path, body),
      delete: (path: string) => run('DELETE', path),
    },
  };
});

import BrandOwnerPage from './page';

const PROMO = { id: 'p1', title: 'MUA 2 TẶNG 1', subtitle: null, couponCode: 'TUBU20', startAt: '2026-10-01T00:00:00.000Z', endAt: '2026-10-30T00:00:00.000Z', isActive: true };
const BRAND = {
  id: 'b1', slug: 'sachi', name: 'Sachi', logoUrl: null, coverUrl: null, tagline: null, story: null, origin: null,
  isVerified: true, isPublished: true, followerCount: 12, promotions: [PROMO],
};
const SALES = {
  period: '30d', from: '2026-09-10T00:00:00.000Z', to: '2026-10-10T00:00:00.000Z',
  orderCount: 12, unitsSold: 31, revenue: 4_560_000,
  delivered: { orderCount: 9, revenue: 3_200_000 },
  topProducts: [
    { productId: 'p1', name: 'Nước rửa chén Sachi', slug: 'nrc', quantity: 20, revenue: 3_000_000 },
    { productId: 'p2', name: 'Xà bông Sachi', slug: 'xb', quantity: 11, revenue: 1_560_000 },
  ],
};

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<BrandOwnerPage />);
  mounted.push(r);
  await flush(8);
  return r;
};
const h1s = () => Array.from(document.querySelectorAll('h1')).map((h) => h.textContent);
const text = () => document.body.textContent ?? '';
const btn = (name: string | RegExp) => byText(document.body, 'button', name);
const named = (name: string) => document.querySelector<HTMLElement>(`button[aria-label="${name}"]`);
const press = async (name: string | RegExp) => {
  click(typeof name === 'string' ? (named(name) ?? btn(name)) : btn(name));
  await flush(6);
};
const field = (text: string) => {
  const label = Array.from(document.querySelectorAll('label')).find((l) => l.textContent === text);
  return document.getElementById(label?.getAttribute('for') ?? '__none__') as HTMLInputElement | HTMLTextAreaElement | null;
};
const byLabel = (name: string) => document.querySelector<HTMLInputElement>(`[aria-label="${name}"]`);
const calls = (method: string, path: string) => m.calls.filter((c) => c.method === method && c.path === path);
const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });

beforeEach(() => {
  m.phase = 'authenticated';
  m.search = new URLSearchParams();
  m.replace.mockClear();
  m.calls = [];
  m.fail.clear();
  m.failOnce.clear();
  m.write.clear();
  m.data = { '/brand/owner/me': BRAND, '/brand/owner/me/sales': SALES };
});
afterEach(() => {
  mounted.forEach((r) => r.unmount());
  mounted = [];
  document.body.innerHTML = '';
});

describe('khung trang /chu-thuong-hieu', () => {
  it('đúng một h1 "Quản lý nhãn hàng" khi đang tải và khi có dữ liệu; tên nhãn là h2', async () => {
    m.data = {};
    const r = render(<BrandOwnerPage />);
    mounted.push(r);
    expect(h1s()).toEqual(['Quản lý nhãn hàng']);
    expect(document.querySelectorAll('[data-skeleton]').length).toBeGreaterThan(0);
    mounted.pop()!.unmount();

    m.data = { '/brand/owner/me': BRAND };
    await mount();
    expect(h1s()).toEqual(['Quản lý nhãn hàng']);
    expect(Array.from(document.querySelectorAll('h2')).map((h) => h.textContent)).toContain('Sachi');
    expect(headingProblems(document.body)).toEqual([]);
  });

  it('khách chưa đăng nhập: mời đăng nhập mang returnTo, không gọi API', async () => {
    m.phase = 'guest';
    await mount();
    expect(h1s()).toEqual(['Quản lý nhãn hàng']);
    expect(document.querySelector('a[href="/dang-nhap?returnTo=%2Fchu-thuong-hieu"]')).not.toBeNull();
    expect(m.calls).toEqual([]);
  });

  it('chưa được cấp nhãn (404): nói rõ, vẫn đúng một h1, không có nút thử lại', async () => {
    m.fail.set('GET /brand/owner/me', httpError(404, 'Not Found'));
    await mount();
    expect(text()).toContain('Bạn chưa được cấp quyền quản lý nhãn nào. Liên hệ Tubu để trở thành đối tác nhãn.');
    expect(h1s()).toEqual(['Quản lý nhãn hàng']);
    expect(btn(/thử lại/i)).toBeNull();
  });

  it('máy chủ từ chối (403): báo không có quyền bằng lời dễ hiểu, không lộ mã lỗi', async () => {
    m.fail.set('GET /brand/owner/me', httpError(403, 'Forbidden resource'));
    await mount();
    expect(text()).toContain('Tài khoản này không có quyền quản lý nhãn hàng.');
    expect(text()).not.toContain('Forbidden');
    expect(h1s()).toEqual(['Quản lý nhãn hàng']);
  });

  it('lỗi tải: có nút Thử lại, bấm thì tải lại được', async () => {
    m.failOnce.add('GET /brand/owner/me');
    await mount();
    expect(h1s()).toEqual(['Quản lý nhãn hàng']);
    expect(text()).toContain('Mất kết nối');
    await press('Thử lại');
    expect(text()).toContain('Thông tin nhãn');
  });

  it('trạng thái nhãn: chính hãng, đang hiển thị, số theo dõi; không dùng ký tự ✓', async () => {
    await mount();
    expect(text()).toContain('Chính hãng');
    expect(text()).toContain('Đang hiển thị');
    expect(text()).toContain('12 theo dõi');
    expect(text()).not.toContain('✓');
  });

  it('nhãn chưa xác minh và còn nháp', async () => {
    m.data['/brand/owner/me'] = { ...BRAND, isVerified: false, isPublished: false };
    await mount();
    expect(text()).toContain('Chưa xác minh');
    expect(text()).toContain('Nháp (admin duyệt)');
  });

  it('"Xem trang nhãn": đã đăng thì là liên kết /brand/:slug; nháp thì chỉ báo, không có liên kết', async () => {
    await mount();
    expect(document.querySelector('a[href="/brand/sachi"]')?.textContent).toContain('Xem trang nhãn');
    mounted.pop()!.unmount();

    m.data['/brand/owner/me'] = { ...BRAND, isPublished: false };
    await mount();
    expect(document.querySelector('a[href="/brand/sachi"]')).toBeNull();
    await press('Xem trang nhãn');
    expect(document.querySelector('[role="status"]')?.textContent).toContain('Nhãn đang là nháp — Tubu duyệt xong khách mới xem được.');
  });

  it('không có nút chưa đặt tên, ô chưa gắn nhãn hay vùng chạm nhỏ', async () => {
    await mount();
    expect(unnamedControls(document.body)).toEqual([]);
    expect(unlabeledFields(document.body)).toEqual([]);
    expect(smallTouchTargets(document.body)).toEqual([]);
  });
});

describe('tab Hồ sơ & khuyến mãi', () => {
  it('có hai tab, mặc định mở Hồ sơ & khuyến mãi và chưa gọi API doanh thu', async () => {
    await mount();
    const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
    expect(tabs.map((t) => t.textContent)).toEqual(['Hồ sơ & khuyến mãi', 'Doanh thu']);
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
    expect(text()).toContain('Thông tin nhãn');
    expect(calls('GET', '/brand/owner/me/sales')).toHaveLength(0);
  });

  it('Lưu thông tin gửi PATCH /brand/owner/me với đủ năm trường; ảnh mới lấy từ ô tải ảnh', async () => {
    await mount();
    typeInto(field('Tagline'), 'Sống xanh');
    click(btn('Logo'));
    await press('Lưu thông tin');
    const sent = calls('PATCH', '/brand/owner/me');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toEqual({ logoUrl: 'https://res.cloudinary.com/x/new.jpg', coverUrl: '', tagline: 'Sống xanh', origin: '', story: '' });
    expect(document.querySelector('[role="status"]')?.textContent).toContain('Đã lưu thông tin nhãn');
  });

  it('lưu lỗi 403: báo không có quyền, không báo đã lưu', async () => {
    m.fail.set('PATCH /brand/owner/me', httpError(403, 'Forbidden resource'));
    await mount();
    await press('Lưu thông tin');
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Bạn không có quyền thực hiện thao tác này.');
    expect(text()).not.toContain('Đã lưu thông tin nhãn');
  });

  it('thêm khuyến mãi không nhập mã: không gửi couponCode; ngày trống thì mặc định bắt đầu bây giờ, kéo dài 30 ngày', async () => {
    await mount();
    typeInto(byLabel('Tiêu đề (MUA 2 TẶNG 1)'), '  Giảm sốc ');
    await press('Thêm khuyến mãi');
    const sent = calls('POST', '/brand/owner/me/promotions');
    expect(sent).toHaveLength(1);
    const body = sent[0]!.body as Record<string, string | undefined>;
    expect(body.title).toBe('Giảm sốc');
    expect(body.couponCode).toBeUndefined();
    expect(body.subtitle).toBeUndefined();
    expect(new Date(body.endAt!).getTime() - new Date(body.startAt!).getTime()).toBe(30 * 864e5);
    expect(text()).toContain('Đã thêm khuyến mãi');
  });

  it('mã được viết hoa; mã bị máy chủ từ chối (400) hiện đúng thông báo, không báo "Đã thêm"', async () => {
    m.fail.set('POST /brand/owner/me/promotions', httpError(400, 'Mã giảm giá "MASAI" chưa có trong hệ thống.'));
    await mount();
    typeInto(byLabel('Tiêu đề (MUA 2 TẶNG 1)'), 'Giảm sốc');
    typeInto(byLabel('Mã giảm giá (tuỳ chọn) — VD: TUBU20'), 'masai');
    await press('Thêm khuyến mãi');
    expect((calls('POST', '/brand/owner/me/promotions')[0]!.body as { couponCode: string }).couponCode).toBe('MASAI');
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('chưa có trong hệ thống');
    expect(text()).not.toContain('Đã thêm khuyến mãi');
  });

  it('sửa khuyến mãi rồi xoá ô mã gửi couponCode rỗng để gỡ mã', async () => {
    await mount();
    await press('Sửa khuyến mãi MUA 2 TẶNG 1');
    expect(byLabel('Mã giảm giá (tuỳ chọn) — VD: TUBU20')!.value).toBe('TUBU20');
    typeInto(byLabel('Mã giảm giá (tuỳ chọn) — VD: TUBU20'), '');
    await press('Lưu thay đổi');
    const sent = calls('PATCH', '/brand/owner/me/promotions/p1');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toMatchObject({ title: 'MUA 2 TẶNG 1', couponCode: '' });
    expect(text()).toContain('Đã cập nhật khuyến mãi');
  });

  it('bật/tắt khuyến mãi chỉ gửi isActive', async () => {
    await mount();
    const sw = document.querySelector<HTMLElement>('[role="switch"][aria-label="Bật khuyến mãi MUA 2 TẶNG 1"]');
    expect(sw?.getAttribute('aria-checked')).toBe('true');
    click(sw);
    await flush(6);
    expect(calls('PATCH', '/brand/owner/me/promotions/p1')[0]!.body).toEqual({ isActive: false });
  });

  it('ngày kết thúc trước ngày bắt đầu: báo lỗi và khoá nút thêm', async () => {
    await mount();
    typeInto(byLabel('Tiêu đề (MUA 2 TẶNG 1)'), 'Giảm sốc');
    typeInto(byLabel('Từ ngày'), '2026-11-10');
    typeInto(byLabel('Đến ngày'), '2026-11-01');
    expect(text()).toContain('Ngày kết thúc phải sau ngày bắt đầu.');
    expect((btn('Thêm khuyến mãi') as HTMLButtonElement).disabled).toBe(true);
  });

  it('xoá khuyến mãi phải xác nhận trong sheet; Huỷ không gọi API, Xoá gọi DELETE đúng id', async () => {
    await mount();
    await press('Xoá khuyến mãi MUA 2 TẶNG 1');
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(Array.from(dialog.querySelectorAll('h2')).map((h) => h.textContent)).toContain('Xoá khuyến mãi này?');
    click(byText(dialog, 'button', 'Huỷ'));
    await flush();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(calls('DELETE', '/brand/owner/me/promotions/p1')).toHaveLength(0);

    await press('Xoá khuyến mãi MUA 2 TẶNG 1');
    const again = document.querySelector<HTMLElement>('[role="dialog"]')!;
    click(Array.from(again.querySelectorAll('button')).find((b) => b.textContent === 'Xoá') ?? null);
    await flush(6);
    expect(calls('DELETE', '/brand/owner/me/promotions/p1')).toHaveLength(1);
  });
});

describe('tab Doanh thu', () => {
  beforeEach(() => {
    m.search = new URLSearchParams('tab=sales');
  });

  it('gọi kỳ 30 ngày, hiện doanh thu, số đơn, số sản phẩm, đơn đã giao và SP bán chạy; không hiện form hồ sơ', async () => {
    await mount();
    expect(calls('GET', '/brand/owner/me/sales')[0]!.query).toEqual({ period: '30d' });
    expect(text()).toContain('4.560.000đ');
    expect(text()).toContain('9 đơn đã giao');
    expect(text()).toContain('3.200.000đ');
    const rows = Array.from(document.querySelectorAll('ol li'));
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('Nước rửa chén Sachi');
    expect(rows[0]!.textContent).toContain('3.000.000đ');
    expect(rows[0]!.textContent).toContain('Đã bán 20');
    expect(text()).toMatch(/không hiện\s+thông tin khách/i);
    expect(text()).not.toContain('Thông tin nhãn');
  });

  it('đổi kỳ báo cáo gọi lại API với kỳ đó', async () => {
    await mount();
    expect(Array.from(document.querySelectorAll('[role="tab"]')).map((t) => t.textContent)).toEqual([
      'Hồ sơ & khuyến mãi', 'Doanh thu', '7 ngày', '30 ngày', '90 ngày', 'Tháng này', 'Tháng trước',
    ]);
    await press('Tháng trước');
    expect(calls('GET', '/brand/owner/me/sales').map((c) => c.query)).toContainEqual({ period: 'prev_month' });
    await press('7 ngày');
    expect(calls('GET', '/brand/owner/me/sales').map((c) => c.query)).toContainEqual({ period: '7d' });
  });

  it('chọn tab Doanh thu đổi ?tab=sales; về Hồ sơ thì bỏ khỏi URL', async () => {
    m.search = new URLSearchParams();
    await mount();
    await press('Doanh thu');
    expect(m.replace).toHaveBeenCalledWith('/chu-thuong-hieu?tab=sales', { scroll: false });
  });

  it('kỳ chưa có đơn: trạng thái rỗng, không vẽ danh sách', async () => {
    m.data['/brand/owner/me/sales'] = { ...SALES, orderCount: 0, unitsSold: 0, revenue: 0, delivered: { orderCount: 0, revenue: 0 }, topProducts: [] };
    await mount();
    expect(text()).toContain('Chưa có đơn nào trong kỳ này');
    expect(document.querySelectorAll('ol li')).toHaveLength(0);
  });

  it('lỗi tải: thông báo và nút Thử lại', async () => {
    m.failOnce.add('GET /brand/owner/me/sales');
    await mount();
    expect(text()).toContain('Mất kết nối');
    await press('Thử lại');
    expect(text()).toContain('4.560.000đ');
  });

  it('403 khi tải doanh thu: báo không có quyền bằng lời dễ hiểu', async () => {
    m.fail.set('GET /brand/owner/me/sales', httpError(403, 'Forbidden resource'));
    await mount();
    expect(text()).toContain('Tài khoản này không có quyền quản lý nhãn hàng.');
  });
});

describe('/chu-thuong-hieu — diện mạo Mini App ở điện thoại', () => {
  it('Xem trang nhãn là nút secondary; thẻ không viền; tiêu đề thẻ serif title-sm', async () => {
    await mount();
    expect(document.querySelector('a[href="/brand/sachi"]')!.className).toContain('max-md:bg-[var(--color-action-secondary-bg)]');
    const info = document.querySelector('section[aria-label="Thông tin nhãn"]')!;
    expect(info.className).toContain('max-md:border-transparent');
    expect(info.querySelector('h2')!.className).toContain('font-display');
    expect(info.querySelector('h2')!.className).toContain('max-md:text-[length:var(--type-title-sm-size)]');
  });

  it('ô Tagline và Nguồn gốc cỡ chữ body-lg như Mini App', async () => {
    await mount();
    expect(field('Tagline')!.className).toContain('max-md:text-[length:var(--type-body-lg-size)]');
    expect(field('Nguồn gốc')!.className).toContain('max-md:text-[length:var(--type-body-lg-size)]');
  });
});
