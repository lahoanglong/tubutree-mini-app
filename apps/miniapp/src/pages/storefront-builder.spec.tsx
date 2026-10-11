import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  getMyStorefront: vi.fn(),
  createStorefront: vi.fn(),
  publishStorefront: vi.fn(),
  updateStorefront: vi.fn(),
  createCollection: vi.fn(),
  updateCollection: vi.fn(),
  deleteCollection: vi.fn(),
  addItem: vi.fn(),
  updateItem: vi.fn(),
  removeItem: vi.fn(),
  pickerProducts: vi.fn(),
  getQuests: vi.fn(),
  claimQuest: vi.fn(),
  getStorefrontStats: vi.fn(),
  getStorefrontCategories: vi.fn(),
  applyStorefrontTemplate: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  Sheet: ({ visible, children }: { visible: boolean; children: ReactNode }) =>
    visible ? <div data-testid="sheet">{children}</div> : null,
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/storefront', search: '', state: null }),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/storefront-api', () => ({ ...mocks }));
vi.mock('../components/content-kit-sheet', () => ({
  ContentKitSheet: ({ visible, productSlug }: { visible: boolean; productSlug: string }) =>
    visible ? <div data-testid="content-kit">{productSlug}</div> : null,
}));
vi.mock('../components/image-upload', () => ({
  ImageUpload: ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
    <input aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import StorefrontBuilderPage from './storefront-builder';

const product = {
  id: 'p1', name: 'Trà xanh', slug: 'tra-xanh', thumbnail: null, brand: 'Tubu',
  basePrice: 100_000, salePrice: 80_000, ratingAvg: 5, reviewCount: 1, inStock: true,
};
const item = (over: Record<string, unknown> = {}) => ({
  id: 'i1', productId: 'p1', note: null, variationId: null, isPinned: false, isHidden: false, sortOrder: 0, product, ...over,
});
const storefront = (over: Record<string, unknown> = {}) => ({
  id: 'sf1', slug: 'shop-aff-1', type: 'CTV', title: 'Cửa hàng Xanh', headerNote: 'Mua giúp mình nhé',
  avatarUrl: null, coverUrl: null, theme: 'default', themeColor: null, subdomain: null, isPublished: false,
  collections: [
    { id: 'c1', title: 'Bộ sưu tập A', kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, sortOrder: 0, items: [item()] },
  ],
  ...over,
});
const quests = {
  level: 1, levelMax: 5, totalEarnedXu: 500,
  quests: [
    { code: 'Q1', title: 'Thêm 3 sản phẩm', hint: 'Thêm vào bộ sưu tập', goal: 3, progress: 3, done: true, claimed: false, rewardXu: 1500 },
    { code: 'Q2', title: 'Đăng gian hàng', hint: 'Bấm Lưu & Đăng', goal: 1, progress: 0, done: false, claimed: false, rewardXu: 500 },
    { code: 'Q3', title: 'Viết hồ sơ', hint: '', goal: 1, progress: 1, done: true, claimed: true, rewardXu: 2000 },
  ],
};
const stats = {
  orders7d: 2, orders30d: 9, revenue30d: 1_250_000, commission30d: 125_000,
  byProduct: [{ productSlug: 'tra-xanh', productName: 'Trà xanh', qty: 4, revenue: 320_000 }],
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><StorefrontBuilderPage /></QueryClientProvider>);
}

/** Trạng thái "chưa có gian hàng": API /storefront/me trả 404. */
function notFound() {
  mocks.getMyStorefront.mockRejectedValue({ response: { status: 404 } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getMyStorefront.mockResolvedValue(storefront());
  mocks.getQuests.mockResolvedValue(quests);
  mocks.getStorefrontStats.mockResolvedValue(stats);
  mocks.pickerProducts.mockResolvedValue([
    { ...product, id: 'p2', name: 'Xà phòng', slug: 'xa-phong', maxAffiliateRate: 12 },
  ]);
  mocks.getStorefrontCategories.mockResolvedValue([
    { id: 'cat1', name: 'Chăm sóc da', slug: 'cham-soc-da', image: null },
    { id: 'cat2', name: 'Nhà bếp', slug: 'nha-bep', image: 'https://cdn.example/bep.png' },
  ]);
  mocks.createStorefront.mockResolvedValue(storefront());
  mocks.applyStorefrontTemplate.mockResolvedValue({ collectionId: 'c9', title: 'Mẫu', itemCount: 8 });
  for (const fn of [
    mocks.updateStorefront, mocks.publishStorefront, mocks.createCollection, mocks.updateCollection,
    mocks.deleteCollection, mocks.addItem, mocks.updateItem, mocks.removeItem, mocks.claimQuest,
  ]) fn.mockResolvedValue({});
  mocks.claimQuest.mockResolvedValue({ claimed: true, code: 'Q1', rewardXu: 1500, coinsBalance: 2000 });
});

describe('Trang gian hàng CTV — cấu trúc trang (C-114)', () => {
  it('đang tải: có đúng một h1', () => {
    mocks.getMyStorefront.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Gian hàng của tôi');
  });

  it('chưa có gian hàng (404): có đúng một h1 và lời mời tạo', async () => {
    notFound();
    renderPage();
    expect(await screen.findByRole('button', { name: 'Tạo gian hàng' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('lỗi tải khác 404: có đúng một h1 và nút Thử lại gọi lại API', async () => {
    mocks.getMyStorefront.mockRejectedValueOnce({ response: { status: 500 }, message: 'Máy chủ lỗi' });
    renderPage();
    const retry = await screen.findByRole('button', { name: /Thử lại/ });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Tạo gian hàng' })).not.toBeInTheDocument();
    fireEvent.click(retry);
    await waitFor(() => expect(mocks.getMyStorefront).toHaveBeenCalledTimes(2));
  });

  it('có gian hàng: đúng một h1, tên gian hàng là h2, huy hiệu trạng thái theo isPublished', async () => {
    const view = renderPage();
    expect(await screen.findByRole('heading', { level: 2, name: 'Cửa hàng Xanh' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByText('Nháp — chưa đăng')).toBeInTheDocument();
    expect(screen.getByText('/shop-aff-1')).toBeInTheDocument();
    view.unmount();

    mocks.getMyStorefront.mockResolvedValue(storefront({ isPublished: true, subdomain: 'xanh' }));
    renderPage();
    expect(await screen.findByText('Đang hiển thị')).toBeInTheDocument();
    expect(screen.getByText('xanh.tubutree.com')).toBeInTheDocument();
  });
});

describe('Tạo gian hàng và chọn mẫu', () => {
  it('chọn một mẫu: tạo gian hàng rồi áp mẫu đúng danh mục', async () => {
    notFound();
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Tạo gian hàng' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Dùng mẫu Nhà bếp' }));
    await waitFor(() => expect(mocks.applyStorefrontTemplate).toHaveBeenCalledWith('cat2'));
    expect(mocks.createStorefront).toHaveBeenCalledTimes(1);
  });

  it('bỏ qua mẫu: chỉ tạo gian hàng trống, không áp mẫu', async () => {
    notFound();
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Tạo gian hàng' }));
    fireEvent.click(await screen.findByRole('button', { name: /Bỏ qua, tự tạo gian hàng trống/ }));
    await waitFor(() => expect(mocks.createStorefront).toHaveBeenCalledTimes(1));
    expect(mocks.applyStorefrontTemplate).not.toHaveBeenCalled();
  });

  it('ô chọn mẫu là nút thật cao >= 44px', async () => {
    notFound();
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Tạo gian hàng' }));
    const tile = await screen.findByRole('button', { name: 'Dùng mẫu Chăm sóc da' });
    expect(tile.tagName).toBe('BUTTON');
    expect(parseFloat(tile.style.minHeight)).toBeGreaterThanOrEqual(44);
  });
});

describe('Chỉnh gian hàng — sản phẩm và bộ sưu tập', () => {
  it('hiện tên sản phẩm, giá bán (ưu tiên giá khuyến mãi) và tên bộ sưu tập', async () => {
    renderPage();
    expect((await screen.findAllByText('Trà xanh')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('80.000đ').length).toBeGreaterThan(0);
    expect(screen.getByText('Bộ sưu tập A')).toBeInTheDocument();
  });

  it('ghim, ẩn, xoá sản phẩm gọi đúng API (xoá phải qua bước xác nhận)', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Ghim lên đầu' }));
    await waitFor(() => expect(mocks.updateItem).toHaveBeenCalledWith('i1', { isPinned: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Ẩn sản phẩm' }));
    await waitFor(() => expect(mocks.updateItem).toHaveBeenCalledWith('i1', { isHidden: true }));

    fireEvent.click(screen.getByRole('button', { name: 'Xoá khỏi bộ sưu tập' }));
    expect(mocks.removeItem).not.toHaveBeenCalled();
    const sheet = await screen.findByTestId('sheet');
    expect(within(sheet).getByText('Xoá sản phẩm này khỏi gian hàng?')).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Xoá' }));
    await waitFor(() => expect(mocks.removeItem).toHaveBeenCalledTimes(1));
    expect(mocks.removeItem.mock.calls[0]![0]).toBe('i1');
  });

  it('sản phẩm đã ghim/đã ẩn đổi nhãn nút để hoàn tác', async () => {
    mocks.getMyStorefront.mockResolvedValue(
      storefront({ collections: [{ id: 'c1', title: 'A', kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, sortOrder: 0, items: [item({ isPinned: true, isHidden: true })] }] }),
    );
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Bỏ ghim' }));
    await waitFor(() => expect(mocks.updateItem).toHaveBeenCalledWith('i1', { isPinned: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Hiện sản phẩm' }));
    await waitFor(() => expect(mocks.updateItem).toHaveBeenCalledWith('i1', { isHidden: false }));
  });

  it('nút biểu tượng (ghim, ẩn, xoá, đổi tên, xoá bộ sưu tập) cao và rộng >= 44px', async () => {
    renderPage();
    await screen.findByText('Bộ sưu tập A');
    for (const name of ['Ghim lên đầu', 'Ẩn sản phẩm', 'Xoá khỏi bộ sưu tập', 'Đổi tên bộ sưu tập', 'Xoá bộ sưu tập']) {
      const btn = screen.getByRole('button', { name });
      const box = btn.className.includes('touch-target')
        ? { w: 44, h: 44 }
        : { w: parseFloat(btn.style.minWidth), h: parseFloat(btn.style.minHeight) };
      expect(box.w, `${name} rộng`).toBeGreaterThanOrEqual(44);
      expect(box.h, `${name} cao`).toBeGreaterThanOrEqual(44);
    }
  });

  it('"Nội dung" mở bộ nội dung bán hàng của đúng sản phẩm', async () => {
    renderPage();
    fireEvent.click(await screen.findByText('Nội dung'));
    expect(await screen.findByTestId('content-kit')).toHaveTextContent('tra-xanh');
  });

  it('lý do giới thiệu: mở sheet, nhập, Lưu gửi ghi chú đã cắt khoảng trắng', async () => {
    renderPage();
    fireEvent.click(await screen.findByText('Thêm lý do giới thiệu'));
    const sheet = await screen.findByTestId('sheet');
    expect(within(sheet).getByText('Vì sao mình giới thiệu')).toBeInTheDocument();
    fireEvent.change(within(sheet).getByPlaceholderText('VD: Mình dùng 3 tháng, da đỡ khô hẳn.'), { target: { value: '  Dùng 3 tháng  ' } });
    expect(within(sheet).getByText('16/200')).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(mocks.updateItem).toHaveBeenCalledWith('i1', { note: 'Dùng 3 tháng' }));
  });

  it('lý do đã có thì hiện trong dấu ngoặc kép thay cho lời mời', async () => {
    mocks.getMyStorefront.mockResolvedValue(
      storefront({ collections: [{ id: 'c1', title: 'A', kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, sortOrder: 0, items: [item({ note: 'Dùng rất ổn' })] }] }),
    );
    renderPage();
    expect(await screen.findByText('“Dùng rất ổn”')).toBeInTheDocument();
    expect(screen.queryByText('Thêm lý do giới thiệu')).not.toBeInTheDocument();
  });

  it('tạo bộ sưu tập cần tên; tên được cắt khoảng trắng rồi gửi', async () => {
    renderPage();
    await screen.findByText('Bộ sưu tập A');
    const add = screen.getByRole('button', { name: /Tạo bộ sưu tập/ });
    expect(add).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Tên bộ sưu tập (khách sẽ thấy)'), { target: { value: '  Mùa hè  ' } });
    expect(add).not.toBeDisabled();
    fireEvent.click(add);
    await waitFor(() => expect(mocks.createCollection).toHaveBeenCalledWith({ title: 'Mùa hè' }));
  });

  it('đổi tên bộ sưu tập: sheet có tiêu đề, Lưu gửi tên mới', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Đổi tên bộ sưu tập' }));
    const sheet = await screen.findByTestId('sheet');
    const input = within(sheet).getByDisplayValue('Bộ sưu tập A');
    fireEvent.change(input, { target: { value: ' Bộ B ' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(mocks.updateCollection).toHaveBeenCalledWith('c1', { title: 'Bộ B' }));
  });

  it('xoá bộ sưu tập phải xác nhận; Huỷ thì không gọi API', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Xoá bộ sưu tập' }));
    const sheet = await screen.findByTestId('sheet');
    expect(within(sheet).getByText('Xoá bộ sưu tập này?')).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Hủy' }));
    expect(mocks.deleteCollection).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Xoá bộ sưu tập' }));
    const sheet2 = await screen.findByTestId('sheet');
    fireEvent.click(within(sheet2).getByRole('button', { name: 'Xoá bộ sưu tập' }));
    await waitFor(() => expect(mocks.deleteCollection).toHaveBeenCalledWith('c1'));
  });

  it('thêm sản phẩm: chọn từ danh sách gợi ý gọi addItem vào đúng bộ sưu tập', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Thêm sản phẩm/ }));
    const sheet = await screen.findByTestId('sheet');
    expect(await within(sheet).findByText('Xà phòng')).toBeInTheDocument();
    expect(within(sheet).getByText('+12% hoa hồng')).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: /^(\+ )?Thêm$/ }));
    await waitFor(() => expect(mocks.addItem).toHaveBeenCalledWith('c1', { productId: 'p2' }));
  });

  it('thêm sản phẩm: không có kết quả thì hiện trạng thái rỗng', async () => {
    mocks.pickerProducts.mockResolvedValue([]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Thêm sản phẩm/ }));
    const sheet = await screen.findByTestId('sheet');
    expect(await within(sheet).findByText('Không tìm thấy sản phẩm phù hợp')).toBeInTheDocument();
  });
});

describe('Đăng gian hàng và xem trước', () => {
  it('"Lưu & Đăng" gọi publishStorefront(true) rồi báo đã đăng', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Lưu & Đăng' }));
    await waitFor(() => expect(mocks.publishStorefront).toHaveBeenCalledWith(true));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã đăng gian hàng 🎉', type: 'success' }));
  });

  it('đang đăng: nút "Lưu & Đăng" báo bận và bấm lại không đăng lần hai', async () => {
    mocks.publishStorefront.mockReturnValue(new Promise(() => {}));
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Lưu & Đăng' });
    fireEvent.click(btn);
    await waitFor(() => expect(btn).toHaveAttribute('aria-busy', 'true'));
    fireEvent.click(btn);
    expect(mocks.publishStorefront).toHaveBeenCalledTimes(1);
  });

  it('xem trước khi còn nháp: báo cần đăng, không chuyển trang', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Xem trước' }));
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning' }));
  });

  it('xem trước khi đã đăng: chuyển tới /s/:slug', async () => {
    mocks.getMyStorefront.mockResolvedValue(storefront({ isPublished: true }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Xem trước' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/s/shop-aff-1');
  });
});

describe('Hồ sơ và cấu hình gian hàng', () => {
  it('lưu hồ sơ gửi ảnh đại diện, ảnh bìa, lời nhắn đã cắt khoảng trắng', async () => {
    renderPage();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Sửa hồ sơ' }))[0]!);
    const sheet = await screen.findByTestId('sheet');
    expect(within(sheet).getByText('Hồ sơ gian hàng')).toBeInTheDocument();
    fireEvent.change(within(sheet).getByLabelText('Ảnh đại diện'), { target: { value: 'https://cdn/a.jpg' } });
    fireEvent.change(within(sheet).getByLabelText('Ảnh bìa'), { target: { value: 'https://cdn/c.jpg' } });
    fireEvent.change(within(sheet).getByDisplayValue('Mua giúp mình nhé'), { target: { value: '  Chào bạn  ' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Lưu hồ sơ' }));
    await waitFor(() =>
      expect(mocks.updateStorefront).toHaveBeenCalledWith({ avatarUrl: 'https://cdn/a.jpg', coverUrl: 'https://cdn/c.jpg', headerNote: 'Chào bạn' }),
    );
  });

  it('cấu hình: đóng rồi mở lại thì form về dữ liệu đã lưu, chỉnh sửa chưa lưu bị bỏ (BottomSheet gỡ nội dung khi đóng)', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Cấu hình' }));
    const first = await screen.findByTestId('sheet');
    fireEvent.change(within(first).getByDisplayValue('Cửa hàng Xanh'), { target: { value: 'Tên gõ dở' } });
    expect(within(first).getByDisplayValue('Tên gõ dở')).toBeInTheDocument();
    fireEvent.click(within(first).getByRole('button', { name: 'Đóng' }));
    await waitFor(() => expect(screen.queryByTestId('sheet')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Cấu hình' }));
    const again = await screen.findByTestId('sheet');
    expect(within(again).getByDisplayValue('Cửa hàng Xanh')).toBeInTheDocument();
    expect(mocks.updateStorefront).not.toHaveBeenCalled();
  });

  it('cấu hình: không chọn màu thì gửi màu mặc định xanh lá, các trường rỗng thành undefined', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Cấu hình' }));
    const sheet = await screen.findByTestId('sheet');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Lưu cấu hình gian hàng' }));
    await waitFor(() => expect(mocks.updateStorefront).toHaveBeenCalledTimes(1));
    expect(mocks.updateStorefront).toHaveBeenCalledWith({
      title: 'Cửa hàng Xanh',
      subdomain: undefined,
      themeColor: '#16a34a',
      bankName: undefined,
      bankBin: undefined,
      bankAccountNo: undefined,
      bankAccountName: undefined,
      warehouseAddress: undefined,
      warehouseCity: undefined,
      warehousePhone: undefined,
    });
  });

  it('cấu hình: chọn màu "Xanh dương" gửi #2563eb; subdomain được viết thường', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Cấu hình' }));
    const sheet = await screen.findByTestId('sheet');
    const swatch = within(sheet).getByRole('button', { name: 'Xanh dương' });
    expect(swatch).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(swatch);
    expect(within(sheet).getByRole('button', { name: 'Xanh dương' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(sheet).getByRole('button', { name: 'Xanh lá' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.change(within(sheet).getByPlaceholderText('vd: brand1'), { target: { value: '  XanhShop ' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Lưu cấu hình gian hàng' }));
    await waitFor(() => expect(mocks.updateStorefront).toHaveBeenCalledTimes(1));
    expect(mocks.updateStorefront).toHaveBeenCalledWith(expect.objectContaining({ themeColor: '#2563eb', subdomain: 'xanhshop' }));
  });

  it('màu đã lưu của gian hàng được chọn sẵn', async () => {
    mocks.getMyStorefront.mockResolvedValue(storefront({ themeColor: '#7c3aed' }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Cấu hình' }));
    const sheet = await screen.findByTestId('sheet');
    expect(within(sheet).getByRole('button', { name: 'Tím' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('ô nhập trong cấu hình đều có tên truy cập (nhãn hoặc aria-label)', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Cấu hình' }));
    const sheet = await screen.findByTestId('sheet');
    for (const name of [
      'Tên gian hàng', 'Subdomain riêng', 'Mã BIN ngân hàng', 'Tên ngân hàng', 'Số tài khoản ngân hàng',
      'Tên chủ tài khoản', 'Địa chỉ kho xuất hàng', 'Tỉnh / Thành phố', 'Hotline kho liên hệ',
    ]) {
      expect(within(sheet).getByRole('textbox', { name }), name).toBeInTheDocument();
    }
  });

  it('mỗi ô màu có vùng chạm >= 44px', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Cấu hình' }));
    const sheet = await screen.findByTestId('sheet');
    for (const name of ['Xanh lá', 'Ngọc', 'Xanh dương', 'Tím', 'Đất nung']) {
      const btn = within(sheet).getByRole('button', { name });
      expect(parseFloat(btn.style.minWidth), name).toBeGreaterThanOrEqual(44);
      expect(parseFloat(btn.style.minHeight), name).toBeGreaterThanOrEqual(44);
    }
  });
});

describe('Thống kê và Hành trình gian hàng', () => {
  it('thống kê 30 ngày hiện đơn, doanh thu, hoa hồng và top sản phẩm', async () => {
    renderPage();
    expect(await screen.findByText('Thống kê 30 ngày')).toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument();
    expect(screen.getByText('Đơn (7 ngày: 2)')).toBeInTheDocument();
    expect(screen.getByText('1.250.000đ')).toBeInTheDocument();
    expect(screen.getByText('125.000đ')).toBeInTheDocument();
    expect(screen.getByText('4 món · 320.000đ')).toBeInTheDocument();
  });

  it('chưa có đơn: hiện lời nhắn chia sẻ link', async () => {
    mocks.getStorefrontStats.mockResolvedValue({ ...stats, byProduct: [] });
    renderPage();
    expect(await screen.findByText(/Chưa có đơn nào qua gian hàng/)).toBeInTheDocument();
  });

  it('nhiệm vụ: cấp độ, tổng xu, tiến độ; nhiệm vụ đã nhận không còn ký tự ✓', async () => {
    renderPage();
    expect(await screen.findByText('Hành trình gian hàng')).toBeInTheDocument();
    expect(screen.getByText('1/5')).toBeInTheDocument();
    expect(screen.getByText('Đã nhận 500 TubuXu')).toBeInTheDocument();
    expect(screen.getByText('0/1')).toBeInTheDocument();
    expect(screen.getByText('Viết hồ sơ')).toBeInTheDocument();
    expect(screen.getByText('Đã nhận')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/[✓✔]/);
  });

  it('nhiệm vụ đã đạt: nút nhận thưởng gọi claimQuest và báo số xu', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /\+1\.500 xu/ }));
    await waitFor(() => expect(mocks.claimQuest).toHaveBeenCalledWith('Q1'));
    await waitFor(() =>
      expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: '+1.500 TubuXu 🎉', type: 'success' }),
    );
  });

  it('đang nhận một thưởng: nút đó báo bận, nút nhận khác bị khoá, bấm lại không gọi API thêm', async () => {
    mocks.getQuests.mockResolvedValue({
      ...quests,
      quests: [
        quests.quests[0],
        { code: 'Q4', title: 'Chia sẻ link', hint: '', goal: 1, progress: 1, done: true, claimed: false, rewardXu: 700 },
      ],
    });
    mocks.claimQuest.mockReturnValue(new Promise(() => {}));
    renderPage();
    const first = await screen.findByRole('button', { name: /\+1\.500 xu/ });
    const second = screen.getByRole('button', { name: /\+700 xu/ });
    fireEvent.click(first);
    await waitFor(() => expect(first).toHaveAttribute('aria-busy', 'true'));
    expect(second).toBeDisabled();
    fireEvent.click(first);
    expect(mocks.claimQuest).toHaveBeenCalledTimes(1);
  });

  it('nhiệm vụ chưa đạt không có nút nhận', async () => {
    renderPage();
    await screen.findByText('Hành trình gian hàng');
    expect(screen.getAllByRole('button', { name: /xu$/ })).toHaveLength(1);
  });
});
