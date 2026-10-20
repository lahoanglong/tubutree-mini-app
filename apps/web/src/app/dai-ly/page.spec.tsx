// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { headingProblems, smallTouchTargets, unlabeledFields, unnamedControls } from '@/test-utils/a11y';

// Mini App dealer.spec.tsx: trạng thái (đăng ký / chờ duyệt / hub), 4 tab, đặt trước vượt tồn, nhãn -X% thật, mẫu đơn,
// dán đơn, Trả trước → trang chuyển khoản, hạn mức, đơn, công nợ (Báo đã CK có Idempotency-Key), báo cáo quý, thưởng.

type Call = { method: string; path: string; body?: unknown; headers?: Record<string, string> };

const m = vi.hoisted(() => ({
  phase: 'authenticated' as string,
  search: new URLSearchParams(),
  replace: vi.fn(),
  push: vi.fn(),
  calls: [] as Call[],
  data: {} as Record<string, unknown>,
  fail: new Set<string>(),
  hold: new Set<string>(),
  release: [] as (() => void)[],
  post: {} as Record<string, () => unknown>,
  config: { isLoaded: true, dealer: { maxDiscountPct: 0.45, reviewHours: 24 } } as Record<string, unknown>,
}));

vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => m.phase }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn(), user: { role: 'DEALER' } }) }));
vi.mock('@/components/evidence-upload', () => ({
  EvidenceUpload: ({ label, value, onChange }: { label: string; value: string[]; onChange: (v: string[]) => void }) => (
    <button type="button" className="min-h-11" onClick={() => onChange(['data:image/jpeg;base64,AAAA'])}>
      {value.length ? `Đã chọn ${label}` : `Chọn ${label}`}
    </button>
  ),
}));
vi.mock('@/lib/use-public-config', () => ({ usePublicConfig: () => m.config }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: m.replace, push: m.push }),
  usePathname: () => '/dai-ly',
  useSearchParams: () => m.search,
}));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string) => {
      m.calls.push({ method: 'get', path });
      if (m.fail.has(path)) throw new Error('Máy chủ đang bận');
      if (m.hold.has(path)) await new Promise<void>((r) => m.release.push(r));
      if (!(path in m.data)) throw new Error(`chưa mock ${path}`);
      return m.data[path];
    },
    post: async (path: string, body?: unknown, opts?: { headers?: Record<string, string> }) => {
      m.calls.push({ method: 'post', path, body, headers: opts?.headers });
      const h = m.post[path];
      if (!h) throw new Error(`chưa mock POST ${path}`);
      return h();
    },
    delete: async (path: string) => {
      m.calls.push({ method: 'delete', path });
      return { ok: true };
    },
  },
}));

import DealerPage from './page';

const APPROVED = { isDealer: true, status: 'APPROVED', tier: { id: 't1', name: 'Bạc', creditLimit: 50_000_000 }, currentDebt: 1_000_000 };
const row = (over: Record<string, unknown> = {}) => ({
  variationId: 'v1', sku: 'POLANG-500', product: 'Nước rửa chén', brand: 'Pơ Lang', variation: '500ml',
  retailPrice: 100_000, dealerPrice: 80_000, discountPct: 20, stock: 5, ...over,
});

let mounted: Rendered[] = [];
const mount = async (search = '') => {
  m.search = new URLSearchParams(search);
  const r = render(<DealerPage />);
  mounted.push(r);
  await flush(8);
  return r.container;
};
const posts = (path: string) => m.calls.filter((c) => c.method === 'post' && c.path === path);
const button = (name: string | RegExp) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((b) => (typeof name === 'string' ? (b.getAttribute('aria-label') ?? b.textContent) === name : name.test(b.getAttribute('aria-label') ?? b.textContent ?? '')))!;
const plus = () => document.querySelector<HTMLButtonElement>('button[aria-label="Tăng số lượng"]')!;
const tab = (label: string) => Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]')).find((t) => t.textContent === label)!;
const setup = (over: Record<string, unknown> = {}) => {
  m.data = {
    '/dealer/me': APPROVED,
    '/dealer/pricelist': [row({ stock: 9 })],
    '/dealer/templates': [],
    '/dealer/orders': [],
    ...over,
  };
};

beforeEach(() => {
  m.phase = 'authenticated';
  m.calls = [];
  m.fail = new Set();
  m.hold = new Set();
  m.release = [];
  m.post = {};
  m.replace.mockClear();
  m.push.mockClear();
  m.config = { isLoaded: true, dealer: { maxDiscountPct: 0.45, reviewHours: 24 } };
  setup();
});
afterEach(() => {
  mounted.forEach((x) => x.unmount());
  mounted = [];
});

describe('/dai-ly — khách, phiên và trạng thái hồ sơ, luôn đúng một h1', () => {
  it('khách chưa đăng nhập: mời đăng nhập quay lại /dai-ly, không gọi API', async () => {
    m.phase = 'guest';
    const c = await mount();
    expect(c.querySelector<HTMLAnchorElement>('a[href^="/dang-nhap"]')?.getAttribute('href')).toContain(encodeURIComponent('/dai-ly'));
    expect(headingProblems(c)).toEqual([]);
    expect(m.calls).toEqual([]);
  });

  it('đang khôi phục phiên: Đang tải…; API không trả lời: báo mất kết nối chứ không mời đăng nhập', async () => {
    m.phase = 'loading';
    let c = await mount();
    expect(c.textContent).toContain('Đang tải…');
    expect(headingProblems(c)).toEqual([]);
    mounted.pop()!.unmount();
    m.phase = 'unavailable';
    c = await mount();
    expect(c.textContent).toContain('Không kết nối được với Tubu Tree');
    expect(c.querySelector('a[href^="/dang-nhap"]')).toBeNull();
  });

  it('lỗi tải hồ sơ: báo lỗi và Thử lại gọi lại API', async () => {
    m.fail.add('/dealer/me');
    const c = await mount();
    expect(c.textContent).toContain('Máy chủ đang bận');
    expect(headingProblems(c)).toEqual([]);
    m.fail.delete('/dealer/me');
    click(button('Thử lại'));
    await flush();
    expect(c.textContent).toContain('Kênh đại lý');
    expect(c.textContent).toContain('Bạc');
  });

  it('đang tải hồ sơ: khung chờ, vẫn một h1', async () => {
    m.hold.add('/dealer/me');
    const c = await mount();
    expect(headingProblems(c)).toEqual([]);
    expect(c.textContent).toContain('Kênh đại lý');
  });

  it('PENDING: màn chờ duyệt, số giờ theo cấu hình; không có số thì không hẹn giờ', async () => {
    setup({ '/dealer/me': { isDealer: false, status: 'PENDING', tier: null, currentDebt: 0 } });
    let c = await mount();
    expect(c.textContent).toContain('Hồ sơ đang được duyệt');
    expect(c.textContent).toContain('trong vòng 24 giờ');
    expect(headingProblems(c)).toEqual([]);
    mounted.pop()!.unmount();
    m.config = { isLoaded: false };
    c = await mount();
    expect(c.textContent).not.toMatch(/\d+ giờ/);
    expect(c.textContent).toContain('xét duyệt và liên hệ lại');
  });

  it('chưa là đại lý: form đăng ký, "Giá sỉ đến X%" theo cấu hình; chưa có số thì bỏ con số', async () => {
    setup({ '/dealer/me': { isDealer: false, status: 'NONE', tier: null, currentDebt: 0 } });
    let c = await mount();
    expect(c.textContent).toContain('Giá sỉ đến 45%');
    expect(headingProblems(c)).toEqual([]);
    mounted.pop()!.unmount();
    m.config = { isLoaded: true };
    c = await mount();
    expect(c.textContent).toContain('Giá sỉ ưu đãi');
    expect(c.textContent).not.toMatch(/\d+%/);
  });

  it('REJECTED: hiện lý do admin ghi để nộp lại đúng chỗ', async () => {
    setup({ '/dealer/me': { isDealer: false, status: 'REJECTED', tier: null, currentDebt: 0, rejectionReason: 'Ảnh CCCD mờ' } });
    const c = await mount();
    expect(c.textContent).toContain('Hồ sơ trước bị từ chối');
    expect(c.textContent).toContain('Lý do: Ảnh CCCD mờ');
  });

  it('đã duyệt (APPROVED hoặc isDealer): hub với bậc, công nợ, hạn mức; ?tab= chọn tab', async () => {
    let c = await mount();
    expect(c.textContent).toContain('Bạc');
    expect(c.textContent).toContain('1.000.000đ');
    expect(c.textContent).toContain('Hạn mức: 50.000.000đ');
    expect(headingProblems(c)).toEqual([]);
    expect(unnamedControls(c)).toEqual([]);
    expect(smallTouchTargets(c)).toEqual([]);
    expect(tab('Bảng giá').getAttribute('aria-selected')).toBe('true');
    expect(c.querySelectorAll('[role="tab"]')).toHaveLength(4);
    click(tab('Công nợ'));
    expect(m.replace).toHaveBeenCalledWith('/dai-ly?tab=credit', { scroll: false });
    mounted.pop()!.unmount();
    setup({ '/dealer/me': { ...APPROVED, status: 'NONE' }, '/dealer/credit-ledger': { balance: 0, entries: [] } });
    c = await mount('tab=credit');
    expect(tab('Công nợ').getAttribute('aria-selected')).toBe('true');
  });
});

describe('/dai-ly — đăng ký đại lý', () => {
  beforeEach(() => setup({ '/dealer/me': { isDealer: false, status: 'NONE', tier: null, currentDebt: 0 } }));

  const field = (c: HTMLElement, label: string) => {
    const l = Array.from(c.querySelectorAll('label')).find((x) => x.textContent === label)!;
    return document.getElementById(l.getAttribute('for')!) as HTMLInputElement;
  };
  const fillText = (c: HTMLElement) => {
    typeInto(field(c, 'Tên doanh nghiệp / cửa hàng *'), 'Cửa hàng An');
    typeInto(field(c, 'Người đại diện *'), 'Nguyễn An');
    typeInto(field(c, 'Số điện thoại *'), '0901234567');
    typeInto(field(c, 'Địa chỉ kinh doanh *'), '1 Lê Lợi');
  };

  it('nút gửi khoá tới khi đủ trường bắt buộc kể cả hai ảnh CCCD; gửi đúng body tới /dealer/apply', async () => {
    m.post['/dealer/apply'] = () => ({ ok: true });
    const c = await mount();
    expect(button('Gửi hồ sơ đăng ký').disabled).toBe(true);
    fillText(c);
    expect(button('Gửi hồ sơ đăng ký').disabled).toBe(true);
    click(button('Chọn Ảnh CCCD mặt trước *'));
    expect(button('Gửi hồ sơ đăng ký').disabled).toBe(true);
    click(button('Chọn Ảnh CCCD mặt sau *'));
    expect(button('Gửi hồ sơ đăng ký').disabled).toBe(false);
    expect(unlabeledFields(c)).toEqual([]);
    click(button('Gửi hồ sơ đăng ký'));
    await flush();
    expect(posts('/dealer/apply')[0]?.body).toEqual({
      businessName: 'Cửa hàng An', ownerName: 'Nguyễn An', phone: '0901234567', address: '1 Lê Lợi',
      cccdFrontUrl: 'data:image/jpeg;base64,AAAA', cccdBackUrl: 'data:image/jpeg;base64,AAAA',
    });
    expect(c.textContent).toContain('Đã gửi hồ sơ đăng ký đại lý!');
  });

  it('thêm mã số thuế thì gửi kèm; lỗi từ máy chủ hiện nguyên văn và cho gửi lại', async () => {
    m.post['/dealer/apply'] = () => {
      throw new Error('Số điện thoại đã đăng ký');
    };
    const c = await mount();
    fillText(c);
    typeInto(field(c, 'Mã số thuế'), '0312345678');
    click(button('Chọn Ảnh CCCD mặt trước *'));
    click(button('Chọn Ảnh CCCD mặt sau *'));
    click(button('Gửi hồ sơ đăng ký'));
    await flush();
    expect((posts('/dealer/apply')[0]?.body as { taxCode: string }).taxCode).toBe('0312345678');
    expect(c.querySelector('[role="alert"]')?.textContent).toBe('Số điện thoại đã đăng ký');
    expect(button('Gửi hồ sơ đăng ký').disabled).toBe(false);
  });
});

describe('/dai-ly — bảng giá, đặt trước hàng chưa về', () => {
  it('SP hết hàng: ghi rõ được đặt trước, nút + bấm được, dòng đặt trước hiện số lượng', async () => {
    setup({ '/dealer/pricelist': [row({ stock: 0 })] });
    const c = await mount();
    expect(c.textContent).toContain('Hết hàng — được đặt trước');
    expect(plus().getAttribute('aria-disabled')).toBe('false');
    click(plus());
    expect(c.textContent).toContain('Đặt trước 1, giao khi hàng về');
  });

  it('vượt tồn mới hiện số đặt trước, trong tồn thì không', async () => {
    setup({ '/dealer/pricelist': [row({ stock: 2 })] });
    const c = await mount();
    click(plus());
    click(plus());
    expect(c.textContent).not.toContain('Đặt trước');
    click(plus());
    expect(c.textContent).toContain('Đặt trước 1, giao khi hàng về');
    click(plus());
    expect(c.textContent).toContain('Đặt trước 2, giao khi hàng về');
  });

  it('thanh tổng nói thật: cả đơn giao khi đủ hàng, giữ giá hôm nay, trả trước vẫn thanh toán đủ', async () => {
    setup({ '/dealer/pricelist': [row({ stock: 0 })] });
    const c = await mount();
    click(plus());
    expect(c.textContent).toContain('1 mặt hàng đặt vượt tồn');
    expect(c.textContent).toContain('cả đơn sẽ giao khi đủ hàng');
    expect(c.textContent).toContain('giữ giá hôm nay');
    expect(c.textContent).toContain('Đơn trả trước vẫn thanh toán đủ');
    expect(unnamedControls(c)).toEqual([]);
    expect(smallTouchTargets(c)).toEqual([]);
  });

  it('nhãn -X% tính từ giá thật của dòng, không lấy mặc định của bậc', async () => {
    setup({
      '/dealer/pricelist': [
        row({ variationId: 'v1', sku: 'A', dealerPrice: 70_000, discountPct: 20 }),
        row({ variationId: 'v2', sku: 'B', dealerPrice: 100_000, discountPct: 20 }),
      ],
    });
    const c = await mount();
    const labels = Array.from(c.querySelectorAll('span')).map((s) => s.textContent ?? '').filter((t) => /^-\d+%$/.test(t));
    expect(labels).toEqual(['-30%']);
  });

  it('bảng giá lỗi: báo lỗi kèm Thử lại; rỗng sau lọc báo không tìm thấy', async () => {
    m.fail.add('/dealer/pricelist');
    let c = await mount();
    expect(c.textContent).toContain('Máy chủ đang bận');
    mounted.pop()!.unmount();
    m.fail = new Set();
    c = await mount();
    typeInto(c.querySelector('input[type="search"]'), 'khong-co-san-pham-nay');
    await new Promise((r) => setTimeout(r, 300));
    await flush();
    expect(c.textContent).toContain('Không tìm thấy sản phẩm');
    typeInto(c.querySelector('input[type="search"]'), 'polang');
    await new Promise((r) => setTimeout(r, 300));
    await flush();
    expect(c.textContent).toContain('POLANG-500');
  });

  it('tổng tiền tính theo giá sỉ của từng dòng', async () => {
    const c = await mount();
    for (let i = 0; i < 3; i++) click(plus());
    expect(c.textContent).toContain('240.000đ');
  });
});

describe('/dai-ly — đặt đơn (tiền: cùng endpoint, body, Idempotency-Key như Mini App)', () => {
  it('Ghi công nợ: POST /dealer/orders đúng body CREDIT và Idempotency-Key; thông báo thường khi đủ hàng', async () => {
    m.post['/dealer/orders'] = () => ({ code: 'TUBU2', items: [{ backorderedQty: 0, quantity: 1 }] });
    const c = await mount();
    click(plus());
    click(button('Ghi công nợ'));
    await flush();
    const [call] = posts('/dealer/orders');
    expect(call?.body).toEqual({ items: [{ variationId: 'v1', quantity: 1 }], paymentMethod: 'CREDIT', note: undefined });
    expect(call?.headers?.['Idempotency-Key']).toEqual(expect.any(String));
    expect(c.textContent).toContain('Đã tạo đơn đại lý!');
    expect(m.push).not.toHaveBeenCalled();
  });

  it('đơn có phần đặt trước: thông báo cả đơn giao khi đủ hàng', async () => {
    setup({ '/dealer/pricelist': [row({ stock: 0 })] });
    m.post['/dealer/orders'] = () => ({ code: 'TUBU1', items: [{ backorderedQty: 1, quantity: 1 }] });
    const c = await mount();
    click(plus());
    click(button('Ghi công nợ'));
    await flush();
    expect(c.textContent).toContain('Đã tạo đơn đại lý — đơn sẽ giao khi đủ hàng, giữ giá hôm nay.');
  });

  it('Trả trước: PREPAID rồi chuyển tới trang chuyển khoản của đơn', async () => {
    m.post['/dealer/orders'] = () => ({ code: 'TUBU3', status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', items: [] });
    await mount();
    click(plus());
    click(button('Trả trước'));
    await flush();
    expect((posts('/dealer/orders')[0]?.body as { paymentMethod: string }).paymentMethod).toBe('PREPAID');
    expect(m.push).toHaveBeenCalledWith('/thanh-toan/chuyen-khoan/TUBU3');
  });

  it('bấm hai lần cùng nhịp chỉ gửi một đơn', async () => {
    m.post['/dealer/orders'] = () => new Promise(() => undefined);
    await mount();
    click(plus());
    const btn = button('Ghi công nợ');
    click(btn);
    click(btn);
    await flush();
    expect(posts('/dealer/orders')).toHaveLength(1);
  });

  it('lỗi mạng rồi bấm lại giữ nguyên Idempotency-Key; đặt xong thì đơn sau dùng key mới', async () => {
    let n = 0;
    m.post['/dealer/orders'] = () => {
      n += 1;
      if (n === 1) throw new Error('Mất kết nối');
      return { code: `TUBU${n}`, items: [] };
    };
    const c = await mount();
    click(plus());
    click(button('Ghi công nợ'));
    await flush();
    expect(c.textContent).toContain('Mất kết nối');
    click(button('Ghi công nợ'));
    await flush();
    const keys = posts('/dealer/orders').map((p) => p.headers?.['Idempotency-Key']);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
    click(plus());
    click(button('Ghi công nợ'));
    await flush();
    const after = posts('/dealer/orders').map((p) => p.headers?.['Idempotency-Key']);
    expect(after[2]).not.toBe(keys[0]);
  });

  it('lỗi mạng rồi đổi phương thức cùng giỏ: giữ Idempotency-Key, máy chủ trả đơn công nợ cũ thì không chuyển trang', async () => {
    let n = 0;
    m.post['/dealer/orders'] = () => {
      n += 1;
      if (n === 1) throw new Error('Mất kết nối');
      return { code: 'TUBU2', status: 'CONFIRMED', paymentMethod: 'BANK_TRANSFER', items: [] };
    };
    await mount();
    click(plus());
    click(button('Ghi công nợ'));
    await flush();
    click(button('Trả trước'));
    await flush();
    const keys = posts('/dealer/orders').map((p) => p.headers?.['Idempotency-Key']);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(m.push).not.toHaveBeenCalled();
  });

  it('lỗi mạng rồi đổi giỏ: vẫn cùng Idempotency-Key, đơn cũ trả về khác giỏ thì không xoá giỏ, báo đơn đã tạo và không chuyển trang', async () => {
    let n = 0;
    m.post['/dealer/orders'] = () => {
      n += 1;
      if (n === 1) throw new Error('Mất kết nối');
      return { code: 'TUBU1', status: 'CONFIRMED', paymentMethod: 'CREDIT', items: [{ variationId: 'v1', quantity: 1 }] };
    };
    await mount();
    click(plus());
    click(button('Ghi công nợ'));
    await flush();
    click(plus());
    click(button('Ghi công nợ'));
    await flush();
    const keys = posts('/dealer/orders').map((p) => p.headers?.['Idempotency-Key']);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(document.body.textContent).toContain('Đơn TUBU1 đã được tạo ở lần đặt trước');
    expect(m.push).not.toHaveBeenCalled();
    click(button('Ghi công nợ'));
    await flush();
    const keys3 = posts('/dealer/orders').map((p) => p.headers?.['Idempotency-Key']);
    expect(keys3[2]).not.toBe(keys3[1]);
    expect(posts('/dealer/orders')[2]?.body).toMatchObject({ items: [{ variationId: 'v1', quantity: 2 }] });
  });

  it('Trả trước nhưng máy chủ trả đơn không chờ chuyển khoản (công nợ): không chuyển sang trang chuyển khoản', async () => {
    m.post['/dealer/orders'] = () => ({ code: 'TUBU7', status: 'CONFIRMED', paymentMethod: 'BANK_TRANSFER', items: [] });
    await mount();
    click(plus());
    click(button('Trả trước'));
    await flush();
    expect(m.push).not.toHaveBeenCalled();
  });

  it('thanh đặt hàng dính đáy dùng StickyActionBar: body có has-sticky-bar để chân trang không bị che', async () => {
    await mount();
    expect(document.body.classList.contains('has-sticky-bar')).toBe(false);
    click(plus());
    await flush();
    expect(document.body.classList.contains('has-sticky-bar')).toBe(true);
    expect(document.querySelector('[data-testid="sticky-bar"]')?.textContent).toContain('Ghi công nợ');
  });

  it('vượt hạn mức: chặn Ghi công nợ, vẫn cho Trả trước, cảnh báo bằng chữ', async () => {
    setup({ '/dealer/me': { ...APPROVED, tier: { id: 't1', name: 'Bạc', creditLimit: 1_000_000 }, currentDebt: 950_000 } });
    const c = await mount();
    click(plus());
    expect(c.textContent).toContain('Vượt hạn mức công nợ');
    expect(button('Ghi công nợ').disabled).toBe(true);
    expect(button('Trả trước').disabled).toBe(false);
  });
});

describe('/dai-ly — mẫu đơn và dán đơn', () => {
  it('chạm tên mẫu nạp lại số lượng; nút xoá gọi DELETE đúng id', async () => {
    setup({ '/dealer/templates': [{ id: 'tp1', name: 'Đơn tháng', items: [{ variationId: 'v1', quantity: 2 }] }] });
    const c = await mount();
    click(button(/Đơn tháng/));
    expect(c.textContent).toContain('160.000đ');
    const del = button('Xoá mẫu đơn');
    expect(del.tagName).toBe('BUTTON');
    click(del);
    await flush();
    expect(m.calls.some((x) => x.method === 'delete' && x.path === '/dealer/templates/tp1')).toBe(true);
  });

  it('Lưu mẫu gửi tên và các dòng có số lượng', async () => {
    m.post['/dealer/templates'] = () => ({ id: 'tp2', name: 'Đơn tuần', items: [], createdAt: '' });
    const c = await mount();
    click(plus());
    click(plus());
    click(button('Lưu mẫu'));
    await flush();
    typeInto(document.querySelector('input[aria-label="Tên mẫu"]'), 'Đơn tuần');
    click(Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find((b) => b.textContent === 'Lưu mẫu')!);
    await flush();
    expect(posts('/dealer/templates')[0]?.body).toEqual({ name: 'Đơn tuần', items: [{ variationId: 'v1', quantity: 2 }] });
    expect(c.textContent).toContain('Đã lưu mẫu đơn.');
  });

  it('dán đơn: khớp SKU thì cộng vào đơn, báo kết quả bằng chữ', async () => {
    const c = await mount();
    click(button('Dán đơn'));
    await flush();
    typeInto(document.querySelector('textarea'), 'POLANG-500 3\nSAI-SKU 1');
    click(button('Thêm vào đơn'));
    await flush();
    const result = byText(document.body, '[role="status"]', 'Khớp 1 dòng');
    expect(result?.textContent).toContain('Không khớp: SAI-SKU');
    expect(c.textContent).toContain('240.000đ');
  });

  it('dán đơn bị chặn khi bảng giá chưa tải xong', async () => {
    m.hold.add('/dealer/pricelist');
    await mount();
    click(button('Dán đơn'));
    await flush();
    typeInto(document.querySelector('textarea'), 'POLANG-500 3');
    expect(button('Thêm vào đơn').disabled).toBe(true);
    expect(document.body.textContent).toContain('Đang tải bảng giá');
  });
});

describe('/dai-ly — đơn hàng, công nợ, báo cáo', () => {
  // Tab nằm ở ?tab= (router.replace bị mock nên không tự đổi URL): mở thẳng bằng tham số.
  const TAB_KEY: Record<string, string> = { 'Đơn hàng': 'orders', 'Công nợ': 'credit', 'Báo cáo': 'report' };
  const open = async (label: string) => {
    await mount(`tab=${TAB_KEY[label]}`);
  };

  it('thẻ đơn là liên kết tới chi tiết đơn, giữ nhãn chờ hàng và Thanh toán ngay', async () => {
    setup({
      '/dealer/orders': [
        { code: 'TUBU9', status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', total: 500_000, createdAt: '2026-09-01T00:00:00.000Z', items: [{ backorderedQty: 2 }, { backorderedQty: 0 }] },
      ],
    });
    await open('Đơn hàng');
    const card = document.querySelector<HTMLAnchorElement>('a[aria-label="Xem đơn TUBU9"]')!;
    expect(card.getAttribute('href')).toBe('/tai-khoan/don-hang/TUBU9');
    expect(card.textContent).toContain('Đặt trước 2 — chờ hàng về');
    expect(card.textContent).toContain('Thanh toán ngay →');
    expect(card.textContent).toContain('500.000đ');
    expect(card.textContent).toContain('Chờ thanh toán');
  });

  it('chưa có đơn: trạng thái rỗng; lỗi: báo lỗi', async () => {
    await open('Đơn hàng');
    expect(document.body.textContent).toContain('Chưa có đơn đại lý nào');
    mounted.pop()!.unmount();
    m.fail.add('/dealer/orders');
    await open('Đơn hàng');
    expect(document.body.textContent).toContain('Máy chủ đang bận');
  });

  it('công nợ: Báo đã CK gửi đúng số tiền, ghi chú và Idempotency-Key; chặn số vượt dư nợ; sổ rỗng có trạng thái rỗng', async () => {
    setup({ '/dealer/credit-ledger': { balance: 3_000_000, entries: [] } });
    m.post['/dealer/credit-payment'] = () => ({ ok: true });
    await open('Công nợ');
    expect(document.body.textContent).toContain('3.000.000đ');
    expect(document.body.textContent).toContain('Chưa có giao dịch công nợ');
    const amount = document.querySelector<HTMLInputElement>('input[aria-label="Số tiền đã chuyển"]')!;
    typeInto(amount, '4000000');
    expect(button('Báo đã CK').disabled).toBe(true);
    expect(document.body.textContent).toContain('Số tiền vượt dư nợ hiện tại (3.000.000đ).');
    typeInto(amount, '1000000');
    expect(button('Báo đã CK').disabled).toBe(false);
    click(button('Báo đã CK'));
    await flush();
    const [call] = posts('/dealer/credit-payment');
    expect(call?.body).toEqual({ amount: 1_000_000, note: 'Báo đã chuyển khoản' });
    expect(call?.headers?.['Idempotency-Key']).toEqual(expect.any(String));
    expect(document.body.textContent).toContain('chờ xác nhận đã nhận được tiền');
  });

  it('Báo đã CK: bấm lại sau lỗi giữ key, sau thành công đổi key', async () => {
    setup({ '/dealer/credit-ledger': { balance: 3_000_000, entries: [] } });
    let n = 0;
    m.post['/dealer/credit-payment'] = () => {
      n += 1;
      if (n === 1) throw new Error('Mất kết nối');
      return { ok: true };
    };
    await open('Công nợ');
    typeInto(document.querySelector('input[aria-label="Số tiền đã chuyển"]'), '1000000');
    click(button('Báo đã CK'));
    await flush();
    click(button('Báo đã CK'));
    await flush();
    typeInto(document.querySelector('input[aria-label="Số tiền đã chuyển"]'), '500000');
    click(button('Báo đã CK'));
    await flush();
    const keys = posts('/dealer/credit-payment').map((p) => p.headers?.['Idempotency-Key']);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it('sổ công nợ giữ dấu +/- của từng dòng', async () => {
    setup({
      '/dealer/credit-ledger': {
        balance: 200_000,
        entries: [
          { id: 'e1', delta: 500_000, note: 'Đơn TUBU1', refType: 'ORDER', createdAt: '2026-09-01T00:00:00.000Z' },
          { id: 'e2', delta: -300_000, note: null, refType: 'PAYMENT', createdAt: '2026-09-02T00:00:00.000Z' },
        ],
      },
    });
    await open('Công nợ');
    expect(document.body.textContent).toContain('+500.000đ');
    expect(document.body.textContent).toContain('-300.000đ');
    expect(document.body.textContent).toContain('PAYMENT');
  });

  const REPORT = {
    quarter: 'Q3/2026', periodStart: '', periodEnd: '', revenue: 120_000_000, orderCount: 14, pendingRevenue: 5_000_000, pendingOrderCount: 1,
    bonusPct: 2, bonusAmount: 2_400_000, nextTier: { min: 200_000_000, pct: 3, toNext: 80_000_000 }, tiers: [{ min: 100_000_000, pct: 2 }, { min: 200_000_000, pct: 3 }],
  };
  const reward = (over: Record<string, unknown> = {}) => ({
    id: 'rw1', type: 'TOUR', title: 'Tour Đà Nẵng', description: null, threshold: 100_000_000, period: 'QUARTER', periodKey: 'Q3/2026',
    periodLabel: 'Quý 3/2026', isCurrentPeriod: true, volume: 120_000_000, pendingVolume: 0, achieved: true, toGo: 0, claimStatus: null, claimId: null,
    rejectionReason: null, claimDeadline: '2026-10-30T17:00:00.000Z', canClaim: true, ...over,
  });

  it('báo cáo quý: số liệu doanh số, thưởng, bậc và phần thưởng; không ký tự ✓ trong chữ', async () => {
    setup({ '/dealer/quarterly-report': REPORT, '/dealer/rewards': { claimGraceDays: 30, rewards: [reward()] } });
    await open('Báo cáo');
    const t = document.body.textContent ?? '';
    expect(t).toContain('Doanh số Q3/2026');
    expect(t).toContain('120.000.000đ');
    expect(t).toContain('14 đơn đã chốt');
    expect(t).toContain('2.400.000đ');
    expect(t).toContain('Còn 80.000.000đ để đạt thưởng 3%');
    expect(t).toContain('Từ 100.000.000đ');
    expect(t).toContain('thưởng 2%');
    expect(t).toContain('chờ thanh toán/đóng gói — chưa tính thưởng');
    expect(t).toContain('Phần thưởng đại lý');
    expect(t).not.toContain('✓');
    expect(button('Yêu cầu nhận thưởng')).toBeTruthy();
  });

  it('báo cáo lỗi: báo lỗi kèm Thử lại', async () => {
    setup({ '/dealer/rewards': { claimGraceDays: 30, rewards: [] } });
    m.fail.add('/dealer/quarterly-report');
    await open('Báo cáo');
    expect(document.body.textContent).toContain('Máy chủ đang bận');
    expect(button('Thử lại')).toBeTruthy();
  });

  it('yêu cầu nhận thưởng: POST đúng rewardId và periodKey, dòng chuyển sang chờ duyệt, nút biến mất', async () => {
    setup({ '/dealer/quarterly-report': REPORT, '/dealer/rewards': { claimGraceDays: 30, rewards: [reward()] } });
    m.post['/dealer/rewards/rw1/claim'] = () => ({
      success: true, alreadyClaimed: false, claimStatus: 'PENDING', message: 'Đã ghi nhận yêu cầu nhận thưởng.',
      claim: { id: 'c1', status: 'PENDING', periodKey: 'Q3/2026', volumeAtClaim: 1, createdAt: '' },
    });
    await open('Báo cáo');
    m.data['/dealer/rewards'] = { claimGraceDays: 30, rewards: [reward({ claimStatus: 'PENDING', claimId: 'c1', canClaim: false })] };
    click(button('Yêu cầu nhận thưởng'));
    await flush();
    expect(posts('/dealer/rewards/rw1/claim')[0]?.body).toEqual({ periodKey: 'Q3/2026', note: undefined });
    expect(document.body.textContent).toContain('Đã ghi nhận yêu cầu nhận thưởng.');
    expect(document.body.textContent).toContain('Đã gửi yêu cầu · chờ duyệt');
    expect(button('Yêu cầu nhận thưởng')).toBeUndefined();
  });

  it('thưởng đã bị từ chối: nêu lý do, không hiện lại nút', async () => {
    setup({
      '/dealer/quarterly-report': REPORT,
      '/dealer/rewards': { claimGraceDays: 30, rewards: [reward({ claimStatus: 'REJECTED', canClaim: false, rejectionReason: 'Sai số liệu' })] },
    });
    await open('Báo cáo');
    expect(document.body.textContent).toContain('Lý do: Sai số liệu');
    expect(button('Yêu cầu nhận thưởng')).toBeUndefined();
  });
});

describe('/dai-ly — diện mạo Mini App ở điện thoại (theme B2B navy)', () => {
  it('nền xanh xám, thẻ tổng quan navy, nút Dán đơn kiểu secondary, giá đại lý màu navy', async () => {
    const c = await mount();
    const main = c.querySelector('main')!;
    expect(main.className).toContain('max-md:bg-[var(--color-dealer-bg)]');
    expect(main.hasAttribute('data-dealer-theme')).toBe(true);
    const css = readFileSync(resolve(process.cwd(), 'src/components/dealer/dealer-theme.css'), 'utf8');
    expect(css).toContain('--color-dealer-ink: #1f2a44;');
    expect(css).toContain('--color-dealer-bg: #f4f6f9;');
    expect(c.querySelector('section[aria-label="Tổng quan đại lý"]')!.className).toContain('max-md:bg-[var(--color-dealer-ink)]');
    expect(button('Dán đơn').className).toContain('max-md:bg-[var(--color-action-secondary-bg)]');
    expect(c.querySelector('li .font-bold')!.className).toContain('max-md:text-[var(--color-dealer-ink)]');
    expect(c.querySelector('h1')!.parentElement!.className).toContain('max-md:pl-12');
  });
});

describe('/dai-ly — biến màu navy nhìn thấy được từ sheet (portal ra body)', () => {
  it('dealer-theme.css khai báo biến ở :root vì Sheet render ngoài khung data-dealer-theme', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/components/dealer/dealer-theme.css'), 'utf8');
    expect(css).toMatch(/^:root\s*\{/m);
    expect(css).not.toMatch(/^\[data-dealer-theme\]\s*\{/m);
  });
  it('nút Lưu mẫu và Thêm vào đơn có màu dự phòng khi biến không phân giải', async () => {
    await mount();
    click(plus());
    click(button('Lưu mẫu'));
    await flush();
    const save = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find((b) => b.textContent === 'Lưu mẫu')!;
    expect(save.className).toContain('var(--color-dealer-ink,');
  });
});

describe('/dai-ly — chữ navy còn lại ở điện thoại', () => {
  it('tổng giỏ, mẫu đơn đã lưu, tổng đơn ở tab Đơn hàng', async () => {
    setup({
      '/dealer/templates': [{ id: 'tp1', name: 'Đơn tháng', items: [{ variationId: 'v1', quantity: 2 }] }],
      '/dealer/orders': [
        { code: 'TUBU9', status: 'CONFIRMED', paymentMethod: 'BANK_TRANSFER', total: 500_000, createdAt: '2026-09-01T00:00:00.000Z', items: [] },
      ],
    });
    const c = await mount();
    const INK_TEXT = 'max-md:text-[var(--color-dealer-ink)]';
    click(button(/Đơn tháng/));
    expect(Array.from(c.querySelectorAll('span.font-bold')).find((e) => e.textContent?.includes('160.000đ'))!.className).toContain(INK_TEXT);
    const pill = c.querySelector('ul[aria-label="Mẫu đơn đã lưu"] li')!;
    expect(pill.className).toContain('max-md:border-[color:var(--color-dealer-ink)]');
    expect(button(/Đơn tháng/).className).toContain(INK_TEXT);
    mounted.pop()!.unmount();
    await mount('tab=orders');
    const total = Array.from(document.querySelectorAll('a[aria-label="Xem đơn TUBU9"] span.font-bold'))[0]!;
    expect(total.className).toContain(INK_TEXT);
  });
});

describe('/dai-ly — nút chính navy ở điện thoại như inkButton của Mini App', () => {
  const INK = 'max-md:enabled:bg-[var(--color-dealer-ink,';

  it('Ghi công nợ, Lưu mẫu, Thêm vào đơn (dán đơn) đều navy', async () => {
    await mount();
    click(plus());
    expect(button('Ghi công nợ').className).toContain(INK);
    click(button('Lưu mẫu'));
    await flush();
    expect(Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find((b) => b.textContent === 'Lưu mẫu')!.className).toContain(INK);
    document.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="Đóng"]')?.click();
    click(button('Dán đơn'));
    await flush();
    expect(button('Thêm vào đơn').className).toContain(INK);
  });

  it('Gửi hồ sơ đăng ký navy', async () => {
    setup({ '/dealer/me': { isDealer: false, status: 'NONE', tier: null, currentDebt: 0 } });
    await mount();
    expect(button('Gửi hồ sơ đăng ký').className).toContain(INK);
  });

  it('Báo đã CK navy', async () => {
    setup({ '/dealer/credit-ledger': { balance: 3_000_000, entries: [] } });
    await mount('tab=credit');
    expect(button('Báo đã CK').className).toContain(INK);
  });

  it('Báo cáo: thẻ doanh số quý gradient navy, thưởng và thanh tiến độ dùng màu nhấn đại lý, Yêu cầu nhận thưởng navy', async () => {
    setup({
      '/dealer/quarterly-report': {
        quarter: 'Q3/2026', periodStart: '', periodEnd: '', revenue: 120_000_000, orderCount: 14, pendingRevenue: 0, pendingOrderCount: 0,
        bonusPct: 2, bonusAmount: 2_400_000, nextTier: { min: 200_000_000, pct: 3, toNext: 80_000_000 }, tiers: [{ min: 100_000_000, pct: 2 }],
      },
      '/dealer/rewards': {
        claimGraceDays: 30,
        rewards: [{
          id: 'rw1', type: 'TOUR', title: 'Tour', description: null, threshold: 1, period: 'QUARTER', periodKey: 'Q3/2026', periodLabel: 'Quý 3/2026',
          isCurrentPeriod: true, volume: 1, pendingVolume: 0, achieved: true, toGo: 0, claimStatus: null, claimId: null, rejectionReason: null,
          claimDeadline: '2026-10-30T17:00:00.000Z', canClaim: true,
        }],
      },
    });
    await mount('tab=report');
    const hero = document.querySelector('section[aria-label="Doanh số Q3/2026"]')!;
    expect(hero.className).toContain('max-md:from-[var(--color-dealer-ink)]');
    expect(hero.className).toContain('max-md:to-[var(--color-dealer-ink-soft)]');
    expect(hero.querySelector('b')!.className).toContain('max-md:text-[var(--color-dealer-accent)]');
    expect(hero.querySelector('[role="progressbar"] > div')!.className).toContain('max-md:bg-[var(--color-dealer-accent)]');
    expect(button('Yêu cầu nhận thưởng').className).toContain(INK);
    const css = readFileSync(resolve(process.cwd(), 'src/components/dealer/dealer-theme.css'), 'utf8');
    expect(css).toContain('--color-dealer-ink-soft: #2e3b5e;');
    expect(css).toContain('--color-dealer-accent: var(--forest-300);');
  });
});

describe('/dai-ly — báo trước phí giao và mức tối thiểu của đơn sỉ (bc5e4c5b, 269aec88)', () => {
  const RULES = { minOrderValue: 3_000_000, freeShipThreshold: 5_000_000, shippingFee: 19_000 };
  const meWith = (over: Record<string, unknown> = {}) => ({ ...APPROVED, currentDebt: 0, orderRules: RULES, ...over });
  const priced = (dealerPrice: number, me = meWith()) =>
    setup({ '/dealer/me': me, '/dealer/pricelist': [row({ dealerPrice, retailPrice: dealerPrice * 2, stock: 9 })] });
  const buttons = (name: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).filter((b) => b.textContent === name || b.textContent === 'Đang đặt...');

  it('giỏ 4.000.000đ: hiện phí giao 19.000đ, tổng 4.019.000đ và nút đặt bật', async () => {
    priced(4_000_000);
    const c = await mount();
    click(plus());
    expect(c.textContent).toContain('4.019.000đ');
    expect(c.textContent).toContain('Tiền hàng 4.000.000đ + Phí giao 19.000đ (miễn phí từ 5.000.000đ)');
    expect(button('Ghi công nợ').disabled).toBe(false);
  });

  it('giỏ 5.000.000đ: miễn phí giao, tổng bằng tiền hàng', async () => {
    priced(5_000_000);
    const c = await mount();
    click(plus());
    expect(c.textContent).toContain('Miễn phí giao (đơn từ 5.000.000đ)');
    expect(c.textContent).not.toContain('Phí giao 19.000đ');
    expect(c.textContent).not.toContain('5.019.000đ');
  });

  it('giỏ 2.999.999đ: tắt cả hai nút đặt, ghi mức tối thiểu, bấm không gửi đơn', async () => {
    priced(2_999_999);
    const c = await mount();
    click(plus());
    expect(c.textContent).toContain('Đơn tối thiểu 3.000.000đ tiền hàng — thêm 1đ nữa để đặt.');
    expect(c.textContent).not.toContain('Phí giao');
    for (const b of [...buttons('Ghi công nợ'), ...buttons('Trả trước')]) {
      expect(b.disabled).toBe(true);
      click(b);
    }
    await flush();
    expect(posts('/dealer/orders')).toHaveLength(0);
  });

  it('hạn mức tính cả phí giao: nợ + tiền hàng vừa hạn mức nhưng cộng phí thì vượt', async () => {
    priced(4_000_000, meWith({ tier: { id: 't1', name: 'Bạc', creditLimit: 10_000_000 }, currentDebt: 5_990_000 }));
    const c = await mount();
    click(plus());
    expect(c.textContent).toContain('Vượt hạn mức công nợ');
    expect(button('Ghi công nợ').disabled).toBe(true);
    expect(button('Trả trước').disabled).toBe(false);
  });

  it('nợ + tiền hàng + phí vừa đúng hạn mức: vẫn đặt được', async () => {
    priced(4_000_000, meWith({ tier: { id: 't1', name: 'Bạc', creditLimit: 10_000_000 }, currentDebt: 5_981_000 }));
    const c = await mount();
    click(plus());
    expect(c.textContent).not.toContain('Vượt hạn mức công nợ');
    expect(button('Ghi công nợ').disabled).toBe(false);
  });

  it('đặt đơn đủ mức tối thiểu: cùng endpoint, body và Idempotency-Key như trước, không kèm phí giao', async () => {
    priced(4_000_000);
    m.post['/dealer/orders'] = () => ({ code: 'TUBU3', items: [{ backorderedQty: 0, quantity: 1 }] });
    await mount();
    click(plus());
    click(button('Ghi công nợ'));
    await flush();
    const [call] = posts('/dealer/orders');
    expect(call?.body).toEqual({ items: [{ variationId: 'v1', quantity: 1 }], paymentMethod: 'CREDIT', note: undefined });
    expect(call?.headers?.['Idempotency-Key']).toEqual(expect.any(String));
  });

  it('mức tối thiểu 0 (tắt): không chặn, vẫn báo phí giao theo ngưỡng', async () => {
    priced(100_000, meWith({ orderRules: { ...RULES, minOrderValue: 0 } }));
    const c = await mount();
    click(plus());
    expect(c.textContent).not.toContain('Đơn tối thiểu');
    expect(c.textContent).toContain('Tiền hàng 100.000đ + Phí giao 19.000đ');
    expect(button('Ghi công nợ').disabled).toBe(false);
  });

  it('API chưa trả orderRules: giữ hành vi cũ, tổng bằng tiền hàng, không dòng phí và không chặn', async () => {
    setup({ '/dealer/me': { ...APPROVED, currentDebt: 0 }, '/dealer/pricelist': [row({ dealerPrice: 80_000, stock: 9 })] });
    const c = await mount();
    click(plus());
    expect(c.textContent).toContain('80.000đ');
    expect(c.textContent).not.toContain('Phí giao');
    expect(c.textContent).not.toContain('Đơn tối thiểu');
    expect(c.textContent).not.toContain('Miễn phí giao');
    expect(button('Ghi công nợ').disabled).toBe(false);
  });

  it('đơn bị từ chối vì còn nợ quá hạn: hiện nguyên văn lý do máy chủ, không tự quyết ở web', async () => {
    priced(4_000_000);
    const reason = 'Bạn còn nợ đơn ngày 01/10/2026 đã quá hạn thanh toán (NET 15). Vui lòng thanh toán công nợ trước khi đặt thêm đơn ghi công nợ, hoặc chọn thanh toán trả trước.';
    m.post['/dealer/orders'] = () => {
      throw new Error(reason);
    };
    const c = await mount();
    click(plus());
    click(button('Ghi công nợ'));
    await flush();
    expect(c.textContent).toContain(reason);
  });
});
