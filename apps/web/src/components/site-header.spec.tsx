import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: { user: null as { fullName: string } | null, status: 'anonymous', initialized: true, sessionUnavailable: false }, cart: { itemCount: 0 }, notifications: [] as { status: string }[], hydrated: false as boolean | 'real' }));
const DEFAULTS = { auth: mocks.auth, cart: mocks.cart, notifications: mocks.notifications };
vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));
// Mặc định như máy chủ/hydrate đầu (useHydrated=false); ca cần pha phiên thật bật true để giả lập sau hydrate; 'real' chạy hook thật.
vi.mock('@/lib/use-hydrated', async (orig) => {
  const actual = await orig<typeof import('@/lib/use-hydrated')>();
  return { useHydrated: () => (mocks.hydrated === 'real' ? actual.useHydrated() : mocks.hydrated) };
});
vi.mock('@tanstack/react-query', () => ({
  useQuery: (o: { queryKey: unknown[] }) => ({
    data: o.queryKey.join('/') === 'notifications/unread' ? { count: mocks.notifications.filter((n) => n.status !== 'READ').length } : mocks.cart,
  }),
}));
vi.mock('@/lib/shop-client', () => ({ getCart: vi.fn() }));
vi.mock('@/lib/route-map', async (orig) => ({ ...(await orig<object>()), isWebRouteReady: (p: string) => ['/', '/tai-khoan', '/vuon-xanh', '/mua-chung', '/tai-khoan/thong-bao'].includes(p) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/' }));

import SiteHeader from './site-header';

const render = () => renderToStaticMarkup(<SiteHeader />);

afterEach(() => {
  mocks.auth = DEFAULTS.auth;
  mocks.cart = DEFAULTS.cart;
  mocks.notifications = DEFAULTS.notifications;
  mocks.hydrated = false;
});

describe('SiteHeader', () => {
  it('header dính đầu trang chừa inset phía trên (thanh trạng thái, tai thỏ) để không chui xuống dưới', () => {
    mocks.auth = { user: null, status: 'anonymous', initialized: true, sessionUnavailable: false };
    const header = render().match(/<header[^>]*>/)?.[0] ?? '';
    expect(header).toMatch(/\bsticky\b/);
    expect(header).toContain('padding-top:env(safe-area-inset-top, 0px)');
  });

  it('không dẫn khách vào Kênh Đối Tác (/merchant) — C-025', () => {
    mocks.auth = { user: null, status: 'anonymous', initialized: true, sessionUnavailable: false };
    const out = render();
    expect(out).not.toContain('/merchant');
    expect(out).not.toContain('Đối Tác');
  });

  it('khách chưa đăng nhập thấy nút Đăng nhập; đã đăng nhập thấy tên và link tài khoản', () => {
    mocks.auth = { user: null, status: 'anonymous', initialized: true, sessionUnavailable: false };
    expect(render()).toContain('href="/dang-nhap"');
    mocks.auth = { user: { fullName: 'Nguyễn Văn An' }, status: 'authenticated', initialized: true, sessionUnavailable: false };
    const out = render();
    expect(out).toContain('href="/tai-khoan"');
    expect(out).toContain('>An<');
  });

  it('nút tài khoản dùng tên gọi như lời chào thẻ thành viên: họ tên có khoảng trắng thừa hay emoji vẫn ra từ cuối, thiếu tên thì "Tài khoản" (P2 #7)', () => {
    mocks.auth = { user: { fullName: 'Nguyễn Thị Quay Lại ' }, status: 'authenticated', initialized: true, sessionUnavailable: false };
    expect(render()).toContain('>Lại<');
    mocks.auth = { user: { fullName: '🌸 Hoa 🌸' }, status: 'authenticated', initialized: true, sessionUnavailable: false };
    expect(render()).toContain('>Hoa<');
    mocks.auth = { user: { fullName: '' }, status: 'authenticated', initialized: true, sessionUnavailable: false };
    expect(render()).toContain('>Tài khoản<');
  });

  // R2-BUYERWEB-5: mất mạng lúc khôi phục phiên thì khách vẫn là khách đã đăng nhập, header không được mời đăng nhập lại.
  it('phiên tạm không khôi phục được (mất mạng): header giữ lối vào Tài khoản, không hiện Đăng nhập', () => {
    mocks.auth = { user: null, status: 'idle', initialized: true, sessionUnavailable: true };
    mocks.hydrated = true;
    try {
      const out = render();
      expect(out).not.toContain('href="/dang-nhap"');
      expect(out).toContain('href="/tai-khoan"');
    } finally {
      mocks.hydrated = false;
      mocks.auth = { user: null, status: 'anonymous', initialized: true, sessionUnavailable: false };
    }
  });

  // Header không có dải báo mất kết nối riêng; trạng thái "phiên tạm lỗi" chỉ đổi nút Đăng nhập thành lối vào Tài khoản.
  // Máy chủ không được mang trạng thái đó, nếu không hydrate lệch.
  it('HTML máy chủ (lượt vẽ đầu) không mang trạng thái mất kết nối dù phiên tạm lỗi', () => {
    mocks.auth = { user: null, status: 'idle', initialized: true, sessionUnavailable: true };
    mocks.hydrated = 'real';
    const out = renderToString(<SiteHeader />);
    expect(out).not.toContain('role="alert"');
    expect(out).not.toMatch(/mất kết nối/i);
    expect(out).toContain('href="/dang-nhap"');
    expect(out).not.toContain('href="/tai-khoan"');
  });

  it('nút giỏ hàng có tên truy cập kèm số lượng và vùng chạm 44px', () => {
    mocks.auth = { user: { fullName: 'An' }, status: 'authenticated', initialized: true, sessionUnavailable: false };
    mocks.cart = { itemCount: 3 };
    const out = render();
    expect(out).toContain('aria-label="Giỏ hàng, 3 sản phẩm"');
    expect(out).toMatch(/<a [^>]*class="[^"]*\bh-11 w-11\b[^"]*"[^>]*href="\/gio-hang"/);
    mocks.cart = { itemCount: 0 };
    expect(render()).toContain('aria-label="Giỏ hàng"');
  });

  it('có ô tìm kiếm sản phẩm ở header — C-025', () => {
    const out = render();
    expect(out).toContain('role="search"');
    expect(out).toContain('name="q"');
    expect(out).toContain('aria-label="Tìm kiếm"');
  });

  // PC-7: khung chứa ô tìm kiếm mang data-site-search để CSS ẩn nó ngay từ khung hình đầu trên host gian hàng CTV
  // (html[data-tenant-host]), thay vì chờ effect gỡ ô sau hydrate làm ô nháy lên rồi biến mất.
  it('ô tìm kiếm nằm trong khung data-site-search để ẩn được trước khi vẽ trên host gian hàng', () => {
    expect(render()).toMatch(/<div [^>]*data-site-search[^>]*>\s*<form[^>]*role="search"/);
  });

  it('thương hiệu hiện bằng ảnh logo thật, không còn chữ + biểu tượng dựng tay', () => {
    const out = render();
    expect(out).toMatch(/<img[^>]*alt="Tubu Tree"/);
    expect(out).not.toContain('SỐNG XANH AN LÀNH');
  });

  it('máy tính: điều hướng không lặp logo và nút tài khoản, ẩn mục chưa làm xong, thêm chức năng chương trình', () => {
    mocks.auth = { user: null, status: 'anonymous', initialized: true, sessionUnavailable: false };
    const out = render();
    const desk = out.match(/<nav[^>]*data-desktop-nav[^>]*>.*?<\/nav>/s)?.[0] ?? '';
    expect(desk).not.toContain('>Trang chủ<');
    expect(desk).not.toContain('>Cá nhân<');
    expect(desk).toContain('>Vườn Xanh<');
    expect(desk).toContain('>Mua chung<');
    expect(desk).not.toContain('>Danh mục<');
    expect(desk).not.toContain('>Kho quà<');
  });

  it('thanh đầu một hàng chính cao 64px, chuông thông báo có số chưa đọc cho khách đã đăng nhập', () => {
    mocks.auth = { user: { fullName: 'Lan Anh' }, status: 'authenticated', initialized: true, sessionUnavailable: false };
    mocks.notifications = [{ status: 'UNREAD' }, { status: 'READ' }, { status: 'UNREAD' }];
    const out = render();
    expect(out).not.toMatch(/flex-wrap/);
    expect(out).toMatch(/aria-label="Thông báo, 2 chưa đọc"/);
    expect(out).toMatch(/>2<\/span>/);
    mocks.notifications = [];
  });

  it('khách chưa đăng nhập không có chuông', () => {
    mocks.auth = { user: null, status: 'anonymous', initialized: true, sessionUnavailable: false };
    expect(render()).not.toContain('/tai-khoan/thong-bao');
  });
});
