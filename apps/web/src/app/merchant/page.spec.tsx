// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MerchantPage from './page';
import { byText, click, flush, render, selectValue, typeInto, type Rendered } from '@/test-utils/dom';
import { headingProblems, scrollRegionProblems, unlabeledFields } from '@/test-utils/a11y';

const mocks = vi.hoisted(() => ({
  auth: { user: { role: 'DEALER' } as { role: string } | null, status: 'authenticated', initialized: true },
  store: null as unknown,
  updateStore: vi.fn(),
  getProducts: vi.fn(),
  createProduct: vi.fn(),
  removeResell: vi.fn(),
  listOrders: vi.fn(),
  setOrderStatus: vi.fn(),
  listFulfil: vi.fn(),
  fulfilAction: vi.fn(),
  settlement: vi.fn(),
  updateProduct: vi.fn(),
  stopSelling: vi.fn(),
  checkPancake: vi.fn(),
}));

vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/lib/merchant-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/merchant-client')>()),
  getMerchantStore: async () => mocks.store,
  updateMerchantStore: (dto: unknown) => mocks.updateStore(dto),
  getMerchantProducts: (page: number) => mocks.getProducts(page),
  createMerchantProduct: (dto: unknown) => mocks.createProduct(dto),
  removeResellProduct: (id: string) => mocks.removeResell(id),
  countMerchantOrders: async () => 3,
  listMerchantOrders: (status: string | undefined, page: number) => mocks.listOrders(status, page),
  updateMerchantOrderStatus: (id: string, status: string) => mocks.setOrderStatus(id, status),
  listFulfilOrders: (status: string | undefined, page: number) => mocks.listFulfil(status, page),
  acceptFulfilOrder: (id: string) => mocks.fulfilAction('accept', id),
  packFulfilOrder: (id: string) => mocks.fulfilAction('pack', id),
  shipFulfilOrder: (id: string, body: unknown) => mocks.fulfilAction('ship', id, body),
  deliverFulfilOrder: (id: string) => mocks.fulfilAction('deliver', id),
  failFulfilOrder: (id: string, reason: string) => mocks.fulfilAction('fail', id, reason),
  cancelFulfilOrder: (id: string, reason: string) => mocks.fulfilAction('cancel', id, reason),
  getMerchantSettlement: () => mocks.settlement(),
  updateMerchantProduct: (id: string, dto: unknown) => mocks.updateProduct(id, dto),
  stopSellingMerchantProduct: (id: string) => mocks.stopSelling(id),
  checkPancakeVariation: (code: string) => mocks.checkPancake(code),
}));

const STORE = {
  id: 's1',
  type: 'MERCHANT',
  slug: 'minh-an',
  subdomain: 'minhan',
  title: 'Minh An',
  headerNote: 'Sống xanh',
  avatarUrl: null,
  coverUrl: null,
  theme: 'default',
  themeColor: null,
  bankName: null,
  bankBin: null,
  bankAccountNo: null,
  bankAccountName: null,
  warehouseAddress: null,
  warehouseCity: null,
  warehouseDistrict: null,
  warehouseWard: null,
  warehousePhone: null,
  shippingFee: null,
  freeShipFrom: null,
  isPublished: true,
};

const PRODUCT = (id: string, approvalStatus: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `SP ${id}`,
  slug: `sp-${id}`,
  description: 'Mô tả',
  shortDesc: 'Mô tả ngắn',
  basePrice: 120000,
  images: [],
  approvalStatus,
  variations: [{ id: `v${id}`, sku: id, name: 'Mặc định', retailPrice: 120000, stock: 7 }],
  createdAt: '2026-10-01T03:00:00.000Z',
  ...extra,
});
const ORDER = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
  id,
  code: `TT${id}`,
  status,
  total: 250000,
  createdAt: '2026-10-01T03:00:00.000Z',
  user: { fullName: 'Lan Anh', phone: '0900000001' },
  shippingAddress: { recipient: 'Lan', phone: '0900000002', street: '1 Lê Lợi', ward: 'Bến Nghé', district: 'Quận 1', province: 'TP.HCM' },
  items: [{ id: `i${id}`, productName: 'Dầu gội', variationName: '500ml', quantity: 2, unitPrice: 125000, backorderedQty: 1 }],
  ...extra,
});

const FULFIL = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
  id,
  code: `TF${id}`,
  status,
  subtotal: 200000,
  discount: 0,
  shippingFee: 30000,
  total: 230000,
  paymentMethod: 'COD',
  paymentStatus: 'UNPAID',
  shippingAddress: { recipient: 'Hà My', phone: '0900000003', street: '9 Hai Bà Trưng', ward: 'Bến Nghé', district: 'Quận 1', province: 'TP.HCM' },
  note: null,
  merchantAcceptedAt: null,
  createdAt: '2026-10-13T03:00:00.000Z',
  items: [{ id: `fi${id}`, productName: 'Mật ong rừng', variationName: 'Mặc định', unitPrice: 200000, quantity: 1, total: 200000 }],
  user: { fullName: 'Hà My', phone: '0900000003' },
  sla: { state: null, dueAt: '2026-10-14T03:00:00.000Z' },
  ...extra,
});

let ui: Rendered | undefined;
const mount = async () => {
  ui = render(<MerchantPage />);
  await flush();
  return ui.container;
};
const openTab = async (label: string) => {
  click(byText(ui!.container, '[role="tab"]', label));
  await flush();
};
const FIELD = 'input,textarea,select';
const inputByLabel = (root: ParentNode, label: string) => {
  const l = byText(root, 'label', label)!;
  return (l.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(FIELD) ??
    l.parentElement!.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(FIELD))!;
};

beforeEach(() => {
  mocks.auth = { user: { role: 'DEALER' }, status: 'authenticated', initialized: true };
  mocks.store = { ...STORE };
  mocks.updateStore = vi.fn(async () => ({}));
  mocks.getProducts = vi.fn(async () => ({
    ownProducts: [PRODUCT('a', 'APPROVED'), PRODUCT('b', 'REJECTED', { rejectReason: 'Thiếu chứng nhận' }), PRODUCT('c', 'PENDING_REVIEW')],
    resellProducts: [PRODUCT('r1', 'APPROVED')],
    meta: { page: 1, limit: 20, ownTotal: 4, resellTotal: 2 },
  }));
  mocks.createProduct = vi.fn(async () => ({}));
  mocks.removeResell = vi.fn(async () => ({}));
  mocks.listOrders = vi.fn(async () => ({
    data: [ORDER('1', 'CONFIRMED'), ORDER('2', 'PACKED'), ORDER('3', 'SHIPPING'), ORDER('4', 'DELIVERED')],
    meta: { page: 1, limit: 20, total: 4 },
  }));
  mocks.setOrderStatus = vi.fn(async () => ({}));
  mocks.listFulfil = vi.fn(async () => ({
    data: [FULFIL('1', 'CONFIRMED'), FULFIL('2', 'CONFIRMED', { merchantAcceptedAt: '2026-10-13T04:00:00.000Z', sla: { state: 'SHIP_OVERDUE', dueAt: '2026-10-13T05:00:00.000Z' } }), FULFIL('3', 'SHIPPING', { shippingPartner: 'GHN', shippingCode: 'GHN123', shippedAt: '2026-10-13T06:00:00.000Z' })],
    meta: { page: 1, limit: 20, total: 3 },
    counts: { CONFIRMED: 3, PACKED: 2, SHIPPING: 1 },
    slaConfig: { confirmHours: 24, shipHours: 48, deliverDays: 7 },
  }));
  mocks.fulfilAction = vi.fn(async () => ({}));
  mocks.settlement = vi.fn(async () => ({
    holdDays: 7,
    lines: [
      { orderId: 'o1', orderCode: 'TF1', kind: 'SALE', goodsAmount: 200000, shippingFee: 30000, commissionAmount: 30000, codCollected: 0, netAmount: 200000, deliveredAt: '2026-10-01T03:00:00.000Z' },
      { orderId: 'o2', orderCode: 'TF2', kind: 'SALE', goodsAmount: 100000, shippingFee: 30000, commissionAmount: 15000, codCollected: 130000, netAmount: -15000, deliveredAt: '2026-10-02T03:00:00.000Z' },
    ],
    total: 185000,
    upcoming: [],
    payouts: [{ id: 'p1', storefrontId: 's1', amount: 500000, status: 'PAID', createdAt: '2026-09-20T03:00:00.000Z', paidAt: '2026-09-21T03:00:00.000Z', bankRef: 'FT123', lines: [{ id: 'l1' }] }],
  }));
  mocks.updateProduct = vi.fn(async () => ({}));
  mocks.stopSelling = vi.fn(async () => ({}));
  mocks.checkPancake = vi.fn(async (code: string) => ({
    variationId: 'pv',
    pancakeId: code,
    productId: 'pp',
    productName: 'Bột giặt quế',
    variationName: '1kg',
    retailPrice: 150000,
    salePrice: null,
    stock: 40,
  }));
});
afterEach(() => {
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
  ui?.unmount();
  ui = undefined;
});

describe('cổng đối tác /merchant — khung trang (DS v2)', () => {
  it('chưa đăng nhập: nút Đăng nhập trỏ /dang-nhap, cao 44px, dùng token forest', async () => {
    mocks.auth = { user: null, status: 'unauthenticated', initialized: true };
    const root = await mount();
    const link = byText(root, 'a', 'Đăng nhập ngay') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/dang-nhap');
    expect(link.className).toContain('min-h-[44px]');
    expect(link.className).toContain('bg-forest-600');
    expect(root.querySelector('h1')!.className).toContain('font-display');
  });

  it('tài khoản không phải đối tác: chỉ hiện lời giải thích, không có thanh tab', async () => {
    mocks.auth = { user: { role: 'CUSTOMER' }, status: 'authenticated', initialized: true };
    const root = await mount();
    expect(root.textContent).toContain('Kênh dành cho đối tác');
    expect(byText(root, 'button', 'Gian hàng & Subdomain')).toBeNull();
  });

  it('thẻ số liệu đọc tổng từ meta; huy hiệu xuất bản theo token success, chưa xuất bản theo token warning', async () => {
    const root = await mount();
    const kpi = Array.from(root.querySelectorAll('p.text-2xl')).map((p) => p.textContent);
    // Gian hàng tự giao: "Đơn cần giao" = chờ xử lý (3) + đã đóng gói (2) của chính gian hàng.
    expect(kpi).toEqual(['4', '2', '5']);
    expect(root.textContent).not.toContain('Cần xuất kho ngay');
    const published = byText(root, 'span', 'Đang xuất bản')!;
    expect(published.className).toContain('bg-success-bg');
    ui!.unmount();
    mocks.store = { ...STORE, isPublished: false };
    const root2 = await mount();
    expect(byText(root2, 'span', 'Chưa xuất bản')!.className).toContain('bg-warning-bg');
  });

  it('thanh tab cuộn ngang trong khung riêng, mỗi tab cao 44px và tab đang chọn dùng viền forest', async () => {
    const root = await mount();
    const store = byText(root, '[role="tab"]', 'Gian hàng & Subdomain')!;
    expect(store.parentElement!.className).toContain('overflow-x-auto');
    expect(store.className).toContain('min-h-[44px]');
    expect(store.className).toContain('border-forest-600');
    expect(store.getAttribute('aria-selected')).toBe('true');
    expect(byText(root, '[role="tab"]', 'Sản phẩm')!.className).toContain('text-stone-500');
    expect(root.textContent).not.toContain('VietQR');
  });

  it('SELLER-17: tab nằm trên URL (?tab=), tải lại vẫn mở đúng tab; tab lạ thì về tab đầu', async () => {
    window.history.replaceState(null, '', '/merchant?tab=settlement');
    let root = await mount();
    expect(byText(root, '[role="tab"]', 'Đối soát')!.getAttribute('aria-selected')).toBe('true');
    expect(root.textContent).toContain('Chờ lập phiếu');
    await openTab('Đơn cần giao');
    expect(window.location.search).toBe('?tab=fulfil');
    await openTab('Gian hàng & Subdomain');
    expect(window.location.search).toBe('');
    ui!.unmount();
    window.history.replaceState(null, '', '/merchant?tab=bogus');
    root = await mount();
    expect(byText(root, '[role="tab"]', 'Gian hàng & Subdomain')!.getAttribute('aria-selected')).toBe('true');
  });

  it('SELLER-8: gian hàng CTV không thấy tab tự giao, tài khoản nhận đối soát, giao hàng; thẻ đơn ghi rõ kho Tubu xử lý', async () => {
    mocks.auth = { user: { role: 'AFFILIATE' }, status: 'authenticated', initialized: true };
    mocks.store = { ...STORE, type: 'CTV' };
    const root = await mount();
    const tabs = Array.from(root.querySelectorAll('[role="tab"]')).map((t) => t.textContent);
    expect(tabs).toEqual(['Gian hàng & Subdomain', 'Sản phẩm', 'Đơn qua gian hàng']);
    expect(Array.from(root.querySelectorAll('p.text-2xl')).map((p) => p.textContent)).toEqual(['2', '3']);
    expect(root.textContent).toContain('Kho Tubu đóng gói và giao');
    expect(root.textContent).not.toContain('Sản phẩm riêng');
    expect(mocks.listFulfil).not.toHaveBeenCalled();
    await openTab('Sản phẩm');
    expect(byText(root, 'button', 'Đăng sản phẩm mới')).toBeNull();
    expect(root.textContent).toContain('Gian hàng CTV bán lại sản phẩm của Tubu Tree');
    expect(root.textContent).toContain('SP r1');
  });

  it('ADMIN trên gian hàng CTV cũng không đăng sản phẩm riêng (không có đường tự giao cho sản phẩm đó)', async () => {
    mocks.auth = { user: { role: 'ADMIN' }, status: 'authenticated', initialized: true };
    mocks.store = { ...STORE, type: 'CTV' };
    const root = await mount();
    await openTab('Sản phẩm');
    expect(byText(root, 'button', 'Đăng sản phẩm mới')).toBeNull();
  });
});

describe('cổng đối tác — tab Gian hàng & Subdomain', () => {
  it('lưu cấu hình gửi đúng dữ liệu, màu mặc định là #16a34a và nút Lưu cao 44px', async () => {
    const root = await mount();
    const save = byText(root, 'button', 'Lưu cấu hình gian hàng')!;
    expect(save.className).toContain('min-h-[44px]');
    expect(save.className).toContain('bg-forest-600');
    typeInto(inputByLabel(root, 'Tên gian hàng'), '  Minh An Xanh  ');
    click(save);
    await flush();
    expect(mocks.updateStore).toHaveBeenCalledWith({
      title: 'Minh An Xanh',
      headerNote: 'Sống xanh',
      subdomain: 'minhan',
      themeColor: '#16a34a',
      coverUrl: undefined,
      avatarUrl: undefined,
      isPublished: true,
    });
  });

  it('chọn màu chủ đạo: nút đang chọn có aria-pressed và hex được lưu đúng giá trị dữ liệu', async () => {
    const root = await mount();
    const navy = byText(root, 'button', 'Xanh Navy Hiện Đại')!;
    expect(navy.getAttribute('aria-pressed')).toBe('false');
    expect(navy.className).toContain('min-h-[44px]');
    click(navy);
    expect(navy.getAttribute('aria-pressed')).toBe('true');
    expect(navy.className).toContain('border-stone-900');
    click(byText(root, 'button', 'Lưu cấu hình gian hàng'));
    await flush();
    expect(mocks.updateStore).toHaveBeenCalledWith(expect.objectContaining({ themeColor: '#1d4ed8' }));
  });

  it('ô nhập cao 44px, viền stone-450 và không tắt vòng lấy nét; ô subdomain co được trong hàng flex', async () => {
    const root = await mount();
    const title = inputByLabel(root, 'Tên gian hàng');
    expect(title.className).toContain('min-h-[44px]');
    expect(title.className).toContain('border-stone-450');
    expect(title.className).not.toContain('outline-none');
    const sub = root.querySelector<HTMLInputElement>('input[placeholder="ten-thuong-hieu"]')!;
    expect(sub.className).toContain('min-w-0');
    expect(sub.className).not.toContain('outline-none');
  });

  it('thông báo lưu: thành công theo token success (role status), lỗi theo token danger (role alert)', async () => {
    const root = await mount();
    click(byText(root, 'button', 'Lưu cấu hình gian hàng'));
    await flush();
    const ok = root.querySelector('[role="status"]')!;
    expect(ok.textContent).toContain('Đã lưu cấu hình gian hàng thành công!');
    expect(ok.className).toContain('bg-success-bg');
    mocks.updateStore = vi.fn(async () => {
      throw new Error('Subdomain đã tồn tại');
    });
    click(byText(root, 'button', 'Lưu cấu hình gian hàng'));
    await flush();
    const err = root.querySelector('[role="alert"]')!;
    expect(err.textContent).toContain('Subdomain đã tồn tại');
    expect(err.className).toContain('bg-danger-bg');
  });

  it('khung xem trước: nền chuyển sắc dùng token --color-bg-inverse thay vì hex cứng', async () => {
    const root = await mount();
    const html = root.innerHTML;
    expect(html).toContain('var(--color-bg-inverse)');
    expect(html).not.toContain('#1e293b');
  });

  it('SELLER-8: khung xem trước hiện sản phẩm thật đang bán của gian hàng, không có sản phẩm mẫu giả', async () => {
    const root = await mount();
    expect(root.textContent).not.toContain('Sản phẩm mẫu của Shop');
    expect(root.textContent).toContain('SP a');
    expect(root.textContent).not.toContain('SP c');
    ui!.unmount();
    mocks.getProducts = vi.fn(async () => ({ ownProducts: [], resellProducts: [], meta: { page: 1, limit: 20, ownTotal: 0, resellTotal: 0 } }));
    const empty = await mount();
    expect(empty.textContent).toContain('Gian hàng chưa có sản phẩm nào đang bán.');
  });
});

describe('cổng đối tác — tab Tài khoản nhận đối soát (SELLER-8)', () => {
  it('nói rõ khách trả tiền cho Tubu, không có mã VietQR mẫu; lưu gửi BIN theo ngân hàng chọn và tên viết hoa', async () => {
    const root = await mount();
    await openTab('Tài khoản nhận đối soát');
    expect(root.textContent).toContain('Khách luôn thanh toán cho Tubu Tree');
    expect(root.querySelector('img')).toBeNull();
    selectValue(inputByLabel(root, 'Ngân hàng'), '970418');
    typeInto(inputByLabel(root, 'Số tài khoản'), '0123456789');
    typeInto(inputByLabel(root, 'Tên chủ tài khoản'), 'nguyen van a');
    const save = byText(root, 'button', 'Lưu tài khoản')!;
    expect(save.className).toContain('min-h-[44px]');
    expect(inputByLabel(root, 'Số tài khoản').className).toContain('min-h-[44px]');
    click(save);
    await flush();
    expect(mocks.updateStore).toHaveBeenCalledWith({
      bankName: 'BIDV',
      bankBin: '970418',
      bankAccountNo: '0123456789',
      bankAccountName: 'NGUYEN VAN A',
    });
  });

  it('gỡ được tài khoản đã lưu: gửi chuỗi rỗng để BE xoá', async () => {
    mocks.store = { ...STORE, bankName: 'BIDV', bankBin: '970418', bankAccountNo: '0123456789', bankAccountName: 'NGUYEN VAN A' };
    const root = await mount();
    await openTab('Tài khoản nhận đối soát');
    click(byText(root, 'button', 'Gỡ tài khoản'));
    await flush();
    expect(mocks.updateStore).toHaveBeenCalledWith({ bankName: '', bankBin: '', bankAccountNo: '', bankAccountName: '' });
    expect(root.querySelector('[role="status"]')!.textContent).toContain('Đã gỡ tài khoản nhận đối soát.');
  });
});

describe('cổng đối tác — tab Giao hàng & liên hệ (SELLER-8)', () => {
  it('phí giao, mức miễn phí (trống = null) và SĐT khách thấy trên đơn; không hứa tính ship theo địa chỉ kho', async () => {
    const root = await mount();
    await openTab('Giao hàng & liên hệ');
    expect(root.textContent).not.toContain('tính toán phí ship');
    const fee = inputByLabel(root, 'Phí giao mỗi đơn');
    expect(fee.className).toContain('min-h-[44px]');
    typeInto(fee, '25000');
    typeInto(inputByLabel(root, 'Số điện thoại khách liên hệ'), ' 0912345678 ');
    typeInto(inputByLabel(root, 'Địa chỉ gửi hàng'), ' 45 Đường số 8 ');
    click(byText(root, 'button', 'Lưu cài đặt giao hàng'));
    await flush();
    expect(mocks.updateStore).toHaveBeenCalledWith({
      shippingFee: 25000,
      freeShipFrom: null,
      warehousePhone: '0912345678',
      warehouseAddress: '45 Đường số 8',
      warehouseWard: '',
      warehouseDistrict: '',
      warehouseCity: '',
    });
  });
});

describe('cổng đối tác — tab Đơn cần giao (D4)', () => {
  it('đủ người nhận, địa chỉ, tiền thu hộ; quá hạn hiện huy hiệu; nút theo bước gọi đúng API', async () => {
    const root = await mount();
    await openTab('Đơn cần giao');
    expect(mocks.listFulfil).toHaveBeenLastCalledWith('CONFIRMED', 1);
    const first = root.querySelector('article[aria-label="Đơn TF1"]')!;
    expect(first.textContent).toContain('Hà My · 0900000003');
    expect(first.textContent).toContain('9 Hai Bà Trưng, Bến Nghé, Quận 1, TP.HCM');
    expect(first.textContent).toContain('Thu hộ khi giao: 230.000');
    expect(first.textContent).toContain('Chờ bạn xác nhận');
    click(byText(first, 'button', 'Xác nhận đơn'));
    await flush();
    expect(mocks.fulfilAction).toHaveBeenLastCalledWith('accept', '1');

    const second = root.querySelector('article[aria-label="Đơn TF2"]')!;
    expect(byText(second, 'span', 'Quá hạn gửi hàng')!.className).toContain('bg-danger-bg');
    click(byText(second, 'button', 'Nhập mã vận đơn'));
    typeInto(inputByLabel(second, 'Đơn vị vận chuyển'), ' GHN ');
    typeInto(inputByLabel(second, 'Mã vận đơn'), 'GHN999');
    click(byText(second, 'button', 'Xác nhận đã gửi hàng'));
    await flush();
    expect(mocks.fulfilAction).toHaveBeenLastCalledWith('ship', '2', { carrier: 'GHN', trackingCode: 'GHN999', trackingUrl: undefined });

    const third = root.querySelector('article[aria-label="Đơn TF3"]')!;
    expect(third.textContent).toContain('GHN · GHN123');
    expect(byText(third, 'button', 'Huỷ đơn')).toBeNull();
    click(byText(third, 'button', 'Khách đã nhận hàng'));
    await flush();
    expect(mocks.fulfilAction).toHaveBeenLastCalledWith('deliver', '3');
  });

  it('huỷ đơn cần lý do và lỗi API hiện role alert; bộ lọc hiện số đơn từng trạng thái', async () => {
    mocks.fulfilAction = vi.fn(async () => {
      throw new Error('Đơn vừa được cập nhật ở nơi khác.');
    });
    const root = await mount();
    await openTab('Đơn cần giao');
    expect(byText(root, 'button', 'Chờ xử lý (3)')!.getAttribute('aria-pressed')).toBe('true');
    expect(byText(root, 'button', 'Đã đóng gói (2)')).not.toBeNull();
    const first = root.querySelector('article[aria-label="Đơn TF1"]')!;
    click(byText(first, 'button', 'Huỷ đơn'));
    typeInto(inputByLabel(first, 'Lý do huỷ'), ' Hết hàng ');
    click(byText(first, 'button', 'Xác nhận huỷ đơn'));
    await flush();
    expect(mocks.fulfilAction).toHaveBeenLastCalledWith('cancel', '1', 'Hết hàng');
    expect(first.querySelector('[role="alert"]')!.textContent).toContain('Đơn vừa được cập nhật ở nơi khác.');
    click(byText(root, 'button', 'Đang giao'));
    await flush();
    expect(mocks.listFulfil).toHaveBeenLastCalledWith('SHIPPING', 1);
  });
});

describe('cổng đối tác — tab Đối soát', () => {
  it('công thức thực nhận, số âm hiện dấu trừ, phiếu đã chuyển kèm mã giao dịch', async () => {
    const root = await mount();
    await openTab('Đối soát');
    expect(root.textContent).toContain('thực nhận = tiền hàng + phí giao − phí sàn Tubu − tiền COD bạn đã tự thu');
    expect(root.textContent).toContain('sau 7 ngày');
    expect(root.textContent).toContain('Chờ lập phiếu (2 đơn)');
    expect(root.textContent).toContain('−15.000');
    expect(root.textContent).toContain('mã GD FT123');
    expect(scrollRegionProblems(root)).toEqual([]);
  });
});

describe('cổng đối tác — tab Quản lý sản phẩm', () => {
  it('hai nút danh sách xuống dòng được ở 390px, cao 44px, tô forest khi chọn và báo aria-pressed', async () => {
    const root = await mount();
    await openTab('Sản phẩm');
    const own = byText(root, 'button', 'Sản phẩm do tôi đăng')!;
    const resell = byText(root, 'button', 'Sản phẩm Tubu Tree bán lại')!;
    expect(own.parentElement!.className).toContain('flex-wrap');
    expect(own.className).toContain('min-h-[44px]');
    expect(own.className).toContain('bg-forest-600');
    expect(own.getAttribute('aria-pressed')).toBe('true');
    expect(resell.getAttribute('aria-pressed')).toBe('false');
    expect(resell.className).toContain('border-stone-450');
    click(resell);
    expect(resell.getAttribute('aria-pressed')).toBe('true');
    expect(root.textContent).toContain('SP r1');
  });

  it('huy hiệu kiểm duyệt theo token success / danger / warning, bảng cuộn ngang trong khung riêng', async () => {
    const root = await mount();
    await openTab('Sản phẩm');
    expect(byText(root, 'span', 'Đã duyệt')!.className).toContain('bg-success-bg');
    const rejected = byText(root, 'span', 'Từ chối: Thiếu chứng nhận')!;
    expect(rejected.className).toContain('bg-danger-bg');
    expect(rejected.getAttribute('title')).toBe('Thiếu chứng nhận');
    expect(byText(root, 'span', 'Chờ Tubu Tree duyệt')!.className).toContain('bg-warning-bg');
    const frame = root.querySelector('table')!.parentElement!;
    expect(frame.className).toContain('overflow-x-auto');
    expect(frame.className).toContain('rounded-card');
    expect(root.querySelector('td.text-forest-700')!.textContent).toContain('120.000');
  });

  it('Gỡ khỏi shop: hỏi xác nhận, từ chối thì không gọi API, đồng ý gọi đúng sản phẩm; lỗi hiện thông báo danger', async () => {
    const root = await mount();
    await openTab('Sản phẩm');
    click(byText(root, 'button', 'Sản phẩm Tubu Tree bán lại'));
    const remove = byText(root, 'button', 'Gỡ khỏi shop')!;
    expect(remove.className).toContain('min-h-[44px]');
    expect(remove.className).toContain('text-danger-fg');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    click(remove);
    expect(confirm).toHaveBeenCalledWith('Gỡ sản phẩm SP r1 khỏi gian hàng?');
    expect(mocks.removeResell).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    mocks.removeResell = vi.fn(async () => {
      throw new Error('Không có quyền');
    });
    click(remove);
    await flush();
    expect(mocks.removeResell).toHaveBeenCalledWith('r1');
    const alert = root.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('Không có quyền');
    expect(alert.className).toContain('bg-danger-bg');
  });

  it('thanh phân trang: nút Trước/Sau cao 44px và chuyển trang gọi đúng số trang', async () => {
    mocks.getProducts = vi.fn(async (page: number) => ({
      ownProducts: [PRODUCT('a', 'APPROVED')],
      resellProducts: [],
      meta: { page, limit: 20, ownTotal: 45, resellTotal: 0 },
    }));
    const root = await mount();
    await openTab('Sản phẩm');
    expect(root.textContent).toContain('Hiển thị 1–1/45');
    const prev = byText(root, 'button', 'Trang trước')!;
    const next = byText(root, 'button', 'Trang sau')!;
    expect(prev.className).toContain('min-h-[44px]');
    expect((prev as HTMLButtonElement).disabled).toBe(true);
    click(next);
    await flush();
    expect(mocks.getProducts).toHaveBeenLastCalledWith(2);
  });

  it('Đăng sản phẩm mới: hộp thoại theo token (nền stone-900/40, rounded-sheet), nút Đóng có tên và cao 44px, gửi đúng dữ liệu', async () => {
    const root = await mount();
    await openTab('Sản phẩm');
    click(byText(root, 'button', 'Đăng sản phẩm mới'));
    const overlay = root.querySelector<HTMLElement>('.fixed.inset-0')!;
    expect(overlay.className).toContain('bg-stone-900/40');
    expect(overlay.firstElementChild!.className).toContain('rounded-sheet');
    const close = root.querySelector<HTMLButtonElement>('button[aria-label="Đóng"]')!;
    expect(close.className).toContain('h-11');
    expect(overlay.textContent).not.toContain('24h');
    typeInto(inputByLabel(overlay, 'Tên sản phẩm'), '  Nước rửa chén  ');
    typeInto(inputByLabel(overlay, 'Giá bán'), '100000');
    typeInto(inputByLabel(overlay, 'Tồn kho bạn đang có'), '50');
    typeInto(inputByLabel(overlay, 'Nội dung mô tả chi tiết'), 'Chiết xuất bồ hòn');
    typeInto(inputByLabel(overlay, 'Tiêu chuẩn'), 'Thuần chay, Hữu cơ, ');
    typeInto(inputByLabel(overlay, 'URL hình ảnh'), ' https://img/x.png ');
    const submit = byText(overlay, 'button', 'Gửi kiểm duyệt')!;
    expect(submit.className).toContain('min-h-[44px]');
    click(submit);
    await flush();
    expect(mocks.createProduct).toHaveBeenCalledWith({
      name: 'Nước rửa chén',
      description: 'Chiết xuất bồ hòn',
      shortDesc: undefined,
      basePrice: 100000,
      stock: 50,
      images: ['https://img/x.png'],
      certifications: ['Thuần chay', 'Hữu cơ'],
    });
    expect(root.querySelector('.fixed.inset-0')).toBeNull();
  });

  it('D4 Tubu giao hộ: phải kiểm mã Pancake trước khi gửi; gửi mã đã kiểm, giá theo kho Tubu, không gửi tồn kho', async () => {
    const root = await mount();
    await openTab('Sản phẩm');
    click(byText(root, 'button', 'Đăng sản phẩm mới'));
    const overlay = root.querySelector<HTMLElement>('.fixed.inset-0')!;
    typeInto(inputByLabel(overlay, 'Tên sản phẩm'), 'Bột giặt quế');
    typeInto(inputByLabel(overlay, 'Nội dung mô tả chi tiết'), 'Bột giặt sinh học');
    click(overlay.querySelectorAll<HTMLInputElement>('input[type="radio"]')[1]!);
    expect(overlay.querySelector('#merchant-product-price')).toBeNull();
    typeInto(inputByLabel(overlay, 'Mã biến thể Pancake'), ' PCK-77 ');
    click(byText(overlay, 'button', 'Gửi kiểm duyệt'));
    await flush();
    expect(mocks.createProduct).not.toHaveBeenCalled();
    expect(overlay.querySelector('[role="alert"]')!.textContent).toContain('Kiểm tra mã');
    click(byText(overlay, 'button', 'Kiểm tra mã'));
    await flush();
    expect(mocks.checkPancake).toHaveBeenCalledWith(' PCK-77 ');
    expect(overlay.querySelector('[role="status"]')!.textContent).toContain('Bột giặt quế (1kg)');
    expect(overlay.querySelector('[role="status"]')!.textContent).toContain('còn 40 trong kho Tubu');
    typeInto(inputByLabel(overlay, 'Mã biến thể Pancake'), 'PCK-77');
    click(byText(overlay, 'button', 'Kiểm tra mã'));
    await flush();
    click(byText(overlay, 'button', 'Gửi kiểm duyệt'));
    await flush();
    expect(mocks.createProduct).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Bột giặt quế', basePrice: 150000, tubuFulfils: true, pancakeCode: 'PCK-77' }),
    );
    expect(mocks.createProduct.mock.calls[0]![0]).not.toHaveProperty('stock');
  });

  it('D4 mã Pancake không hợp lệ: hiện lỗi của API ngay dưới ô mã', async () => {
    mocks.checkPancake = vi.fn(async () => {
      throw new Error('Không tìm thấy mã biến thể này trong danh mục Pancake của Tubu Tree');
    });
    const root = await mount();
    await openTab('Sản phẩm');
    click(byText(root, 'button', 'Đăng sản phẩm mới'));
    const overlay = root.querySelector<HTMLElement>('.fixed.inset-0')!;
    click(overlay.querySelectorAll<HTMLInputElement>('input[type="radio"]')[1]!);
    typeInto(inputByLabel(overlay, 'Mã biến thể Pancake'), 'SAI');
    click(byText(overlay, 'button', 'Kiểm tra mã'));
    await flush();
    expect(overlay.querySelector('[role="alert"]')!.textContent).toContain('Không tìm thấy mã biến thể');
  });

  it('sửa sản phẩm chỉ gửi trường đã đổi; ngừng bán hỏi xác nhận rồi gọi API; sản phẩm ngừng bán mở bán lại được', async () => {
    mocks.getProducts = vi.fn(async () => ({
      ownProducts: [PRODUCT('a', 'APPROVED', { isActive: true }), PRODUCT('z', 'APPROVED', { isActive: false })],
      resellProducts: [],
      meta: { page: 1, limit: 20, ownTotal: 2, resellTotal: 0 },
    }));
    const root = await mount();
    await openTab('Sản phẩm');
    click(byText(root.querySelector('tbody')!, 'button', 'Sửa'));
    const overlay = root.querySelector<HTMLElement>('.fixed.inset-0')!;
    expect(overlay.textContent).toContain('chờ Tubu Tree duyệt lại');
    typeInto(inputByLabel(overlay, 'Tồn kho'), '12');
    click(byText(overlay, 'button', 'Lưu thay đổi'));
    await flush();
    expect(mocks.updateProduct).toHaveBeenCalledWith('a', { stock: 12 });

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    click(byText(root, 'button', 'Ngừng bán'));
    await flush();
    expect(confirm).toHaveBeenCalled();
    expect(mocks.stopSelling).toHaveBeenCalledWith('a');
    expect(root.textContent).toContain('Đã ngừng bán');
    click(byText(root, 'button', 'Mở bán lại'));
    await flush();
    expect(mocks.updateProduct).toHaveBeenLastCalledWith('z', { isActive: true });
  });

  it('Đăng sản phẩm mới: lỗi từ API hiện thông báo danger và hộp thoại vẫn mở; Hủy đóng hộp thoại', async () => {
    mocks.createProduct = vi.fn(async () => {
      throw new Error('Giá không hợp lệ');
    });
    const root = await mount();
    await openTab('Sản phẩm');
    click(byText(root, 'button', 'Đăng sản phẩm mới'));
    const overlay = root.querySelector<HTMLElement>('.fixed.inset-0')!;
    typeInto(inputByLabel(overlay, 'Tên sản phẩm'), 'SP');
    typeInto(inputByLabel(overlay, 'Giá bán'), '5000');
    typeInto(inputByLabel(overlay, 'Tồn kho bạn đang có'), '1');
    typeInto(inputByLabel(overlay, 'Nội dung mô tả chi tiết'), 'Mô tả');
    click(byText(overlay, 'button', 'Gửi kiểm duyệt'));
    await flush();
    const err = overlay.querySelector('[role="alert"]')!;
    expect(err.textContent).toContain('Giá không hợp lệ');
    expect(err.className).toContain('text-danger-fg');
    click(byText(overlay, 'button', 'Hủy'));
    expect(root.querySelector('.fixed.inset-0')).toBeNull();
  });
});

describe('cổng đối tác — tab Đơn qua gian hàng', () => {
  it('đối tác không phải ADMIN: ghi chú thông tin theo token info, không có nút chuyển trạng thái', async () => {
    const root = await mount();
    await openTab('Đơn qua gian hàng');
    const notice = Array.from(root.querySelectorAll('div')).find((d) => d.children.length === 0 && d.textContent?.includes('Hàng của kho Tubu Tree do Tubu đóng gói và giao'))!;
    expect(notice.className).toContain('bg-info-bg');
    expect(notice.textContent).toContain('nằm ở tab Đơn cần giao');
    expect(root.textContent).toContain('Do kho Tubu xử lý');
    expect(byText(root, 'button', 'Đã đóng gói')).toBeNull();
    expect(byText(root, 'button', 'Bắt đầu giao')).toBeNull();
    expect(byText(root, 'button', 'Đã giao')).toBeNull();
  });

  it('địa chỉ giao, huy hiệu trạng thái và chip Đặt trước giữ nội dung, dùng token DS v2', async () => {
    const root = await mount();
    await openTab('Đơn qua gian hàng');
    expect(root.textContent).toContain('Lan · 0900000002');
    expect(root.textContent).toContain('1 Lê Lợi, Bến Nghé, Quận 1, TP.HCM');
    expect(byText(root, 'span', 'Đặt trước 1')!.className).toContain('bg-warning-bg');
    const frame = root.querySelector('table')!.parentElement!;
    expect(frame.className).toContain('overflow-x-auto');
  });

  it('bộ lọc trạng thái có tên truy cập, cao 44px và gọi lại danh sách ở trang 1 theo trạng thái chọn', async () => {
    const root = await mount();
    await openTab('Đơn qua gian hàng');
    const select = root.querySelector<HTMLSelectElement>('select#merchant-orders-status')!;
    expect(select.className).toContain('min-h-[44px]');
    expect(select.labels?.[0]?.textContent).toBe('Lọc theo trạng thái đơn');
    selectValue(select, 'CONFIRMED');
    await flush();
    expect(mocks.listOrders).toHaveBeenLastCalledWith('CONFIRMED', 1);
  });

  it('ADMIN: mỗi trạng thái có đúng một nút chuyển bước, cao 44px, gọi đúng trạng thái kế tiếp', async () => {
    mocks.auth = { user: { role: 'ADMIN' }, status: 'authenticated', initialized: true };
    const root = await mount();
    await openTab('Đơn qua gian hàng');
    const packed = byText(root, 'button', 'Đã đóng gói')!;
    const shipping = byText(root, 'button', 'Bắt đầu giao')!;
    const delivered = byText(root, 'button', 'Đã giao')!;
    for (const b of [packed, shipping, delivered]) expect(b.className).toContain('min-h-[44px]');
    expect(packed.className).toContain('bg-sage-700');
    expect(shipping.className).toContain('bg-forest-800');
    expect(delivered.className).toContain('bg-forest-600');
    click(packed);
    await flush();
    expect(mocks.setOrderStatus).toHaveBeenLastCalledWith('1', 'PACKED');
    click(shipping);
    await flush();
    expect(mocks.setOrderStatus).toHaveBeenLastCalledWith('2', 'SHIPPING');
    click(delivered);
    await flush();
    expect(mocks.setOrderStatus).toHaveBeenLastCalledWith('3', 'DELIVERED');
    expect(root.textContent).not.toContain('Do kho Tubu xử lý');
  });

  it('ADMIN: lỗi khi chuyển trạng thái hiện thông báo danger (role alert)', async () => {
    mocks.auth = { user: { role: 'ADMIN' }, status: 'authenticated', initialized: true };
    mocks.setOrderStatus = vi.fn(async () => {
      throw new Error('Đơn đã bị huỷ');
    });
    const root = await mount();
    await openTab('Đơn qua gian hàng');
    click(byText(root, 'button', 'Đã đóng gói'));
    await flush();
    const alert = root.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('Đơn đã bị huỷ');
    expect(alert.className).toContain('bg-danger-bg');
  });
});

/**
 * `unlabeledFields` chấp nhận placeholder/aria-label làm tên truy cập nên không bảo vệ cặp `<label for>` ↔ `id`: xoá
 * `htmlFor` hay đổi `id` vẫn xanh. Hàm này chặt hơn: mỗi label[for] phải trỏ tới đúng một control có thật, và mỗi ô
 * nhập của form (trừ hidden/submit/button...) phải có ít nhất một <label> gắn với nó (`el.labels`).
 */
const NOT_LABELED_BY_ELEMENT = /^(hidden|submit|button|reset|image)$/;
function labelPairProblems(root: ParentNode): string[] {
  const problems: string[] = [];
  for (const label of Array.from(root.querySelectorAll<HTMLLabelElement>('label[for]'))) {
    const target = root.querySelector(`[id="${CSS.escape(label.htmlFor)}"]`);
    if (!target || !/^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) {
      problems.push(`label[for=${label.htmlFor}] không trỏ tới input/select/textarea nào: ${(label.textContent ?? '').trim()}`);
    }
  }
  for (const el of Array.from(root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea'))) {
    if (el instanceof HTMLInputElement && NOT_LABELED_BY_ELEMENT.test(el.type)) continue;
    if (!el.labels || el.labels.length === 0) problems.push(`không có <label> gắn: ${el.outerHTML.slice(0, 120)}`);
  }
  return problems;
}

// PF-4 (axe label, select-name, scrollable-region-focusable, page-has-heading-one, landmark-one-main).
describe('cổng đối tác — truy cập', () => {
  it.each([
    ['Gian hàng & Subdomain'],
    ['Đơn cần giao'],
    ['Sản phẩm'],
    ['Đơn qua gian hàng'],
    ['Đối soát'],
    ['Giao hàng & liên hệ'],
    ['Tài khoản nhận đối soát'],
  ])('tab %s: mọi ô nhập và select có nhãn gắn đúng (label for/id), bảng có khung cuộn focus được', async (tabLabel) => {
    const root = await mount();
    await openTab(tabLabel);
    expect(unlabeledFields(root)).toEqual([]);
    expect(labelPairProblems(root)).toEqual([]);
    expect(scrollRegionProblems(root)).toEqual([]);
  });

  it('form thêm sản phẩm mở ra cũng có nhãn cho mọi ô', async () => {
    const root = await mount();
    await openTab('Sản phẩm');
    const open = Array.from(root.querySelectorAll('button')).find((b) => /Thêm sản phẩm|Đăng sản phẩm/.test(b.textContent ?? ''));
    expect(open, 'nút mở form thêm sản phẩm').toBeDefined();
    click(open!);
    await flush();
    expect(root.querySelector('textarea')).not.toBeNull();
    expect(unlabeledFields(root)).toEqual([]);
    expect(labelPairProblems(root)).toEqual([]);
  });

  it('labelPairProblems bắt label[for] trỏ hụt và ô nhập không có <label> (guard không vô nghĩa)', () => {
    const box = document.createElement('div');
    box.innerHTML = '<label for="a">A</label><input id="b" placeholder="B"><label for="c">C</label><input id="c"><input type="hidden"><button>ok</button>';
    expect(labelPairProblems(box)).toEqual([
      'label[for=a] không trỏ tới input/select/textarea nào: A',
      expect.stringContaining('không có <label> gắn: <input id="b"'),
    ]);
  });

  it('chưa đăng nhập và không phải đối tác: trang có đúng một h1 nằm trong <main>', async () => {
    mocks.auth = { user: null, status: 'unauthenticated', initialized: true };
    const anon = await mount();
    expect(headingProblems(anon)).toEqual([]);
    expect(anon.querySelector('main h1')).not.toBeNull();
    ui!.unmount();

    mocks.auth = { user: { role: 'CUSTOMER' }, status: 'authenticated', initialized: true };
    const customer = await mount();
    expect(headingProblems(customer)).toEqual([]);
    expect(customer.querySelector('main h1')?.textContent).toBe('Kênh dành cho đối tác');
  });
});

// PG-3 (axe heading-order): tiêu đề từng tab là h2 ngay dưới h1 của trang; các tiêu đề con nối tiếp không nhảy cấp.
describe('cổng đối tác — thứ bậc heading của các tab', () => {
  it.each(['Gian hàng & Subdomain', 'Đơn cần giao', 'Sản phẩm', 'Đơn qua gian hàng', 'Đối soát', 'Giao hàng & liên hệ', 'Tài khoản nhận đối soát'])(
    'tab %s: không nhảy cấp heading',
    async (label) => {
      await mount();
      await openTab(label);
      expect(headingProblems(ui!.container)).toEqual([]);
    },
  );

  it('tên gian hàng trong khung mô phỏng điện thoại không phải heading của trang', async () => {
    const root = await mount();
    expect(root.querySelectorAll('h5').length).toBe(0);
  });
});
