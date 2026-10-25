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
  shareSheet: vi.fn(),
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
vi.mock('../components/share-sheet', () => ({
  ShareSheet: (props: { visible: boolean }) => {
    mocks.shareSheet(props);
    return props.visible ? <div data-testid="share-sheet" /> : null;
  },
}));
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
  avatarUrl: null, coverUrl: null, theme: 'default', themeColor: null, subdomain: null, isPublished: false, referralCode: 'SHOP-AFF-1',
  subdomainEnabled: false, publicHiddenReason: null,
  collections: [
    { id: 'c1', title: 'Bộ sưu tập A', kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, sortOrder: 0, items: [item()] },
  ],
  ...over,
});
const quests = {
  level: 1, levelMax: 5, totalEarnedPoints: 4,
  quests: [
    { code: 'Q1', title: 'Thêm 3 sản phẩm', hint: 'Thêm vào bộ sưu tập', goal: 3, progress: 3, done: true, claimed: false, rewardPoints: 2 },
    { code: 'Q2', title: 'Đăng gian hàng', hint: 'Bấm Lưu & Đăng', goal: 1, progress: 0, done: false, claimed: false, rewardPoints: 2 },
    { code: 'Q3', title: 'Viết hồ sơ', hint: '', goal: 1, progress: 1, done: true, claimed: true, rewardPoints: 2 },
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
  mocks.claimQuest.mockResolvedValue({ claimed: true, code: 'Q1', rewardPoints: 2, pointsBalance: 12 });
});

describe('Trang gian hàng CTV — cấu trúc trang (C-114)', () => {
  it('đang tải: có đúng một h1', () => {
    mocks.getMyStorefront.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Gian hàng của tôi');
  });

  it('lỗi tải khác 404: có đúng một h1 và nút Thử lại gọi lại API', async () => {
    mocks.getMyStorefront.mockRejectedValueOnce({ response: { status: 500 }, message: 'Máy chủ lỗi' });
    renderPage();
    const retry = await screen.findByRole('button', { name: /Thử lại/ });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Bắt đầu mở gian hàng' })).not.toBeInTheDocument();
    fireEvent.click(retry);
    await waitFor(() => expect(mocks.getMyStorefront).toHaveBeenCalledTimes(2));
  });

  it('có gian hàng: đúng một h1, tên gian hàng là h2, huy hiệu trạng thái theo isPublished', async () => {
    const view = renderPage();
    expect(await screen.findByRole('heading', { level: 2, name: 'Cửa hàng Xanh' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByText('Bản nháp, chưa gửi duyệt')).toBeInTheDocument();
    expect(screen.getByText('/s/shop-aff-1')).toBeInTheDocument();
    view.unmount();

    mocks.getMyStorefront.mockResolvedValue(storefront({ isPublished: true, subdomain: 'xanh', subdomainEnabled: true }));
    renderPage();
    expect(await screen.findByText('Đang hiển thị')).toBeInTheDocument();
    expect(screen.getByText('xanh.tubutree.com')).toBeInTheDocument();
  });
});

describe('Chỉnh gian hàng — sản phẩm và bộ sưu tập', () => {
  it('hiện tên sản phẩm, giá bán (ưu tiên giá khuyến mãi) và tên bộ sưu tập', async () => {
    renderPage();
    expect((await screen.findAllByText('Trà xanh')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('80.000đ').length).toBeGreaterThan(0);
    expect(screen.getByText('Bộ sưu tập A')).toBeInTheDocument();
  });

  it('món khách không thấy (chưa duyệt, ngừng bán…) được đánh dấu kèm lý do; món bình thường không có nhãn (SELLER-15)', async () => {
    mocks.getMyStorefront.mockResolvedValue(
      storefront({
        collections: [
          {
            id: 'c1', title: 'Bộ sưu tập A', kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, sortOrder: 0,
            items: [
              item({ hiddenReason: null }),
              item({ id: 'i2', productId: 'p3', product: { ...product, id: 'p3', name: 'SP chưa duyệt' }, hiddenReason: 'Sản phẩm chưa được duyệt bán' }),
            ],
          },
        ],
      }),
    );
    renderPage();
    expect(await screen.findByText(/Khách không thấy: Sản phẩm chưa được duyệt bán/)).toBeInTheDocument();
    expect(screen.getAllByText(/Khách không thấy/)).toHaveLength(1);
  });

  it('tên món bị ẩn không làm mờ bằng opacity (chữ phải đạt 4,5:1) và nhãn lý do được phép xuống dòng (D6-14)', async () => {
    mocks.getMyStorefront.mockResolvedValue(
      storefront({
        collections: [
          {
            id: 'c1', title: 'Bộ sưu tập A', kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, sortOrder: 0,
            items: [
              item({ id: 'i2', productId: 'p3', product: { ...product, id: 'p3', name: 'SP chưa duyệt' }, hiddenReason: 'Sản phẩm chưa được duyệt bán nên khách chưa thấy trong gian hàng' }),
              item({ id: 'i3', productId: 'p4', product: { ...product, id: 'p4', name: 'SP tự ẩn' }, isHidden: true }),
            ],
          },
        ],
      }),
    );
    renderPage();
    for (const name of ['SP chưa duyệt', 'SP tự ẩn']) {
      const el = await screen.findByText(name);
      expect(el.style.opacity).toBe('');
    }
    const badge = screen.getByText(/Khách không thấy/);
    expect(badge.style.whiteSpace).toBe('normal');
    expect(badge.style.maxWidth).toBe('100%');
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
    fireEvent.change(screen.getByPlaceholderText('Tên bộ sưu tập'), { target: { value: '  Mùa hè  ' } });
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
    fireEvent.click(within(sheet).getByRole('button', { name: 'Huỷ' }));
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
  it('"Gửi duyệt" gọi publishStorefront(true) rồi báo đã đăng', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Gửi duyệt' }));
    await waitFor(() => expect(mocks.publishStorefront).toHaveBeenCalledWith(true));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã gửi gian hàng. Tubu sẽ thông báo khi duyệt xong.', type: 'success' }));
  });

  it('đang đăng: nút "Gửi duyệt" báo bận và bấm lại không đăng lần hai', async () => {
    mocks.publishStorefront.mockReturnValue(new Promise(() => {}));
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Gửi duyệt' });
    fireEvent.click(btn);
    await waitFor(() => expect(btn).toHaveAttribute('aria-busy', 'true'));
    fireEvent.click(btn);
    expect(mocks.publishStorefront).toHaveBeenCalledTimes(1);
  });

  it('xem trước khi chưa ai xem được: mở bản xem trước ngay trong app, không chuyển trang', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Xem trước' }));
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(await screen.findByTestId('storefront-preview')).toHaveTextContent('Cửa hàng Xanh');
  });

  it('xem trước khi đã đăng: chuyển tới /s/:slug', async () => {
    mocks.getMyStorefront.mockResolvedValue(storefront({ isPublished: true }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Xem trước' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/s/shop-aff-1');
  });
});

describe('Chia sẻ, gỡ đăng và gian hàng đang bị ẩn (D3-08, D3-02)', () => {
  const published = (over: Record<string, unknown> = {}) => storefront({ isPublished: true, ...over });
  const empty = { collections: [{ id: 'c1', title: 'Bộ sưu tập A', kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, sortOrder: 0, items: [] }] };

  it('đã đăng: nút chính là "Chia sẻ gian hàng", mở ShareSheet với slug, tên và mã giới thiệu của chủ', async () => {
    mocks.getMyStorefront.mockResolvedValue(published());
    renderPage();
    expect(screen.queryByRole('button', { name: 'Gửi duyệt' })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Chia sẻ gian hàng' }));
    expect(await screen.findByTestId('share-sheet')).toBeInTheDocument();
    expect(mocks.shareSheet).toHaveBeenLastCalledWith(
      expect.objectContaining({ visible: true, slug: 'shop-aff-1', title: 'Cửa hàng Xanh', referralCode: 'SHOP-AFF-1' }),
    );
  });

  it('còn nháp: chưa có nút chia sẻ (link chưa mở được) và không có nút Gỡ đăng', async () => {
    renderPage();
    await screen.findByRole('button', { name: 'Gửi duyệt' });
    expect(screen.queryByRole('button', { name: 'Chia sẻ gian hàng' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Gỡ đăng' })).not.toBeInTheDocument();
  });

  it('gỡ đăng phải xác nhận; Huỷ thì không gọi API, xác nhận gọi publishStorefront(false) rồi báo đã gỡ', async () => {
    mocks.getMyStorefront.mockResolvedValue(published());
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Gỡ đăng' }));
    const sheet = await screen.findByTestId('sheet');
    expect(within(sheet).getByText('Gỡ đăng gian hàng này?')).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Huỷ' }));
    expect(mocks.publishStorefront).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Gỡ đăng' }));
    const again = await screen.findByTestId('sheet');
    fireEvent.click(within(again).getByRole('button', { name: 'Gỡ đăng' }));
    await waitFor(() => expect(mocks.publishStorefront).toHaveBeenCalledWith(false));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã gỡ đăng gian hàng', type: 'success' }));
  });

  it('chưa có sản phẩm nào: "Gửi duyệt" tắt kèm lời nhắc thêm sản phẩm, không gọi API', async () => {
    mocks.getMyStorefront.mockResolvedValue(storefront(empty));
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Gửi duyệt' });
    expect(btn).toBeDisabled();
    expect(screen.getByText('Thêm ít nhất 1 sản phẩm để đăng gian hàng.')).toBeInTheDocument();
    fireEvent.click(btn);
    expect(mocks.publishStorefront).not.toHaveBeenCalled();
  });

  it('có sản phẩm: không hiện lời nhắc và nút Đăng bấm được', async () => {
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Gửi duyệt' });
    expect(btn).not.toBeDisabled();
    expect(screen.queryByText('Thêm ít nhất 1 sản phẩm để đăng gian hàng.')).not.toBeInTheDocument();
  });

  it('khách không thấy gian hàng (bị admin gỡ, chủ không còn là CTV…): hiện lý do cho chủ', async () => {
    mocks.getMyStorefront.mockResolvedValue(published({ publicHiddenReason: 'Tubu Tree đã gỡ gian hàng: dùng ảnh người khác.' }));
    renderPage();
    expect(await screen.findByText('Tubu Tree đã gỡ gian hàng: dùng ảnh người khác.')).toBeInTheDocument();
  });

  it('gian hàng bình thường: không có dòng lý do ẩn', async () => {
    mocks.getMyStorefront.mockResolvedValue(published());
    renderPage();
    await screen.findByRole('button', { name: 'Chia sẻ gian hàng' });
    expect(screen.queryByTestId('hidden-reason')).not.toBeInTheDocument();
  });

  it('đã đăng: nhắc trang web cập nhật sau vài phút; còn nháp thì không nhắc', async () => {
    mocks.getMyStorefront.mockResolvedValue(published());
    const view = renderPage();
    expect(await screen.findByText('Gian hàng cập nhật sau vài phút khi bạn đổi nội dung.')).toBeInTheDocument();
    view.unmount();
    mocks.getMyStorefront.mockResolvedValue(storefront());
    renderPage();
    await screen.findByRole('button', { name: 'Gửi duyệt' });
    expect(screen.queryByText('Gian hàng cập nhật sau vài phút khi bạn đổi nội dung.')).not.toBeInTheDocument();
  });
});

describe('Trạng thái chờ duyệt (B-40)', () => {
  const pending = (over: Record<string, unknown> = {}) =>
    storefront({ isPublished: true, status: 'PENDING_APPROVAL', publicHiddenReason: 'Gian hàng đang chờ Tubu Tree duyệt lần đầu; khi được duyệt sẽ hiện với khách.', ...over });

  it('đã gửi duyệt mà chưa được duyệt: nhãn "Chờ duyệt", không ghi "Đang hiển thị", nói rõ thời hạn duyệt', async () => {
    mocks.getMyStorefront.mockResolvedValue(pending());
    renderPage();
    expect(await screen.findByText('Chờ duyệt', { selector: 'span' })).toBeInTheDocument();
    expect(screen.queryByText('Đang hiển thị')).not.toBeInTheDocument();
    expect(screen.getByTestId('hidden-reason')).toHaveTextContent('1 ngày làm việc');
    expect(screen.queryByText('Gian hàng cập nhật sau vài phút khi bạn đổi nội dung.')).not.toBeInTheDocument();
  });

  it('chờ duyệt: nút chia sẻ bị khoá, nói chia sẻ được sau khi duyệt', async () => {
    mocks.getMyStorefront.mockResolvedValue(pending());
    renderPage();
    const share = await screen.findByRole('button', { name: 'Chia sẻ được sau khi duyệt' });
    expect(share).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Chia sẻ gian hàng' })).not.toBeInTheDocument();
  });

  it('chờ duyệt: "Xem trước" mở bản xem trước trong app thay vì trang /s/ báo không tồn tại', async () => {
    mocks.getMyStorefront.mockResolvedValue(pending());
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Xem trước' }));
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(await screen.findByTestId('storefront-preview')).toBeInTheDocument();
  });

  it('chờ duyệt: nút rút lại gửi duyệt thay cho "Gỡ đăng"', async () => {
    mocks.getMyStorefront.mockResolvedValue(pending());
    renderPage();
    expect(await screen.findByRole('button', { name: 'Huỷ gửi duyệt' })).toBeInTheDocument();
  });

  it('đã được duyệt (LIVE): nhãn "Đang hiển thị" và chia sẻ được', async () => {
    mocks.getMyStorefront.mockResolvedValue(storefront({ isPublished: true, status: 'LIVE' }));
    renderPage();
    expect(await screen.findByText('Đang hiển thị')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chia sẻ gian hàng' })).not.toBeDisabled();
  });

  it('gian hàng nháp do máy chủ báo DRAFT: vào luồng 4 bước, có lối mở trình chỉnh sửa đầy đủ', async () => {
    mocks.getMyStorefront.mockResolvedValue(storefront({ status: 'DRAFT' }));
    renderPage();
    expect(await screen.findByText('Bước 2/4')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mở trình chỉnh sửa đầy đủ' }));
    expect(await screen.findByRole('button', { name: 'Gửi duyệt' })).toBeInTheDocument();
  });
});

describe('Link subdomain theo cờ (D3-11)', () => {
  it('cờ tắt: chỉ hiện /s/<slug>, trang cấu hình không có ô subdomain và không gửi subdomain', async () => {
    mocks.getMyStorefront.mockResolvedValue(storefront({ subdomain: null, subdomainEnabled: false }));
    renderPage();
    expect(await screen.findByText('/s/shop-aff-1')).toBeInTheDocument();
    expect(screen.queryByText(/tubutree\.com/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cài đặt' }));
    const sheet = await screen.findByTestId('sheet');
    expect(within(sheet).queryByPlaceholderText('vd: brand1')).not.toBeInTheDocument();
    expect(sheet.textContent).not.toMatch(/tubutree\.com/);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Lưu cấu hình gian hàng' }));
    await waitFor(() => expect(mocks.updateStorefront).toHaveBeenCalledTimes(1));
    expect(mocks.updateStorefront.mock.calls[0]![0].subdomain).toBeUndefined();
  });

  it('cờ bật: hiện link subdomain và ô nhập subdomain riêng', async () => {
    mocks.getMyStorefront.mockResolvedValue(storefront({ subdomain: 'lan-xanh', subdomainEnabled: true }));
    renderPage();
    expect(await screen.findByText('lan-xanh.tubutree.com')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cài đặt' }));
    const sheet = await screen.findByTestId('sheet');
    expect(within(sheet).getByPlaceholderText('vd: brand1')).toBeInTheDocument();
  });
});

describe('Subdomain chỉ gửi khi người dùng đổi (D3-11)', () => {
  it('cờ bật, subdomain đang lưu không đổi: lưu cấu hình không gửi lại subdomain', async () => {
    mocks.getMyStorefront.mockResolvedValue(storefront({ subdomain: 'lan-xanh', subdomainEnabled: true }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Cài đặt' }));
    const sheet = await screen.findByTestId('sheet');
    expect(within(sheet).getByPlaceholderText('vd: brand1')).toHaveValue('lan-xanh');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Lưu cấu hình gian hàng' }));
    await waitFor(() => expect(mocks.updateStorefront).toHaveBeenCalledTimes(1));
    expect(mocks.updateStorefront.mock.calls[0]![0].subdomain).toBeUndefined();
  });

  it('cờ bật, đổi subdomain: gửi giá trị mới viết thường', async () => {
    mocks.getMyStorefront.mockResolvedValue(storefront({ subdomain: 'lan-xanh', subdomainEnabled: true }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Cài đặt' }));
    const sheet = await screen.findByTestId('sheet');
    fireEvent.change(within(sheet).getByPlaceholderText('vd: brand1'), { target: { value: ' Lan-Do ' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Lưu cấu hình gian hàng' }));
    await waitFor(() => expect(mocks.updateStorefront).toHaveBeenCalledTimes(1));
    expect(mocks.updateStorefront.mock.calls[0]![0].subdomain).toBe('lan-do');
  });
});

describe('Ảnh bìa trống (D7)', () => {
  it('chưa có ảnh bìa: hiện lời mời thêm ảnh bìa trong khung bìa; có ảnh thì không', async () => {
    const view = renderPage();
    expect(await screen.findByText('Thêm ảnh bìa')).toBeInTheDocument();
    view.unmount();
    mocks.getMyStorefront.mockResolvedValue(storefront({ coverUrl: 'https://cdn/c.jpg' }));
    renderPage();
    await screen.findByText('Bộ sưu tập A');
    expect(screen.queryByText('Thêm ảnh bìa')).not.toBeInTheDocument();
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
    fireEvent.click(await screen.findByRole('button', { name: 'Cài đặt' }));
    const first = await screen.findByTestId('sheet');
    fireEvent.change(within(first).getByDisplayValue('Cửa hàng Xanh'), { target: { value: 'Tên gõ dở' } });
    expect(within(first).getByDisplayValue('Tên gõ dở')).toBeInTheDocument();
    fireEvent.click(within(first).getByRole('button', { name: 'Đóng' }));
    await waitFor(() => expect(screen.queryByTestId('sheet')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Cài đặt' }));
    const again = await screen.findByTestId('sheet');
    expect(within(again).getByDisplayValue('Cửa hàng Xanh')).toBeInTheDocument();
    expect(mocks.updateStorefront).not.toHaveBeenCalled();
  });

  it('cấu hình CTV: gửi màu mặc định xanh lá, không gửi tài khoản ngân hàng hay kho (Tubu thu tiền và giao hàng)', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Cài đặt' }));
    const sheet = await screen.findByTestId('sheet');
    expect(sheet.textContent).not.toMatch(/VietQR/);
    expect(within(sheet).queryByRole('textbox', { name: 'Số tài khoản ngân hàng' })).toBeNull();
    expect(within(sheet).queryByRole('textbox', { name: 'Địa chỉ kho xuất hàng' })).toBeNull();
    expect(sheet.textContent).toContain('Khách luôn thanh toán cho Tubu Tree.');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Lưu cấu hình gian hàng' }));
    await waitFor(() => expect(mocks.updateStorefront).toHaveBeenCalledTimes(1));
    expect(mocks.updateStorefront).toHaveBeenCalledWith({ title: 'Cửa hàng Xanh', subdomain: undefined, themeColor: '#16a34a' });
  });

  it('cấu hình gian hàng tự giao: xoá trắng kho/hotline gửi chuỗi rỗng để xoá thật, giá trị được cắt khoảng trắng', async () => {
    mocks.getMyStorefront.mockResolvedValue(
      storefront({ type: 'MERCHANT', warehouseAddress: '12 Lê Lợi', warehouseCity: 'Huế', warehousePhone: '0912000111' }),
    );
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Cài đặt' }));
    const sheet = await screen.findByTestId('sheet');
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Địa chỉ kho xuất hàng' }), { target: { value: '' } });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Hotline kho liên hệ' }), { target: { value: ' 0912999888 ' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Lưu cấu hình gian hàng' }));
    await waitFor(() => expect(mocks.updateStorefront).toHaveBeenCalledTimes(1));
    expect(mocks.updateStorefront).toHaveBeenCalledWith(
      expect.objectContaining({ warehouseAddress: '', warehouseCity: 'Huế', warehousePhone: '0912999888' }),
    );
    expect(mocks.updateStorefront.mock.calls[0]![0]).not.toHaveProperty('bankAccountNo');
  });

  it('CTV của đại lý (isPartner=true): có ô kho xuất hàng và hotline; isPartner=false thì không', async () => {
    mocks.getMyStorefront.mockResolvedValue(storefront({ type: 'CTV', isPartner: true }));
    const first = renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Cài đặt' }));
    let sheet = await screen.findByTestId('sheet');
    expect(within(sheet).getByRole('textbox', { name: 'Địa chỉ kho xuất hàng' })).toBeInTheDocument();
    expect(within(sheet).getByRole('textbox', { name: 'Hotline kho liên hệ' })).toBeInTheDocument();
    first.unmount();
    mocks.getMyStorefront.mockResolvedValue(storefront({ type: 'CTV', isPartner: false }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Cài đặt' }));
    sheet = await screen.findByTestId('sheet');
    expect(within(sheet).queryByRole('textbox', { name: 'Địa chỉ kho xuất hàng' })).toBeNull();
  });

  it('tài khoản ngân hàng cũ: báo không dùng để thu tiền và cho gỡ (gửi chuỗi rỗng)', async () => {
    mocks.getMyStorefront.mockResolvedValue(storefront({ bankName: 'Vietcombank', bankAccountNo: '0123456789' }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Cài đặt' }));
    const sheet = await screen.findByTestId('sheet');
    expect(sheet.textContent).toContain('Vietcombank ****6789');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Gỡ tài khoản đã lưu' }));
    await waitFor(() =>
      expect(mocks.updateStorefront).toHaveBeenCalledWith({ bankName: '', bankBin: '', bankAccountNo: '', bankAccountName: '' }),
    );
  });

  it('cấu hình: chọn màu "Xanh dương" gửi #2563eb; subdomain được viết thường', async () => {
    mocks.getMyStorefront.mockResolvedValue(storefront({ subdomainEnabled: true }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Cài đặt' }));
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
    fireEvent.click(await screen.findByRole('button', { name: 'Cài đặt' }));
    const sheet = await screen.findByTestId('sheet');
    expect(within(sheet).getByRole('button', { name: 'Tím' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('ô nhập trong cấu hình đều có tên truy cập (nhãn hoặc aria-label)', async () => {
    mocks.getMyStorefront.mockResolvedValue(storefront({ type: 'MERCHANT', subdomainEnabled: true }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Cài đặt' }));
    const sheet = await screen.findByTestId('sheet');
    for (const name of [
      'Tên gian hàng', 'Subdomain riêng', 'Địa chỉ kho xuất hàng', 'Tỉnh / Thành phố', 'Hotline kho liên hệ',
    ]) {
      expect(within(sheet).getByRole('textbox', { name }), name).toBeInTheDocument();
    }
  });

  it('mỗi ô màu có vùng chạm >= 44px', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Cài đặt' }));
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
    expect(screen.getByText('Đơn 30 ngày')).toBeInTheDocument();
    expect(screen.queryByText(/7 ngày/)).not.toBeInTheDocument();
    expect(screen.getByText('1.250.000đ')).toBeInTheDocument();
    expect(screen.getByText('125.000đ')).toBeInTheDocument();
    expect(screen.getByText('4 món · 320.000đ')).toBeInTheDocument();
  });

  it('các dòng cộng đúng ô Doanh thu: sản phẩm ngoài top 5 gộp một dòng, phần ship/giảm giá cấp đơn một dòng, ẩn dòng 0 món', async () => {
    const p = (i: number, revenue: number, qty = 1) => ({ productSlug: `p${i}`, productName: `SP ${i}`, qty, revenue });
    mocks.getStorefrontStats.mockResolvedValue({
      ...stats,
      revenue30d: 1_000_000,
      byProduct: [p(1, 300_000), p(2, 200_000), p(3, 150_000), p(4, 100_000), p(5, 80_000), p(6, 70_000, 2), p(7, 50_000), p(8, 0, 0)],
      shippingAndOrderDiscount30d: 50_000,
    });
    renderPage();
    expect(await screen.findByText('SP 5')).toBeInTheDocument();
    expect(screen.queryByText('SP 6')).not.toBeInTheDocument();
    expect(screen.getByText('2 sản phẩm khác')).toBeInTheDocument();
    expect(screen.getByText('3 món · 120.000đ')).toBeInTheDocument();
    expect(screen.getByText('Phí ship, giảm giá, chênh lệch hoàn tiền')).toBeInTheDocument();
    expect(screen.getByText('50.000đ')).toBeInTheDocument();
    expect(screen.queryByText('SP 8')).not.toBeInTheDocument();
    expect(screen.queryByText(/0 món · 0đ/)).not.toBeInTheDocument();
  });

  it('phần cấp đơn bằng 0 hoặc API cũ không trả: không hiện dòng đó', async () => {
    renderPage();
    expect(await screen.findByText('4 món · 320.000đ')).toBeInTheDocument();
    expect(screen.queryByText('Phí ship, giảm giá, chênh lệch hoàn tiền')).not.toBeInTheDocument();
  });

  it('chưa có đơn: hiện lời nhắn chia sẻ link', async () => {
    mocks.getStorefrontStats.mockResolvedValue({ ...stats, byProduct: [] });
    renderPage();
    expect(await screen.findByText(/Chưa có đơn nào qua gian hàng/)).toBeInTheDocument();
  });

  it('nhiệm vụ: cấp độ, tổng điểm, tiến độ; nhiệm vụ đã nhận không còn ký tự ✓', async () => {
    renderPage();
    expect(await screen.findByText('Hành trình gian hàng')).toBeInTheDocument();
    expect(screen.getByText('1/5')).toBeInTheDocument();
    expect(screen.getByText('Đã nhận 4 điểm')).toBeInTheDocument();
    expect(screen.getByText('0/1')).toBeInTheDocument();
    expect(screen.getByText('Viết hồ sơ')).toBeInTheDocument();
    expect(screen.getByText('Đã nhận')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/[✓✔]/);
  });

  it('nhiệm vụ đã đạt: nút nhận thưởng gọi claimQuest và báo số Điểm Xanh', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /\+2 điểm/ }));
    await waitFor(() => expect(mocks.claimQuest).toHaveBeenCalledWith('Q1'));
    await waitFor(() =>
      expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: '+2 điểm 🎉', type: 'success' }),
    );
  });

  it('đang nhận một thưởng: nút đó báo bận, nút nhận khác bị khoá, bấm lại không gọi API thêm', async () => {
    mocks.getQuests.mockResolvedValue({
      ...quests,
      quests: [
        quests.quests[0],
        { code: 'Q4', title: 'Chia sẻ link', hint: '', goal: 1, progress: 1, done: true, claimed: false, rewardPoints: 5 },
      ],
    });
    mocks.claimQuest.mockReturnValue(new Promise(() => {}));
    renderPage();
    const first = await screen.findByRole('button', { name: /\+2 điểm/ });
    const second = screen.getByRole('button', { name: /\+5 điểm/ });
    fireEvent.click(first);
    await waitFor(() => expect(first).toHaveAttribute('aria-busy', 'true'));
    expect(second).toBeDisabled();
    fireEvent.click(first);
    expect(mocks.claimQuest).toHaveBeenCalledTimes(1);
  });

  it('nhiệm vụ chưa đạt không có nút nhận', async () => {
    renderPage();
    await screen.findByText('Hành trình gian hàng');
    expect(screen.getAllByRole('button', { name: /điểm$/ })).toHaveLength(1);
  });
});
