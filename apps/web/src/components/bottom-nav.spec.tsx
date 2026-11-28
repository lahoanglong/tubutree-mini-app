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
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname, useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ status: mocks.status }) }));
vi.mock('@/lib/route-map', async (orig) => ({ ...(await orig<object>()), isWebRouteReady: (p: string) => mocks.ready(p) }));
const offers = vi.hoisted(() => ({ dot: null as string | null, enabled: [] as boolean[], elsewhere: [] as (boolean | undefined)[] }));
vi.mock('@/lib/use-offers-dot', () => ({
  useOffersDot: (enabled: boolean, checkInElsewhere?: boolean) => {
    offers.enabled.push(enabled);
    offers.elsewhere.push(checkInElsewhere);
    return enabled ? offers.dot : null;
  },
}));
const reminders = vi.hoisted(() => ({ garden: false, profile: false, checkInElsewhere: false, args: [] as [boolean, number][] }));
vi.mock('@/lib/use-engagement-dots', () => ({
  useEngagementDots: (enabled: boolean, activeOrders: number) => {
    reminders.args.push([enabled, activeOrders]);
    return { garden: reminders.garden, profile: reminders.profile, checkInElsewhere: reminders.checkInElsewhere };
  },
}));
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
  offers.dot = null;
  offers.enabled = [];
  offers.elsewhere = [];
  reminders.garden = false;
  reminders.profile = false;
  reminders.checkInElsewhere = false;
  reminders.args = [];
});

describe('BottomNav (điện thoại)', () => {
  it('chỉ hiện dưới md và chừa safe-area đáy', () => {
    const out = render('/');
    expect(out).toContain('md:hidden');
    expect(out).toContain('env(safe-area-inset-bottom');
    expect(out).toContain('data-bottom-nav');
  });

  it('khoảng chừa cuối trang bằng thanh 60px + phần nút giữa nhô 22px (top-[-22px]) + safe-area: hết trang không có chữ nằm dưới nút', () => {
    const out = render('/');
    expect(out).toMatch(/data-testid="bottom-nav-spacer" style="height:calc\(60px \+ 22px \+ env\(safe-area-inset-bottom, 0px\)\)"/);
  });

  it('hiện ở 5 route gốc, kể cả route gốc chưa làm xong', () => {
    for (const p of ['/', '/san-pham', '/quet-ma', '/uu-dai', '/tai-khoan']) {
      expect(render(p), p).toContain('<nav');
    }
  });

  it('Vườn Xanh không là tab nhưng giữ thanh đáy (trang khám phá, UAT 28/11); màn chơi con thì ẩn', () => {
    expect(render('/vuon-xanh')).not.toBe('');
    expect(render('/vuon-xanh/choi')).toBe('');
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
    expect(out).not.toContain('href="/quet-ma"');
    expect(out).not.toContain('href="/uu-dai"');
  });

  it('đủ 5 mục đúng nhãn như Mini App khi mọi route đã xong; Quét mã là nút nổi giữa', () => {
    mocks.ready = () => true;
    const out = render('/');
    const labels = ['Trang chủ', 'Danh mục', 'Quét mã', 'Ưu đãi', 'Cá nhân'];
    const positions = labels.map((l) => out.indexOf(`>${l}<`));
    expect(positions.every((i) => i > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(out).toContain('href="/quet-ma"');
    expect(out).not.toContain('href="/vuon-xanh"');
    expect(out).toMatch(/data-center="true"[^>]*href="\/quet-ma"|href="\/quet-ma"[^>]*data-center="true"/);
  });

  it('đánh dấu trang hiện tại bằng aria-current', () => {
    const out = render('/tai-khoan');
    expect(out.match(/aria-current="page"/g)).toHaveLength(1);
    expect(out).toMatch(/href="\/tai-khoan"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/tai-khoan"/);
  });

  it('badge đơn đang xử lý nằm ở tab Cá nhân: có số thì gắn vào nhãn truy cập, không có thì không hiện', () => {
    mocks.ready = () => true;
    mocks.count = 3;
    const out = render('/');
    expect(out).toContain('Cá nhân, 3 đơn đang xử lý');
    expect(out).not.toContain('Ưu đãi, 3');
    expect(out).toContain('>3<');
    mocks.count = 0;
    expect(render('/')).not.toContain('đơn đang xử lý');
    mocks.count = 120;
    expect(render('/')).toContain('>99+<');
  });

  it('badge hỏi /me/summary chỉ khi đã đăng nhập, cùng khoá với Cá nhân; đặt/huỷ đơn làm mới nó qua TubuQueryClient', async () => {
    mocks.ready = () => true;
    render('/');
    const opts = mocks.query.mock.calls[0]![0] as { queryKey: string[]; enabled: boolean; retry: boolean };
    expect(opts.queryKey).toEqual(['me-summary']);
    expect(opts.enabled).toBe(true);
    expect(opts.retry).toBe(false);
    mocks.status = 'anonymous';
    render('/');
    expect((mocks.query.mock.calls.at(-1)![0] as { enabled: boolean }).enabled).toBe(false);
  });

  it('không hỏi badge khi mục Cá nhân chưa hiện (route còn pending)', () => {
    mocks.ready = (p) => p !== '/tai-khoan';
    render('/');
    expect((mocks.query.mock.calls[0]![0] as { enabled: boolean }).enabled).toBe(false);
  });

  it('tab Ưu đãi có chấm đỏ khi việc cần làm; không có thì không chấm; chỉ hỏi khi tab hiện', () => {
    mocks.ready = () => true;
    offers.dot = 'checkin';
    const out = render('/');
    expect(out).toContain('Ưu đãi, có việc cần làm');
    expect(out).toContain('data-testid="offers-dot"');
    // W46: cùng chấm 8px với tab Cá nhân (lớp tubu-remind-dot), không còn chấm 10px vẽ tay.
    expect(out).toMatch(/data-testid="offers-dot"[^>]*class="tubu-remind-dot"/);
    expect(out).not.toContain('h-2.5 w-2.5');
    offers.dot = null;
    expect(render('/')).not.toContain('offers-dot');
    mocks.ready = (p) => p !== '/uu-dai';
    offers.enabled = [];
    render('/');
    expect(offers.enabled.at(-1)).toBe(false);
  });

  it('nhãn tab dùng cỡ chữ nhãn của token như Mini App (12px, text-label), không phải text-xs hay text-caption 13px; khoảng cách icon-nhãn 3px', () => {
    mocks.ready = () => true;
    const out = render('/');
    const labels = ['Trang chủ', 'Danh mục', 'Quét mã', 'Ưu đãi', 'Cá nhân'];
    for (const l of labels) expect(out, l).toContain(`<span class="text-label">${l}</span>`);
    expect(out).not.toContain('text-xs');
    expect(out).not.toContain('text-caption');
    expect(out.match(/gap-\[3px\]/g)).toHaveLength(5);
  });

  it('tab đang chọn không chỉ khác màu: icon tô 16% + nảy, nét 600; tab thường nét 500; mép trên là --elevation-nav (không viền)', () => {
    mocks.ready = () => true;
    const out = render('/uu-dai');
    const anchor = (label: string) => new RegExp(`<a[^>]*aria-label="${label}"[^>]*>[\\s\\S]*?</a>`).exec(out)![0];
    const active = anchor('Ưu đãi');
    expect(active).toContain('font-semibold');
    expect(active).toContain('tubu-tab-pop');
    expect(active).toContain('fill-opacity="0.16"');
    const idle = anchor('Trang chủ');
    expect(idle).toContain('font-medium');
    expect(idle).not.toContain('tubu-tab-pop');
    expect(idle).not.toContain('fill-opacity');
    expect(out).toContain('shadow-nav');
    expect(out).not.toContain('border-t');
  });

  it('tab giữa cùng đường chân chữ với các tab khác: xếp dọc giống các tab khác (căn giữa, cùng khoảng cách, chừa chỗ 24px cho nút nổi)', () => {
    mocks.ready = () => true;
    const out = render('/');
    const center = /<a[^>]*data-center="true"[^>]*class="([^"]*)"|<a[^>]*class="([^"]*)"[^>]*data-center="true"/.exec(out);
    const cls = (center?.[1] ?? center?.[2])!;
    expect(cls).toContain('justify-center');
    expect(cls).not.toContain('justify-end');
    expect(cls).not.toContain('pb-1.5');
    expect(cls).toContain('gap-[3px]');
    // Ô trống thay chỗ icon: thiếu nó thì nhãn nhảy lên khoảng 13,5px; co lại khi chữ phóng to thì nhãn lệch lên.
    expect(out).toMatch(/data-center="true"[^>]*>\s*<span aria-hidden="true" class="h-6 shrink-0"/);
  });

  it('globals.css ẩn thanh khi có sticky-action-bar', () => {
    const css = readFileSync(fileURLToPath(new URL('../app/globals.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/body\.has-sticky-bar\s+\[data-bottom-nav\]\s*\{[^}]*display:\s*none/);
  });

  it('chấm nhắc 8px, đứng yên, nghĩa ở aria-label; số đơn thắng chấm ở tab Cá nhân; chấm Vườn Xanh dời sang thẻ Trang chủ (W42) nên tab giữa không có chấm', () => {
    mocks.ready = () => true;
    reminders.garden = true;
    reminders.profile = true;
    let out = render('/');
    expect(out).not.toContain('garden-dot');
    expect(out).toMatch(/<a[^>]*aria-label="Quét mã"[^>]*data-center="true"|<a[^>]*data-center="true"[^>]*aria-label="Quét mã"/);
    expect(out).toMatch(/data-testid="profile-dot"[^>]*class="tubu-remind-dot"/);
    expect(out).not.toMatch(/animate-/);
    const rule = /\.tubu-remind-dot\s*\{([^}]*)\}/.exec(readFileSync(fileURLToPath(new URL('./mini/mini.css', import.meta.url)), 'utf8'))![1]!;
    expect(rule).toMatch(/width:\s*8px;[\s\S]*height:\s*8px;/);
    expect(rule).not.toMatch(/animation|transition/);
    expect(out).toContain('aria-label="Cá nhân, có thông báo chưa đọc"');
    expect(reminders.args.at(-1)).toEqual([true, 0]);
    mocks.count = 2;
    reminders.profile = false;
    out = render('/');
    expect(out).not.toContain('data-testid="profile-dot"');
    expect(reminders.args.at(-1)).toEqual([true, 2]);
    // W46: mỗi tab tối đa một dấu, kể cả khi hook nhắc còn bật lúc đã có số đơn.
    reminders.profile = true;
    out = render('/');
    expect(out).toContain('aria-label="Cá nhân, 2 đơn đang xử lý"');
    expect(out).not.toContain('data-testid="profile-dot"');
  });

  it('cờ tắt: không chấm nhắc, tab Ưu đãi giữ lý do điểm danh', () => {
    mocks.ready = () => true;
    const out = render('/');
    expect(out).not.toContain('garden-dot');
    expect(out).not.toContain('profile-dot');
  });

  it('lý do "chưa điểm danh" của chấm Ưu đãi chỉ nhường cho thẻ Vườn Xanh ở Trang chủ; tab gốc khác giữ lý do đó (W42)', () => {
    mocks.ready = () => true;
    reminders.checkInElsewhere = true;
    render('/');
    expect(offers.elsewhere.at(-1)).toBe(true);
    for (const p of ['/san-pham', '/quet-ma', '/uu-dai', '/tai-khoan']) {
      render(p);
      expect(offers.elsewhere.at(-1), p).toBe(false);
    }
  });
});
