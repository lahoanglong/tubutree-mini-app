// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError } from '@/lib/client-api';
import { click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';

type QuoteItem = { variationId: string; unitPrice: number; quantity: number; total: number; isFlash: boolean; flashLimitNotice: string | null };
type Quote = { items: QuoteItem[]; goods: number; shippingFee: number; total: number; blockedPaymentMethods?: Record<string, string> };

const state = vi.hoisted(() => ({
  posts: [] as { path: string; body: any; headers?: Record<string, string> }[],
  quoteCalls: [] as unknown[],
  suggestCalls: [] as string[],
  suggest: (async () => []) as (q: string) => Promise<unknown>,
  product: (async () => ({})) as () => Promise<unknown>,
  quote: (async () => ({})) as (items: any) => Promise<unknown>,
  order: (async () => ({})) as () => Promise<unknown>,
  routes: { bank: false, order: true },
}));

vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'ctv1' } }) }));
vi.mock('@/lib/route-map', () => ({
  isWebRouteReady: (p: string) => (p.startsWith('/thanh-toan/chuyen-khoan') ? state.routes.bank : state.routes.order),
}));
vi.mock('@/components/geo-picker', () => ({
  EMPTY_GEO: { province: '', provinceCode: '', ward: '', wardCode: '' },
  GeoPicker: ({ value, onChange }: { value: { province: string; ward: string }; onChange: (v: unknown) => void }) => (
    <div>
      <div data-testid="geo">{value.province ? `${value.province} / ${value.ward}` : 'chưa chọn địa bàn'}</div>
      <button type="button" onClick={() => onChange({ province: 'Đà Nẵng', provinceCode: '84_VN48', ward: 'Phường Hải Châu', wardCode: '84_VN4801' })}>
        Chọn địa bàn thử
      </button>
    </div>
  ),
}));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string, opts?: { query?: { q?: string } }) => {
      if (path === '/search/suggest') {
        state.suggestCalls.push(opts!.query!.q!);
        return state.suggest(opts!.query!.q!);
      }
      if (path.startsWith('/products/')) return state.product();
      throw new Error(`GET lạ ${path}`);
    },
    post: async (path: string, body: unknown, opts?: { headers?: Record<string, string> }) => {
      if (path === '/affiliate/orders/quote') {
        state.quoteCalls.push((body as { items: unknown }).items);
        return state.quote((body as { items: unknown }).items);
      }
      state.posts.push({ path, body, headers: opts?.headers });
      return state.order();
    },
  },
}));

import { CtvOrderSheet } from './ctv-order-sheet';
import { loadRecentCustomers, saveRecentCustomer } from './recent-customers';

const AN = { recipient: 'Nguyễn An', phone: '0901234567', street: '12 Lê Lợi', province: 'Hà Nội', provinceCode: '84_VN01', ward: 'Phường Ba Đình', wardCode: '84_VN0101', usedAt: 0 };
const BINH = { recipient: 'Trần Bình', phone: '0912345678', street: '5 Nguyễn Huệ', province: 'TP Hồ Chí Minh', provinceCode: '84_VN79', ward: 'Phường Bến Nghé', wardCode: '84_VN7901', usedAt: 0 };

const line = (over: Partial<QuoteItem> = {}): QuoteItem => ({ variationId: 'var1', unitPrice: 65_000, quantity: 1, total: 65_000, isFlash: false, flashLimitNotice: null, ...over });
const REGULAR: Quote = { items: [line()], goods: 65_000, shippingFee: 19_000, total: 84_000, blockedPaymentMethods: {} };
const FLASH: Quote = { items: [line({ unitPrice: 52_000, total: 52_000, isFlash: true })], goods: 52_000, shippingFee: 19_000, total: 71_000 };

let mounted: Rendered[] = [];
const body = () => document.body;
const buttons = () => Array.from(body().querySelectorAll('button'));
const btn = (re: RegExp | string) => buttons().find((b) => (typeof re === 'string' ? b.textContent === re : re.test(b.textContent ?? ''))) ?? null;
const aria = (name: string) => body().querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
const input = (label: string) => {
  const l = Array.from(body().querySelectorAll('label')).find((x) => x.textContent === label);
  if (!l) throw new Error(`không thấy nhãn ${label}`);
  return document.getElementById(l.htmlFor) as HTMLInputElement;
};
const text = () => body().textContent ?? '';
const submit = () => btn(/^(Tạo đơn hộ khách|Gửi lại đơn|Đang tạo đơn…)$/) as HTMLButtonElement;
const until = async (cond: () => boolean, ms = 4000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('hết thời gian chờ');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
};
const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));

function mount() {
  const r = render(<CtvOrderSheet open onClose={() => {}} />);
  mounted.push(r);
  return r;
}

async function addProduct(opts: { settle?: boolean } = {}) {
  typeInto(body().querySelector('input[type="search"]'), 'nước');
  await until(() => !!btn(/Nước rửa chén/));
  click(btn(/Nước rửa chén/));
  await until(() => !!btn(/^Chanh/));
  click(btn(/^Chanh/));
  await until(() => !!aria('Giảm số lượng'));
  if (opts.settle === false) return;
  await until(() => !submit().disabled);
}

async function readyWithAn(opts: { settle?: boolean } = {}) {
  saveRecentCustomer('ctv1', AN, 1);
  mount();
  click(btn('Nguyễn An · …567'));
  await addProduct(opts);
}

const orderPosts = () => state.posts.filter((p) => p.path === '/affiliate/orders');
const keyOf = (n: number) => orderPosts()[n]!.headers!['Idempotency-Key'];

beforeEach(() => {
  localStorage.clear();
  state.posts = [];
  state.quoteCalls = [];
  state.suggestCalls = [];
  state.routes = { bank: false, order: true };
  state.suggest = async () => [{ slug: 'nrc', name: 'Nước rửa chén', thumbnail: null, basePrice: 65_000 }];
  state.product = async () => ({ name: 'Nước rửa chén', variations: [{ id: 'var1', name: 'Chanh', retailPrice: 65_000, salePrice: null, stock: 10 }] });
  state.quote = async () => REGULAR;
  state.order = async () => ({ id: 'o1', code: 'TUBU9', total: 84_000, status: 'PENDING', items: [] });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('CtvOrderSheet — khách gần đây, giảm chạm', () => {
  it('đóng thì không dựng gì', () => {
    const r = render(<CtvOrderSheet open={false} onClose={() => {}} />);
    mounted.push(r);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('chưa có khách gần đây thì không hiện hàng chip', () => {
    mount();
    expect(text()).not.toContain('Khách gần đây');
  });

  it('có khách gần đây: chip theo tên + 3 số cuối SĐT, chạm là điền sẵn cả 5 trường', () => {
    saveRecentCustomer('ctv1', AN, 2);
    saveRecentCustomer('ctv1', BINH, 1);
    mount();
    expect(text()).toContain('Khách gần đây');
    click(btn('Nguyễn An · …567'));
    expect(input('Tên người nhận').value).toBe('Nguyễn An');
    expect(input('Số điện thoại').value).toBe('0901234567');
    expect(input('Địa chỉ (số nhà, đường)').value).toBe('12 Lê Lợi');
    expect(body().querySelector('[data-testid="geo"]')?.textContent).toBe('Hà Nội / Phường Ba Đình');
  });

  it('chip "Khách mới" xoá thông tin người nhận', () => {
    saveRecentCustomer('ctv1', AN, 1);
    mount();
    click(btn('Nguyễn An · …567'));
    click(btn(/Khách mới/));
    expect(input('Tên người nhận').value).toBe('');
    expect(input('Số điện thoại').value).toBe('');
    expect(body().querySelector('[data-testid="geo"]')?.textContent).toBe('chưa chọn địa bàn');
  });

  it('luồng nhanh: chọn khách + thêm sản phẩm + tạo đơn gửi đúng endpoint và body của Mini App', async () => {
    await readyWithAn();
    click(submit());
    await flush();
    expect(orderPosts()).toHaveLength(1);
    const p = orderPosts()[0]!;
    expect(p.body).toEqual({
      items: [{ variationId: 'var1', quantity: 1 }],
      customer: {
        recipient: 'Nguyễn An', phone: '0901234567', province: 'Hà Nội', district: '', ward: 'Phường Ba Đình', street: '12 Lê Lợi',
        provinceCode: '84_VN01', districtCode: '', wardCode: '84_VN0101',
      },
      paymentMethod: 'COD',
      note: undefined,
      expectedTotal: 84_000,
    });
    expect(p.headers?.['Idempotency-Key']).toMatch(/\S{8,}/);
  });

  it('đang gửi đơn: bấm lại không tạo đơn lần 2', async () => {
    state.order = () => new Promise(() => {});
    await readyWithAn();
    const b = submit();
    click(b);
    click(b);
    await flush();
    expect(orderPosts()).toHaveLength(1);
    expect(b.getAttribute('aria-busy')).toBe('true');
  });

  it('khách nhập tay, đơn thành công thì được nhớ cho lần sau (SĐT bỏ khoảng trắng)', async () => {
    mount();
    typeInto(input('Tên người nhận'), 'Lê Cúc');
    typeInto(input('Số điện thoại'), '0933 444 555');
    typeInto(input('Địa chỉ (số nhà, đường)'), '9 Trần Phú');
    click(btn('Chọn địa bàn thử'));
    await addProduct();
    click(submit());
    await until(() => text().includes('Đã tạo đơn hộ khách'));
    expect(loadRecentCustomers('ctv1')).toEqual([
      expect.objectContaining({ recipient: 'Lê Cúc', phone: '0933444555', street: '9 Trần Phú', province: 'Đà Nẵng', provinceCode: '84_VN48', ward: 'Phường Hải Châu', wardCode: '84_VN4801' }),
    ]);
  });

  it('đơn bị máy chủ từ chối thì KHÔNG nhớ khách và báo lỗi ngay trên form', async () => {
    state.order = async () => {
      throw new ApiError('hết hàng', 400, 'OUT_OF_STOCK');
    };
    await readyWithAn();
    click(submit());
    await flush();
    expect(text()).toContain('hết hàng');
    expect(loadRecentCustomers('ctv1').map((c) => c.recipient)).toEqual(['Nguyễn An']);
    expect(orderPosts()).toHaveLength(1);
  });

  it('thành công: khách vừa dùng đứng đầu danh sách gần đây', async () => {
    saveRecentCustomer('ctv1', AN, 1);
    saveRecentCustomer('ctv1', BINH, 2);
    mount();
    click(btn('Nguyễn An · …567'));
    await addProduct();
    click(submit());
    await until(() => text().includes('Đã tạo đơn hộ khách'));
    expect(loadRecentCustomers('ctv1').map((c) => c.recipient)).toEqual(['Nguyễn An', 'Trần Bình']);
  });

  it('nhập thiếu: báo lỗi từng trường, không gửi', async () => {
    mount();
    click(submit());
    expect(text().match(/Vui lòng nhập/g)).toHaveLength(3);
    expect(text()).toContain('Thêm ít nhất 1 sản phẩm');
    expect(orderPosts()).toHaveLength(0);
  });

  it('nút tăng/giảm/xoá có vùng chạm 44px', async () => {
    await readyWithAn();
    for (const name of ['Giảm số lượng', 'Tăng số lượng', 'Xoá sản phẩm']) {
      expect(aria(name)!.className).toMatch(/h-11/);
      expect(aria(name)!.className).toMatch(/w-11/);
    }
  });

  it('chọn Chuyển khoản: aria-pressed đổi, đơn gửi BANK_TRANSFER; trang chuyển khoản chưa mở thì lối chính là trang đơn (có QR)', async () => {
    await readyWithAn();
    const cod = btn(/COD/)!;
    const bank = btn(/Chuyển khoản/)!;
    expect(cod.getAttribute('aria-pressed')).toBe('true');
    click(bank);
    expect(bank.getAttribute('aria-pressed')).toBe('true');
    expect(cod.getAttribute('aria-pressed')).toBe('false');
    click(submit());
    await until(() => text().includes('Đã tạo đơn hộ khách'));
    expect(orderPosts()[0]!.body.paymentMethod).toBe('BANK_TRANSFER');
    expect(text()).not.toContain('Mini App');
    const links = body().querySelectorAll('a[href="/tai-khoan/don-hang/TUBU9"]');
    expect(links).toHaveLength(1);
    expect(links[0]!.textContent).toBe('Mở trang thanh toán (gửi khách)');
  });

  it('trang chuyển khoản đã mở: có lối "Mở trang thanh toán (gửi khách)"', async () => {
    state.routes.bank = true;
    await readyWithAn();
    click(btn(/Chuyển khoản/));
    click(submit());
    await until(() => text().includes('Đã tạo đơn hộ khách'));
    expect(body().querySelector('a[href="/thanh-toan/chuyen-khoan/TUBU9"]')?.textContent).toBe('Mở trang thanh toán (gửi khách)');
  });

  it('phân loại hết hàng không thêm được, còn hàng thì thêm', async () => {
    state.product = async () => ({
      name: 'Nước rửa chén',
      variations: [
        { id: 'var0', name: 'Cam', retailPrice: 70_000, salePrice: null, stock: 0 },
        { id: 'var1', name: 'Chanh', retailPrice: 65_000, salePrice: null, stock: 10 },
      ],
    });
    mount();
    typeInto(body().querySelector('input[type="search"]'), 'nước');
    await until(() => !!btn(/Nước rửa chén/));
    click(btn(/Nước rửa chén/));
    await until(() => !!btn(/^Cam/));
    expect(text()).toContain('Tạm hết hàng');
    expect((btn(/^Cam/) as HTMLButtonElement).disabled).toBe(true);
    expect(aria('Giảm số lượng')).toBeNull();
    click(btn(/^Chanh/));
    await until(() => !!aria('Giảm số lượng'));
  });

  it('tăng số lượng không vượt tồn kho', async () => {
    state.product = async () => ({ name: 'Nước rửa chén', variations: [{ id: 'var1', name: 'Chanh', retailPrice: 65_000, salePrice: null, stock: 2 }] });
    await readyWithAn();
    click(aria('Tăng số lượng'));
    click(aria('Tăng số lượng'));
    click(aria('Tăng số lượng'));
    expect(body().querySelector('li span.min-w-5')?.textContent).toBe('2');
  });

  it('gợi ý sản phẩm lỗi tải: có nút Thử lại gọi lại API', async () => {
    let n = 0;
    state.suggest = async () => {
      if (n++ === 0) throw new Error('mạng lỗi');
      return [];
    };
    mount();
    typeInto(body().querySelector('input[type="search"]'), 'nước');
    await until(() => !!btn('Thử lại'));
    click(btn('Thử lại'));
    await until(() => state.suggestCalls.length === 2);
  });
});

describe('CtvOrderSheet — giá như khách tự đặt, kể cả giờ vàng', () => {
  it('giờ vàng: dòng hàng, tạm tính, phí giao và tổng lấy từ báo giá của máy chủ', async () => {
    state.quote = async () => FLASH;
    await readyWithAn();
    await until(() => text().includes('Chanh · 52.000đ'));
    expect(text()).toContain('Giá giờ vàng');
    expect(body().querySelector('[data-testid="ctv-order-goods"]')?.textContent).toBe('52.000đ');
    expect(body().querySelector('[data-testid="ctv-order-shipping"]')?.textContent).toBe('19.000đ');
    expect(body().querySelector('[data-testid="ctv-order-total"]')?.textContent).toBe('71.000đ');
    expect(text()).not.toContain('Phí ship tính khi tạo đơn');
    expect(state.quoteCalls.at(-1)).toEqual([{ variationId: 'var1', quantity: 1 }]);
  });

  it('vượt số suất giờ vàng: báo lý do dưới dòng hàng, giá thường', async () => {
    const notice = 'Giá giờ vàng chỉ áp dụng tối đa 1 sản phẩm cho bạn.';
    state.quote = async (items: { quantity: number }[]) => {
      const q = items[0]!.quantity;
      return q === 1 ? FLASH : { items: [line({ quantity: q, total: 65_000 * q, flashLimitNotice: notice })], goods: 65_000 * q, shippingFee: 19_000, total: 65_000 * q + 19_000 };
    };
    await readyWithAn();
    await until(() => text().includes('Chanh · 52.000đ'));
    click(aria('Tăng số lượng'));
    await until(() => text().includes(notice));
    expect(text()).toContain('Chanh · 65.000đ');
    expect(body().querySelector('[data-testid="ctv-order-total"]')?.textContent).toBe('149.000đ');
  });

  it('chưa lấy được báo giá: giá niêm yết và ghi phí giao tính khi tạo đơn', async () => {
    state.quote = async () => {
      throw new ApiError('mạng lỗi', 500);
    };
    await readyWithAn({ settle: false });
    await until(() => text().includes('Phí ship tính khi tạo đơn'));
    expect(text()).toContain('Chanh · 65.000đ');
    expect(body().querySelector('[data-testid="ctv-order-goods"]')?.textContent).toBe('65.000đ');
  });
});

describe('CtvOrderSheet — đơn tạo ra đúng tổng CTV đã báo khách', () => {
  it('báo giá còn đang tính: nút khoá, không gửi; có báo giá rồi mới gửi kèm expectedTotal', async () => {
    let release!: (q: Quote) => void;
    state.quote = () => new Promise((r) => (release = r as (q: Quote) => void));
    await readyWithAn({ settle: false });
    await until(() => state.quoteCalls.length > 0);
    expect(submit().disabled).toBe(true);
    click(submit());
    expect(orderPosts()).toHaveLength(0);
    release(FLASH);
    await until(() => !submit().disabled);
    click(submit());
    await flush();
    expect(orderPosts()[0]!.body).toMatchObject({ expectedTotal: 71_000 });
  });

  it('TOTAL_CHANGED: báo tổng mới, tải lại báo giá, không báo thành công; bấm lại gửi tổng mới', async () => {
    const message = 'Tổng tiền đơn vừa thay đổi từ 71.000đ thành 84.000đ.';
    let ended = false;
    state.quote = async () => (ended ? REGULAR : FLASH);
    let first = true;
    state.order = async () => {
      if (first) {
        first = false;
        throw new ApiError(message, 400, 'TOTAL_CHANGED');
      }
      return { id: 'o1', code: 'TUBU9', total: 84_000, status: 'PENDING', items: [] };
    };
    await readyWithAn();
    await until(() => body().querySelector('[data-testid="ctv-order-total"]')?.textContent === '71.000đ');
    ended = true;
    click(submit());
    await until(() => text().includes(message));
    expect(text()).toContain('Báo lại khách tổng tiền mới bên dưới rồi bấm tạo đơn lần nữa.');
    await until(() => body().querySelector('[data-testid="ctv-order-total"]')?.textContent === '84.000đ');
    expect(text()).not.toContain('Đã tạo đơn hộ khách');
    await until(() => !submit().disabled);
    click(submit());
    await until(() => text().includes('Đã tạo đơn hộ khách'));
    expect(orderPosts()[1]!.body).toMatchObject({ expectedTotal: 84_000 });
  });

  it('báo giá từ chối hàng gian hàng đối tác tự giao: hiện lý do ngay trên form', async () => {
    const message = 'Sản phẩm "Nước rửa chén" do gian hàng đối tác tự giao, chỉ đặt được qua giỏ hàng.';
    state.quote = async () => {
      throw new ApiError(message, 400, 'NOT_TUBU_FULFILLED');
    };
    await readyWithAn({ settle: false });
    await until(() => text().includes(message));
    expect(orderPosts()).toHaveLength(0);
  });
});

describe('CtvOrderSheet — ô tìm sản phẩm chỉ gợi ý từ 2 ký tự', () => {
  it('1 ký tự: không gọi API, báo "Nhập ít nhất 2 ký tự"', async () => {
    mount();
    typeInto(body().querySelector('input[type="search"]'), 'n');
    expect(text()).toContain('Nhập ít nhất 2 ký tự');
    await wait(450);
    expect(state.suggestCalls).toEqual([]);
    expect(text()).not.toContain('Không tìm thấy sản phẩm phù hợp');
  });

  it('gõ tới 2 ký tự thì gọi API; xoá về 1 ký tự thì gợi ý ẩn ngay', async () => {
    mount();
    typeInto(body().querySelector('input[type="search"]'), 'nư');
    await until(() => !!btn(/Nước rửa chén/));
    expect(state.suggestCalls).toEqual(['nư']);
    typeInto(body().querySelector('input[type="search"]'), 'n');
    expect(text()).toContain('Nhập ít nhất 2 ký tự');
    expect(btn(/Nước rửa chén/)).toBeNull();
  });
});

describe('CtvOrderSheet — mạng chậm không tạo đơn thứ hai', () => {
  it('quá thời gian: tự kiểm tra lại bằng đúng key cũ, báo "Đang kiểm tra đơn…"; lần kiểm tra trả đơn đã tạo thì ra màn thành công', async () => {
    let n = 0;
    let resolveCheck!: (v: unknown) => void;
    state.order = () => {
      if (n++ === 0) return Promise.reject(new NetworkError(true));
      return new Promise((r) => (resolveCheck = r));
    };
    await readyWithAn();
    click(submit());
    await until(() => text().includes('Đang kiểm tra đơn…'));
    expect(submit().getAttribute('aria-busy')).toBe('true');
    await until(() => orderPosts().length === 2);
    expect(keyOf(1)).toBe(keyOf(0));
    resolveCheck({ id: 'o1', code: 'TUBU9', total: 84_000, status: 'PENDING', items: [] });
    await until(() => text().includes('Đã tạo đơn hộ khách'));
    expect(orderPosts()).toHaveLength(2);
  });

  it('kiểm tra lại vẫn không được: báo ngay trên form, nút thành "Gửi lại đơn", gửi đúng key cũ', async () => {
    let n = 0;
    state.order = async () => {
      if (n++ < 2) throw new NetworkError(true);
      return { id: 'o1', code: 'TUBU9', total: 84_000, status: 'PENDING', items: [] };
    };
    await readyWithAn();
    click(submit());
    await until(() => text().includes('Mạng yếu nên chưa biết đơn đã được tạo chưa.'), 6000);
    expect(keyOf(1)).toBe(keyOf(0));
    expect(submit().textContent).toBe('Gửi lại đơn');
    click(submit());
    await until(() => text().includes('Đã tạo đơn hộ khách'));
    expect(orderPosts()).toHaveLength(3);
    expect(keyOf(2)).toBe(keyOf(0));
  }, 10_000);

  it('5xx cũng coi là chưa rõ kết quả và tự kiểm tra lại', async () => {
    let n = 0;
    state.order = async () => {
      if (n++ === 0) throw new ApiError('Lỗi máy chủ', 502);
      return { id: 'o1', code: 'TUBU9', total: 84_000, status: 'PENDING', items: [] };
    };
    await readyWithAn();
    click(submit());
    await until(() => text().includes('Đã tạo đơn hộ khách'));
    expect(orderPosts()).toHaveLength(2);
    expect(keyOf(1)).toBe(keyOf(0));
  }, 10_000);

  it('chưa rõ kết quả rồi CTV sửa đơn: cảnh báo đơn trước có thể đã tạo, gửi là đơn mới với key mới', async () => {
    let n = 0;
    state.order = async () => {
      if (n++ < 2) throw new NetworkError(true);
      return { id: 'o1', code: 'TUBU9', total: 149_000, status: 'PENDING', items: [] };
    };
    await readyWithAn();
    click(submit());
    await until(() => submit().textContent === 'Gửi lại đơn', 6000);
    click(aria('Tăng số lượng'));
    await until(() => text().includes('Đơn gửi lúc nãy có thể đã được tạo'));
    await until(() => !submit().disabled);
    click(submit());
    await until(() => text().includes('Đã tạo đơn hộ khách'));
    expect(keyOf(2)).not.toBe(keyOf(0));
  }, 10_000);

  it('máy chủ từ chối (4xx): không tự gửi lại', async () => {
    state.order = async () => {
      throw new ApiError('Sản phẩm không đủ tồn kho.', 400, 'OUT_OF_STOCK');
    };
    await readyWithAn();
    click(submit());
    await until(() => text().includes('Sản phẩm không đủ tồn kho.'));
    await wait(1800);
    expect(orderPosts()).toHaveLength(1);
  });

  it('đơn xong, "Lên đơn khác" cùng khách cùng món: đơn mới, key mới', async () => {
    await readyWithAn();
    click(submit());
    await until(() => text().includes('Đã tạo đơn hộ khách'));
    click(btn('Lên đơn khác'));
    await addProduct();
    click(submit());
    await flush();
    expect(orderPosts()).toHaveLength(2);
    expect(keyOf(1)).not.toBe(keyOf(0));
  });
});

describe('CtvOrderSheet — trần COD báo trước khi gửi', () => {
  const COD_OVER = 'Thanh toán khi nhận hàng (COD) chỉ nhận đơn tối đa 5.000.000đ, đơn này là 5.400.000đ. Vui lòng chọn chuyển khoản.';
  const BIG: Quote = {
    items: [line({ unitPrice: 5_381_000, total: 5_381_000 })],
    goods: 5_381_000,
    shippingFee: 19_000,
    total: 5_400_000,
    blockedPaymentMethods: { COD: COD_OVER },
  };

  it('báo giá khoá COD: thẻ COD mờ kèm lý do, tự chuyển sang Chuyển khoản, đơn gửi BANK_TRANSFER', async () => {
    state.quote = async () => BIG;
    saveRecentCustomer('ctv1', AN, 1);
    mount();
    click(btn('Nguyễn An · …567'));
    await addProduct({ settle: false });
    await until(() => btn(/Chuyển khoản/)!.getAttribute('aria-pressed') === 'true');
    expect(btn(/COD/)!.getAttribute('aria-disabled')).toBe('true');
    expect(btn(/COD/)!.getAttribute('aria-pressed')).toBe('false');
    expect(text()).toContain(COD_OVER);
    click(btn(/COD/));
    expect(btn(/Chuyển khoản/)!.getAttribute('aria-pressed')).toBe('true');
    await until(() => !submit().disabled);
    click(submit());
    await flush();
    expect(orderPosts()[0]!.body.paymentMethod).toBe('BANK_TRANSFER');
  });

  it('báo giá không khoá COD: giữ COD mặc định', async () => {
    await readyWithAn();
    expect(btn(/COD/)!.getAttribute('aria-pressed')).toBe('true');
    expect(btn(/COD/)!.getAttribute('aria-disabled')).toBeNull();
    expect(text()).not.toContain('chỉ nhận đơn tối đa');
  });

  it('PAYMENT_METHOD_NOT_ALLOWED: tải lại báo giá, khoá COD và chuyển khoản', async () => {
    let blocked = false;
    state.quote = async () => (blocked ? BIG : { ...BIG, blockedPaymentMethods: {} });
    let first = true;
    state.order = async () => {
      if (first) {
        first = false;
        throw new ApiError(COD_OVER, 400, 'PAYMENT_METHOD_NOT_ALLOWED');
      }
      return { id: 'o1', code: 'TUBU9', total: 5_400_000, status: 'PENDING', items: [] };
    };
    await readyWithAn();
    blocked = true;
    click(submit());
    await until(() => btn(/Chuyển khoản/)!.getAttribute('aria-pressed') === 'true');
    expect(btn(/COD/)!.getAttribute('aria-disabled')).toBe('true');
    expect(text()).toContain(COD_OVER);
  });
});

describe('CtvOrderSheet — SĐT và tên người nhận cùng luật với máy chủ', () => {
  async function fillManual(recipient: string, phone: string) {
    mount();
    typeInto(input('Tên người nhận'), recipient);
    typeInto(input('Số điện thoại'), phone);
    typeInto(input('Địa chỉ (số nhà, đường)'), '9 Trần Phú');
    click(btn('Chọn địa bàn thử'));
    await addProduct();
    click(submit());
    await flush();
  }

  it('SĐT gõ có dấu chấm hay 84 đầu vẫn hợp lệ, gửi dạng 0xxxxxxxxx; tên được cắt khoảng trắng', async () => {
    await fillManual('  Lê Cúc ', '84.933.444.555');
    expect(orderPosts()).toHaveLength(1);
    expect(orderPosts()[0]!.body.customer).toMatchObject({ recipient: 'Lê Cúc', phone: '0933444555' });
  });

  it('SĐT 9 số không có 0 đầu: báo chưa đúng, không gửi', async () => {
    await fillManual('Lê Cúc', '933444555');
    expect(text()).toContain('Số điện thoại chưa đúng');
    expect(orderPosts()).toHaveLength(0);
  });

  it('tên 1 ký tự: báo cần ít nhất 2 ký tự, không gửi', async () => {
    await fillManual(' A ', '0933444555');
    expect(text()).toContain('Tên người nhận cần ít nhất 2 ký tự');
    expect(orderPosts()).toHaveLength(0);
  });
});
