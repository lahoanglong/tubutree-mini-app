// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MerchantPage from './page';
import { byText, click, flush, render, selectValue, typeInto, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({
  auth: { user: { role: 'DEALER' } as { role: string } | null, status: 'authenticated', initialized: true },
  store: null as unknown,
  updateStore: vi.fn(),
}));

vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/lib/merchant-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/merchant-client')>()),
  getMerchantStore: async () => mocks.store,
  updateMerchantStore: (dto: unknown) => mocks.updateStore(dto),
  getMerchantProducts: async () => ({
    ownProducts: [],
    resellProducts: [],
    meta: { page: 1, limit: 20, ownTotal: 4, resellTotal: 2 },
  }),
  countMerchantOrders: async () => 3,
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
});
afterEach(() => {
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
