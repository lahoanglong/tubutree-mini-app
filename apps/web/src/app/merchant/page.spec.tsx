// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MerchantPage from './page';
import { byText, click, flush, render, selectValue, typeInto, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({
  auth: { user: { role: 'DEALER' } as { role: string } | null, status: 'authenticated', initialized: true },
  store: null as unknown,
  updateStore: vi.fn(),
  getProducts: vi.fn(),
  createProduct: vi.fn(),
  removeResell: vi.fn(),
  listOrders: vi.fn(),
  setOrderStatus: vi.fn(),
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

let ui: Rendered | undefined;
const mount = async () => {
  ui = render(<MerchantPage />);
  await flush();
  return ui.container;
};
const openTab = async (label: string) => {
  click(byText(ui!.container, 'button', label));
  await flush();
};
const inputByLabel = (root: ParentNode, label: string) =>
  byText(root, 'label', label)!.parentElement!.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select')!;

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
});
afterEach(() => {
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
    expect(root.querySelector('h2')!.className).toContain('font-display');
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
    expect(kpi).toEqual(['4', '2', '3']);
    const published = byText(root, 'span', 'Đang xuất bản')!;
    expect(published.className).toContain('bg-success-bg');
    ui!.unmount();
    mocks.store = { ...STORE, isPublished: false };
    const root2 = await mount();
    expect(byText(root2, 'span', 'Chưa xuất bản')!.className).toContain('bg-warning-bg');
  });

  it('thanh tab cuộn ngang trong khung riêng, mỗi tab cao 44px và tab đang chọn dùng viền forest', async () => {
    const root = await mount();
    const store = byText(root, 'button', 'Gian hàng & Subdomain')!;
    expect(store.parentElement!.className).toContain('overflow-x-auto');
    expect(store.className).toContain('min-h-[44px]');
    expect(store.className).toContain('border-forest-600');
    expect(byText(root, 'button', 'Tài khoản VietQR')!.className).toContain('text-stone-500');
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
});

describe('cổng đối tác — tab Tài khoản VietQR', () => {
  it('chọn ngân hàng đổi BIN, lưu gửi tên chủ tài khoản viết hoa và hiện mã QR mẫu khi có số tài khoản', async () => {
    const root = await mount();
    await openTab('Tài khoản VietQR');
    expect(root.textContent).toContain('Vui lòng nhập số tài khoản');
    selectValue(inputByLabel(root, 'Ngân hàng thụ hưởng'), 'BIDV');
    typeInto(inputByLabel(root, 'Số tài khoản'), '0123456789');
    typeInto(inputByLabel(root, 'Tên chủ tài khoản'), 'nguyen van a');
    const qr = root.querySelector<HTMLImageElement>('img[alt="VietQR Mẫu"]')!;
    expect(qr.src).toContain('970418-0123456789');
    expect(qr.className).toContain('max-w-full');
    click(byText(root, 'button', 'Lưu tài khoản ngân hàng'));
    await flush();
    expect(mocks.updateStore).toHaveBeenCalledWith({
      bankName: 'BIDV',
      bankBin: '970418',
      bankAccountNo: '0123456789',
      bankAccountName: 'NGUYEN VAN A',
    });
  });

  it('ô nhập và nút Lưu dùng token DS v2, cao 44px', async () => {
    const root = await mount();
    await openTab('Tài khoản VietQR');
    expect(inputByLabel(root, 'Số tài khoản').className).toContain('min-h-[44px]');
    expect(inputByLabel(root, 'Ngân hàng thụ hưởng').className).toContain('bg-stone-0');
    expect(byText(root, 'button', 'Lưu tài khoản ngân hàng')!.className).toContain('min-h-[44px]');
  });
});

describe('cổng đối tác — tab Kho hàng & Giao nhận', () => {
  it('lưu địa chỉ kho gửi giá trị đã cắt khoảng trắng; ô nhập cao 44px', async () => {
    const root = await mount();
    await openTab('Kho Hàng & Giao Nhận');
    const addr = inputByLabel(root, 'Số nhà, tên đường');
    expect(addr.className).toContain('min-h-[44px]');
    typeInto(addr, ' 45 Đường số 8 ');
    typeInto(inputByLabel(root, 'Tỉnh / Thành phố'), ' TP. Hồ Chí Minh ');
    typeInto(inputByLabel(root, 'Quận / Huyện'), 'Quận 7');
    typeInto(inputByLabel(root, 'Phường / Xã'), 'Tân Hưng');
    typeInto(inputByLabel(root, 'Số điện thoại liên hệ kho'), '0912345678');
    click(byText(root, 'button', 'Lưu địa chỉ kho hàng'));
    await flush();
    expect(mocks.updateStore).toHaveBeenCalledWith({
      warehouseAddress: '45 Đường số 8',
      warehouseCity: 'TP. Hồ Chí Minh',
      warehouseDistrict: 'Quận 7',
      warehouseWard: 'Tân Hưng',
      warehousePhone: '0912345678',
    });
  });
});

describe('cổng đối tác — tab Quản lý sản phẩm', () => {
  it('hai nút danh sách xuống dòng được ở 390px, cao 44px, tô forest khi chọn và báo aria-pressed', async () => {
    const root = await mount();
    await openTab('Quản Lý Sản Phẩm');
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
    await openTab('Quản Lý Sản Phẩm');
    expect(byText(root, 'span', 'Đã duyệt')!.className).toContain('bg-success-bg');
    const rejected = byText(root, 'span', 'Từ chối: Thiếu chứng nhận')!;
    expect(rejected.className).toContain('bg-danger-bg');
    expect(rejected.getAttribute('title')).toBe('Thiếu chứng nhận');
    expect(byText(root, 'span', 'Chờ Admin duyệt')!.className).toContain('bg-warning-bg');
    const frame = root.querySelector('table')!.parentElement!;
    expect(frame.className).toContain('overflow-x-auto');
    expect(frame.className).toContain('rounded-card');
    expect(root.querySelector('td.text-forest-700')!.textContent).toContain('120.000');
  });

  it('Gỡ khỏi shop: hỏi xác nhận, từ chối thì không gọi API, đồng ý gọi đúng sản phẩm; lỗi hiện thông báo danger', async () => {
    const root = await mount();
    await openTab('Quản Lý Sản Phẩm');
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
    await openTab('Quản Lý Sản Phẩm');
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
    await openTab('Quản Lý Sản Phẩm');
    click(byText(root, 'button', 'Đăng sản phẩm mới'));
    const overlay = root.querySelector<HTMLElement>('.fixed.inset-0')!;
    expect(overlay.className).toContain('bg-stone-900/40');
    expect(overlay.firstElementChild!.className).toContain('rounded-sheet');
    const close = root.querySelector<HTMLButtonElement>('button[aria-label="Đóng"]')!;
    expect(close.className).toContain('h-11');
    typeInto(inputByLabel(overlay, 'Tên sản phẩm'), '  Nước rửa chén  ');
    typeInto(inputByLabel(overlay, 'Nội dung mô tả chi tiết'), 'Chiết xuất bồ hòn');
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
      certifications: ['Thuần chay', 'Hữu cơ', 'Không thử nghiệm trên động vật'],
    });
    expect(root.querySelector('.fixed.inset-0')).toBeNull();
  });

  it('Đăng sản phẩm mới: lỗi từ API hiện thông báo danger và hộp thoại vẫn mở; Hủy đóng hộp thoại', async () => {
    mocks.createProduct = vi.fn(async () => {
      throw new Error('Giá không hợp lệ');
    });
    const root = await mount();
    await openTab('Quản Lý Sản Phẩm');
    click(byText(root, 'button', 'Đăng sản phẩm mới'));
    const overlay = root.querySelector<HTMLElement>('.fixed.inset-0')!;
    typeInto(inputByLabel(overlay, 'Tên sản phẩm'), 'SP');
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

describe('cổng đối tác — tab Đơn hàng thuộc kho', () => {
  it('đối tác không phải ADMIN: ghi chú thông tin theo token info, không có nút chuyển trạng thái', async () => {
    const root = await mount();
    await openTab('Đơn Hàng Thuộc Kho');
    const notice = Array.from(root.querySelectorAll('div')).find((d) => d.children.length === 0 && d.textContent?.includes('Đơn do kho Tubu Tree xử lý'))!;
    expect(notice.className).toContain('bg-info-bg');
    expect(root.textContent).toContain('Do kho Tubu xử lý');
    expect(byText(root, 'button', 'Đã đóng gói')).toBeNull();
    expect(byText(root, 'button', 'Bắt đầu giao')).toBeNull();
    expect(byText(root, 'button', 'Đã giao')).toBeNull();
  });

  it('địa chỉ giao, huy hiệu trạng thái và chip Đặt trước giữ nội dung, dùng token DS v2', async () => {
    const root = await mount();
    await openTab('Đơn Hàng Thuộc Kho');
    expect(root.textContent).toContain('Lan · 0900000002');
    expect(root.textContent).toContain('1 Lê Lợi, Bến Nghé, Quận 1, TP.HCM');
    expect(byText(root, 'span', 'Đặt trước 1')!.className).toContain('bg-warning-bg');
    const frame = root.querySelector('table')!.parentElement!;
    expect(frame.className).toContain('overflow-x-auto');
  });

  it('bộ lọc trạng thái có tên truy cập, cao 44px và gọi lại danh sách ở trang 1 theo trạng thái chọn', async () => {
    const root = await mount();
    await openTab('Đơn Hàng Thuộc Kho');
    const select = root.querySelector<HTMLSelectElement>('select[aria-label="Lọc theo trạng thái đơn"]')!;
    expect(select.className).toContain('min-h-[44px]');
    selectValue(select, 'CONFIRMED');
    await flush();
    expect(mocks.listOrders).toHaveBeenLastCalledWith('CONFIRMED', 1);
  });

  it('ADMIN: mỗi trạng thái có đúng một nút chuyển bước, cao 44px, gọi đúng trạng thái kế tiếp', async () => {
    mocks.auth = { user: { role: 'ADMIN' }, status: 'authenticated', initialized: true };
    const root = await mount();
    await openTab('Đơn Hàng Thuộc Kho');
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
    await openTab('Đơn Hàng Thuộc Kho');
    click(byText(root, 'button', 'Đã đóng gói'));
    await flush();
    const alert = root.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('Đơn đã bị huỷ');
    expect(alert.className).toContain('bg-danger-bg');
  });
});
