// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { headingProblems, smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// Chép ý about.spec.tsx (Mini App): hotline/email từ cấu hình, FAQ admin hoặc bản dự phòng, nhóm lọc, accordion, xoá tài khoản
// có xác nhận, đăng xuất. Khác Mini App: chính sách là link sang /chinh-sach/<loai> (không sheet tóm tắt), liên hệ là tel:/mailto:,
// và trang công khai nên khối Xoá tài khoản/Đăng xuất chỉ hiện khi đã đăng nhập.

const mocks = vi.hoisted(() => ({
  auth: { status: 'authenticated' as string, initialized: true, sessionUnavailable: false, user: { id: 'u1' } as unknown, logout: vi.fn() },
  get: vi.fn(),
  post: vi.fn(),
  oaAvailable: false,
  openChat: vi.fn(),
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: mocks.post } }));
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
  const r = render(<AboutPage />);
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
  mocks.post.mockReset().mockResolvedValue({ message: 'Đã ghi nhận yêu cầu' });
  mocks.oaAvailable = false;
  mocks.openChat.mockReset().mockResolvedValue(undefined);
  setup();
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/gioi-thieu: trang công khai', () => {
  it('có tiêu đề riêng, mô tả, canonical và cho lập chỉ mục', () => {
    expect(metadata.title).toBe('Về Tubu Tree — Tubu Tree');
    expect(metadata.description).toEqual(expect.any(String));
    expect(metadata.alternates?.canonical).toBe('/gioi-thieu');
    expect(metadata.robots).toBeUndefined();
  });

  it('khách chưa đăng nhập vẫn xem được FAQ và liên hệ, không thấy Xoá tài khoản hay Đăng xuất', async () => {
    mocks.auth.status = 'idle';
    mocks.auth.user = null;
    const { container } = await mount();
    expect(container.textContent).toContain('Bao lâu thì nhận hàng?');
    expect(container.textContent).toContain('0984 606 774');
    expect(byText(container, 'button', 'Xóa tài khoản')).toBeNull();
    expect(byText(container, 'button', 'Đăng xuất')).toBeNull();
  });

  it('đúng một h1 "Về Tubu Tree", các khối là h2, không lỗi a11y', async () => {
    const { container } = await mount();
    expect(Array.from(container.querySelectorAll('h1')).map((h) => h.textContent)).toEqual(['Về Tubu Tree']);
    const h2 = Array.from(container.querySelectorAll('h2')).map((h) => h.textContent);
    expect(h2).toEqual(expect.arrayContaining(['Sống Xanh An Lành', 'Câu hỏi thường gặp', 'Hỗ trợ khách hàng', 'Điều khoản & Chính sách']));
    expect(headingProblems(container)).toEqual([]);
    expect(unnamedControls(container)).toEqual([]);
    expect(smallTouchTargets(container)).toEqual([]);
  });
});

describe('/gioi-thieu: câu hỏi thường gặp', () => {
  it('FAQ lấy từ GET /faqs, nhóm lọc theo danh mục admin', async () => {
    const { container } = await mount();
    expect(mocks.get).toHaveBeenCalledWith('/faqs');
    expect(container.textContent).toContain('Bao lâu thì nhận hàng?');
    expect(button(container, 'Đổi trả')).toBeTruthy();
    expect(container.textContent).not.toContain('Tubu Tree bán những gì?');
  });

  it('admin chưa nhập FAQ: dùng bản dự phòng, câu thanh toán không còn ZaloPay', async () => {
    setup({ faqs: [] });
    const { container } = await mount();
    expect(container.textContent).toContain('Tubu Tree bán những gì?');
    expect(container.textContent).not.toMatch(/ZaloPay/);
  });

  it('GET /faqs lỗi: cũng dùng bản dự phòng', async () => {
    setup({ faqs: new Error('429') });
    const { container } = await mount();
    expect(container.textContent).toContain('Tubu Tree bán những gì?');
  });

  it('FAQ dự phòng nói đúng số trong cấu hình admin đặt', async () => {
    setup({
      faqs: [],
      config: { support: SUPPORT, returnWindowDays: 14, loyalty: { earnPct: 3, vndPerPointRedeem: 1_000, maxRedeemPct: 0.3, pointExpireMonths: 6 } },
    });
    const { container } = await mount();
    click(button(container, /Điểm Xanh là gì/));
    expect(container.textContent).toContain('Mỗi đơn đã giao tích 3% tiền hàng thành Điểm Xanh.');
    click(button(container, /đổi\/trả thế nào/));
    expect(container.textContent).toContain('trong vòng 14 ngày từ khi nhận');
  });

  it('đang tải FAQ: chưa hiện bản dự phòng (tránh nháy sang nội dung khác)', async () => {
    mocks.get.mockImplementation((path: string) => (path === '/faqs' ? new Promise(() => {}) : Promise.resolve({ support: SUPPORT })));
    const { container } = await mount();
    expect(container.textContent).not.toContain('Tubu Tree bán những gì?');
    expect(container.querySelector('[data-skeleton]')).not.toBeNull();
    expect(Array.from(container.querySelectorAll('h2')).map((h) => h.textContent)).toContain('Câu hỏi thường gặp');
  });

  it('câu hỏi là nút aria-expanded: câu đầu mở sẵn, mở câu khác thì câu cũ gập', async () => {
    const { container } = await mount();
    const q1 = button(container, /Bao lâu thì nhận hàng\?/);
    const q2 = button(container, /Phí ship bao nhiêu\?/);
    expect(q1.getAttribute('aria-expanded')).toBe('true');
    expect(q2.getAttribute('aria-expanded')).toBe('false');
    expect(container.textContent).toContain('2-4 ngày.');
    expect(container.textContent).not.toContain('Miễn phí từ 200k.');
    click(q2);
    expect(q2.getAttribute('aria-expanded')).toBe('true');
    expect(q1.getAttribute('aria-expanded')).toBe('false');
    expect(container.textContent).toContain('Miễn phí từ 200k.');
    click(q2);
    expect(q2.getAttribute('aria-expanded')).toBe('false');
  });

  it('chọn nhóm lọc: chỉ còn câu hỏi của nhóm và gập hết câu đang mở', async () => {
    const { container } = await mount();
    const chip = button(container, 'Đổi trả');
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    click(chip);
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(container.textContent).not.toContain('Bao lâu thì nhận hàng?');
    expect(button(container, /Đổi hàng thế nào\?/).getAttribute('aria-expanded')).toBe('false');
    click(button(container, 'Tất cả'));
    expect(container.textContent).toContain('Bao lâu thì nhận hàng?');
  });
});

describe('/gioi-thieu: liên hệ hỗ trợ', () => {
  it('hotline là link tel: bỏ khoảng trắng, email là mailto:, không còn số mẫu 1900 1234', async () => {
    const { container } = await mount();
    const tel = container.querySelector<HTMLAnchorElement>('a[href^="tel:"]')!;
    expect(tel.getAttribute('href')).toBe('tel:0984606774');
    expect(tel.textContent).toBe('0984 606 774');
    expect(container.querySelector('a[href="mailto:tubutree@gmail.com"]')).not.toBeNull();
    expect(container.textContent).not.toMatch(/1900 1234|hotro@tubutree\.com/);
    expect(container.textContent).not.toContain('Zalo OA');
  });

  it('có tên Zalo OA thì hiện dòng Zalo OA; có OA cấu hình thì có nút nhắn OA', async () => {
    mocks.oaAvailable = true;
    setup({ config: { support: { ...SUPPORT, zaloOaName: 'Tubu Tree OA' } } });
    const { container } = await mount();
    expect(container.textContent).toContain('Zalo OA');
    expect(container.textContent).toContain('Tubu Tree OA');
    click(button(container, 'Nhắn Zalo OA'));
    expect(mocks.openChat).toHaveBeenCalledTimes(1);
  });

  it('chỉ có email thì chỉ hiện dòng Email', async () => {
    setup({ config: { support: { hotline: '   ', email: 'a@b.vn', zaloOaName: null } } });
    const { container } = await mount();
    expect(container.querySelector('a[href^="tel:"]')).toBeNull();
    expect(container.textContent).toContain('a@b.vn');
  });

  it('admin để trống hết liên hệ: ẩn cả khối Hỗ trợ', async () => {
    setup({ config: { support: { hotline: null, email: null, zaloOaName: null } } });
    const { container } = await mount();
    expect(Array.from(container.querySelectorAll('h2')).map((h) => h.textContent)).not.toContain('Hỗ trợ khách hàng');
  });

  it('/config/public lỗi: vẫn có hotline và email mặc định', async () => {
    setup({ config: new Error('429') });
    const { container } = await mount();
    expect(container.textContent).toContain('0984 606 774');
    expect(container.textContent).toContain('tubutree@gmail.com');
  });
});

describe('/gioi-thieu: chính sách', () => {
  it('bốn dòng chính sách là link sang trang chính sách đầy đủ', async () => {
    const { container } = await mount();
    const hrefs = Array.from(container.querySelectorAll<HTMLAnchorElement>('a[href^="/chinh-sach/"]')).map((a) => [a.textContent, a.getAttribute('href')]);
    expect(hrefs).toEqual([
      ['Điều khoản sử dụng', '/chinh-sach/dieu-khoan'],
      ['Chính sách bảo mật', '/chinh-sach/bao-mat'],
      ['Chính sách đổi trả', '/chinh-sach/doi-tra'],
      ['Chính sách vận chuyển', '/chinh-sach/van-chuyen'],
    ]);
  });
});

describe('/gioi-thieu: tài khoản', () => {
  it('Xóa tài khoản: bấm, hỏi lại, "Gửi yêu cầu xóa" gọi API đúng một lần; "Hủy" quay về', async () => {
    const { container } = await mount();
    click(button(container, 'Xóa tài khoản'));
    expect(container.textContent).toContain('Xóa tài khoản vĩnh viễn?');
    click(button(container, 'Hủy'));
    expect(container.textContent).not.toContain('Xóa tài khoản vĩnh viễn?');
    expect(mocks.post).not.toHaveBeenCalled();

    click(button(container, 'Xóa tài khoản'));
    click(button(container, 'Gửi yêu cầu xóa'));
    await flush();
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post.mock.calls[0]![0]).toBe('/me/deletion-request');
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Đã ghi nhận yêu cầu');
    expect(byText(container, 'button', 'Gửi yêu cầu xóa')).toBeNull();
  });

  it('gửi yêu cầu lỗi: báo lỗi và cho gửi lại', async () => {
    mocks.post.mockRejectedValueOnce(new Error('Máy chủ bận'));
    const { container } = await mount();
    click(button(container, 'Xóa tài khoản'));
    click(button(container, 'Gửi yêu cầu xóa'));
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Máy chủ bận');
    click(button(container, 'Gửi yêu cầu xóa'));
    await flush();
    expect(mocks.post).toHaveBeenCalledTimes(2);
  });

  it('có OA cấu hình: sau khi gửi yêu cầu có nút nhắn Zalo OA để trao đổi trực tiếp', async () => {
    mocks.oaAvailable = true;
    const { container } = await mount();
    click(button(container, 'Xóa tài khoản'));
    click(button(container, 'Gửi yêu cầu xóa'));
    await flush();
    click(button(container, 'Nhắn Zalo OA về việc xóa tài khoản'));
    expect(mocks.openChat).toHaveBeenCalledWith('Tôi muốn xoá tài khoản Tubu Tree');
  });

  it('nút Đăng xuất gọi logout', async () => {
    const { container } = await mount();
    click(button(container, 'Đăng xuất'));
    expect(mocks.auth.logout).toHaveBeenCalledTimes(1);
  });
});
