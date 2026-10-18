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
  pause: vi.fn(),
  returns: vi.fn(async () => [] as unknown[]),
}));

vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/lib/merchant-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/merchant-client')>()),
  getMerchantStore: async () => {
    if (mocks.store instanceof Error) throw mocks.store;
    return mocks.store;
  },
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
  listMerchantReturns: () => mocks.returns(),
  updateMerchantProduct: (id: string, dto: unknown) => mocks.updateProduct(id, dto),
  stopSellingMerchantProduct: (id: string) => mocks.stopSelling(id),
  checkPancakeVariation: (code: string) => mocks.checkPancake(code),
  pauseMerchantOrders: (paused: boolean) => mocks.pause(paused),
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
const tableRow = (root: ParentNode, productName: string) =>
  Array.from(root.querySelectorAll('tbody tr')).find((r) => r.textContent?.includes(productName))!;
// Thao tác phụ của hàng sản phẩm nằm trong menu "⋯" dựng ra body (không nằm trong hàng): mở menu của đúng hàng rồi tìm mục theo aria-controls.
const openRowMenu = (row: Element) => {
  const trigger = row.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
  if (trigger.getAttribute('aria-expanded') !== 'true') click(trigger);
  const menu = document.getElementById(trigger.getAttribute('aria-controls')!)!;
  return Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
};
const rowAction = (root: ParentNode, productName: string, item: string) => {
  click(openRowMenu(tableRow(root, productName)).find((b) => b.textContent === item)!);
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
  mocks.returns = vi.fn(async () => [] as unknown[]);
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
  mocks.pause = vi.fn(async () => ({}));
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
      coverUrl: '',
      avatarUrl: '',
      isPublished: true,
    });
  });

  it('D7-10: ô URL logo và ảnh bìa có ảnh xem trước; đổi liên kết thì ảnh đổi theo và Lưu vẫn gửi đúng liên kết', async () => {
    mocks.store = { ...STORE, avatarUrl: 'https://cdn.example/logo.png', coverUrl: '' };
    const root = await mount();
    const previews = () => Array.from(root.querySelectorAll<HTMLImageElement>('[data-preview] img'));
    expect(previews().map((i) => i.getAttribute('alt'))).toEqual(['Xem trước: URL Logo thương hiệu']);
    expect(previews()[0]!.getAttribute('src')).toBe('https://cdn.example/logo.png');

    typeInto(inputByLabel(root, 'URL Ảnh bìa'), 'https://cdn.example/cover.png');
    expect(previews().map((i) => i.getAttribute('src'))).toEqual(['https://cdn.example/logo.png', 'https://cdn.example/cover.png']);

    click(byText(root, 'button', 'Lưu cấu hình gian hàng'));
    await flush();
    expect(mocks.updateStore).toHaveBeenLastCalledWith(
      expect.objectContaining({ avatarUrl: 'https://cdn.example/logo.png', coverUrl: 'https://cdn.example/cover.png' }),
    );
  });

  it('D7-10: "Xoá ảnh" của ô logo làm Lưu gửi chuỗi rỗng (xoá ảnh đã lưu)', async () => {
    mocks.store = { ...STORE, avatarUrl: 'https://cdn.example/logo.png', coverUrl: '' };
    const root = await mount();
    click(byText(root, 'button', 'Xoá ảnh'));
    expect(root.querySelector('[data-preview] img')).toBeNull();
    click(byText(root, 'button', 'Lưu cấu hình gian hàng'));
    await flush();
    expect(mocks.updateStore).toHaveBeenLastCalledWith(expect.objectContaining({ avatarUrl: '', coverUrl: '' }));
  });

  it('xoá slogan, URL logo và URL ảnh bìa rồi lưu → gửi chuỗi rỗng để API xoá giá trị cũ (không bỏ trường)', async () => {
    mocks.store = { ...STORE, avatarUrl: 'https://cdn.example/logo.png', coverUrl: 'https://cdn.example/cover.png' };
    const root = await mount();
    expect(inputByLabel(root, 'URL Logo thương hiệu').value).toBe('https://cdn.example/logo.png');
    typeInto(inputByLabel(root, 'Thông điệp thương hiệu'), '  ');
    typeInto(inputByLabel(root, 'URL Logo thương hiệu'), '');
    typeInto(inputByLabel(root, 'URL Ảnh bìa'), '   ');
    click(byText(root, 'button', 'Lưu cấu hình gian hàng'));
    await flush();
    const dto = mocks.updateStore.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(dto).toMatchObject({ headerNote: '', avatarUrl: '', coverUrl: '' });
    expect(JSON.parse(JSON.stringify(dto))).toMatchObject({ headerNote: '', avatarUrl: '', coverUrl: '' });
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

describe('cổng đối tác — tạm nghỉ nhận đơn (R2-MERCHANT-13)', () => {
  it('gian hàng đối tác có nút Tạm nghỉ nhận đơn; ẩn gian hàng được giải thích là không dừng bán', async () => {
    const root = await mount();
    expect(byText(root, 'label', 'Xuất bản công khai gian hàng')!.textContent).toContain('không dừng bán');
    click(byText(root, 'button', 'Tạm nghỉ nhận đơn'));
    await flush();
    expect(mocks.pause).toHaveBeenCalledWith(true);
  });

  it('đang tạm nghỉ: hiện trạng thái và nút mở nhận đơn lại', async () => {
    mocks.store = { ...STORE, ordersPausedAt: '2026-10-13T03:00:00.000Z' };
    const root = await mount();
    expect(root.textContent).toContain('Đang tạm nghỉ');
    click(byText(root, 'button', 'Mở nhận đơn lại'));
    await flush();
    expect(mocks.pause).toHaveBeenCalledWith(false);
  });

  it('gian hàng CTV không có nút tạm nghỉ (hàng do kho Tubu giao)', async () => {
    mocks.store = { ...STORE, type: 'CTV' };
    mocks.auth = { user: { role: 'AFFILIATE' }, status: 'authenticated', initialized: true };
    const root = await mount();
    expect(byText(root, 'button', 'Tạm nghỉ nhận đơn')).toBeNull();
  });
});

describe('cổng đối tác — đại lý giữ gian hàng CTV (isPartner)', () => {
  const PARTNER_TABS = ['Gian hàng & Subdomain', 'Sản phẩm', 'Đơn qua gian hàng', 'Đơn cần giao', 'Đối soát', 'Giao hàng & liên hệ', 'Tài khoản nhận đối soát'];
  const tabLabels = (root: ParentNode) => Array.from(root.querySelectorAll('[role="tab"]')).map((t) => (t.textContent ?? '').replace(/\d+$/, ''));

  it('CTV + isPartner=true: đủ tab đối tác, đăng sản phẩm, tài khoản nhận đối soát và Tạm nghỉ nhận đơn', async () => {
    mocks.store = { ...STORE, type: 'CTV', isPartner: true };
    const root = await mount();
    expect(tabLabels(root)).toEqual(expect.arrayContaining(PARTNER_TABS));
    expect(root.textContent).toContain('Sản phẩm riêng');
    expect(byText(root, 'button', 'Tạm nghỉ nhận đơn')).not.toBeNull();
    await openTab('Sản phẩm');
    expect(byText(root, 'button', 'Đăng sản phẩm mới')).not.toBeNull();
    await openTab('Tài khoản nhận đối soát');
    expect(root.querySelector('#merchant-bank-name')).not.toBeNull();
  });

  it('CTV + isPartner=false chưa có phiếu đối soát: chỉ ba tab của gian hàng CTV, không có nút tạm nghỉ', async () => {
    mocks.auth = { user: { role: 'AFFILIATE' }, status: 'authenticated', initialized: true };
    mocks.store = { ...STORE, type: 'CTV', isPartner: false };
    const root = await mount();
    expect(tabLabels(root)).toEqual(['Gian hàng & Subdomain', 'Sản phẩm', 'Đơn qua gian hàng']);
    expect(byText(root, 'button', 'Tạm nghỉ nhận đơn')).toBeNull();
    expect(mocks.settlement).not.toHaveBeenCalled();
  });

  it('CTV + isPartner=false đã có phiếu đối soát (vd. phiếu âm từ thông báo): có thêm tab Đối soát xem phiếu, vẫn không có tab đối tác khác', async () => {
    mocks.auth = { user: { role: 'AFFILIATE' }, status: 'authenticated', initialized: true };
    mocks.store = { ...STORE, type: 'CTV', isPartner: false, hasPayouts: true };
    mocks.settlement = vi.fn(async () => ({
      holdDays: 7,
      lines: [],
      total: 0,
      upcoming: [],
      payouts: [{ id: 'p9', storefrontId: 's1', amount: -42500, status: 'PENDING', createdAt: '2026-10-15T03:00:00.000Z', lines: [{ id: 'l9', kind: 'REVERSAL' }] }],
      tubuAccount: { bankName: 'Vietcombank', accountNo: '0011223344', accountName: 'TUBU TREE' },
    }));
    window.history.replaceState(null, '', '/merchant?tab=settlement');
    const root = await mount();
    expect(tabLabels(root)).toEqual(['Gian hàng & Subdomain', 'Hàng trả về', 'Sản phẩm', 'Đơn qua gian hàng', 'Đối soát']);
    expect(byText(root, '[role="tab"]', 'Đối soát')!.getAttribute('aria-selected')).toBe('true');
    expect(root.textContent).toContain('0011223344');
    expect(byText(root, 'button', 'Tạm nghỉ nhận đơn')).toBeNull();
  });

  describe('CUSTOMER còn sở hữu gian hàng', () => {
    const customer = () => {
      mocks.auth = { user: { role: 'CUSTOMER' }, status: 'authenticated', initialized: true };
    };

    it('có phiếu đối soát (hasPayouts): chỉ hai tab Hàng trả về và Đối soát, không có mục sửa gian hàng, sản phẩm, thẻ số liệu', async () => {
      customer();
      mocks.store = { ...STORE, type: 'CTV', isPartner: false, hasPayouts: true };
      mocks.getProducts.mockClear();
      mocks.listOrders.mockClear();
      mocks.listFulfil.mockClear();
      window.history.replaceState(null, '', '/merchant');
      const root = await mount();
      expect(tabLabels(root)).toEqual(['Hàng trả về', 'Đối soát']);
      expect(byText(root, '[role="tab"]', 'Hàng trả về')!.getAttribute('aria-selected')).toBe('true');
      expect(root.textContent).not.toContain('Kênh dành cho đối tác');
      expect(byText(root, 'button', 'Lưu thay đổi')).toBeNull();
      expect(root.textContent).not.toContain('Sản phẩm bán lại');
      expect(byText(root, 'a', 'Xem gian hàng')).toBeNull();
      expect(mocks.getProducts).not.toHaveBeenCalled();
      expect(mocks.listOrders).not.toHaveBeenCalled();
      expect(mocks.listFulfil).not.toHaveBeenCalled();
    });

    it('mở bằng ?tab=store hoặc ?tab=products vẫn rơi về Hàng trả về, không lộ tab cấm', async () => {
      customer();
      mocks.store = { ...STORE, type: 'CTV', isPartner: false, hasPayouts: true };
      window.history.replaceState(null, '', '/merchant?tab=products');
      const root = await mount();
      expect(byText(root, '[role="tab"]', 'Hàng trả về')!.getAttribute('aria-selected')).toBe('true');
      expect(byText(root, 'button', 'Đăng sản phẩm mới')).toBeNull();
    });

    it('cờ đối tác do admin bật tay còn nguyên: không dựng giao diện tự giao, không gọi danh sách đơn cần giao', async () => {
      customer();
      mocks.store = { ...STORE, type: 'CTV', isPartner: true, hasPayouts: true };
      mocks.listFulfil.mockClear();
      window.history.replaceState(null, '', '/merchant');
      const root = await mount();
      expect(tabLabels(root)).toEqual(['Hàng trả về', 'Đối soát']);
      expect(root.textContent).not.toContain('Đơn cần giao');
      expect(mocks.listFulfil).not.toHaveBeenCalled();
    });

    it('có gian hàng nhưng chưa có phiếu: vẫn là màn không có quyền', async () => {
      customer();
      mocks.store = { ...STORE, type: 'CTV', isPartner: false, hasPayouts: false };
      const root = await mount();
      expect(root.textContent).toContain('Kênh dành cho đối tác');
      expect(root.querySelector('[role="tablist"]')).toBeNull();
    });

    it('GET store trả 403 (không có gian hàng hoặc chưa có phiếu): màn không có quyền, không treo ở trạng thái tải', async () => {
      customer();
      mocks.store = new Error('Bạn không có quyền truy cập tài nguyên này.');
      const root = await mount();
      expect(root.textContent).toContain('Kênh dành cho đối tác');
      expect(root.textContent).not.toContain('Đang tải thông tin gian hàng');
      expect(root.querySelector('[role="tablist"]')).toBeNull();
    });
  });

  it('CTV + isPartner=false có phiếu đối soát: tab "Hàng trả về" chỉ có mục hàng trả, không gọi danh sách đơn cần giao', async () => {
    mocks.auth = { user: { role: 'AFFILIATE' }, status: 'authenticated', initialized: true };
    mocks.store = { ...STORE, type: 'CTV', isPartner: false, hasPayouts: true };
    mocks.returns = vi.fn(async () => [
      { id: 'r1', status: 'APPROVED', createdAt: '2026-10-13T03:00:00Z', reviewedAt: '2026-10-13T05:00:00Z', receivedAt: null, reasonLabel: null, reason: 'Hỏng', fullReturn: false, shopFault: null, orderCode: 'TB-9', lines: [{ productName: 'Mật ong', variationName: null, quantity: 1 }] },
    ]);
    window.history.replaceState(null, '', '/merchant?tab=fulfil');
    const root = await mount();
    expect(byText(root, '[role="tab"]', 'Hàng trả về')!.getAttribute('aria-selected')).toBe('true');
    expect(root.textContent).toContain('Hàng khách trả về (1 chờ nhận)');
    expect(byText(root, 'button', 'Đã nhận hàng trả')).not.toBeNull();
    expect(mocks.listFulfil).not.toHaveBeenCalled();
  });

  it('CTV + isPartner=false có phiếu nhưng chưa có yêu cầu trả nào: tab hàng trả về báo trống', async () => {
    mocks.auth = { user: { role: 'AFFILIATE' }, status: 'authenticated', initialized: true };
    mocks.store = { ...STORE, type: 'CTV', isPartner: false, hasPayouts: true };
    window.history.replaceState(null, '', '/merchant?tab=fulfil');
    const root = await mount();
    expect(root.textContent).toContain('Chưa có hàng khách trả về.');
  });

  it('MERCHANT không có trường isPartner (phản hồi cũ): vẫn đủ tab đối tác', async () => {
    mocks.store = { ...STORE, type: 'MERCHANT' };
    const root = await mount();
    expect(tabLabels(root)).toEqual(expect.arrayContaining(PARTNER_TABS));
  });

  it('BRAND không isPartner: không có tab đối tác', async () => {
    mocks.store = { ...STORE, type: 'BRAND' };
    const root = await mount();
    expect(tabLabels(root)).toEqual(['Gian hàng & Subdomain', 'Sản phẩm', 'Đơn qua gian hàng']);
  });
});

describe('cổng đối tác — tab Tài khoản nhận đối soát (SELLER-8)', () => {
  it('nói rõ khách trả tiền cho Tubu, không có mã VietQR mẫu; lưu gửi BIN theo ngân hàng chọn và tên viết hoa', async () => {
    const root = await mount();
    await openTab('Tài khoản nhận đối soát');
    expect(root.textContent).not.toContain('Khách luôn thanh toán cho Tubu Tree');
    expect(root.textContent).toContain('Đơn COD do bạn tự giao: bạn thu tiền mặt của khách');
    expect(root.textContent).toContain('tab Đối soát');
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
  });

  it('R5-PARTNER-6: không có địa chỉ người nhận thì ghi "Khách mua", không bao giờ hiện họ tên hay SĐT tài khoản người mua (kể cả khi API cũ còn trả)', async () => {
    mocks.listFulfil = vi.fn(async () => ({
      data: [FULFIL('9', 'CONFIRMED', { shippingAddress: null, user: { fullName: 'Chủ Tài Khoản Mua', phone: '0944444444' } })],
      meta: { page: 1, limit: 20, total: 1 },
      counts: { CONFIRMED: 1 },
      slaConfig: { confirmHours: 24, shipHours: 48, deliverDays: 7 },
    }));
    const root = await mount();
    await openTab('Đơn cần giao');
    const card = root.querySelector('article[aria-label="Đơn TF9"]')!;
    expect(card.textContent).toContain('Khách mua');
    expect(card.textContent).not.toContain('Chủ Tài Khoản Mua');
    expect(card.textContent).not.toContain('0944444444');
  });

  it('R2-MERCHANT-12: ô link tra cứu không dùng kiểm tra URL của trình duyệt (báo lỗi tiếng Anh), gõ thiếu https:// vẫn gửi được', async () => {
    const root = await mount();
    await openTab('Đơn cần giao');
    const second = root.querySelector('article[aria-label="Đơn TF2"]')!;
    click(byText(second, 'button', 'Nhập mã vận đơn'));
    const url = inputByLabel(second, 'Link tra cứu') as HTMLInputElement;
    expect(url.type).toBe('text');
    expect(url.inputMode).toBe('url');
    typeInto(inputByLabel(second, 'Đơn vị vận chuyển'), 'GHN');
    typeInto(inputByLabel(second, 'Mã vận đơn'), 'GHNABC1');
    typeInto(url, ' ghn.vn/tra-cuu/GHNABC1 ');
    click(byText(second, 'button', 'Xác nhận đã gửi hàng'));
    await flush();
    expect(mocks.fulfilAction).toHaveBeenLastCalledWith('ship', '2', { carrier: 'GHN', trackingCode: 'GHNABC1', trackingUrl: 'ghn.vn/tra-cuu/GHNABC1' });

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

  it('R4-PARTNER-1: lý do chỉ có khoảng trắng không gửi được, nút xác nhận tắt cho tới khi có chữ', async () => {
    const root = await mount();
    await openTab('Đơn cần giao');
    const first = root.querySelector('article[aria-label="Đơn TF1"]')!;
    mocks.fulfilAction.mockClear();
    click(byText(first, 'button', 'Huỷ đơn'));
    const submit = byText(first, 'button', 'Xác nhận huỷ đơn') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    typeInto(inputByLabel(first, 'Lý do huỷ'), '    ');
    expect((byText(first, 'button', 'Xác nhận huỷ đơn') as HTMLButtonElement).disabled).toBe(true);
    first.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    expect(mocks.fulfilAction).not.toHaveBeenCalled();
    typeInto(inputByLabel(first, 'Lý do huỷ'), 'Hết hàng');
    expect((byText(first, 'button', 'Xác nhận huỷ đơn') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('cổng đối tác — tab Đối soát', () => {
  it('công thức thực nhận, số âm hiện dấu trừ, phiếu đã chuyển kèm mã giao dịch', async () => {
    const root = await mount();
    await openTab('Đối soát');
    const selfShip = root.textContent!.slice(root.textContent!.indexOf('Mỗi đơn bạn tự giao'), root.textContent!.indexOf('Chờ lập phiếu'));
    expect(selfShip).toContain('thực nhận = tiền khách thực trả cho hàng + phí giao − phí sàn Tubu − tiền COD bạn đã tự thu');
    // Q8 review S3: nêu cả giảm giá hạng thành viên; mỗi khoản giảm chỉ trừ vào món được hưởng khoản đó.
    // Q8 S2/S7: hàng đối tác bán giá lẻ (giờ vàng nếu Tubu đưa vào), chỉ chịu mã của khách và giảm hạng; không Điểm Xanh.
    expect(selfShip).toContain('Hàng của bạn bán theo giá lẻ niêm yết (hoặc giá giờ vàng khi Tubu Tree đưa món vào giờ vàng)');
    expect(selfShip).toContain('Phần mã giảm giá của khách và giảm giá hạng thành viên áp cho món của bạn được trừ vào số tiền của bạn');
    expect(selfShip).toContain('mã chỉ áp cho món khác không trừ vào món của bạn');
    expect(selfShip).toContain('Khách không trả hàng của bạn bằng Điểm Xanh; hàng của bạn không bán giá đại lý, không đặt định kỳ, không vào combo hay mua chung');
    expect(selfShip).not.toContain('Điểm Xanh áp cho');
    expect(root.textContent).toContain('sau 7 ngày');
    expect(root.textContent).toContain('Chờ lập phiếu (2 khoản)');
    expect(root.textContent).toContain('−15.000');
    expect(root.textContent).toContain('mã GD FT123');
    // Gian hàng không có hàng Tubu giao hộ: không có cột/ghi chú giao hộ.
    expect(root.textContent).not.toContain('Phí giao hộ');
    expect(root.textContent).not.toContain('Hàng Tubu giao hộ:');
    expect(scrollRegionProblems(root)).toEqual([]);
  });

  it('R2-MERCHANT-4: phiếu âm ghi "Bạn cần nộp", tài khoản Tubu, nội dung CK, hạn nộp; mở phiếu xem từng đơn', async () => {
    mocks.settlement = vi.fn(async () => ({
      holdDays: 7,
      lines: [],
      total: 0,
      upcoming: [],
      negativeDueDays: 7,
      tubuAccount: { bankName: 'Vietcombank', accountNo: '0071000999', accountName: 'CONG TY TUBU TREE' },
      payouts: [
        {
          id: 'p2',
          storefrontId: 's1',
          amount: -103500,
          status: 'PENDING',
          direction: 'TO_TUBU',
          transferMemo: 'TUBU DS ABCD1234',
          dueAt: '2026-10-21T03:00:00.000Z',
          createdAt: '2026-10-14T03:00:00.000Z',
          lines: [
            { id: 'l9', orderId: 'o9', orderCode: 'TF9', kind: 'SALE', goodsAmount: 210000, shippingFee: 0, commissionAmount: 31500, codCollected: 210000, netAmount: -31500, deliveredAt: null, createdAt: '2026-10-14T03:00:00.000Z' },
          ],
        },
        { id: 'p1', storefrontId: 's1', amount: -20000, status: 'PAID', direction: 'TO_TUBU', transferMemo: 'TUBU DS X', dueAt: null, createdAt: '2026-09-20T03:00:00.000Z', paidAt: '2026-09-22T03:00:00.000Z', bankRef: 'FT9', lines: [] },
      ],
    }));
    const root = await mount();
    await openTab('Đối soát');
    const pending = root.querySelector('li[aria-label="Phiếu TUBU DS ABCD1234"]')!;
    expect(pending.textContent).toContain('Bạn cần nộp 103.500');
    expect(pending.textContent).toContain('Chờ nộp');
    expect(pending.textContent).not.toContain('Chờ chuyển');
    expect(pending.textContent).toContain('Vietcombank · 0071000999 · CONG TY TUBU TREE');
    expect(pending.textContent).toContain('Nội dung chuyển khoản: TUBU DS ABCD1234');
    expect(pending.textContent).toContain('Hạn nộp 21/10/2026');
    const summary = pending.querySelector('summary')!;
    expect(summary.textContent).toContain('Xem 1 khoản');
    expect(pending.querySelector('table')!.textContent).toContain('TF9');
    expect(root.textContent).toContain('Đã thu');
    expect(root.textContent).toContain('trong 7 ngày');
  });

  it('R4-PARTNER-4: phiếu đã huỷ hiện lý do, các khoản lúc huỷ và lời dặn; không lộ id nội bộ; phiếu âm đã huỷ nói chưa cần nộp', async () => {
    const line = { id: 'l9', orderId: 'o9', orderCode: 'TF9', kind: 'SALE', goodsAmount: 210000, shippingFee: 0, commissionAmount: 31500, codCollected: 210000, netAmount: -31500, deliveredAt: null, createdAt: '2026-10-14T03:00:00.000Z' };
    mocks.settlement = vi.fn(async () => ({
      holdDays: 7,
      lines: [],
      total: 0,
      upcoming: [],
      negativeDueDays: 7,
      payouts: [
        { id: 'pc2', storefrontId: 's1', amount: -31500, status: 'CANCELLED', direction: 'TO_TUBU', transferMemo: 'TUBU DS CCCC0002', dueAt: null, createdAt: '2026-10-14T03:00:00.000Z', cancelledAt: '2026-10-15T03:00:00.000Z', cancelReason: 'Lập nhầm kỳ', cancelledLineCount: 1, lines: [line] },
        { id: 'pc1', storefrontId: 's1', amount: 87360, status: 'CANCELLED', direction: 'TO_MERCHANT', transferMemo: 'TUBU DS CCCC0001', dueAt: null, createdAt: '2026-10-12T03:00:00.000Z', cancelledAt: '2026-10-13T03:00:00.000Z', cancelReason: 'Sai tài khoản nhận', cancelledLineCount: 2, lines: [line, { ...line, id: 'l8', orderId: 'o8', orderCode: 'TF8' }] },
      ],
    }));
    const root = await mount();
    await openTab('Đối soát');
    const positive = root.querySelector('li[aria-label="Phiếu TUBU DS CCCC0001"]')!;
    expect(positive.textContent).toContain('Đã huỷ');
    expect(positive.textContent).toContain('Phiếu chuyển 87.360');
    expect(positive.textContent).toContain('Tubu Tree đã huỷ phiếu này ngày 13/10/2026: Sai tài khoản nhận.');
    expect(positive.textContent).toContain('Các khoản của phiếu đã quay lại bảng kê và sẽ vào phiếu mới.');
    expect(positive.textContent).not.toContain('Bạn chưa cần nộp');
    expect(positive.textContent).toContain('Xem 2 khoản lúc huỷ');
    expect(positive.textContent).not.toContain('Tubu sẽ chuyển');
    const negative = root.querySelector('li[aria-label="Phiếu TUBU DS CCCC0002"]')!;
    expect(negative.textContent).toContain('Phiếu nộp 31.500');
    expect(negative.textContent).toContain('Bạn chưa cần nộp khoản này; nếu đã chuyển khoản, liên hệ Tubu Tree để đối chiếu.');
    expect(negative.textContent).not.toContain('Bạn cần nộp');
    expect(negative.textContent).not.toContain('Chuyển vào tài khoản Tubu Tree');
  });

  it('Q8: khoản hàng Tubu giao hộ nằm cùng bảng kê với đơn tự giao — nhãn, tên món, phí giao hộ; bỏ câu "thoả thuận ký gửi"', async () => {
    const item = { productName: 'Mật ong', variationName: 'Hũ 500g', quantity: 2 };
    const sale = {
      orderId: 'o7',
      orderCode: 'TT7',
      kind: 'SALE',
      refKey: 'ITEM:i1',
      orderItemId: 'i1',
      item,
      goodsAmount: 102000,
      shippingFee: 0,
      commissionAmount: 10200,
      opsFeeAmount: 4440,
      codCollected: 0,
      netAmount: 87360,
      deliveredAt: '2026-10-01T03:00:00.000Z',
    };
    mocks.settlement = vi.fn(async () => ({
      holdDays: 7,
      consignmentTerms: { commissionPct: 0.1, feePct: 0.02, feeFixed: 3400 },
      lines: [
        { orderId: 'o1', orderCode: 'TF1', kind: 'SALE', refKey: '', goodsAmount: 200000, shippingFee: 30000, commissionAmount: 30000, codCollected: 0, netAmount: 200000, deliveredAt: '2026-10-01T03:00:00.000Z' },
        sale,
        { ...sale, kind: 'REVERSAL', refKey: 'RETURN:r1:ITEM:i1', units: 1, goodsAmount: -51000, commissionAmount: -5100, opsFeeAmount: -2220, netAmount: -43680, deliveredAt: null },
      ],
      total: 243680,
      upcoming: [{ ...sale, orderId: 'o8', orderCode: 'TT8', refKey: 'ITEM:i9', orderItemId: 'i9', availableAt: '2026-10-20T03:00:00.000Z' }],
      payouts: [{ id: 'p1', storefrontId: 's1', amount: 87360, status: 'PAID', createdAt: '2026-09-20T03:00:00.000Z', paidAt: '2026-09-21T03:00:00.000Z', bankRef: 'FT1', lines: [{ ...sale, id: 'l1', createdAt: '2026-09-20T03:00:00.000Z' }] }],
    }));
    const root = await mount();
    await openTab('Đối soát');
    expect(root.textContent).toContain('Hàng Tubu giao hộ: kho Tubu Tree giao và thu tiền của khách');
    expect(root.textContent).toContain('phí sàn 10% − phí Tubu giao hộ 2% + 3.400đ mỗi đơn');
    expect(root.textContent).toContain('Phí giao hàng do Tubu Tree thu và chịu');
    expect(root.textContent).toContain('3.400đ mỗi đơn (mức hiện tại; mỗi đơn tính theo mức áp dụng lúc khách đặt)');
    expect(root.textContent).toContain('chỉ đơn Tubu Tree đã thu được tiền');
    const consignmentNote = root.textContent!.slice(root.textContent!.indexOf('Hàng Tubu giao hộ: kho Tubu Tree'), root.textContent!.indexOf('Chờ lập phiếu'));
    expect(consignmentNote).toContain('giá bán của món, kể cả giá giờ vàng, đã trừ phần mã giảm giá của khách và giảm giá hạng thành viên áp cho chính món đó');
    expect(consignmentNote).toContain('mã chỉ áp cho món khác không trừ vào món của bạn');
    expect(consignmentNote).toContain('Điểm Xanh không dùng cho hàng của bạn');
    expect(consignmentNote).not.toContain('Điểm Xanh áp cho');
    expect(consignmentNote).not.toContain('chia theo giá trị món');
    expect(root.textContent).not.toContain('thoả thuận ký gửi');
    expect(root.textContent).not.toContain('chưa vào đối soát tự động');
    expect(root.textContent).not.toContain('Hàng Tubu giao hộ đã bán');
    expect(root.textContent).toContain('Chờ lập phiếu (3 khoản)');
    expect(root.textContent).toContain('Sắp đủ hạn (1 khoản)');

    const pending = root.querySelector('[aria-label="Khoản chờ lập phiếu đối soát"]')!;
    expect(Array.from(pending.querySelectorAll('th')).map((th) => th.textContent)).toEqual([
      'Đơn', 'Ngày giao', 'Tiền hàng', 'Phí giao', 'Phí sàn', 'Phí giao hộ', 'COD bạn đã thu', 'Thực nhận',
    ]);
    const rows = Array.from(pending.querySelectorAll('tbody tr')).map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => td.textContent));
    expect(rows[0]).toEqual(['TF1', '01/10/2026', '200.000đ', '30.000đ', '−30.000đ', '—', '0đ', '200.000đ']);
    expect(rows[1]).toEqual(['TT7Tubu giao hộMật ong (Hũ 500g) × 2', '01/10/2026', '102.000đ', '—', '−10.200đ', '−4.440đ', '—', '87.360đ']);
    // R4-PARTNER-2: dòng đảo ghi số đơn vị trả (1/2), không phải "× 2" của cả dòng hàng.
    expect(rows[2]).toEqual(['TT7(trả một phần)Tubu giao hộMật ong (Hũ 500g) · trả 1/2', '—', '−51.000đ', '—', '5.100đ', '2.220đ', '—', '−43.680đ']);
    const payout = root.querySelector('li[aria-label^="Phiếu"]')!;
    expect(payout.querySelector('table')!.textContent).toContain('Tubu giao hộ');
    expect(scrollRegionProblems(root)).toEqual([]);
  });

  it('R4-PARTNER-2: dòng đảo trả cả đơn hiện số đơn vị còn lại; dòng đảo cũ chưa có số đơn vị không hiện số lượng sai', async () => {
    const item = { productName: 'Trà Shan', variationName: null, quantity: 3 };
    const reversal = { orderId: 'o3', orderCode: 'TT3', kind: 'REVERSAL', orderItemId: 'i3', item, goodsAmount: -30000, shippingFee: 0, commissionAmount: -3000, opsFeeAmount: 0, codCollected: 0, netAmount: -27000, deliveredAt: null };
    mocks.settlement = vi.fn(async () => ({
      holdDays: 7,
      consignmentTerms: { commissionPct: 0.1, feePct: 0, feeFixed: 0 },
      lines: [
        { ...reversal, refKey: 'ITEM:i3', units: 2 },
        { ...reversal, orderId: 'o4', orderCode: 'TT4', refKey: 'ITEM:i4', orderItemId: 'i4' },
      ],
      total: -54000,
      upcoming: [],
      payouts: [],
    }));
    const root = await mount();
    await openTab('Đối soát');
    const pending = root.querySelector('[aria-label="Khoản chờ lập phiếu đối soát"]')!;
    const rows = Array.from(pending.querySelectorAll('tbody tr')).map((tr) => tr.querySelector('td')!.textContent);
    expect(rows).toEqual(['TT3(trả hàng)Tubu giao hộTrà Shan · trả 2/3', 'TT4(trả hàng)Tubu giao hộTrà Shan']);
  });

  it('Q8 review S5: món Tubu giao hộ chưa vào đối soát tự động — danh sách chỉ đọc kèm lý do, không cộng vào bảng kê', async () => {
    mocks.settlement = vi.fn(async () => ({
      holdDays: 7,
      consignmentTerms: { commissionPct: 0.1, feePct: 0, feeFixed: 0 },
      lines: [],
      total: 0,
      upcoming: [],
      payouts: [],
      consignmentExcluded: {
        settleFrom: '2026-10-01T00:00:00.000Z',
        total: 4,
        lines: [
          { orderId: 'o5', orderCode: 'TT5', orderItemId: 'i5', productName: 'Mật ong', variationName: 'Hũ 500g', quantity: 2, goodsAmount: 180000, createdAt: '2026-10-05T03:00:00.000Z', deliveredAt: '2026-10-07T03:00:00.000Z', reason: 'TAKEOVER_UNCONFIRMED', linkPending: true },
          { orderId: 'o6', orderCode: 'TT6', orderItemId: 'i6', productName: 'Mật ong', variationName: 'Hũ 250g', quantity: 1, goodsAmount: 95000, createdAt: '2026-10-06T03:00:00.000Z', deliveredAt: '2026-10-08T03:00:00.000Z', reason: 'TAKEOVER_BEFORE_CONFIRM', confirmedAt: '2026-10-09T03:00:00.000Z', linkPending: false },
          { orderId: 'o7', orderCode: 'TT7', orderItemId: 'i7', productName: 'Bột sắn dây', variationName: null, quantity: 1, goodsAmount: 70000, createdAt: '2026-10-04T03:00:00.000Z', deliveredAt: '2026-10-06T03:00:00.000Z', reason: 'TAKEOVER_UNCONFIRMED', linkPending: false },
          { orderId: 'o4', orderCode: 'TT4', orderItemId: 'i4', productName: 'Trà Shan', variationName: null, quantity: 1, goodsAmount: 90000, createdAt: '2026-09-20T03:00:00.000Z', deliveredAt: null, reason: 'BEFORE_SETTLE_FROM', linkPending: false },
        ],
      },
    }));
    const root = await mount();
    await openTab('Đối soát');
    expect(root.textContent).toContain('Hàng Tubu giao hộ chưa vào đối soát tự động (4 món)');
    expect(root.textContent).toContain('Chờ lập phiếu (0 khoản)');
    const region = root.querySelector('[aria-label="Hàng Tubu giao hộ chưa vào đối soát tự động"]')!;
    expect(Array.from(region.querySelectorAll('th')).map((th) => th.textContent)).toEqual(['Đơn', 'Ngày đặt', 'Món', 'Tiền khách trả cho món', 'Lý do']);
    const rows = Array.from(region.querySelectorAll('tbody tr')).map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => td.textContent));
    expect(rows).toEqual([
      ['TT5', '05/10/2026', 'Mật ong (Hũ 500g) × 2', '180.000đ', 'Chờ Tubu Tree xác nhận là hàng ký gửi của bạn'],
      // R4-PARTNER-3: đã xác nhận rồi thì không còn nói "chờ xác nhận"; nói rõ đơn đặt trước lúc xác nhận phải đối soát riêng.
      ['TT6', '06/10/2026', 'Mật ong (Hũ 250g) × 1', '95.000đ', 'Đặt trước khi Tubu Tree xác nhận hàng ký gửi (09/10/2026) — đối soát riêng ngoài phiếu, liên hệ Tubu Tree'],
      ['TT7', '04/10/2026', 'Bột sắn dây × 1', '70.000đ', 'Đặt lúc chưa xác nhận hàng ký gửi — liên hệ Tubu Tree để đối chiếu'],
      ['TT4', '20/09/2026', 'Trà Shan × 1', '90.000đ', 'Đặt trước 01/10/2026 — trước khi đối soát tự động'],
    ]);
    expect(scrollRegionProblems(root)).toEqual([]);
  });

  it('đơn bị trả: giải thích phần nộp lại (COD là số tiền mặt đã thu), dòng ghi "(trả hàng)"', async () => {
    mocks.settlement = vi.fn(async () => ({
      holdDays: 7,
      lines: [
        { orderId: 'o3', orderCode: 'TF3', kind: 'REVERSAL', goodsAmount: 0, shippingFee: 0, commissionAmount: 0, codCollected: 130000, netAmount: -130000, deliveredAt: null },
      ],
      total: -130000,
      upcoming: [],
      payouts: [],
    }));
    const root = await mount();
    await openTab('Đối soát');
    expect(root.textContent).toContain('Đơn bị trả: Tubu Tree hoàn tiền cho khách');
    expect(root.textContent).toContain('TF3(trả hàng)');
    expect(root.textContent).toContain('−130.000');
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

  it('D7-10: mỗi hàng sản phẩm có ảnh 40px (thumbnail trước ảnh đầu, thiếu thì khung trống) và menu "⋯" thay cho dãy nút chữ', async () => {
    mocks.getProducts = vi.fn(async () => ({
      ownProducts: [
        PRODUCT('a', 'APPROVED', { isActive: true, thumbnail: 'https://cdn.example/a-thumb.jpg', images: ['https://cdn.example/a-1.jpg'] }),
        PRODUCT('b', 'APPROVED', { isActive: true, images: ['https://cdn.example/b-1.jpg'] }),
        PRODUCT('c', 'PENDING_REVIEW', { images: [] }),
      ],
      resellProducts: [PRODUCT('r', 'APPROVED', { images: ['https://cdn.example/r-1.jpg'] })],
      meta: { page: 1, limit: 20, ownTotal: 3, resellTotal: 1 },
    }));
    const root = await mount();
    await openTab('Sản phẩm');
    const thumbSrc = (name: string) => tableRow(root, name).querySelector('[data-thumb] img')?.getAttribute('src') ?? null;
    expect(thumbSrc('SP a')).toBe('https://cdn.example/a-thumb.jpg');
    expect(thumbSrc('SP b')).toBe('https://cdn.example/b-1.jpg');
    expect(thumbSrc('SP c')).toBeNull();
    expect(tableRow(root, 'SP c').querySelector('[data-thumb]')!.className).toContain('h-10');

    const trigger = tableRow(root, 'SP a').querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
    expect(trigger.getAttribute('aria-label')).toBe('Thao tác với SP a');
    expect(trigger.className).toContain('min-h-[44px]');
    expect(byText(tableRow(root, 'SP a'), 'button', 'Sửa')).toBeNull();
    expect(openRowMenu(tableRow(root, 'SP a')).map((b) => b.textContent)).toEqual(['Sửa', 'Ngừng bán']);
    // Khung bảng cuộn ngang (overflow-x) sẽ cắt menu ở hàng cuối nếu menu nằm trong nó.
    expect(document.getElementById(trigger.getAttribute('aria-controls')!)!.closest('[role="region"]')).toBeNull();

    click(byText(root, 'button', 'Sản phẩm Tubu Tree bán lại'));
    expect(thumbSrc('SP r')).toBe('https://cdn.example/r-1.jpg');
  });

  it('WEB-1: cột giá của danh sách hiện giá khách thực trả (khuyến mãi nếu có) kèm giá gốc gạch ngang', async () => {
    mocks.getProducts = vi.fn(async () => ({
      ownProducts: [PRODUCT('s', 'APPROVED', { isActive: true, salePrice: 90000 }), PRODUCT('n', 'APPROVED', { isActive: true, salePrice: null })],
      resellProducts: [],
      meta: { page: 1, limit: 20, ownTotal: 2, resellTotal: 0 },
    }));
    const root = await mount();
    await openTab('Sản phẩm');
    const cells = Array.from(root.querySelectorAll('tbody td.text-forest-700'));
    expect(cells[0]!.firstChild!.textContent).toBe('90.000đ');
    expect(cells[0]!.querySelector('del')!.textContent).toBe('120.000đ');
    expect(cells[1]!.textContent).toBe('120.000đ');
    expect(cells[1]!.querySelector('del')).toBeNull();
  });

  it('Gỡ khỏi shop: hỏi xác nhận, từ chối thì không gọi API, đồng ý gọi đúng sản phẩm; lỗi hiện thông báo danger', async () => {
    const root = await mount();
    await openTab('Sản phẩm');
    click(byText(root, 'button', 'Sản phẩm Tubu Tree bán lại'));
    expect(byText(root, 'button', 'Gỡ khỏi shop')).toBeNull();
    const remove = openRowMenu(tableRow(root, 'SP r1')).find((b) => b.textContent === 'Gỡ khỏi shop')!;
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
    rowAction(root, 'SP r1', 'Gỡ khỏi shop');
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

  it('R2-MERCHANT-1: mã đang thuộc sản phẩm Tubu đang bán → báo cần Tubu xác nhận, không lộ tồn kho Tubu', async () => {
    mocks.checkPancake = vi.fn(async (code: string) => ({
      pancakeId: code,
      productName: 'Tiêu đen',
      variationName: '200g',
      retailPrice: 120000,
      salePrice: null,
      stock: null,
      requiresAdminConfirm: true,
    }));
    const root = await mount();
    await openTab('Sản phẩm');
    click(byText(root, 'button', 'Đăng sản phẩm mới'));
    const overlay = root.querySelector<HTMLElement>('.fixed.inset-0')!;
    click(overlay.querySelectorAll<HTMLInputElement>('input[type="radio"]')[1]!);
    typeInto(inputByLabel(overlay, 'Mã biến thể Pancake'), 'PCK-9');
    click(byText(overlay, 'button', 'Kiểm tra mã'));
    await flush();
    const status = overlay.querySelector('[role="status"]')!;
    expect(status.textContent).toContain('Tiêu đen (200g)');
    expect(status.textContent).toContain('Tubu Tree xác nhận');
    expect(status.textContent).not.toContain('còn');
    expect(status.textContent).not.toContain('null');
  });

  it('Q8: lựa chọn "Tubu giao hộ" nói rõ tiền từng món vào tab Đối soát sau khi giao, phí giao Tubu giữ', async () => {
    const root = await mount();
    await openTab('Sản phẩm');
    click(byText(root, 'button', 'Đăng sản phẩm mới'));
    const overlay = root.querySelector<HTMLElement>('.fixed.inset-0')!;
    const option = byText(overlay, 'label', 'Tubu giao hộ')!;
    expect(option.textContent).toContain('vào tab Đối soát sau khi giao');
    expect(option.textContent).toContain('phí giao do Tubu Tree giữ');
    expect(option.textContent).not.toContain('thoả thuận ký gửi');
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
      ownProducts: [PRODUCT('a', 'APPROVED', { isActive: true, heldQty: 3 }), PRODUCT('z', 'APPROVED', { isActive: false })],
      resellProducts: [],
      meta: { page: 1, limit: 20, ownTotal: 2, resellTotal: 0 },
    }));
    const root = await mount();
    await openTab('Sản phẩm');
    rowAction(root, 'SP a', 'Sửa');
    const overlay = root.querySelector<HTMLElement>('.fixed.inset-0')!;
    expect(overlay.textContent).toContain('vẫn bán với nội dung cũ');
    expect(overlay.textContent).not.toContain('chờ Tubu Tree duyệt lại');
    expect(byText(overlay, 'label', 'Số còn bán được')!.textContent).toContain('đã trừ 3 sp khách đặt chưa gửi');
    typeInto(inputByLabel(overlay, 'Số còn bán được'), '12');
    click(byText(overlay, 'button', 'Lưu thay đổi'));
    await flush();
    expect(mocks.updateProduct).toHaveBeenCalledWith('a', { stock: 12 });

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    rowAction(root, 'SP a', 'Ngừng bán');
    await flush();
    expect(confirm).toHaveBeenCalled();
    expect(mocks.stopSelling).toHaveBeenCalledWith('a');
    expect(root.textContent).toContain('Đã ngừng bán');
    rowAction(root, 'SP z', 'Mở bán lại');
    await flush();
    expect(mocks.updateProduct).toHaveBeenLastCalledWith('z', { isActive: true });
  });

  describe('R4-PARTNER-6: sản phẩm đã gỡ liên kết Pancake đổi được mã hoặc chuyển sang tự giao', () => {
    const UNLINKED = (extra: Record<string, unknown> = {}) =>
      PRODUCT('u', 'APPROVED', { isActive: false, fulfilment: 'MERCHANT', pancakeLinkCode: 'PCK-OLD', linkState: 'AWAITING', ...extra });
    const radioOf = (root: ParentNode, label: string) => byText(root, 'label', label)!.querySelector<HTMLInputElement>('input[type="radio"]')!;
    async function openEdit(product: Record<string, unknown>) {
      mocks.getProducts = vi.fn(async () => ({ ownProducts: [product], resellProducts: [], meta: { page: 1, limit: 20, ownTotal: 1, resellTotal: 0 } }));
      const root = await mount();
      await openTab('Sản phẩm');
      const open = () => {
        rowAction(root, product.name as string, 'Sửa');
        return root.querySelector<HTMLElement>('.fixed.inset-0')!;
      };
      return { root, row: root.querySelector('tbody')!, open };
    }

    it('dòng sản phẩm nói rõ mã Pancake đã gỡ liên kết (không còn ghi "chờ duyệt" khi đã được duyệt)', async () => {
      const { row } = await openEdit(UNLINKED());
      expect(row.textContent).toContain('Mã Pancake PCK-OLD');
      expect(row.textContent).toContain('đã gỡ liên kết');
      expect(row.textContent).not.toContain('PCK-OLD, chờ duyệt');
    });

    it('mở Sửa: hiện mã hiện tại, ẩn giá và tồn kho (lấy theo kho Tubu); mặc định giữ mã nên không gửi pancakeCode', async () => {
      const { open } = await openEdit(UNLINKED());
      const overlay = open();
      expect(overlay.textContent).toContain('PCK-OLD');
      expect(overlay.querySelector('#merchant-edit-price')).toBeNull();
      expect(overlay.querySelector('#merchant-edit-stock')).toBeNull();
      expect(radioOf(overlay, 'Giữ mã hiện tại').checked).toBe(true);
      typeInto(inputByLabel(overlay, 'Mô tả ngắn'), 'Ngắn hơn');
      click(byText(overlay, 'button', 'Lưu thay đổi'));
      await flush();
      expect(mocks.updateProduct).toHaveBeenCalledWith('u', { shortDesc: 'Ngắn hơn' });
    });

    it('đổi sang mã khác: phải kiểm mã trước, rồi gửi đúng mã đã kiểm', async () => {
      mocks.checkPancake = vi.fn(async (code: string) => ({
        pancakeId: code.trim(),
        productName: 'Bột giặt quế',
        variationName: '1kg',
        retailPrice: 150000,
        salePrice: null,
        stock: 40,
      }));
      const { open } = await openEdit(UNLINKED());
      const overlay = open();
      click(radioOf(overlay, 'Đổi sang mã Pancake khác'));
      typeInto(inputByLabel(overlay, 'Mã biến thể Pancake mới'), ' PCK-NEW ');
      click(byText(overlay, 'button', 'Lưu thay đổi'));
      await flush();
      expect(mocks.updateProduct).not.toHaveBeenCalled();
      expect(overlay.querySelector('[role="alert"]')!.textContent).toContain('Kiểm tra mã');
      click(byText(overlay, 'button', 'Kiểm tra mã'));
      await flush();
      expect(mocks.checkPancake).toHaveBeenCalledWith(' PCK-NEW ');
      expect(overlay.querySelector('[role="status"]')!.textContent).toContain('Bột giặt quế (1kg)');
      click(byText(overlay, 'button', 'Lưu thay đổi'));
      await flush();
      expect(mocks.updateProduct).toHaveBeenCalledWith('u', { pancakeCode: 'PCK-NEW' });
    });

    it('sửa lại ô mã sau khi kiểm thì kết quả kiểm cũ mất hiệu lực', async () => {
      const { open } = await openEdit(UNLINKED());
      const overlay = open();
      click(radioOf(overlay, 'Đổi sang mã Pancake khác'));
      typeInto(inputByLabel(overlay, 'Mã biến thể Pancake mới'), 'PCK-NEW');
      click(byText(overlay, 'button', 'Kiểm tra mã'));
      await flush();
      typeInto(inputByLabel(overlay, 'Mã biến thể Pancake mới'), 'PCK-NEW2');
      expect(overlay.querySelector('[role="status"]')).toBeNull();
      click(byText(overlay, 'button', 'Lưu thay đổi'));
      await flush();
      expect(mocks.updateProduct).not.toHaveBeenCalled();
    });

    it('mã mới không hợp lệ: hiện lỗi của API dưới ô mã, không gửi', async () => {
      mocks.checkPancake = vi.fn(async () => {
        throw new Error('Mã đã được gian hàng khác liên kết');
      });
      const { open } = await openEdit(UNLINKED());
      const overlay = open();
      click(radioOf(overlay, 'Đổi sang mã Pancake khác'));
      typeInto(inputByLabel(overlay, 'Mã biến thể Pancake mới'), 'SAI');
      click(byText(overlay, 'button', 'Kiểm tra mã'));
      await flush();
      expect(overlay.querySelector('[role="alert"]')!.textContent).toContain('Mã đã được gian hàng khác liên kết');
      click(byText(overlay, 'button', 'Lưu thay đổi'));
      await flush();
      expect(mocks.updateProduct).not.toHaveBeenCalled();
    });

    it('chuyển sang tự giao: bỏ mã (pancakeCode null), hiện giá/tồn để nhập, gửi cùng lúc', async () => {
      const { open } = await openEdit(UNLINKED());
      const overlay = open();
      click(radioOf(overlay, 'Chuyển sang gian hàng tự giao'));
      expect(overlay.textContent).toContain('Bạn tự đóng gói');
      typeInto(inputByLabel(overlay, 'Giá bán (đồng)'), '95000');
      typeInto(inputByLabel(overlay, 'Số còn bán được'), '12');
      click(byText(overlay, 'button', 'Lưu thay đổi'));
      await flush();
      expect(mocks.updateProduct).toHaveBeenCalledWith('u', { pancakeCode: null, basePrice: 95000, salePrice: null, stock: 12 });
    });

    it('chuyển sang tự giao mà chưa sửa giá/tồn vẫn gửi pancakeCode null cùng giá đang thấy và salePrice null (không bị coi là không đổi gì)', async () => {
      const { open } = await openEdit(UNLINKED());
      const overlay = open();
      click(radioOf(overlay, 'Chuyển sang gian hàng tự giao'));
      click(byText(overlay, 'button', 'Lưu thay đổi'));
      await flush();
      expect(mocks.updateProduct).toHaveBeenCalledWith('u', { pancakeCode: null, basePrice: 120000, salePrice: null });
    });

    it('chọn lại "Giữ mã hiện tại" sau khi đổi ý thì ẩn lại giá/tồn và không gửi pancakeCode', async () => {
      const { open } = await openEdit(UNLINKED());
      const overlay = open();
      click(radioOf(overlay, 'Chuyển sang gian hàng tự giao'));
      expect(overlay.querySelector('#merchant-edit-price')).not.toBeNull();
      click(radioOf(overlay, 'Giữ mã hiện tại'));
      expect(overlay.querySelector('#merchant-edit-price')).toBeNull();
      click(byText(overlay, 'button', 'Lưu thay đổi'));
      await flush();
      expect(mocks.updateProduct).not.toHaveBeenCalled();
    });

    it('sản phẩm Tubu giao hộ đang liên kết: không có lựa chọn đổi mã', async () => {
      const { open } = await openEdit(PRODUCT('t', 'APPROVED', { isActive: true, fulfilment: 'TUBU', pancakeLinkCode: 'PCK-1', linkState: 'LINKED' }));
      const overlay = open();
      expect(byText(overlay, 'label', 'Đổi sang mã Pancake khác')).toBeNull();
      expect(byText(overlay, 'label', 'Chuyển sang gian hàng tự giao')).toBeNull();
    });

    it('sản phẩm tự giao không có mã: không có lựa chọn đổi mã, vẫn sửa được giá/tồn như cũ', async () => {
      const { open } = await openEdit(PRODUCT('o', 'APPROVED', { isActive: true, fulfilment: 'MERCHANT', pancakeLinkCode: null, linkState: null }));
      const overlay = open();
      expect(byText(overlay, 'label', 'Đổi sang mã Pancake khác')).toBeNull();
      expect(overlay.querySelector('#merchant-edit-price')).not.toBeNull();
    });
  });

  it('R5-PARTNER-8: sản phẩm đã duyệt nhưng ngừng bán ghi "Đã duyệt (Đang ẩn)", không ghi "Đang hiển thị"; sản phẩm đang bán vẫn ghi "Đang hiển thị"', async () => {
    mocks.getProducts = vi.fn(async () => ({
      ownProducts: [PRODUCT('v', 'APPROVED', { isActive: true }), PRODUCT('h', 'APPROVED', { isActive: false })],
      resellProducts: [],
      meta: { page: 1, limit: 20, ownTotal: 2, resellTotal: 0 },
    }));
    const root = await mount();
    await openTab('Sản phẩm');
    const rows = Array.from(root.querySelectorAll('tbody tr'));
    const visible = rows.find((r) => r.textContent?.includes('SP v'))!;
    const hidden = rows.find((r) => r.textContent?.includes('SP h'))!;
    expect(visible.textContent).toContain('Đã duyệt (Đang hiển thị)');
    expect(visible.textContent).not.toContain('Đã ngừng bán');
    expect(hidden.textContent).toContain('Đã duyệt (Đang ẩn)');
    expect(hidden.textContent).not.toContain('Đang hiển thị');
    expect(hidden.textContent).toContain('Đã ngừng bán');
    expect(openRowMenu(hidden).map((b) => b.textContent)).toEqual(['Sửa', 'Mở bán lại']);
  });

  it('R3-MERCHANT-4: sản phẩm đang bán có bản sửa chờ duyệt vẫn hiện nội dung đang bán kèm huy hiệu "Bản sửa chờ duyệt"; mở Sửa tiếp tục từ bản chờ', async () => {
    const pendingEdit = { name: 'SP a (tên mới)', description: 'Mô tả mới', shortDesc: 'Ngắn mới', images: [], thumbnail: null, submittedAt: '2026-10-14T03:00:00.000Z' };
    mocks.getProducts = vi.fn(async () => ({
      ownProducts: [PRODUCT('a', 'APPROVED', { isActive: true, pendingEdit })],
      resellProducts: [],
      meta: { page: 1, limit: 20, ownTotal: 1, resellTotal: 0 },
    }));
    const root = await mount();
    await openTab('Sản phẩm');
    const row = root.querySelector('tbody')!;
    expect(row.textContent).toContain('SP a');
    expect(row.textContent).toContain('Đã duyệt (Đang hiển thị)');
    expect(byText(row, 'span', 'Bản sửa chờ duyệt')!.className).toContain('bg-warning-bg');
    rowAction(root, 'SP a', 'Sửa');
    const overlay = root.querySelector<HTMLElement>('.fixed.inset-0')!;
    expect(overlay.textContent).toContain('Bản sửa đang chờ Tubu Tree duyệt');
    expect(inputByLabel(overlay, 'Tên sản phẩm').value).toBe('SP a (tên mới)');
    typeInto(inputByLabel(overlay, 'Mô tả ngắn'), 'Ngắn mới hơn');
    click(byText(overlay, 'button', 'Lưu thay đổi'));
    await flush();
    expect(mocks.updateProduct).toHaveBeenCalledWith('a', { shortDesc: 'Ngắn mới hơn' });
  });

  it('R3-MERCHANT-4: bản sửa bị từ chối báo rõ lý do và nói sản phẩm vẫn bán nội dung cũ', async () => {
    mocks.getProducts = vi.fn(async () => ({
      ownProducts: [PRODUCT('a', 'APPROVED', { isActive: true, rejectReason: 'Ảnh vi phạm bản quyền', pendingEdit: null })],
      resellProducts: [],
      meta: { page: 1, limit: 20, ownTotal: 1, resellTotal: 0 },
    }));
    const root = await mount();
    await openTab('Sản phẩm');
    const row = root.querySelector('tbody')!;
    expect(row.textContent).toContain('Bản sửa bị từ chối: Ảnh vi phạm bản quyền');
    expect(row.textContent).toContain('vẫn bán nội dung cũ');
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

  it('R2-MERCHANT-6/5: đơn gian hàng tự giao ghi "Bạn tự giao" và chuyển sang tab Đơn cần giao; đơn Tubu giao có hàng nơi khác chỉ hiện tiền dòng của mình', async () => {
    mocks.listOrders = vi.fn(async () => ({
      data: [
        ORDER('5', 'CONFIRMED', { selfFulfilled: true, partial: false }),
        ORDER('6', 'SHIPPING', { total: null, ownTotal: 120000, partial: true, selfFulfilled: false }),
      ],
      meta: { page: 1, limit: 20, total: 2 },
    }));
    const root = await mount();
    await openTab('Đơn qua gian hàng');
    const rows = root.querySelectorAll('tbody tr');
    expect(rows[0]!.textContent).toContain('Bạn tự giao');
    expect(rows[0]!.textContent).not.toContain('Do kho Tubu xử lý');
    expect(rows[1]!.textContent).toContain('Do kho Tubu xử lý');
    expect(rows[1]!.textContent).toContain('Hàng của bạn trong đơn: 120.000');
    expect(rows[1]!.textContent).toContain('Đơn còn hàng của nơi khác');
    click(byText(rows[0] as HTMLElement, 'button', 'Xem ở tab Đơn cần giao'));
    await flush();
    expect(byText(root, '[role="tab"]', 'Đơn cần giao')!.getAttribute('aria-selected')).toBe('true');
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
