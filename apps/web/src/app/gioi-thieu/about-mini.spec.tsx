// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { headingProblems, smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// mv-order: giới thiệu giống Mini App ở điện thoại. Gốc: chép ý about.spec.tsx (Mini App): hotline/email từ cấu hình, FAQ admin hoặc bản dự phòng, nhóm lọc, accordion, xoá tài khoản
// có xác nhận, đăng xuất. Khác Mini App: chính sách là link sang /chinh-sach/<loai> (không sheet tóm tắt), liên hệ là tel:/mailto:,
// và trang công khai nên khối Xoá tài khoản/Đăng xuất chỉ hiện khi đã đăng nhập.

const mocks = vi.hoisted(() => ({
  auth: { status: 'authenticated' as string, initialized: true, sessionUnavailable: false, user: { id: 'u1' } as unknown, logout: vi.fn() },
  get: vi.fn(),
  serverGet: vi.fn(),
  post: vi.fn(),
  oaAvailable: false,
  openChat: vi.fn(),
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: mocks.post } }));
vi.mock('@/lib/core-http-server', () => ({ createServerHttp: () => ({ get: mocks.serverGet }) }));
vi.mock('@/lib/platform-bridge', () => ({
  platformBridge: {
    oa: {
      get available() {
        return mocks.oaAvailable;
      },
      openChat: mocks.openChat,
    },
  },
}));

import AboutPage, { metadata } from './page';

const SUPPORT = { hotline: '0984 606 774', email: 'tubutree@gmail.com', zaloOaName: null as string | null };
const FAQS = [
  { id: 'f1', category: 'Vận chuyển', question: 'Bao lâu thì nhận hàng?', answer: '2-4 ngày.' },
  { id: 'f2', category: 'Vận chuyển', question: 'Phí ship bao nhiêu?', answer: 'Miễn phí từ 200k.' },
  { id: 'f3', category: 'Đổi trả', question: 'Đổi hàng thế nào?', answer: 'Trong 7 ngày.' },
];

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(await AboutPage());
  mounted.push(r);
  await flush(6);
  return r;
};
const button = (c: HTMLElement, name: string | RegExp) => byText(c, 'button', name)!;

type Setup = { faqs?: unknown; config?: unknown };
function setup({ faqs = FAQS, config = { support: SUPPORT } }: Setup = {}) {
  mocks.get.mockImplementation(async (path: string) => {
    if (path === '/faqs') {
      if (faqs instanceof Error) throw faqs;
      return faqs;
    }
    if (path === '/config/public') {
      if (config instanceof Error) throw config;
      return config;
    }
    throw new Error(`unexpected ${path}`);
  });
}

beforeEach(() => {
  mocks.auth.status = 'authenticated';
  mocks.auth.initialized = true;
  mocks.auth.sessionUnavailable = false;
  mocks.auth.logout.mockReset().mockResolvedValue(undefined);
  mocks.get.mockReset();
  mocks.serverGet.mockReset().mockRejectedValue(new Error('server down'));
  mocks.post.mockReset().mockResolvedValue({ message: 'Đã ghi nhận yêu cầu' });
  mocks.oaAvailable = false;
  mocks.openChat.mockReset().mockResolvedValue(undefined);
  setup();
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('giới thiệu như Mini App (điện thoại)', () => {
  it('hero chuyển màu xanh, tiêu đề nhỏ hơn; tiêu đề khối chữ không chân đậm', async () => {
    const { container } = await mount();
    const hero = container.querySelector('h2')!.closest('section')!;
    expect(hero.className).toContain('max-md:bg-[linear-gradient(');
    expect(container.querySelector('h2')!.className).toContain('max-md:text-[length:var(--type-title-md-size)]');
    const faqTitle = Array.from(container.querySelectorAll('h2')).find((h) => h.textContent === 'Câu hỏi thường gặp')!;
    expect(faqTitle.className).toContain('max-md:font-ui');
    expect(faqTitle.className).toContain('max-md:font-bold');
  });

  it('chip FAQ bo tròn hẳn, một hàng cuộn ngang; chưa chọn nền be, đang chọn nền xanh đậm', async () => {
    const { container } = await mount();
    const group = container.querySelector('[role="group"]')!;
    expect(group.className).toContain('max-md:flex-nowrap');
    const [all, ship] = Array.from(group.querySelectorAll('button'));
    expect(all!.className).toContain('max-md:rounded-full');
    expect(all!.className).toContain('max-md:bg-[var(--color-action-primary-bg)]');
    expect(ship!.className).toContain('max-md:bg-[var(--stone-100)]');
    expect(ship!.className).toContain('max-md:border-transparent');
  });

  it('email chữ đen đậm không gạch chân; hotline chữ xanh đậm; tên chính sách đậm; lưới một cột không tràn ngang', async () => {
    const { container } = await mount();
    const mail = container.querySelector<HTMLAnchorElement>('a[href^="mailto:"]')!;
    expect(mail.className).toContain('max-md:text-[color:var(--color-text-primary)]');
    expect(mail.className).toContain('max-md:font-semibold');
    const hot = container.querySelector<HTMLAnchorElement>('a[href^="tel:"]')!;
    expect(hot.className).toContain('max-md:text-[color:var(--color-text-brand)]');
    expect(container.querySelector('main > div.grid')!.className).toContain('max-md:grid-cols-[minmax(0,1fr)]');
    const policy = container.querySelector<HTMLAnchorElement>('a[href="/chinh-sach/dieu-khoan"]')!;
    expect(policy.className).toContain('max-md:font-semibold');
  });

  it('Đăng xuất là nút nền xanh nhạt; Xoá tài khoản chữ đỏ', async () => {
    const { container } = await mount();
    expect(button(container, 'Đăng xuất').className).toContain('max-md:bg-[var(--color-action-secondary-bg)]');
    expect(button(container, 'Xoá tài khoản').className).toContain('max-md:text-[color:var(--color-text-danger)]');
  });
});
