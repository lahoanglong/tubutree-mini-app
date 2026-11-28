// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { ApiError, NetworkError } from '@/lib/client-api';
import { ZALO_UNAVAILABLE_NOTICE } from '@/lib/login-errors';
import { ui } from '@/lib/guest-ui';

// BUYERWEB-15 (quay lại đúng trang sau đăng nhập), BUYERWEB-19 (lỗi thân thiện), BUYERWEB-4 (thiếu App ID).

const mocks = vi.hoisted(() => ({
  auth: {
    status: 'idle' as string,
    initialized: true,
    zaloLoginConfigured: true,
    user: null,
    startZaloLogin: vi.fn(),
    handleCallback: vi.fn(),
    startGoogleLogin: vi.fn(),
    completeGoogleLogin: vi.fn(),
    loginWithEmailOtp: vi.fn(),
  },
  search: new URLSearchParams(),
  replace: vi.fn(),
  config: vi.fn(),
  apiFetch: vi.fn(),
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/lib/client-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/client-api')>()),
  apiFetch: (...a: unknown[]) => mocks.apiFetch(...a),
}));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: (...a: unknown[]) => mocks.config(...a) } }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: mocks.replace }),
  useSearchParams: () => mocks.search,
}));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getPublicSupport: async () => ({ hotline: '1900 1234', email: 'a@b.vn' }),
}));

import LoginPage from './page';
import { LoginSkeleton } from './login-skeleton';
import CallbackPage from './callback/page';
import GooglePage from './google/page';

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
  mocks.auth.startGoogleLogin.mockReset();
  mocks.auth.completeGoogleLogin.mockReset().mockResolvedValue(undefined);
  mocks.auth.loginWithEmailOtp.mockReset().mockResolvedValue(undefined);
  mocks.apiFetch.mockReset();
  mocks.search = new URLSearchParams();
  mocks.replace.mockReset();
  mocks.config.mockReset().mockResolvedValue({});
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
  it('không còn cách đăng nhập nào trên web: một câu ngắn, nút chính mở Tubu Tree trên Zalo, hotline, đường xem tiếp (B-25)', async () => {
    vi.stubEnv('NEXT_PUBLIC_ZALO_MINIAPP_ID', '');
    mocks.auth.zaloLoginConfigured = false;
    mocks.config.mockResolvedValue({ emailLoginConfigured: false, googleLoginConfigured: false });
    const { container } = mount(<LoginPage />);
    await flush();
    expect(byText(container, 'button', 'Đăng nhập với Zalo')).toBeNull();
    const open = Array.from(container.querySelectorAll('a')).find((a) => a.textContent === 'Mở Tubu Tree trên Zalo')!;
    expect(open.getAttribute('href')).toBe('https://zalo.me/s/2070857098114207963/');
    expect(open.className).toContain('min-h-11');
    expect(container.textContent).toContain('tạm ngưng');
    expect(container.textContent).toContain('1900 1234');
    expect(container.textContent).not.toContain('NEXT_PUBLIC');
    expect(container.querySelector('[data-testid="login-qr"]')).not.toBeNull();
    const keepBrowsing = Array.from(container.querySelectorAll('a')).find((a) => a.textContent === 'Tiếp tục xem sản phẩm')!;
    expect(keepBrowsing.getAttribute('href')).toBe('/');
    vi.unstubAllEnvs();
  });

  it('đã cấu hình thì nút bấm được và không có cảnh báo', async () => {
    const { container } = mount(<LoginPage />);
    await flush();
    expect((byText(container, 'button', 'Đăng nhập với Zalo') as HTMLButtonElement).disabled).toBe(false);
    expect(container.textContent).not.toContain('tạm ngưng');
  });
});

describe('/dang-nhap — mặt tiền trang', () => {
  it('có logo thương hiệu kèm chữ thay thế, đúng một main và một h1', async () => {
    const { container } = mount(<LoginPage />);
    await flush();
    const logo = container.querySelector('main img');
    expect(logo).not.toBeNull();
    expect(logo!.getAttribute('alt')).toBe('Tubu Tree');
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(container.querySelectorAll('h1')).toHaveLength(1);
  });

  it('nói lợi ích khi cấu hình công khai có mã chào mừng, con số lấy từ cấu hình', async () => {
    mocks.config.mockResolvedValue({ newCustomer: { welcomeVoucher: { amount: 70000, minOrder: 199000 } } });
    const { container } = mount(<LoginPage />);
    await flush();
    const benefit = container.querySelector('[data-testid="login-benefit"]');
    expect(benefit).not.toBeNull();
    expect(benefit!.textContent).toContain('70.000đ');
    expect(benefit!.textContent).toContain('199.000đ');
  });

  it.each([
    ['cấu hình không có phần khách mới', {}],
    ['mã chào mừng bằng 0', { newCustomer: { welcomeVoucher: { amount: 0, minOrder: 0 } } }],
  ])('không hiện dòng lợi ích khi %s', async (_name, cfg) => {
    mocks.config.mockResolvedValue(cfg);
    const { container } = mount(<LoginPage />);
    await flush();
    expect(container.querySelector('[data-testid="login-benefit"]')).toBeNull();
  });

  it('không hiện dòng lợi ích và vẫn đăng nhập được khi tải cấu hình lỗi', async () => {
    mocks.config.mockRejectedValue(new Error('offline'));
    const { container } = mount(<LoginPage />);
    await flush();
    expect(container.querySelector('[data-testid="login-benefit"]')).toBeNull();
    expect((byText(container, 'button', 'Đăng nhập với Zalo') as HTMLButtonElement).disabled).toBe(false);
  });

  it('khung chờ là skeleton đang bận, không còn chữ "Đang tải…"', () => {
    const { container } = mount(<LoginSkeleton />);
    expect(container.querySelectorAll('[data-skeleton]').length).toBeGreaterThan(2);
    expect(container.querySelector('main')?.getAttribute('aria-busy')).toBe('true');
    expect(container.textContent).not.toContain('Đang tải');
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

  it('đăng nhập hỏng: gỡ data-restoring khỏi <html> để khung tài khoản không nháy khi sang /tai-khoan', async () => {
    document.documentElement.setAttribute('data-restoring', '');
    mocks.search = new URLSearchParams({ code: 'abc', state: 'sai' });
    mocks.auth.handleCallback.mockRejectedValue(new ApiError('invalid_grant', 400));
    mount(<CallbackPage />);
    await flush();
    expect(document.documentElement.hasAttribute('data-restoring')).toBe(false);
  });

  it('đăng nhập thành công: không đụng data-restoring (AccountShell gỡ khi biết phiên)', async () => {
    document.documentElement.setAttribute('data-restoring', '');
    mocks.search = new URLSearchParams({ code: 'abc', state: 's' });
    mount(<CallbackPage />);
    await flush();
    expect(document.documentElement.hasAttribute('data-restoring')).toBe(true);
    document.documentElement.removeAttribute('data-restoring');
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

  it('có id Mini App: hiện nút dẫn tới Mini App, vùng chạm 44px', async () => {
    vi.stubEnv('NEXT_PUBLIC_ZALO_MINIAPP_ID', '2070857098114207963');
    const { container } = mount(<LoginPage />);
    await flush();
    const a = openLink(container)!;
    expect(a.getAttribute('href')).toBe('https://zalo.me/s/2070857098114207963/');
    expect(a.className).toContain('min-h-11');
  });

  it('khách tới từ trang sản phẩm: mở đúng sản phẩm đó trong Mini App', async () => {
    vi.stubEnv('NEXT_PUBLIC_ZALO_MINIAPP_ID', '123');
    mocks.search = new URLSearchParams({ returnTo: '/san-pham/dau-goi' });
    const { container } = mount(<LoginPage />);
    await flush();
    expect(openLink(container)!.getAttribute('href')).toBe('https://zalo.me/s/123/product/dau-goi');
  });

  it('chưa cấu hình id Mini App: nút vẫn có, trỏ tới Mini App chính thức', async () => {
    vi.stubEnv('NEXT_PUBLIC_ZALO_MINIAPP_ID', '');
    const { container } = mount(<LoginPage />);
    await flush();
    expect(openLink(container)!.getAttribute('href')).toBe('https://zalo.me/s/2070857098114207963/');
  });

  it('chỉ có App ID của Zalo App, thiếu id Mini App: không dựng link tới App ID', async () => {
    vi.stubEnv('NEXT_PUBLIC_ZALO_APP_ID', '565779011239360460');
    vi.stubEnv('NEXT_PUBLIC_ZALO_MINIAPP_ID', '');
    const { container } = mount(<LoginPage />);
    await flush();
    expect(container.innerHTML).not.toContain('zalo.me/s/565779011239360460');
  });

  it('bấm nút này không chạm vào luồng đăng nhập: không ghi returnTo, không gọi startZaloLogin', async () => {
    vi.stubEnv('NEXT_PUBLIC_ZALO_MINIAPP_ID', '123');
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

  it('ẩn khi không còn cách đăng nhập nào trên web (không có gì để đồng ý)', async () => {
    mocks.auth.zaloLoginConfigured = false;
    mocks.config.mockResolvedValue({ emailLoginConfigured: false });
    const { container } = mount(<LoginPage />);
    await flush();
    expect(container.textContent).not.toContain('Bằng việc đăng nhập, bạn đồng ý với');
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

describe('/dang-nhap — đăng nhập bằng mã gửi qua Email (w54-01)', () => {
  const emailInput = (c: HTMLElement) => c.querySelector<HTMLInputElement>('input[type="email"]');
  const codeInput = (c: HTMLElement) => c.querySelector<HTMLInputElement>('input[autocomplete="one-time-code"]');
  const resendButton = (c: HTMLElement) => byText(c, 'button', /^Gửi lại mã/) as HTMLButtonElement;
  const alertText = (c: HTMLElement) => c.querySelector('[role="alert"]')?.textContent ?? null;
  const SENT = { email: 'khach@gmail.com', resendAfterSec: 60, expiresInSec: 600 };

  async function openCodeStep(c: HTMLElement, email = ' Khach@Gmail.com ') {
    typeInto(emailInput(c), email);
    click(byText(c, 'button', 'Nhận mã qua Email'));
    await flush();
  }

  it('Email là nút chính, Zalo là nút phụ dưới chữ "hoặc"', async () => {
    const { container } = mount(<LoginPage />);
    await flush();
    expect(emailInput(container)?.getAttribute('autocomplete')).toBe('email');
    expect(byText(container, 'button', 'Nhận mã qua Email')!.className).toContain(ui.btnPrimary);
    const zalo = byText(container, 'button', 'Đăng nhập với Zalo')!;
    expect(zalo.className).toContain(ui.btnSecondary);
    expect(container.textContent).toContain('hoặc');
  });

  it('bước 1 → 2: API gửi mã không kèm token; ô mã 6 số bàn phím số có nhãn; gửi lại phải chờ 60 giây', async () => {
    mocks.apiFetch.mockResolvedValue(SENT);
    const { container } = mount(<LoginPage />);
    await flush();
    await openCodeStep(container);
    expect(mocks.apiFetch).toHaveBeenCalledWith('/auth/email-otp/request', { method: 'POST', body: { email: 'Khach@Gmail.com' }, auth: false });
    const input = codeInput(container)!;
    expect(input.getAttribute('inputmode')).toBe('numeric');
    expect(input.getAttribute('maxlength')).toBe('6');
    expect(container.querySelector(`label[for="${input.id}"]`)?.textContent).toBe('Mã đăng nhập');
    expect(container.textContent).toContain('đã gửi tới khach@gmail.com');
    expect(container.textContent).toContain('Mã có hạn 10 phút');
    expect(resendButton(container).textContent).toBe('Gửi lại mã (60 giây)');
    expect(resendButton(container).disabled).toBe(true);
  });

  it('đếm ngược hết thì gửi lại được; gửi lại báo mã mới và đếm lại', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    try {
      mocks.apiFetch.mockResolvedValue(SENT);
      const { container } = mount(<LoginPage />);
      await flush();
      await openCodeStep(container);
      act(() => vi.advanceTimersByTime(30_000));
      expect(resendButton(container).textContent).toBe('Gửi lại mã (30 giây)');
      act(() => vi.advanceTimersByTime(30_000));
      expect(resendButton(container).textContent).toBe('Gửi lại mã');
      expect(resendButton(container).disabled).toBe(false);
      click(resendButton(container));
      await flush();
      expect(mocks.apiFetch).toHaveBeenCalledTimes(2);
      expect(container.querySelector('[role="status"]')?.textContent).toContain('Đã gửi mã mới');
      expect(resendButton(container).textContent).toBe('Gửi lại mã (60 giây)');
    } finally {
      vi.useRealTimers();
    }
  });

  it('gõ đủ 6 số là tự đăng nhập bằng email API đã chuẩn hoá; xong thì giữ nút khoá trong lúc chuyển trang', async () => {
    mocks.apiFetch.mockResolvedValue(SENT);
    const { container } = mount(<LoginPage />);
    await flush();
    await openCodeStep(container);
    typeInto(codeInput(container), '12 34 5');
    await flush();
    expect(mocks.auth.loginWithEmailOtp).not.toHaveBeenCalled();
    typeInto(codeInput(container), '12 34 56');
    await flush();
    expect(mocks.auth.loginWithEmailOtp).toHaveBeenCalledTimes(1);
    expect(mocks.auth.loginWithEmailOtp).toHaveBeenCalledWith('khach@gmail.com', '123456');
    expect((byText(container, 'button', 'Đang đăng nhập…') as HTMLButtonElement).disabled).toBe(true);
  });

  it('sai mã: câu của API, xoá ô để gõ lại, vẫn ở bước nhập mã', async () => {
    mocks.apiFetch.mockResolvedValue(SENT);
    mocks.auth.loginWithEmailOtp.mockRejectedValue(new ApiError('Mã chưa đúng. Bạn còn 4 lần thử.', 400, 'EMAIL_OTP_WRONG', { attemptsLeft: 4 }));
    const { container } = mount(<LoginPage />);
    await flush();
    await openCodeStep(container);
    typeInto(codeInput(container), '000000');
    await flush();
    expect(alertText(container)).toBe('Mã chưa đúng. Bạn còn 4 lần thử.');
    expect(codeInput(container)!.value).toBe('');
    expect(codeInput(container)!.getAttribute('aria-invalid')).toBe('true');
    expect((byText(container, 'button', 'Đăng nhập') as HTMLButtonElement).disabled).toBe(false);
  });

  it('email vừa xin mã chưa tới một phút (429 EMAIL_OTP_COOLDOWN): sang bước nhập mã, đếm theo retryAfterSec của máy chủ, không báo lỗi', async () => {
    mocks.apiFetch.mockRejectedValue(new ApiError('Bạn chờ 42 giây rồi xin mã mới nhé.', 429, 'EMAIL_OTP_COOLDOWN', { retryAfterSec: 42 }));
    const { container } = mount(<LoginPage />);
    await flush();
    await openCodeStep(container);
    expect(codeInput(container)).not.toBeNull();
    expect(resendButton(container).textContent).toBe('Gửi lại mã (42 giây)');
    expect(alertText(container)).toBeNull();
  });

  it('quá trần trong giờ (429 EMAIL_OTP_RATE_LIMITED): ở lại bước email, báo câu tiếng Việt của API', async () => {
    mocks.apiFetch.mockRejectedValue(new ApiError('Email này đã nhận quá nhiều mã. Bạn thử lại sau 12 phút nhé.', 429, 'EMAIL_OTP_RATE_LIMITED', { retryAfterSec: 700 }));
    const { container } = mount(<LoginPage />);
    await flush();
    await openCodeStep(container);
    expect(codeInput(container)).toBeNull();
    expect(alertText(container)).toBe('Email này đã nhận quá nhiều mã. Bạn thử lại sau 12 phút nhé.');
  });

  it('email sai định dạng: báo ngay, không gọi API', async () => {
    const { container } = mount(<LoginPage />);
    await flush();
    await openCodeStep(container, 'khach@');
    expect(mocks.apiFetch).not.toHaveBeenCalled();
    expect(alertText(container)).toContain('chưa đúng định dạng');
    expect(emailInput(container)!.getAttribute('aria-invalid')).toBe('true');
  });

  it('"Đổi email" quay lại bước 1, giữ email đã gõ (ô email tự cắt khoảng trắng hai đầu)', async () => {
    mocks.apiFetch.mockResolvedValue(SENT);
    const { container } = mount(<LoginPage />);
    await flush();
    await openCodeStep(container);
    click(byText(container, 'button', 'Đổi email'));
    await flush();
    expect(emailInput(container)!.value).toBe('Khach@Gmail.com');
    expect(codeInput(container)).toBeNull();
  });

  it('API nói chưa bật đăng nhập Email: không hiện ô Email, Zalo thành nút chính', async () => {
    mocks.config.mockResolvedValue({ emailLoginConfigured: false });
    const { container } = mount(<LoginPage />);
    await flush();
    expect(emailInput(container)).toBeNull();
    expect(byText(container, 'button', 'Đăng nhập với Zalo')!.className).toContain(ui.btnPrimary);
    expect(container.textContent).not.toContain('hoặc');
  });

  it('bản build thiếu App ID Zalo nhưng có Email: chỉ còn ô Email, không báo tạm ngưng', async () => {
    mocks.auth.zaloLoginConfigured = false;
    const { container } = mount(<LoginPage />);
    await flush();
    expect(emailInput(container)).not.toBeNull();
    expect(byText(container, 'button', 'Đăng nhập với Zalo')).toBeNull();
    expect(container.textContent).not.toContain('tạm ngưng');
  });
});

describe('/dang-nhap?zalo_unavailable=1 (Zalo trả -14029)', () => {
  it('báo Zalo đang chờ duyệt, ẩn nút Zalo và lối Mở trên Zalo, ô Email ngay dưới', async () => {
    mocks.search = new URLSearchParams({ zalo_unavailable: '1', returnTo: '/gio-hang' });
    const { container } = mount(<LoginPage />);
    await flush();
    expect(ZALO_UNAVAILABLE_NOTICE).toBe('Đăng nhập Zalo đang chờ duyệt — bạn đăng nhập nhanh bằng Email bên dưới nhé.');
    const notice = container.querySelector('[data-testid="zalo-unavailable"]')!;
    expect(notice.textContent).toBe(ZALO_UNAVAILABLE_NOTICE);
    expect(notice.getAttribute('role')).toBe('status');
    expect(byText(container, 'button', 'Đăng nhập với Zalo')).toBeNull();
    expect(byText(container, 'a', 'Mở trên Zalo')).toBeNull();
    expect(container.querySelector('input[type="email"]')).not.toBeNull();
  });
});

describe('/dang-nhap — Google chỉ hiện khi API có khoá', () => {
  it.each([[{}], [{ googleLoginConfigured: false }]])('cấu hình %j: không có nút Google', async (cfg) => {
    mocks.config.mockResolvedValue(cfg);
    const { container } = mount(<LoginPage />);
    await flush();
    expect(byText(container, 'button', 'Đăng nhập với Google')).toBeNull();
  });

  it('googleLoginConfigured=true: nút phụ; bấm thì ghi returnTo rồi rời sang Google, nút khoá trong lúc chuyển', async () => {
    mocks.config.mockResolvedValue({ googleLoginConfigured: true });
    mocks.search = new URLSearchParams({ returnTo: '/gio-hang' });
    const { container } = mount(<LoginPage />);
    await flush();
    const google = byText(container, 'button', 'Đăng nhập với Google')!;
    expect(google.className).toContain(ui.btnSecondary);
    click(google);
    await flush();
    expect(sessionStorage.getItem('tubu_return_to')).toBe('/gio-hang');
    expect(mocks.auth.startGoogleLogin).toHaveBeenCalledTimes(1);
    expect((byText(container, 'button', 'Đang chuyển tới Google…') as HTMLButtonElement).disabled).toBe(true);
    expect((byText(container, 'button', 'Đăng nhập với Zalo') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('/dang-nhap/callback — Zalo chưa duyệt ứng dụng (-14029)', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => undefined));

  it.each([
    [{ error: '-14029', error_description: 'application is not approved' }],
    [{ error_code: '-14029' }],
    [{ error: 'invalid_request', error_description: 'Application is not approved' }],
  ])('Zalo chuyển về kèm %j → trang đăng nhập có ô Email, giữ returnTo, không đổi mã', async (p) => {
    sessionStorage.setItem('tubu_return_to', '/gio-hang');
    mocks.search = new URLSearchParams(p);
    const { container } = mount(<CallbackPage />);
    await flush();
    expect(mocks.replace).toHaveBeenCalledWith('/dang-nhap?returnTo=%2Fgio-hang&zalo_unavailable=1');
    expect(mocks.auth.handleCallback).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('Đăng nhập chưa thành công');
  });

  it('API đổi mã trả ZALO_APP_NOT_APPROVED → cũng về trang đăng nhập có ô Email, không hiện màn lỗi', async () => {
    mocks.search = new URLSearchParams({ code: 'abc', state: 's' });
    mocks.auth.handleCallback.mockRejectedValue(new ApiError(ZALO_UNAVAILABLE_NOTICE, 503, 'ZALO_APP_NOT_APPROVED'));
    const { container } = mount(<CallbackPage />);
    await flush();
    expect(mocks.replace).toHaveBeenCalledWith('/dang-nhap?zalo_unavailable=1');
    expect(container.textContent).not.toContain('Đăng nhập chưa thành công');
  });

  it('lỗi Zalo khác (access_denied) vẫn hiện màn lỗi như cũ', async () => {
    mocks.search = new URLSearchParams({ error: 'access_denied' });
    const { container } = mount(<CallbackPage />);
    await flush();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Đăng nhập chưa thành công');
  });
});

describe('/dang-nhap/google', () => {
  it('có code + state: đổi mã, về đúng trang đã ghi nhớ', async () => {
    sessionStorage.setItem('tubu_return_to', '/gio-hang');
    mocks.search = new URLSearchParams({ code: 'gcode', state: 'gstate' });
    mount(<GooglePage />);
    await flush();
    expect(mocks.auth.completeGoogleLogin).toHaveBeenCalledWith('gcode', 'gstate');
    expect(mocks.replace).toHaveBeenCalledWith('/gio-hang');
  });

  it.each([
    ['google_unavailable', 'Đăng nhập Google chưa được bật'],
    ['access_denied', 'Bạn đã huỷ đăng nhập Google'],
  ])('?error=%s: câu dễ hiểu, không đổi mã', async (error, text) => {
    mocks.search = new URLSearchParams({ error });
    const { container } = mount(<GooglePage />);
    await flush();
    expect(container.textContent).toContain(text);
    expect(mocks.auth.completeGoogleLogin).not.toHaveBeenCalled();
  });

  it('thiếu state: không gọi API', async () => {
    mocks.search = new URLSearchParams({ code: 'gcode' });
    const { container } = mount(<GooglePage />);
    await flush();
    expect(container.textContent).toContain('Google không gửi kèm mã đăng nhập');
    expect(mocks.auth.completeGoogleLogin).not.toHaveBeenCalled();
  });

  it('API từ chối lượt (GOOGLE_STATE_MISMATCH): câu tiếng Việt của API, nút "Đăng nhập lại" giữ returnTo', async () => {
    sessionStorage.setItem('tubu_return_to', '/gio-hang');
    mocks.search = new URLSearchParams({ code: 'gcode', state: 'gstate' });
    mocks.auth.completeGoogleLogin.mockRejectedValue(
      new ApiError('Phiên đăng nhập Google không hợp lệ hoặc đã hết hạn. Bạn đăng nhập lại nhé.', 401, 'GOOGLE_STATE_MISMATCH'),
    );
    const { container } = mount(<GooglePage />);
    await flush();
    expect(container.textContent).toContain('Phiên đăng nhập Google không hợp lệ');
    expect(byText(container, 'a', 'Đăng nhập lại')?.getAttribute('href')).toBe('/dang-nhap?returnTo=%2Fgio-hang');
  });
});
