import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
  getAffiliateMe: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  Sheet: ({ visible, children }: { visible: boolean; children: ReactNode }) => (visible ? <div data-testid="sheet">{children}</div> : null),
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/storefront', search: '', state: null }),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/storefront-api', () => ({ ...mocks }));
vi.mock('../services/affiliate-api', () => ({ getAffiliateMe: mocks.getAffiliateMe }));
vi.mock('../components/image-upload', () => ({
  ImageUpload: ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
    <input aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import StorefrontBuilderPage from './storefront-builder';

const product = { id: 'p1', name: 'Trà xanh', slug: 'tra-xanh', thumbnail: null, brand: 'Tubu', basePrice: 100_000, salePrice: 80_000, ratingAvg: 5, reviewCount: 1, inStock: true };
const item = { id: 'i1', productId: 'p1', note: null, variationId: null, isPinned: false, isHidden: false, sortOrder: 0, product };
const draft = (over: Record<string, unknown> = {}) => ({
  id: 'sf1', slug: 'shop-aff-1', type: 'CTV', title: 'Cửa hàng của An', headerNote: null, avatarUrl: null, coverUrl: null, theme: 'default',
  themeColor: null, subdomain: null, isPublished: false, status: 'DRAFT', referralCode: 'SHOP-AFF-1', subdomainEnabled: false, publicHiddenReason: null,
  collections: [],
  ...over,
});
const withItem = { collections: [{ id: 'c1', title: 'Sản phẩm mình chọn', kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, sortOrder: 0, items: [item] }] };

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><StorefrontBuilderPage /></QueryClientProvider>);
}
const notFound = () => mocks.getMyStorefront.mockRejectedValue({ response: { status: 404 } });
const next = () => fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getQuests.mockResolvedValue({ quests: [], totalEarnedPoints: 0, level: 0, levelMax: 5 });
  mocks.getStorefrontStats.mockResolvedValue({ orders7d: 0, orders30d: 0, revenue30d: 0, commission30d: 0, byProduct: [] });
  mocks.pickerProducts.mockResolvedValue([{ ...product, id: 'p2', name: 'Xà phòng', slug: 'xa-phong', maxAffiliateRate: 12 }]);
  mocks.getStorefrontCategories.mockResolvedValue([{ id: 'cat1', name: 'Chăm sóc da', slug: 'cham-soc-da', image: null }]);
  mocks.getAffiliateMe.mockResolvedValue({ isAffiliate: true, canRegister: false, canOpenStorefront: true, referralCode: 'AN', walletBalance: 0 });
  mocks.createStorefront.mockResolvedValue(draft());
  mocks.applyStorefrontTemplate.mockResolvedValue({ collectionId: 'c9', title: 'Mẫu', itemCount: 8 });
  mocks.createCollection.mockResolvedValue({ id: 'c1', title: 'Sản phẩm mình chọn', items: [] });
  for (const fn of [mocks.updateStorefront, mocks.publishStorefront, mocks.addItem, mocks.removeItem]) fn.mockResolvedValue({});
});

describe('Bước 1/4: điều kiện', () => {
  it('khách thường chưa có gian hàng: không có "Tạo gian hàng", dẫn đi đăng ký Cộng tác viên và không gọi tạo', async () => {
    notFound();
    mocks.getAffiliateMe.mockResolvedValue({ isAffiliate: false, canRegister: true, referralCode: 'AN', walletBalance: 0 });
    renderPage();
    expect(await screen.findByText('Bước 1/4')).toBeInTheDocument();
    expect(await screen.findByText('Bạn cần là Cộng tác viên trước khi mở gian hàng.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tạo gian hàng' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bắt đầu mở gian hàng' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Đăng ký làm Cộng tác viên' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/affiliate');
    expect(mocks.createStorefront).not.toHaveBeenCalled();
  });

  it('đại lý không đăng ký CTV được: báo không mở được, không có nút đi tiếp', async () => {
    notFound();
    mocks.getAffiliateMe.mockResolvedValue({ isAffiliate: false, canRegister: false, canOpenStorefront: false, referralCode: 'AN', walletBalance: 0 });
    renderPage();
    expect(await screen.findByText('Tài khoản này không mở gian hàng Cộng tác viên được.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bắt đầu mở gian hàng' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Đăng ký làm Cộng tác viên' })).not.toBeInTheDocument();
  });

  it('CTV: liệt kê điều kiện, bấm bắt đầu thì tạo gian hàng một lần và sang bước 2', async () => {
    notFound();
    renderPage();
    expect(await screen.findByText('Bạn đã là Cộng tác viên.', { exact: false })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    mocks.getMyStorefront.mockResolvedValue(draft());
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu mở gian hàng' }));
    expect(await screen.findByText('Bước 2/4')).toBeInTheDocument();
    expect(mocks.createStorefront).toHaveBeenCalledTimes(1);
  });
});

describe('Bước 2/4: thông tin', () => {
  it('đường dẫn gắn với mã giới thiệu nên chỉ hiện, không sửa được', async () => {
    mocks.getMyStorefront.mockResolvedValue(draft());
    renderPage();
    expect(await screen.findByText('/s/shop-aff-1')).toBeInTheDocument();
    expect(screen.getByText('Đường dẫn gắn với mã giới thiệu của bạn nên không đổi được.')).toBeInTheDocument();
  });

  it('tên trống thì chặn và không lưu', async () => {
    mocks.getMyStorefront.mockResolvedValue(draft());
    renderPage();
    fireEvent.change(await screen.findByLabelText('Tên gian hàng'), { target: { value: '  ' } });
    next();
    expect(await screen.findByText('Nhập tên gian hàng.')).toBeInTheDocument();
    expect(mocks.updateStorefront).not.toHaveBeenCalled();
  });

  it('lưu tên, mô tả, ảnh đã cắt khoảng trắng rồi sang bước 3', async () => {
    mocks.getMyStorefront.mockResolvedValue(draft());
    renderPage();
    fireEvent.change(await screen.findByLabelText('Tên gian hàng'), { target: { value: ' Góc Mẹ Bỉm ' } });
    fireEvent.change(screen.getByLabelText('Mô tả ngắn'), { target: { value: 'Đồ mình đã dùng thật' } });
    fireEvent.change(screen.getByLabelText('Ảnh đại diện'), { target: { value: 'https://cdn.example/a.png' } });
    next();
    await waitFor(() =>
      expect(mocks.updateStorefront).toHaveBeenCalledWith({ title: 'Góc Mẹ Bỉm', headerNote: 'Đồ mình đã dùng thật', avatarUrl: 'https://cdn.example/a.png', coverUrl: '' }),
    );
    expect(await screen.findByText('Bước 3/4')).toBeInTheDocument();
  });
});

describe('Bước 3/4: sản phẩm', () => {
  const toProducts = async () => {
    renderPage();
    await screen.findByLabelText('Tên gian hàng');
    next();
    await screen.findByText('Bước 3/4');
  };

  it('chưa có sản phẩm: không đi tiếp được và nói cần thêm ít nhất 1 sản phẩm', async () => {
    mocks.getMyStorefront.mockResolvedValue(draft());
    await toProducts();
    expect(screen.getByText('Thêm ít nhất 1 sản phẩm để tiếp tục.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tiếp tục' })).toBeDisabled();
  });

  it('dựng nhanh theo danh mục: áp mẫu đúng danh mục', async () => {
    mocks.getMyStorefront.mockResolvedValue(draft());
    await toProducts();
    fireEvent.click(screen.getByRole('button', { name: 'Chọn danh mục' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Dùng mẫu Chăm sóc da' }));
    await waitFor(() => expect(mocks.applyStorefrontTemplate).toHaveBeenCalledWith('cat1'));
  });

  it('tự chọn: chưa có bộ sưu tập thì tạo một bộ rồi mở danh sách chọn sản phẩm và thêm vào đúng bộ đó', async () => {
    mocks.getMyStorefront.mockResolvedValue(draft());
    await toProducts();
    fireEvent.click(screen.getByRole('button', { name: 'Thêm sản phẩm' }));
    await waitFor(() => expect(mocks.createCollection).toHaveBeenCalledWith({ title: 'Sản phẩm mình chọn' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm' }));
    await waitFor(() => expect(mocks.addItem).toHaveBeenCalledWith('c1', { productId: 'p2' }));
  });

  it('đã có sản phẩm: đi tiếp được; bỏ sản phẩm gọi removeItem', async () => {
    mocks.getMyStorefront.mockResolvedValue(draft(withItem));
    await toProducts();
    expect(screen.getByText('Đã chọn 1 sản phẩm')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tiếp tục' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ Trà xanh' }));
    await waitFor(() => expect(mocks.removeItem).toHaveBeenCalledWith('i1'));
  });
});

describe('Bước 4/4: xem trước và gửi duyệt', () => {
  it('xem trước đúng dữ liệu, nói thời hạn duyệt, gửi duyệt gọi publishStorefront(true)', async () => {
    mocks.getMyStorefront.mockResolvedValue(draft({ ...withItem, headerNote: 'Mua giúp mình nhé' }));
    renderPage();
    await screen.findByLabelText('Tên gian hàng');
    next();
    await screen.findByText('Bước 3/4');
    next();
    expect(await screen.findByText('Bước 4/4')).toBeInTheDocument();
    expect(screen.getByTestId('storefront-preview')).toHaveTextContent('Mua giúp mình nhé');
    expect(screen.getByText('Tubu duyệt trong 1 ngày làm việc, rồi khách mới xem được gian hàng của bạn.')).toBeInTheDocument();
    mocks.getMyStorefront.mockResolvedValue(draft({ ...withItem, isPublished: true, status: 'PENDING_APPROVAL' }));
    fireEvent.click(screen.getByRole('button', { name: 'Gửi duyệt' }));
    await waitFor(() => expect(mocks.publishStorefront).toHaveBeenCalledWith(true));
    expect(await screen.findByText('Chờ duyệt', { selector: 'span' })).toBeInTheDocument();
  });
});
