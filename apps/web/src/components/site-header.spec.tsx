import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: { user: null as { fullName: string } | null, status: 'anonymous', initialized: true, sessionUnavailable: false }, cart: { itemCount: 0 } }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: mocks.cart }) }));
vi.mock('@/lib/shop-client', () => ({ getCart: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import SiteHeader from './site-header';

const render = () => renderToStaticMarkup(<SiteHeader />);

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

  // R2-BUYERWEB-5: mất mạng lúc khôi phục phiên thì khách vẫn là khách đã đăng nhập, header không được mời đăng nhập lại.
  it('phiên tạm không khôi phục được (mất mạng): header giữ lối vào Tài khoản, không hiện Đăng nhập', () => {
    mocks.auth = { user: null, status: 'idle', initialized: true, sessionUnavailable: true };
    const out = render();
    expect(out).not.toContain('href="/dang-nhap"');
    expect(out).toContain('href="/tai-khoan"');
    mocks.auth = { user: null, status: 'anonymous', initialized: true, sessionUnavailable: false };
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
});
