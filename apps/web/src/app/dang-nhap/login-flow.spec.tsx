// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { ApiError, NetworkError } from '@/lib/client-api';

// BUYERWEB-15 (quay lại đúng trang sau đăng nhập), BUYERWEB-19 (lỗi thân thiện), BUYERWEB-4 (thiếu App ID).

const mocks = vi.hoisted(() => ({
  auth: {
    status: 'idle' as string,
    initialized: true,
    zaloLoginConfigured: true,
    user: null,
    startZaloLogin: vi.fn(),
    handleCallback: vi.fn(),
  },
  search: new URLSearchParams(),
  replace: vi.fn(),
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: mocks.replace }),
  useSearchParams: () => mocks.search,
}));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getPublicSupport: async () => ({ hotline: '1900 1234', email: 'a@b.vn' }),
}));

import LoginPage from './page';
import CallbackPage from './callback/page';

let mounted: Rendered[] = [];
const mount = (ui: Parameters<typeof render>[0]) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};

beforeEach(() => {
  sessionStorage.clear();
  mocks.auth.status = 'idle';
  mocks.auth.zaloLoginConfigured = true;
  mocks.auth.startZaloLogin.mockReset().mockResolvedValue(undefined);
  mocks.auth.handleCallback.mockReset().mockResolvedValue(undefined);
  mocks.search = new URLSearchParams();
  mocks.replace.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.restoreAllMocks();
});

describe('/dang-nhap — returnTo', () => {
  it('bấm đăng nhập ghi nhớ returnTo hợp lệ trước khi rời sang Zalo', async () => {
    mocks.search = new URLSearchParams({ returnTo: '/san-pham/dau-goi' });
    const { container } = mount(<LoginPage />);
    await flush();
    click(byText(container, 'button', 'Đăng nhập với Zalo'));
    await flush();
    expect(sessionStorage.getItem('tubu_return_to')).toBe('/san-pham/dau-goi');
    expect(mocks.auth.startZaloLogin).toHaveBeenCalled();
  });

  it('returnTo ngoài site bị bỏ (chống open redirect) và xoá giá trị cũ còn sót', async () => {
    sessionStorage.setItem('tubu_return_to', '/gio-hang');
    mocks.search = new URLSearchParams({ returnTo: 'https://evil.com' });
    const { container } = mount(<LoginPage />);
    click(byText(container, 'button', 'Đăng nhập với Zalo'));
    await flush();
    expect(sessionStorage.getItem('tubu_return_to')).toBeNull();
  });

  it('đã đăng nhập thì về returnTo, không có thì về trang chủ', async () => {
    mocks.auth.status = 'authenticated';
    mocks.search = new URLSearchParams({ returnTo: '/gio-hang' });
    mount(<LoginPage />);
    await flush();
    expect(mocks.replace).toHaveBeenCalledWith('/gio-hang');
  });

  it('đã đăng nhập, returnTo độc hại: về trang chủ', async () => {
    mocks.auth.status = 'authenticated';
    mocks.search = new URLSearchParams({ returnTo: '//evil.com' });
    mount(<LoginPage />);
    await flush();
    expect(mocks.replace).toHaveBeenCalledWith('/');
  });

  it('lỗi bắt đầu đăng nhập hiện câu tiếng Việt, không in lỗi kỹ thuật', async () => {
    mocks.auth.startZaloLogin.mockRejectedValue(new Error('crypto.subtle is undefined'));
    const { container } = mount(<LoginPage />);
    click(byText(container, 'button', 'Đăng nhập với Zalo'));
    await flush();
    expect(container.textContent).toContain('Không đăng nhập được lúc này');
    expect(container.textContent).not.toContain('crypto.subtle');
  });
});

describe('/dang-nhap — bản build thiếu NEXT_PUBLIC_ZALO_APP_ID (BUYERWEB-4)', () => {
  it('khoá nút và giải thích thân thiện kèm hotline, không để khách bấm rồi gặp lỗi kỹ thuật', async () => {
    mocks.auth.zaloLoginConfigured = false;
    const { container } = mount(<LoginPage />);
    await flush();
    const btn = byText(container, 'button', 'Đăng nhập với Zalo') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(container.textContent).toContain('tạm ngưng');
    expect(container.textContent).toContain('1900 1234');
    expect(container.textContent).not.toContain('NEXT_PUBLIC');
  });

  it('đã cấu hình thì nút bấm được và không có cảnh báo', async () => {
    const { container } = mount(<LoginPage />);
    await flush();
    expect((byText(container, 'button', 'Đăng nhập với Zalo') as HTMLButtonElement).disabled).toBe(false);
    expect(container.textContent).not.toContain('tạm ngưng');
  });
});

describe('/dang-nhap/callback', () => {
  it('thành công: về đúng trang đã ghi nhớ rồi xoá, không có thì về trang chủ', async () => {
    sessionStorage.setItem('tubu_return_to', '/san-pham/dau-goi');
    mocks.search = new URLSearchParams({ code: 'abc', state: 's' });
    mount(<CallbackPage />);
    await flush();
    expect(mocks.replace).toHaveBeenCalledWith('/san-pham/dau-goi');
    expect(sessionStorage.getItem('tubu_return_to')).toBeNull();
  });

  it('thành công không có returnTo: về trang chủ', async () => {
    mocks.search = new URLSearchParams({ code: 'abc', state: 's' });
    mount(<CallbackPage />);
    await flush();
    expect(mocks.replace).toHaveBeenCalledWith('/');
  });

  it('khách từ chối cấp quyền: câu tiếng Việt, không in error_description tiếng Anh, có "Đăng nhập lại" và "Về trang chủ"', async () => {
    mocks.search = new URLSearchParams({ error: 'access_denied', error_description: 'The user denied access to the app' });
    const { container } = mount(<CallbackPage />);
    await flush();
    expect(container.textContent).toContain('từ chối cấp quyền');
    expect(container.textContent).not.toContain('The user denied');
    expect(byText(container, 'a', 'Đăng nhập lại')).not.toBeNull();
    expect(byText(container, 'a', 'Về trang chủ')?.getAttribute('href')).toBe('/');
  });

  it('"Đăng nhập lại" mang theo returnTo để lần thử sau vẫn về đúng trang', async () => {
    sessionStorage.setItem('tubu_return_to', '/gio-hang');
    mocks.search = new URLSearchParams({ error: 'access_denied' });
    const { container } = mount(<CallbackPage />);
    await flush();
    expect(byText(container, 'a', 'Đăng nhập lại')?.getAttribute('href')).toBe('/dang-nhap?returnTo=%2Fgio-hang');
  });

  it('state sai / mã hết hạn từ API tiếng Anh: câu chung tiếng Việt, chi tiết kỹ thuật chỉ ra console', async () => {
    mocks.search = new URLSearchParams({ code: 'abc', state: 'sai' });
    mocks.auth.handleCallback.mockRejectedValue(new ApiError('invalid_grant: code expired', 400));
    const { container } = mount(<CallbackPage />);
    await flush();
    expect(container.textContent).toContain('Không đăng nhập được lúc này');
    expect(container.textContent).not.toContain('invalid_grant');
    expect(console.error).toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('mất mạng khi đổi mã: báo mất kết nối bằng tiếng Việt', async () => {
    mocks.search = new URLSearchParams({ code: 'abc', state: 's' });
    mocks.auth.handleCallback.mockRejectedValue(new NetworkError(false));
    const { container } = mount(<CallbackPage />);
    await flush();
    expect(container.textContent).toContain('Mất kết nối');
    expect(container.textContent).not.toContain('Failed to fetch');
  });

  it('Zalo tạm bận (503): báo bận, nút chính là "Thử lại" dẫn về đăng nhập', async () => {
    mocks.search = new URLSearchParams({ code: 'abc', state: 's' });
    mocks.auth.handleCallback.mockRejectedValue(new ApiError('Zalo đang bận, vui lòng thử lại sau ít phút.', 503));
    const { container } = mount(<CallbackPage />);
    await flush();
    expect(container.textContent).toContain('Zalo đang bận, vui lòng thử lại sau ít phút.');
    expect(byText(container, 'a', 'Thử lại')?.getAttribute('href')).toBe('/dang-nhap');
    expect(byText(container, 'a', 'Đăng nhập lại')).toBeNull();
  });

  it('thiếu mã: báo thiếu mã bằng câu dễ hiểu', async () => {
    const { container } = mount(<CallbackPage />);
    await flush();
    expect(container.textContent).toContain('không gửi kèm mã đăng nhập');
  });
});

// D7 việc 4: nút "Mở trên Zalo" (chỉ thêm giao diện, không đổi luồng đăng nhập).
describe('/dang-nhap — Mở trên Zalo', () => {
  afterEach(() => vi.unstubAllEnvs());
  const openLink = (c: HTMLElement) => Array.from(c.querySelectorAll('a')).find((a) => a.textContent === 'Mở trên Zalo');

  it('có app id: hiện nút dẫn tới Mini App, vùng chạm 44px', async () => {
    vi.stubEnv('NEXT_PUBLIC_ZALO_APP_ID', '2070857098114207963');
    const { container } = mount(<LoginPage />);
    await flush();
    const a = openLink(container)!;
    expect(a.getAttribute('href')).toBe('https://zalo.me/s/2070857098114207963/');
    expect(a.className).toContain('min-h-11');
  });

  it('khách tới từ trang sản phẩm: mở đúng sản phẩm đó trong Mini App', async () => {
    vi.stubEnv('NEXT_PUBLIC_ZALO_APP_ID', '123');
    mocks.search = new URLSearchParams({ returnTo: '/san-pham/dau-goi' });
    const { container } = mount(<LoginPage />);
    await flush();
    expect(openLink(container)!.getAttribute('href')).toBe('https://zalo.me/s/123/product/dau-goi');
  });

  it('chưa cấu hình app id: ẩn nút', async () => {
    vi.stubEnv('NEXT_PUBLIC_ZALO_APP_ID', '');
    const { container } = mount(<LoginPage />);
    await flush();
    expect(openLink(container)).toBeUndefined();
  });

  it('bấm nút này không chạm vào luồng đăng nhập: không ghi returnTo, không gọi startZaloLogin', async () => {
    vi.stubEnv('NEXT_PUBLIC_ZALO_APP_ID', '123');
    mocks.search = new URLSearchParams({ returnTo: '/gio-hang' });
    const { container } = mount(<LoginPage />);
    await flush();
    openLink(container)!.addEventListener('click', (e) => e.preventDefault());
    click(openLink(container)!);
    expect(mocks.auth.startZaloLogin).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('tubu_return_to')).toBeNull();
  });
});

describe('/dang-nhap — đồng ý điều khoản (D5-01)', () => {
  it('dưới nút đăng nhập có câu đồng ý Điều khoản và Chính sách bảo mật, hai liên kết đúng trang', async () => {
    const { container } = mount(<LoginPage />);
    await flush();
    const consent = Array.from(container.querySelectorAll('p')).find((p) => p.textContent?.startsWith('Bằng việc đăng nhập'))!;
    expect(consent.textContent).toBe('Bằng việc đăng nhập, bạn đồng ý với Điều khoản và Chính sách bảo mật.');
    const hrefs = Array.from(consent.querySelectorAll('a')).map((a) => [a.textContent, a.getAttribute('href')]);
    expect(hrefs).toEqual([
      ['Điều khoản', '/chinh-sach/dieu-khoan'],
      ['Chính sách bảo mật', '/chinh-sach/bao-mat'],
    ]);
    const button = byText(container, 'button', 'Đăng nhập với Zalo')!;
    expect(button.compareDocumentPosition(consent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('vẫn hiện khi đăng nhập Zalo tạm ngưng (khách vẫn đọc được điều khoản)', async () => {
    mocks.auth.zaloLoginConfigured = false;
    const { container } = mount(<LoginPage />);
    await flush();
    expect(container.textContent).toContain('Bằng việc đăng nhập, bạn đồng ý với');
  });

  it('không đổi luồng: bấm liên kết điều khoản không ghi returnTo, không gọi startZaloLogin', async () => {
    mocks.search = new URLSearchParams({ returnTo: '/gio-hang' });
    const { container } = mount(<LoginPage />);
    await flush();
    const a = container.querySelector<HTMLAnchorElement>('a[href="/chinh-sach/dieu-khoan"]')!;
    a.addEventListener('click', (e) => e.preventDefault());
    click(a);
    expect(mocks.auth.startZaloLogin).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('tubu_return_to')).toBeNull();
  });
});
