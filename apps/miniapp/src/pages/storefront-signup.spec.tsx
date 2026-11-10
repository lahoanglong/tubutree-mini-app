import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { vi as t } from '../i18n/vi';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  getMyStorefront: vi.fn(),
  getCtvTiers: vi.fn(),
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
vi.mock('../services/affiliate-api', () => ({ getAffiliateMe: mocks.getAffiliateMe, getCtvTiers: mocks.getCtvTiers }));
// Ô ảnh giả ghi lại props lần vẽ gần nhất theo nhãn: test tự báo "đang tải"/"tải xong" như ô thật.
const pickers = vi.hoisted(() => ({} as Record<string, { onChange: (v: string) => void; onBusyChange: (busy: boolean) => void; disabled: boolean }>));
vi.mock('../components/image-upload', () => ({
  ImageUpload: ({ label, value, onChange, onBusyChange, disabled }: { label: string; value: string; onChange: (v: string) => void; onBusyChange?: (busy: boolean) => void; disabled?: boolean }) => {
    pickers[label] = { onChange, onBusyChange: onBusyChange ?? (() => undefined), disabled: Boolean(disabled) };
    return <input aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
  },
}));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import StorefrontBuilderPage from './storefront-builder';
import { HttpError } from '../services/http';
import { LOCK_REFRESH_WAIT_MS } from '../utils/settle-within';

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
  mocks.getCtvTiers.mockResolvedValue({ revenue: 0, tier: { name: 'Tân binh', emoji: '🌱' }, allTiers: [{ name: 'Tân binh', emoji: '🌱', min: 0, milestoneRewardPoints: null }] });
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

/** Hai cú chạm sát nhau trong cùng khung hình (trước khi React vẽ lại `isPending`) chỉ được gửi một yêu cầu. */
describe('Khoá chạm đúp: hai cú chạm cùng khung hình chỉ gửi một yêu cầu', () => {
  function deferred<T = unknown>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((res) => { resolve = res; });
    return { promise, resolve };
  }
  // Cả hai cú nhấp nằm trong MỘT act nên chưa có lần vẽ lại nào chen giữa.
  const twice = async (first: HTMLElement, second: HTMLElement = first) => {
    await act(async () => {
      fireEvent.click(first);
      fireEvent.click(second);
    });
  };
  const errorShown = () => waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: expect.any(String), type: 'error' }));
  const busy = (btn: HTMLElement) => waitFor(() => expect(btn).toHaveAttribute('aria-busy', 'true'));
  const idle = (btn: HTMLElement) => waitFor(() => expect(btn).not.toHaveAttribute('aria-busy', 'true'));
  const nextBtn = () => screen.getByRole('button', { name: 'Tiếp tục' });
  const toStep = async (step: 3 | 4) => {
    renderPage();
    await screen.findByLabelText('Tên gian hàng');
    next();
    await screen.findByText('Bước 3/4');
    if (step === 4) {
      next();
      await screen.findByText('Bước 4/4');
    }
  };

  describe('bước 1: bắt đầu', () => {
    const open = async () => {
      notFound();
      renderPage();
      return screen.findByRole('button', { name: 'Bắt đầu mở gian hàng' });
    };

    it('hai cú chạm "Bắt đầu mở gian hàng" cùng khung hình chỉ tạo gian hàng một lần rồi sang bước 2', async () => {
      const d = deferred();
      mocks.createStorefront.mockReturnValue(d.promise);
      const start = await open();
      await twice(start);
      expect(mocks.createStorefront).toHaveBeenCalledTimes(1);
      await busy(start);
      mocks.getMyStorefront.mockResolvedValue(draft());
      await act(async () => { d.resolve(draft()); });
      expect(await screen.findByText('Bước 2/4')).toBeInTheDocument();
      expect(mocks.createStorefront).toHaveBeenCalledTimes(1);
    });

    it('tạo gian hàng lỗi thì nhả khoá: bấm lại gọi lần hai', async () => {
      mocks.createStorefront.mockRejectedValueOnce(new Error('Mạng yếu'));
      const start = await open();
      fireEvent.click(start);
      await errorShown();
      await idle(start);
      fireEvent.click(start);
      await waitFor(() => expect(mocks.createStorefront).toHaveBeenCalledTimes(2));
    });
  });

  describe('bước 2: thông tin', () => {
    const open = async () => {
      mocks.getMyStorefront.mockResolvedValue(draft());
      renderPage();
      await screen.findByLabelText('Tên gian hàng');
      return nextBtn();
    };

    it('hai cú chạm "Tiếp tục" cùng khung hình chỉ lưu thông tin một lần rồi sang bước 3', async () => {
      const d = deferred();
      mocks.updateStorefront.mockReturnValue(d.promise);
      const save = await open();
      await twice(save);
      expect(mocks.updateStorefront).toHaveBeenCalledTimes(1);
      await busy(save);
      await act(async () => { d.resolve({}); });
      expect(await screen.findByText('Bước 3/4')).toBeInTheDocument();
      expect(mocks.updateStorefront).toHaveBeenCalledTimes(1);
    });

    it('lưu thông tin lỗi thì nhả khoá: bấm lại gọi lần hai', async () => {
      mocks.updateStorefront.mockRejectedValueOnce(new Error('Mạng yếu'));
      const save = await open();
      fireEvent.click(save);
      await errorShown();
      await idle(save);
      fireEvent.click(save);
      await waitFor(() => expect(mocks.updateStorefront).toHaveBeenCalledTimes(2));
    });
  });

  describe('bước 3: sản phẩm', () => {
    const product2 = { ...product, id: 'p2', name: 'Xà phòng' };
    const item2 = { ...item, id: 'i2', productId: 'p2', product: product2, sortOrder: 1 };
    const twoItems = { collections: [{ id: 'c1', title: 'Sản phẩm mình chọn', kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, sortOrder: 0, items: [item, item2] }] };

    it('hai cú chạm cùng một danh mục mẫu cùng khung hình chỉ áp mẫu một lần, xong thì đóng bảng chọn', async () => {
      const d = deferred();
      mocks.applyStorefrontTemplate.mockReturnValue(d.promise);
      mocks.getMyStorefront.mockResolvedValue(draft());
      await toStep(3);
      fireEvent.click(screen.getByRole('button', { name: 'Chọn danh mục' }));
      const cat = await screen.findByRole('button', { name: 'Dùng mẫu Chăm sóc da' });
      await twice(cat);
      expect(mocks.applyStorefrontTemplate.mock.calls).toEqual([['cat1']]);
      await act(async () => { d.resolve({ collectionId: 'c9', title: 'Mẫu', itemCount: 8 }); });
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Dùng mẫu Chăm sóc da' })).toBeNull());
      expect(mocks.applyStorefrontTemplate).toHaveBeenCalledTimes(1);
    });

    it('hai danh mục mẫu khác nhau cùng khung hình: chỉ mẫu đầu được áp (mẫu áp lên cả gian hàng nên không chạy song song)', async () => {
      const d = deferred();
      mocks.applyStorefrontTemplate.mockReturnValue(d.promise);
      mocks.getStorefrontCategories.mockResolvedValue([
        { id: 'cat1', name: 'Chăm sóc da', slug: 'cham-soc-da', image: null },
        { id: 'cat2', name: 'Nhà bếp', slug: 'nha-bep', image: null },
      ]);
      mocks.getMyStorefront.mockResolvedValue(draft());
      await toStep(3);
      fireEvent.click(screen.getByRole('button', { name: 'Chọn danh mục' }));
      const first = await screen.findByRole('button', { name: 'Dùng mẫu Chăm sóc da' });
      const second = screen.getByRole('button', { name: 'Dùng mẫu Nhà bếp' });
      await twice(first, second);
      expect(mocks.applyStorefrontTemplate.mock.calls).toEqual([['cat1']]);
      await act(async () => { d.resolve({ collectionId: 'c9', title: 'Mẫu', itemCount: 8 }); });
    });

    it('áp mẫu lỗi thì nhả khoá: bấm lại gọi lần hai', async () => {
      mocks.applyStorefrontTemplate.mockRejectedValueOnce(new Error('Mạng yếu'));
      mocks.getMyStorefront.mockResolvedValue(draft());
      await toStep(3);
      fireEvent.click(screen.getByRole('button', { name: 'Chọn danh mục' }));
      const cat = await screen.findByRole('button', { name: 'Dùng mẫu Chăm sóc da' });
      fireEvent.click(cat);
      await errorShown();
      await waitFor(() => expect(cat).not.toHaveAttribute('aria-disabled', 'true'));
      fireEvent.click(cat);
      await waitFor(() => expect(mocks.applyStorefrontTemplate).toHaveBeenCalledTimes(2));
    });

    it('hai cú chạm "Thêm sản phẩm" cùng khung hình chỉ tạo bộ sưu tập một lần rồi mở bảng chọn', async () => {
      const d = deferred();
      mocks.createCollection.mockReturnValue(d.promise);
      mocks.getMyStorefront.mockResolvedValue(draft());
      await toStep(3);
      const pick = screen.getByRole('button', { name: 'Thêm sản phẩm' });
      await twice(pick);
      expect(mocks.createCollection).toHaveBeenCalledTimes(1);
      await busy(pick);
      await act(async () => { d.resolve({ id: 'c1', title: 'Sản phẩm mình chọn', items: [] }); });
      expect(await screen.findByRole('button', { name: 'Thêm' })).toBeInTheDocument();
      expect(mocks.createCollection).toHaveBeenCalledTimes(1);
    });

    it('tạo bộ sưu tập lỗi thì nhả khoá: bấm lại gọi lần hai', async () => {
      mocks.createCollection.mockRejectedValueOnce(new Error('Mạng yếu'));
      mocks.getMyStorefront.mockResolvedValue(draft());
      await toStep(3);
      const pick = screen.getByRole('button', { name: 'Thêm sản phẩm' });
      fireEvent.click(pick);
      await errorShown();
      await idle(pick);
      fireEvent.click(pick);
      await waitFor(() => expect(mocks.createCollection).toHaveBeenCalledTimes(2));
    });

    it('hai cú chạm "Bỏ" cùng một món cùng khung hình chỉ bỏ một lần', async () => {
      const d = deferred();
      mocks.removeItem.mockReturnValue(d.promise);
      mocks.getMyStorefront.mockResolvedValue(draft(twoItems));
      await toStep(3);
      await twice(screen.getByRole('button', { name: 'Bỏ Trà xanh' }));
      expect(mocks.removeItem).toHaveBeenCalledTimes(1);
      expect(mocks.removeItem.mock.calls[0]![0]).toBe('i1');
      await act(async () => { d.resolve({}); });
      await waitFor(() => expect(mocks.getMyStorefront).toHaveBeenCalledTimes(3));
    });

    it('bỏ hai món khác nhau cùng khung hình: cả hai đều được gửi', async () => {
      mocks.getMyStorefront.mockResolvedValue(draft(twoItems));
      await toStep(3);
      await twice(screen.getByRole('button', { name: 'Bỏ Trà xanh' }), screen.getByRole('button', { name: 'Bỏ Xà phòng' }));
      await waitFor(() => expect(mocks.removeItem).toHaveBeenCalledTimes(2));
      expect(mocks.removeItem.mock.calls.map((c) => c[0]).sort()).toEqual(['i1', 'i2']);
    });

    it('bỏ món lỗi thì nhả khoá: bấm lại gọi lần hai', async () => {
      mocks.removeItem.mockRejectedValueOnce(new Error('Mạng yếu'));
      mocks.getMyStorefront.mockResolvedValue(draft(twoItems));
      await toStep(3);
      const del = screen.getByRole('button', { name: 'Bỏ Trà xanh' });
      fireEvent.click(del);
      await errorShown();
      fireEvent.click(del);
      await waitFor(() => expect(mocks.removeItem).toHaveBeenCalledTimes(2));
    });
  });

  describe('bước 4: gửi duyệt', () => {
    it('hai cú chạm "Gửi duyệt" cùng khung hình chỉ gửi một lần và chỉ báo một lần', async () => {
      const d = deferred();
      mocks.publishStorefront.mockReturnValue(d.promise);
      mocks.getMyStorefront.mockResolvedValue(draft(withItem));
      await toStep(4);
      const submit = screen.getByRole('button', { name: 'Gửi duyệt' });
      await twice(submit);
      expect(mocks.publishStorefront).toHaveBeenCalledTimes(1);
      await busy(submit);
      mocks.getMyStorefront.mockResolvedValue(draft({ ...withItem, isPublished: true, status: 'PENDING_APPROVAL' }));
      await act(async () => { d.resolve({}); });
      await waitFor(() => expect(mocks.openSnackbar.mock.calls.filter(([o]) => (o as { type: string }).type === 'success')).toHaveLength(1));
      expect(mocks.publishStorefront).toHaveBeenCalledTimes(1);
    });

    it('gửi duyệt lỗi thì nhả khoá: bấm lại gọi lần hai', async () => {
      mocks.publishStorefront.mockRejectedValueOnce(new Error('Mạng yếu'));
      mocks.getMyStorefront.mockResolvedValue(draft(withItem));
      await toStep(4);
      const submit = screen.getByRole('button', { name: 'Gửi duyệt' });
      fireEvent.click(submit);
      await errorShown();
      await idle(submit);
      fireEvent.click(submit);
      await waitFor(() => expect(mocks.publishStorefront).toHaveBeenCalledTimes(2));
    });
  });
});

describe('Bước 2/4: ảnh đại diện và ảnh bìa còn đang lên thì "Tiếp tục" chờ (W90A)', () => {
  const AVATAR = 'Ảnh đại diện';
  const COVER = 'Ảnh bìa';
  const openInfoStep = async () => {
    mocks.getMyStorefront.mockResolvedValue(draft());
    renderPage();
    await screen.findByLabelText('Tên gian hàng');
  };

  it('hai ô tải chồng nhau: còn một ô chưa xong là nút vẫn khoá, bấm không lưu; cả hai xong mới lưu, kèm ảnh MỚI rồi sang bước 3', async () => {
    await openInfoStep();
    act(() => pickers[AVATAR]!.onBusyChange(true));
    act(() => pickers[COVER]!.onBusyChange(true));
    const waiting = screen.getByRole('button', { name: t.common.imagesUploading });
    expect(waiting).toBeDisabled();
    fireEvent.click(waiting);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(mocks.updateStorefront).not.toHaveBeenCalled();

    act(() => {
      pickers[AVATAR]!.onChange('https://cdn.example/a2.png');
      pickers[AVATAR]!.onBusyChange(false);
    });
    expect(screen.getByRole('button', { name: t.common.imagesUploading })).toBeDisabled();

    act(() => {
      pickers[COVER]!.onChange('https://cdn.example/c2.png');
      pickers[COVER]!.onBusyChange(false);
    });
    const go = await screen.findByRole('button', { name: 'Tiếp tục' });
    expect(go).toBeEnabled();
    fireEvent.click(go);
    await waitFor(() => expect(mocks.updateStorefront).toHaveBeenCalledTimes(1));
    expect(mocks.updateStorefront).toHaveBeenCalledWith(expect.objectContaining({ avatarUrl: 'https://cdn.example/a2.png', coverUrl: 'https://cdn.example/c2.png' }));
    expect(await screen.findByText('Bước 3/4')).toBeInTheDocument();
  });

  it('đang lưu thông tin thì cả hai ô ảnh khoá', async () => {
    let release!: (v: unknown) => void;
    mocks.updateStorefront.mockReturnValueOnce(new Promise((r) => (release = r)));
    await openInfoStep();
    expect(screen.getByLabelText(AVATAR)).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
    await waitFor(() => expect(mocks.updateStorefront).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByLabelText(AVATAR)).toBeDisabled());
    expect(screen.getByLabelText(COVER)).toBeDisabled();
    await act(async () => release({}));
    expect(await screen.findByText('Bước 3/4')).toBeInTheDocument();
  });
});

// W112A: lệnh ghi bị máy chủ từ chối vì gian hàng đã đổi (400/404/409) thì nút giữ khoá tới khi dữ liệu làm mới về (tối đa LOCK_REFRESH_WAIT_MS). Mất mạng, quá hạn, 401, 5xx không nói gì về gian hàng thật: không tải lại, nhả ngay.
describe('Luồng 4 bước: máy chủ từ chối thì tải lại rồi mới nhả khoá (W112A)', () => {
  type Pending = { promise: Promise<void>; resolve: () => void };
  type Case = {
    name: string;
    /** Lệnh ghi bị giả lập. */
    write: ReturnType<typeof vi.fn>;
    /** Khoá tải lại kỳ vọng khi máy chủ từ chối, đúng thứ tự gọi. */
    keys: string[][];
    /** Giá trị lệnh ghi trả ở lần bấm lại sau khi nhả khoá. */
    succeed: unknown;
    /** Dựng màn tới đúng bước có nút (trước khi bật bản tải lại giả); trả hàm bấm nút, đồng bộ. */
    open: (qc: QueryClient) => Promise<() => void>;
  };

  const MINE = [['my-storefront']];
  const serverError = (message: string, status: number) => new HttpError(message, undefined, { status, data: { message }, headers: {} });
  const errorToasts = () => mocks.openSnackbar.mock.calls.filter(([o]) => (o as { type: string }).type === 'error');
  // TanStack báo cache qua setTimeout(0): đợi một nhịp để `isPending` kịp về false sau khi lệnh xong.
  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  const pending = (): Pending => {
    let resolve!: () => void;
    const promise = new Promise<void>((res) => { resolve = res; });
    return { promise, resolve };
  };
  const TEMPORARY: [string, unknown][] = [
    ['mất mạng', new HttpError('Network Error', 'ERR_NETWORK')],
    ['quá thời gian', new HttpError('timeout', 'ECONNABORTED')],
    ['máy chủ lỗi 503', serverError('Service Unavailable', 503)],
    ['hết phiên 401', serverError('Unauthorized', 401)],
  ];
  /** Bước chuyển giữa các màn cần tải lại thật; chỉ sau `arm()` mỗi lần tải lại mới là một lời hứa riêng giữ trong tay. */
  function liveClient() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const refreshes: Pending[] = [];
    const arm = (opts: { hang?: boolean } = {}) => {
      invalidate.mockClear();
      invalidate.mockImplementation((() => {
        const p = pending();
        if (!opts.hang) refreshes.push(p);
        return p.promise;
      }) as never);
    };
    return { qc, invalidate, refreshes, arm };
  }
  const keysOf = (invalidate: ReturnType<typeof liveClient>['invalidate']) => invalidate.mock.calls.map(([f]) => (f as { queryKey: string[] }).queryKey);
  const mount = (qc: QueryClient) => render(<QueryClientProvider client={qc}><StorefrontBuilderPage /></QueryClientProvider>);
  const toStep = async (qc: QueryClient, step: 3 | 4) => {
    mount(qc);
    await screen.findByLabelText('Tên gian hàng');
    next();
    await screen.findByText('Bước 3/4');
    if (step === 4) {
      next();
      await screen.findByText('Bước 4/4');
    }
  };

  const CASES: Case[] = [
    {
      name: 'bắt đầu mở gian hàng (startMut)',
      write: mocks.createStorefront,
      keys: MINE,
      succeed: draft(),
      open: async (qc) => {
        notFound();
        mount(qc);
        await screen.findByRole('button', { name: 'Bắt đầu mở gian hàng' });
        return () => fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu mở gian hàng' }));
      },
    },
    {
      name: 'lưu thông tin (InfoStep saveMut)',
      write: mocks.updateStorefront,
      keys: MINE,
      succeed: {},
      open: async (qc) => {
        mocks.getMyStorefront.mockResolvedValue(draft());
        mount(qc);
        await screen.findByLabelText('Tên gian hàng');
        return next;
      },
    },
    {
      name: 'áp mẫu theo danh mục (templateMut)',
      write: mocks.applyStorefrontTemplate,
      keys: MINE,
      succeed: { collectionId: 'c9', title: 'Mẫu', itemCount: 8 },
      open: async (qc) => {
        mocks.getMyStorefront.mockResolvedValue(draft());
        await toStep(qc, 3);
        fireEvent.click(screen.getByRole('button', { name: 'Chọn danh mục' }));
        await screen.findByRole('button', { name: 'Dùng mẫu Chăm sóc da' });
        // W114A: tấm chọn mẫu đóng ngay khi máy chủ từ chối (400/404/409); muốn bấm lại lúc khoá còn giữ thì phải mở lại tấm (đồng bộ, danh mục đã có trong cache) rồi chạm danh mục.
        return () => {
          if (!screen.queryByRole('button', { name: 'Dùng mẫu Chăm sóc da' })) fireEvent.click(screen.getByRole('button', { name: 'Chọn danh mục' }));
          fireEvent.click(screen.getByRole('button', { name: 'Dùng mẫu Chăm sóc da' }));
        };
      },
    },
    {
      name: 'tạo bộ sưu tập để mở bộ chọn (openPicker)',
      write: mocks.createCollection,
      keys: MINE,
      succeed: { id: 'c1', title: 'Sản phẩm mình chọn', items: [] },
      open: async (qc) => {
        mocks.getMyStorefront.mockResolvedValue(draft());
        await toStep(qc, 3);
        return () => fireEvent.click(screen.getByRole('button', { name: 'Thêm sản phẩm' }));
      },
    },
    {
      name: 'bỏ món (removeMut)',
      write: mocks.removeItem,
      keys: MINE,
      succeed: {},
      open: async (qc) => {
        mocks.getMyStorefront.mockResolvedValue(draft(withItem));
        await toStep(qc, 3);
        return () => fireEvent.click(screen.getByRole('button', { name: 'Bỏ Trà xanh' }));
      },
    },
    {
      name: 'thêm sản phẩm từ bộ chọn (PickerSheet addMut)',
      write: mocks.addItem,
      keys: MINE,
      succeed: {},
      open: async (qc) => {
        mocks.getMyStorefront.mockResolvedValue(draft(withItem));
        await toStep(qc, 3);
        fireEvent.click(screen.getByRole('button', { name: 'Thêm sản phẩm' }));
        await screen.findByText('Xà phòng');
        return () => fireEvent.click(screen.getByRole('button', { name: 'Thêm' }));
      },
    },
    {
      name: 'gửi duyệt (submitMut)',
      write: mocks.publishStorefront,
      keys: [['storefront-quests'], ['my-storefront']],
      succeed: {},
      open: async (qc) => {
        mocks.getMyStorefront.mockResolvedValue(draft(withItem));
        await toStep(qc, 4);
        return () => fireEvent.click(screen.getByRole('button', { name: 'Gửi duyệt' }));
      },
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    for (const fn of new Set(CASES.map((c) => c.write))) fn.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe.each(CASES)('$name', (c) => {
    it.each([
      [400, 'Việc này đã được xử lý rồi'],
      [404, 'Không tìm thấy nữa'],
      [409, 'Vừa có thay đổi, bạn thử lại nhé'],
    ])('bị từ chối %i: báo lỗi một lần, tải lại đúng khoá, giữ khoá tới khi dữ liệu về hết rồi mới nhả', async (status, message) => {
      const { qc, invalidate, refreshes, arm } = liveClient();
      const press = await c.open(qc);
      c.write.mockRejectedValueOnce(serverError(message, status)).mockResolvedValue(c.succeed);
      arm();
      press();
      press();
      await waitFor(() => expect(errorToasts()).toEqual([[{ text: message, type: 'error' }]]));
      expect(keysOf(invalidate)).toEqual(c.keys);
      expect(c.write).toHaveBeenCalledTimes(1);
      // Đã báo lỗi mà dữ liệu chưa về: chạm thêm không gửi lần hai.
      press();
      await settle();
      expect(c.write).toHaveBeenCalledTimes(1);
      // Mới về một phần (Promise.all còn chờ khoá cuối): vẫn giữ.
      await act(async () => refreshes.slice(0, -1).forEach((p) => p.resolve()));
      await settle();
      press();
      await settle();
      expect(c.write).toHaveBeenCalledTimes(1);
      await act(async () => refreshes.at(-1)!.resolve());
      await settle();
      expect(errorToasts()).toHaveLength(1);
      press();
      await waitFor(() => expect(c.write).toHaveBeenCalledTimes(2));
    });

    it.each(TEMPORARY)('%s: không nói gì về gian hàng thật nên không tải lại, khoá nhả ngay', async (_label, error) => {
      const { qc, invalidate, arm } = liveClient();
      const press = await c.open(qc);
      c.write.mockRejectedValueOnce(error).mockResolvedValue(c.succeed);
      arm();
      press();
      await waitFor(() => expect(errorToasts()).toHaveLength(1));
      await settle();
      expect(invalidate).not.toHaveBeenCalled();
      press();
      await waitFor(() => expect(c.write).toHaveBeenCalledTimes(2));
    });

    it('bị từ chối mà dữ liệu tải lại treo mãi: còn khoá ở 3,5 giây, nhả sau LOCK_REFRESH_WAIT_MS', async () => {
      const { qc, arm } = liveClient();
      const press = await c.open(qc);
      c.write.mockRejectedValueOnce(serverError('Không tìm thấy nữa', 404)).mockResolvedValue(c.succeed);
      arm({ hang: true });
      vi.useFakeTimers();
      press();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(errorToasts()).toHaveLength(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_500);
      });
      press();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(c.write).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 3_500 + 100);
        for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(0);
      });
      press();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(c.write).toHaveBeenCalledTimes(2);
      expect(errorToasts()).toHaveLength(1);
    });
  });
});

// W114A: tấm chọn mẫu theo danh mục không có ô nhập, chạm một danh mục là gửi: máy chủ từ chối hẳn (400/404/409/422) thì bấm lại nhận đúng lỗi đó nên tấm đóng, lời báo ở snackbar. Khoá chạm giữ như W112A: 400/404/409 chờ gian hàng tải lại, 422 và lỗi tạm nhả ngay. Mất mạng, quá hạn, 401, 5xx: tấm giữ mở để thử lại. Đích luôn là gian hàng của chính người dùng nên không có ca "tấm của đích khác".
describe('Luồng 4 bước: tấm chọn mẫu đóng khi máy chủ từ chối (W114A)', () => {
  type Pending = { promise: Promise<void>; resolve: () => void };
  const MINE = [['my-storefront']];
  const serverError = (message: string, status: number) => new HttpError(message, undefined, { status, data: { message }, headers: {} });
  const errorToasts = () => mocks.openSnackbar.mock.calls.filter(([o]) => (o as { type: string }).type === 'error');
  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  const pending = (): Pending => {
    let resolve!: () => void;
    const promise = new Promise<void>((res) => { resolve = res; });
    return { promise, resolve };
  };
  const PICK = 'Dùng mẫu Chăm sóc da';
  const isOpen = () => screen.queryByRole('button', { name: PICK }) !== null;
  const openSheet = () => fireEvent.click(screen.getByRole('button', { name: 'Chọn danh mục' }));
  const tap = () => {
    const pick = screen.queryByRole('button', { name: PICK });
    if (pick) fireEvent.click(pick);
  };
  const TEMPORARY: [string, unknown][] = [
    ['mất mạng', new HttpError('Network Error', 'ERR_NETWORK')],
    ['quá thời gian', new HttpError('timeout', 'ECONNABORTED')],
    ['máy chủ lỗi 503', serverError('Service Unavailable', 503)],
    ['hết phiên 401', serverError('Unauthorized', 401)],
  ];
  /** Chỉ sau `arm()` mỗi lần tải lại mới là một lời hứa riêng giữ trong tay (bước chuyển giữa các màn cần tải lại thật). */
  function liveClient() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const refreshes: Pending[] = [];
    const arm = () => {
      invalidate.mockClear();
      invalidate.mockImplementation((() => {
        const p = pending();
        refreshes.push(p);
        return p.promise;
      }) as never);
    };
    return { qc, invalidate, refreshes, arm };
  }
  const keysOf = (invalidate: ReturnType<typeof liveClient>['invalidate']) => invalidate.mock.calls.map(([f]) => (f as { queryKey: string[] }).queryKey);
  const open = async (qc: QueryClient) => {
    mocks.getMyStorefront.mockResolvedValue(draft());
    render(<QueryClientProvider client={qc}><StorefrontBuilderPage /></QueryClientProvider>);
    await screen.findByLabelText('Tên gian hàng');
    next();
    await screen.findByText('Bước 3/4');
    openSheet();
    await screen.findByRole('button', { name: PICK });
  };

  beforeEach(() => {
    mocks.applyStorefrontTemplate.mockReset();
  });

  it.each([
    [400, 'Gian hàng đã có bộ sưu tập'],
    [404, 'Không tìm thấy nữa'],
    [409, 'Vừa có thay đổi, bạn thử lại nhé'],
  ])('bị từ chối %i: đóng tấm, báo lỗi một lần, tải lại gian hàng, khoá giữ tới khi dữ liệu về rồi mới nhả', async (status, message) => {
    mocks.applyStorefrontTemplate.mockRejectedValueOnce(serverError(message, status)).mockResolvedValue({ collectionId: 'c9', title: 'Mẫu', itemCount: 8 });
    const { qc, invalidate, refreshes, arm } = liveClient();
    await open(qc);
    arm();
    tap();
    tap();
    await waitFor(() => expect(errorToasts()).toEqual([[{ text: message, type: 'error' }]]));
    await waitFor(() => expect(isOpen()).toBe(false));
    expect(keysOf(invalidate)).toEqual(MINE);
    expect(mocks.applyStorefrontTemplate).toHaveBeenCalledTimes(1);
    // Tấm đã đóng mà gian hàng chưa tải lại: mở lại chạm tiếp không gửi lần hai.
    openSheet();
    tap();
    await settle();
    expect(mocks.applyStorefrontTemplate).toHaveBeenCalledTimes(1);
    await act(async () => refreshes.forEach((p) => p.resolve()));
    await settle();
    expect(errorToasts()).toHaveLength(1);
    if (!isOpen()) openSheet();
    tap();
    await waitFor(() => expect(mocks.applyStorefrontTemplate).toHaveBeenCalledTimes(2));
  });

  it('bị từ chối 422: đóng tấm, không tải lại (không nói gì về gian hàng thật) nên khoá nhả ngay', async () => {
    mocks.applyStorefrontTemplate.mockRejectedValueOnce(serverError('Dữ liệu không hợp lệ', 422)).mockResolvedValue({ collectionId: 'c9', title: 'Mẫu', itemCount: 8 });
    const { qc, invalidate, arm } = liveClient();
    await open(qc);
    arm();
    tap();
    await waitFor(() => expect(errorToasts()).toHaveLength(1));
    await waitFor(() => expect(isOpen()).toBe(false));
    await settle();
    expect(invalidate).not.toHaveBeenCalled();
    openSheet();
    tap();
    await waitFor(() => expect(mocks.applyStorefrontTemplate).toHaveBeenCalledTimes(2));
    expect(errorToasts()).toHaveLength(1);
  });

  it.each(TEMPORARY)('%s: giữ tấm mở, không tải lại, khoá nhả ngay để thử lại', async (_label, error) => {
    mocks.applyStorefrontTemplate.mockRejectedValueOnce(error).mockResolvedValue({ collectionId: 'c9', title: 'Mẫu', itemCount: 8 });
    const { qc, invalidate, arm } = liveClient();
    await open(qc);
    arm();
    tap();
    await waitFor(() => expect(errorToasts()).toHaveLength(1));
    await settle();
    expect(isOpen()).toBe(true);
    expect(invalidate).not.toHaveBeenCalled();
    tap();
    await waitFor(() => expect(mocks.applyStorefrontTemplate).toHaveBeenCalledTimes(2));
    expect(errorToasts()).toHaveLength(1);
  });
});
