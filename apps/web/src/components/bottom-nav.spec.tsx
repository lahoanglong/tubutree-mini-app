import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pathname: '/',
  status: 'authenticated',
  count: 0 as number | undefined,
  ready: (_p: string): boolean => false,
  query: vi.fn(),
}));
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ status: mocks.status }) }));
vi.mock('@/lib/route-map', async (orig) => ({ ...(await orig<object>()), isWebRouteReady: (p: string) => mocks.ready(p) }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: (opts: unknown) => {
    mocks.query(opts);
    return { data: mocks.count };
  },
}));

import BottomNav from './bottom-nav';

const render = (pathname: string) => {
  mocks.pathname = pathname;
  return renderToStaticMarkup(<BottomNav />);
};

beforeEach(() => {
  mocks.status = 'authenticated';
  mocks.count = 0;
  mocks.ready = (p) => p === '/' || p === '/tai-khoan';
  mocks.query.mockReset();
});

describe('BottomNav (điện thoại)', () => {
  it('chỉ hiện dưới md và chừa safe-area đáy', () => {
    const out = render('/');
    expect(out).toContain('md:hidden');
    expect(out).toContain('env(safe-area-inset-bottom');
    expect(out).toContain('data-bottom-nav');
  });

  it('hiện ở 5 route gốc, kể cả route gốc chưa làm xong', () => {
    for (const p of ['/', '/san-pham', '/vuon-xanh', '/tai-khoan/don-hang', '/tai-khoan']) {
      expect(render(p), p).toContain('<nav');
    }
  });

  it('không hiện ở trang con, trang quản trị', () => {
    for (const p of ['/san-pham/ao-thun', '/gio-hang', '/tai-khoan/dia-chi', '/tai-khoan/don-hang/TB1', '/admin']) {
      expect(render(p), p).toBe('');
    }
  });

  it('ẩn mục có route còn pending', () => {
    const out = render('/');
    expect(out).toContain('href="/"');
    expect(out).toContain('href="/tai-khoan"');
    expect(out).not.toContain('href="/san-pham"');
    expect(out).not.toContain('href="/vuon-xanh"');
    expect(out).not.toContain('href="/tai-khoan/don-hang"');
  });

  it('đủ 5 mục đúng nhãn như Mini App khi mọi route đã xong; Vườn Xanh là nút nổi giữa', () => {
    mocks.ready = () => true;
    const out = render('/');
    const labels = ['Trang chủ', 'Danh mục', 'Vườn Xanh', 'Đơn hàng', 'Cá nhân'];
    const positions = labels.map((l) => out.indexOf(`>${l}<`));
    expect(positions.every((i) => i > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(out).toContain('href="/vuon-xanh"');
    expect(out).toMatch(/data-center="true"[^>]*href="\/vuon-xanh"|href="\/vuon-xanh"[^>]*data-center="true"/);
  });

  it('đánh dấu trang hiện tại bằng aria-current', () => {
    const out = render('/tai-khoan');
    expect(out.match(/aria-current="page"/g)).toHaveLength(1);
    expect(out).toMatch(/href="\/tai-khoan"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/tai-khoan"/);
  });

  it('badge đơn đang xử lý: có số thì gắn vào nhãn truy cập, không có thì không hiện', () => {
    mocks.ready = () => true;
    mocks.count = 3;
    const out = render('/');
    expect(out).toContain('Đơn hàng, 3 đơn đang xử lý');
    expect(out).toContain('>3<');
    mocks.count = 0;
    expect(render('/')).not.toContain('đơn đang xử lý');
    mocks.count = 120;
    expect(render('/')).toContain('>99+<');
  });

  it('badge hỏi /orders/active-count chỉ khi đã đăng nhập, dưới khoá orders nên đặt/huỷ đơn làm mới nó', async () => {
    mocks.ready = () => true;
    render('/');
    const opts = mocks.query.mock.calls[0]![0] as { queryKey: string[]; enabled: boolean; retry: boolean };
    expect(opts.queryKey.slice(0, 1)).toEqual(['orders']);
    expect(opts.enabled).toBe(true);
    expect(opts.retry).toBe(false);
    mocks.status = 'anonymous';
    render('/');
    expect((mocks.query.mock.calls.at(-1)![0] as { enabled: boolean }).enabled).toBe(false);
  });

  it('không hỏi badge khi mục Đơn hàng chưa hiện (route còn pending)', () => {
    mocks.ready = (p) => p !== '/tai-khoan/don-hang';
    render('/');
    expect((mocks.query.mock.calls[0]![0] as { enabled: boolean }).enabled).toBe(false);
  });

  it('globals.css ẩn thanh khi có sticky-action-bar', () => {
    const css = readFileSync(fileURLToPath(new URL('../app/globals.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/body\.has-sticky-bar\s+\[data-bottom-nav\]\s*\{[^}]*display:\s*none/);
  });
});
