import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Lịch sử giả đủ dùng cho trang: đẩy/thay mục, lùi bằng số âm, báo cho `useLocation` vẽ lại; `window.history.state.idx` bắt chước react-router để nút lùi nổi đọc được. */
const router = vi.hoisted(() => {
  interface Loc { pathname: string; search: string; state: unknown }
  const first = (): Loc => ({ pathname: '/storefront', search: '', state: null });
  const r = {
    stack: [first()],
    idx: 0,
    listeners: new Set<() => void>(),
    get loc(): Loc { return r.stack[r.idx]!; },
    subscribe(l: () => void) { r.listeners.add(l); return () => { r.listeners.delete(l); }; },
    sync() { window.history.replaceState({ idx: r.idx }, ''); r.listeners.forEach((l) => l()); },
    reset() { r.stack = [first()]; r.idx = 0; r.sync(); },
    go(to: string | number, opts?: { replace?: boolean; state?: unknown }) {
      if (typeof to === 'number') {
        r.idx = Math.min(Math.max(r.idx + to, 0), r.stack.length - 1);
      } else {
        const u = new URL(to, 'http://x');
        const loc: Loc = { pathname: u.pathname, search: u.search, state: opts?.state ?? null };
        if (opts?.replace) r.stack[r.idx] = loc;
        else { r.stack = [...r.stack.slice(0, r.idx + 1), loc]; r.idx += 1; }
      }
      r.sync();
    },
  };
  return r;
});
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
  reorderCollections: vi.fn(),
  reorderItems: vi.fn(),
  pickerProducts: vi.fn(),
  getQuests: vi.fn(),
  claimQuest: vi.fn(),
  getStorefrontStats: vi.fn(),
  getStorefrontCategories: vi.fn(),
  applyStorefrontTemplate: vi.fn(),
  shareSheet: vi.fn(),
  announce: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => {
  const { useSyncExternalStore } = await import('react');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
    Sheet: ({ visible, children }: { visible: boolean; children: ReactNode }) =>
      visible ? <div data-testid="sheet">{children}</div> : null,
    useNavigate: () => mocks.navigate,
    useLocation: () => useSyncExternalStore(router.subscribe, () => router.loc),
    useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
  };
});
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
vi.mock('../hooks/use-notify', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  announce: mocks.announce,
}));

import BackButton from '../components/back-button';
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
const twoItems = () => [
  item({ id: 'i1', product: { ...product, id: 'p1', name: 'Món một' } }),
  item({ id: 'i2', productId: 'p2', product: { ...product, id: 'p2', name: 'Món hai' } }),
  item({ id: 'i3', productId: 'p3', product: { ...product, id: 'p3', name: 'Món ba' } }),
];
const twoCollections = (items = twoItems()) => storefront({
  collections: [
    { id: 'c1', title: 'Bộ một', kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, sortOrder: 0, items },
    { id: 'c2', title: 'Bộ hai', kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, sortOrder: 1, items: [] },
  ],
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

/** Bấm thẻ khối (mặc định thẻ đầu) rồi chờ trang chi tiết: món, bố cục và menu khối nằm ở đó, không ở màn chính. */
async function openCard(name?: RegExp) {
  const btn = name
    ? await screen.findByRole('button', { name })
    : (await screen.findAllByTestId('section-card'))[0]!.querySelector('button')!;
  fireEvent.click(btn);
  await screen.findByTestId('section-detail');
}
const liveStorefront = (over: Record<string, unknown> = {}) => storefront({ isPublished: true, status: 'LIVE', ...over });
async function openQuests() {
  fireEvent.click(await screen.findByRole('button', { name: /Hành trình gian hàng/ }));
  return screen.findByTestId('sheet');
}

beforeEach(() => {
  vi.clearAllMocks();
  router.reset();
  mocks.navigate.mockImplementation((to: string | number, opts?: { replace?: boolean; state?: unknown }) => router.go(to, opts));
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
    mocks.deleteCollection, mocks.addItem, mocks.updateItem, mocks.removeItem, mocks.claimQuest, mocks.reorderCollections, mocks.reorderItems,
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
    expect(await screen.findByText('Bộ sưu tập A')).toBeInTheDocument();
    await openCard();
    expect((await screen.findAllByText('Trà xanh')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('80.000đ').length).toBeGreaterThan(0);
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
    await openCard();
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
    await openCard();
    for (const name of ['SP chưa duyệt', 'SP tự ẩn']) {
      const el = await screen.findByText(name);
      expect(el.style.opacity).toBe('');
    }
    const badge = screen.getByText(/Khách không thấy/);
    expect(badge.style.whiteSpace).toBe('normal');
    expect(badge.style.maxWidth).toBe('100%');
  });

  it('ghim, ẩn, xoá sản phẩm gọi đúng API qua menu "⋯" (xoá phải qua bước xác nhận)', async () => {
    renderPage();
    await openCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Tuỳ chọn sản phẩm' }));
    fireEvent.click(within(await screen.findByTestId('sheet')).getByRole('button', { name: 'Ghim lên đầu' }));
    await waitFor(() => expect(mocks.updateItem).toHaveBeenCalledWith('i1', { isPinned: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Tuỳ chọn sản phẩm' }));
    fireEvent.click(within(await screen.findByTestId('sheet')).getByRole('button', { name: 'Ẩn sản phẩm' }));
    await waitFor(() => expect(mocks.updateItem).toHaveBeenCalledWith('i1', { isHidden: true }));

    fireEvent.click(screen.getByRole('button', { name: 'Tuỳ chọn sản phẩm' }));
    fireEvent.click(within(await screen.findByTestId('sheet')).getByRole('button', { name: 'Xoá khỏi khối' }));
    expect(mocks.removeItem).not.toHaveBeenCalled();
    const sheet = await screen.findByTestId('sheet');
    expect(within(sheet).getByText('Xoá sản phẩm này khỏi gian hàng?')).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Xoá' }));
    await waitFor(() => expect(mocks.removeItem).toHaveBeenCalledTimes(1));
    expect(mocks.removeItem.mock.calls[0]![0]).toBe('i1');
  });

  it('menu "⋯" của sản phẩm có đúng ba mục có chữ, mục xoá đứng cuối; ghim/ẩn/xoá không còn là nút riêng ngoài hàng', async () => {
    renderPage();
    await openCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Tuỳ chọn sản phẩm' }));
    const sheet = await screen.findByTestId('sheet');
    expect(within(sheet).getAllByRole('button').map((b) => b.textContent).filter(Boolean)).toEqual(['Ghim lên đầu', 'Ẩn sản phẩm', 'Xoá khỏi khối']);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Ghim lên đầu' }));
    expect(screen.queryByRole('button', { name: 'Ghim lên đầu' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ẩn sản phẩm' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Xoá khỏi khối' })).toBeNull();
  });

  it('món đã ghim có nhãn "Đã ghim" ngay trên hàng (ghim nằm trong menu "⋯" nên không còn dấu nào khác); món thường không có', async () => {
    mocks.getMyStorefront.mockResolvedValue(twoCollections([
      item({ id: 'i1', isPinned: true, product: { ...product, id: 'p1', name: 'Món một' } }),
      item({ id: 'i2', productId: 'p2', product: { ...product, id: 'p2', name: 'Món hai' } }),
    ]));
    renderPage();
    await openCard();
    const [first, second] = await screen.findAllByTestId('item-row');
    expect(within(first!).getByText('Đã ghim')).toBeInTheDocument();
    expect(within(second!).queryByText('Đã ghim')).not.toBeInTheDocument();
  });

  it('sản phẩm đã ghim/đã ẩn đổi nhãn mục menu để hoàn tác', async () => {
    mocks.getMyStorefront.mockResolvedValue(
      storefront({ collections: [{ id: 'c1', title: 'A', kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, sortOrder: 0, items: [item({ isPinned: true, isHidden: true })] }] }),
    );
    renderPage();
    await openCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Tuỳ chọn sản phẩm' }));
    fireEvent.click(within(await screen.findByTestId('sheet')).getByRole('button', { name: 'Bỏ ghim' }));
    await waitFor(() => expect(mocks.updateItem).toHaveBeenCalledWith('i1', { isPinned: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Tuỳ chọn sản phẩm' }));
    fireEvent.click(within(await screen.findByTestId('sheet')).getByRole('button', { name: 'Hiện sản phẩm' }));
    await waitFor(() => expect(mocks.updateItem).toHaveBeenCalledWith('i1', { isHidden: false }));
  });

  it('nút biểu tượng (menu ⋯ của sản phẩm và của khối, mũi tên ↑↓ khi Sắp xếp) cao và rộng >= 44px', async () => {
    mocks.getMyStorefront.mockResolvedValue(twoCollections());
    renderPage();
    await openCard(/^Bộ một,/);
    const size = (btn: HTMLElement) => (btn.className.includes('touch-target')
      ? { w: 44, h: 44 }
      : { w: parseFloat(btn.style.minWidth), h: parseFloat(btn.style.minHeight) });
    for (const name of ['Tuỳ chọn sản phẩm', 'Tuỳ chọn khối']) {
      const box = size(screen.getAllByRole('button', { name })[0]!);
      expect(box.w, `${name} rộng`).toBeGreaterThanOrEqual(44);
      expect(box.h, `${name} cao`).toBeGreaterThanOrEqual(44);
    }
    fireEvent.click(screen.getByRole('button', { name: 'Sắp xếp' }));
    const arrows = screen.getAllByRole('button', { name: /^Đưa Món / });
    expect(arrows).toHaveLength(6);
    for (const btn of arrows) {
      expect(parseFloat(btn.style.minWidth), btn.getAttribute('aria-label')!).toBeGreaterThanOrEqual(44);
      expect(parseFloat(btn.style.minHeight), btn.getAttribute('aria-label')!).toBeGreaterThanOrEqual(44);
    }
  });

  it('"Bài đăng mẫu" mở bộ nội dung bán hàng của đúng sản phẩm (không còn nút tên "Nội dung")', async () => {
    renderPage();
    await openCard();
    expect(screen.queryByText('Nội dung')).toBeNull();
    fireEvent.click(await screen.findByText('Bài đăng mẫu'));
    expect(await screen.findByTestId('content-kit')).toHaveTextContent('tra-xanh');
  });

  it('lý do giới thiệu: mở sheet, nhập, Lưu gửi ghi chú đã cắt khoảng trắng', async () => {
    renderPage();
    await openCard();
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
    await openCard();
    expect(await screen.findByText('“Dùng rất ổn”')).toBeInTheDocument();
    expect(screen.queryByText('Thêm lý do giới thiệu')).not.toBeInTheDocument();
  });

  it('đổi tên khối: sheet có tiêu đề, Lưu gửi tên mới', async () => {
    renderPage();
    await openCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Tuỳ chọn khối' }));
    fireEvent.click(within(await screen.findByTestId('sheet')).getByRole('button', { name: 'Đổi tên khối' }));
    const sheet = await screen.findByTestId('sheet');
    const input = within(sheet).getByDisplayValue('Bộ sưu tập A');
    fireEvent.change(input, { target: { value: ' Bộ B ' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(mocks.updateCollection).toHaveBeenCalledWith('c1', { title: 'Bộ B' }));
  });

  it('xoá khối phải xác nhận; Huỷ thì không gọi API', async () => {
    renderPage();
    await openCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Tuỳ chọn khối' }));
    fireEvent.click(within(await screen.findByTestId('sheet')).getByRole('button', { name: 'Xoá khối' }));
    const sheet = await screen.findByTestId('sheet');
    expect(within(sheet).getByText('Xoá khối này?')).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Huỷ' }));
    expect(mocks.deleteCollection).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Tuỳ chọn khối' }));
    fireEvent.click(within(await screen.findByTestId('sheet')).getByRole('button', { name: 'Xoá khối' }));
    const sheet2 = await screen.findByTestId('sheet');
    fireEvent.click(within(sheet2).getByRole('button', { name: 'Xoá khối' }));
    await waitFor(() => expect(mocks.deleteCollection).toHaveBeenCalledWith('c1'));
  });

  it('thêm sản phẩm: chọn từ danh sách gợi ý gọi addItem vào đúng bộ sưu tập', async () => {
    renderPage();
    await openCard();
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
    await openCard();
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
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã gửi duyệt. Tubu sẽ thông báo khi xong.', type: 'success' }));
  });

  it('gian hàng đã duyệt từ trước (vừa gỡ đăng): nút "Đăng lại", không hứa duyệt', async () => {
    mocks.getMyStorefront.mockResolvedValue(storefront({ status: 'DRAFT', approved: true, needsApproval: false }));
    renderPage();
    expect(screen.queryByRole('button', { name: 'Gửi duyệt' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Đăng lại' }));
    await waitFor(() => expect(mocks.publishStorefront).toHaveBeenCalledWith(true));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã đăng lại gian hàng. Khách xem được ngay.', type: 'success' }));
  });

  it('cờ duyệt tắt, chưa từng duyệt: nút "Đăng gian hàng", không nhắc gửi duyệt', async () => {
    mocks.getMyStorefront.mockResolvedValue(storefront({ status: 'DRAFT', approved: false, needsApproval: false }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Đăng gian hàng' }));
    await waitFor(() => expect(mocks.publishStorefront).toHaveBeenCalledWith(true));
    expect(screen.queryByRole('button', { name: 'Gửi duyệt' })).toBeNull();
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
    // Gỡ đăng nằm trong Cài đặt, không còn là nút nổi ngoài trang chính.
    await screen.findByRole('button', { name: 'Cài đặt' });
    expect(screen.queryByRole('button', { name: /Gỡ đăng/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cài đặt' }));
    fireEvent.click(within(await screen.findByTestId('sheet')).getByRole('button', { name: 'Gỡ đăng gian hàng' }));
    const sheet = await screen.findByTestId('sheet');
    expect(within(sheet).getByText('Gỡ đăng gian hàng này?')).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Huỷ' }));
    expect(mocks.publishStorefront).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cài đặt' }));
    fireEvent.click(within(await screen.findByTestId('sheet')).getByRole('button', { name: 'Gỡ đăng gian hàng' }));
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

  it('chờ duyệt: trong Cài đặt có nút rút lại gửi duyệt thay cho "Gỡ đăng gian hàng"', async () => {
    mocks.getMyStorefront.mockResolvedValue(pending());
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Cài đặt' }));
    const sheet = await screen.findByTestId('sheet');
    expect(within(sheet).getByRole('button', { name: 'Huỷ gửi duyệt' })).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'Gỡ đăng gian hàng' })).toBeNull();
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

describe('Sắp xếp sản phẩm và bộ sưu tập (nút lên/xuống)', () => {
  const names = () => screen.getAllByTestId('item-name').map((e) => e.textContent);
  const up = (n: string) => screen.getByRole('button', { name: `Đưa ${n} lên` });
  const down = (n: string) => screen.getByRole('button', { name: `Đưa ${n} xuống` });
  const enter = async () => {
    renderPage();
    await openCard(/^Bộ một,/);
    fireEvent.click(screen.getByRole('button', { name: 'Sắp xếp' }));
  };

  it('bấm "Đưa Món hai lên" gửi đúng thứ tự mới, danh sách đổi ngay (trước khi máy chủ trả lời)', async () => {
    mocks.getMyStorefront.mockResolvedValue(twoCollections());
    mocks.reorderItems.mockReturnValue(new Promise(() => {}));
    await enter();
    expect(names()).toEqual(['Món một', 'Món hai', 'Món ba']);
    fireEvent.click(up('Món hai'));
    await waitFor(() => expect(mocks.reorderItems).toHaveBeenCalledWith('c1', ['i2', 'i1', 'i3']));
    expect(names()).toEqual(['Món hai', 'Món một', 'Món ba']);
  });

  it('bấm "Đưa xuống" gửi thứ tự mới; ↑ của món đầu và ↓ của món cuối là nút khoá (aria-disabled)', async () => {
    mocks.getMyStorefront.mockResolvedValue(twoCollections());
    await enter();
    expect(up('Món một')).toHaveAttribute('aria-disabled', 'true');
    expect(down('Món ba')).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(down('Món một'));
    await waitFor(() => expect(mocks.reorderItems).toHaveBeenCalledWith('c1', ['i2', 'i1', 'i3']));
  });

  it('bấm liên tiếp hai lần: yêu cầu thứ hai chỉ gửi khi yêu cầu thứ nhất xong, đã gồm bước đầu, và chỉ tải lại gian hàng một lần ở cuối', async () => {
    mocks.getMyStorefront.mockResolvedValue(twoCollections());
    let finishFirst!: () => void;
    mocks.reorderItems.mockReturnValueOnce(new Promise((resolve) => { finishFirst = () => resolve({}); }));
    await enter();
    fireEvent.click(up('Món hai'));
    await waitFor(() => expect(mocks.reorderItems).toHaveBeenCalledTimes(1));
    expect(names()).toEqual(['Món hai', 'Món một', 'Món ba']);
    fireEvent.click(up('Món ba'));
    await waitFor(() => expect(names()).toEqual(['Món hai', 'Món ba', 'Món một']));
    expect(mocks.reorderItems).toHaveBeenCalledTimes(1);
    const [one, two, three] = twoItems();
    mocks.getMyStorefront.mockResolvedValue(twoCollections([two!, three!, one!]));
    finishFirst();
    await waitFor(() => expect(mocks.reorderItems).toHaveBeenCalledTimes(2));
    expect(mocks.reorderItems.mock.calls.map((c) => c[1])).toEqual([['i2', 'i1', 'i3'], ['i2', 'i3', 'i1']]);
    await waitFor(() => expect(mocks.getMyStorefront).toHaveBeenCalledTimes(2));
    expect(names()).toEqual(['Món hai', 'Món ba', 'Món một']);
  });

  it('máy chủ từ chối: danh sách về thứ tự cũ, có báo lỗi, rồi tải lại để khớp máy chủ', async () => {
    mocks.getMyStorefront.mockResolvedValue(twoCollections());
    mocks.reorderItems.mockRejectedValue(new Error('Mạng yếu'));
    await enter();
    fireEvent.click(up('Món hai'));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: expect.any(String), type: 'error' }));
    expect(names()).toEqual(['Món một', 'Món hai', 'Món ba']);
    await waitFor(() => expect(mocks.getMyStorefront).toHaveBeenCalledTimes(2));
  });

  it('bấm hai lần liên tiếp và cả hai đều lỗi: cuối cùng tải lại gian hàng, màn khớp thứ tự trên máy chủ', async () => {
    mocks.getMyStorefront.mockResolvedValue(twoCollections());
    let failFirst!: (e: Error) => void;
    mocks.reorderItems
      .mockReturnValueOnce(new Promise((_, reject) => { failFirst = reject; }))
      .mockRejectedValueOnce(new Error('Mạng yếu'));
    await enter();
    fireEvent.click(up('Món hai'));
    await waitFor(() => expect(mocks.reorderItems).toHaveBeenCalledTimes(1));
    fireEvent.click(up('Món ba'));
    await waitFor(() => expect(names()).toEqual(['Món hai', 'Món ba', 'Món một']));
    failFirst(new Error('Mạng yếu'));
    await waitFor(() => expect(mocks.reorderItems).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.getMyStorefront).toHaveBeenCalledTimes(2));
    expect(names()).toEqual(['Món một', 'Món hai', 'Món ba']);
  });

  it('món ghim luôn nằm trên: món thường đầu tiên không đưa lên được qua món ghim', async () => {
    mocks.getMyStorefront.mockResolvedValue(twoCollections([
      item({ id: 'i1', isPinned: true, product: { ...product, id: 'p1', name: 'Món một' } }),
      item({ id: 'i2', productId: 'p2', product: { ...product, id: 'p2', name: 'Món hai' } }),
    ]));
    await enter();
    // Món hai không đưa lên qua món ghim, món ghim không đưa xuống qua món thường.
    expect(up('Món hai')).toHaveAttribute('aria-disabled', 'true');
    expect(down('Món một')).toHaveAttribute('aria-disabled', 'true');
  });

  it('khối cũng sắp xếp được: Sắp xếp ở màn chính, "Đưa khối Bộ một xuống" gửi thứ tự khối mới', async () => {
    mocks.getMyStorefront.mockResolvedValue(twoCollections());
    mocks.reorderCollections.mockReturnValue(new Promise(() => {}));
    renderPage();
    await screen.findByText('Bộ một');
    fireEvent.click(screen.getByRole('button', { name: 'Sắp xếp' }));
    fireEvent.click(screen.getByRole('button', { name: 'Đưa khối Bộ một xuống' }));
    await waitFor(() => expect(mocks.reorderCollections).toHaveBeenCalledWith(['c2', 'c1']));
  });
});

describe('Thống kê và Hành trình gian hàng', () => {
  const byProduct = async () => fireEvent.click(await screen.findByRole('button', { name: 'Theo sản phẩm' }));

  it('dải Hành trình và thống kê (LIVE) đứng trên danh sách khối, thống kê trên cả dải', async () => {
    mocks.getMyStorefront.mockResolvedValue(liveStorefront());
    renderPage();
    const stat = await screen.findByText('Thống kê 30 ngày');
    const strip = await screen.findByRole('button', { name: /Hành trình gian hàng/ });
    const card = screen.getAllByTestId('section-card')[0]!;
    expect(stat.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(strip.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('thống kê 30 ngày hiện đơn, doanh thu, hoa hồng; top sản phẩm gập sau nút "Theo sản phẩm"', async () => {
    mocks.getMyStorefront.mockResolvedValue(liveStorefront());
    renderPage();
    expect(await screen.findByText('Thống kê 30 ngày')).toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument();
    expect(screen.getByText('Đơn 30 ngày')).toBeInTheDocument();
    expect(screen.queryByText(/7 ngày/)).not.toBeInTheDocument();
    expect(screen.getByText('1.250.000đ')).toBeInTheDocument();
    expect(screen.getByText('125.000đ')).toBeInTheDocument();
    expect(screen.queryByText('4 món · 320.000đ')).not.toBeInTheDocument();
    await byProduct();
    expect(screen.getByRole('button', { name: 'Theo sản phẩm' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('4 món · 320.000đ')).toBeInTheDocument();
  });

  it('các dòng cộng đúng ô Doanh thu: sản phẩm ngoài top 5 gộp một dòng, phần ship/giảm giá cấp đơn một dòng, ẩn dòng 0 món', async () => {
    const p = (i: number, revenue: number, qty = 1) => ({ productSlug: `p${i}`, productName: `SP ${i}`, qty, revenue });
    mocks.getMyStorefront.mockResolvedValue(liveStorefront());
    mocks.getStorefrontStats.mockResolvedValue({
      ...stats,
      revenue30d: 1_000_000,
      byProduct: [p(1, 300_000), p(2, 200_000), p(3, 150_000), p(4, 100_000), p(5, 80_000), p(6, 70_000, 2), p(7, 50_000), p(8, 0, 0)],
      shippingAndOrderDiscount30d: 50_000,
    });
    renderPage();
    await byProduct();
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
    mocks.getMyStorefront.mockResolvedValue(liveStorefront());
    renderPage();
    await byProduct();
    expect(await screen.findByText('4 món · 320.000đ')).toBeInTheDocument();
    expect(screen.queryByText('Phí ship, giảm giá, chênh lệch hoàn tiền')).not.toBeInTheDocument();
  });

  it('chưa có đơn: hiện lời nhắn chia sẻ link, không có nút "Theo sản phẩm"', async () => {
    mocks.getMyStorefront.mockResolvedValue(liveStorefront());
    mocks.getStorefrontStats.mockResolvedValue({ ...stats, byProduct: [] });
    renderPage();
    expect(await screen.findByText(/Chưa có đơn nào qua gian hàng/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Theo sản phẩm' })).not.toBeInTheDocument();
  });

  it('nhiệm vụ: cấp độ, tổng điểm, tiến độ; nhiệm vụ đã nhận không còn ký tự ✓', async () => {
    renderPage();
    const sheet = await openQuests();
    expect(within(sheet).getByText('Hành trình gian hàng')).toBeInTheDocument();
    expect(within(sheet).getByText('1/5')).toBeInTheDocument();
    expect(within(sheet).getByText('Đã nhận 4 điểm')).toBeInTheDocument();
    expect(within(sheet).getByText('0/1')).toBeInTheDocument();
    expect(within(sheet).getByText('Viết hồ sơ')).toBeInTheDocument();
    expect(within(sheet).getByText('Đã nhận')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/[✓✔]/);
  });

  it('nút nhận thưởng nói rõ việc bấm là nhận điểm: "Nhận 1.000 điểm", không còn "+1.000 điểm"', async () => {
    mocks.getQuests.mockResolvedValue({ ...quests, quests: [{ ...quests.quests[0]!, rewardPoints: 1000 }] });
    renderPage();
    await openQuests();
    expect(await screen.findByRole('button', { name: 'Nhận 1.000 điểm' })).toBeInTheDocument();
    expect(screen.queryByText('+1.000 điểm')).toBeNull();
  });

  it('nhiệm vụ đã đạt: nút nhận thưởng gọi claimQuest và báo số Điểm Xanh', async () => {
    renderPage();
    await openQuests();
    fireEvent.click(await screen.findByRole('button', { name: 'Nhận 2 điểm' }));
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
    await openQuests();
    const first = await screen.findByRole('button', { name: 'Nhận 2 điểm' });
    const second = screen.getByRole('button', { name: 'Nhận 5 điểm' });
    fireEvent.click(first);
    await waitFor(() => expect(first).toHaveAttribute('aria-busy', 'true'));
    expect(second).toBeDisabled();
    fireEvent.click(first);
    expect(mocks.claimQuest).toHaveBeenCalledTimes(1);
  });

  it('nhiệm vụ chưa đạt không có nút nhận', async () => {
    renderPage();
    await openQuests();
    expect(screen.getAllByRole('button', { name: /điểm$/ })).toHaveLength(1);
  });
});

describe('Màn dựng theo khối (P10)', () => {
  const mkItem = (key: string, name: string, over: Record<string, unknown> = {}) =>
    item({ id: `i-${key}`, productId: `p-${key}`, product: { ...product, id: `p-${key}`, name }, ...over });
  const mkItems = (prefix: string, n: number) => Array.from({ length: n }, (_, k) => mkItem(`${prefix}${k + 1}`, `Món ${prefix}${k + 1}`));
  const section = (id: string, title: string, items: unknown[], over: Record<string, unknown> = {}) => ({
    id, title, kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, sortOrder: 0, items, ...over,
  });
  const three = () => storefront({
    collections: [
      section('c1', 'Bộ một', mkItems('a', 3)),
      section('c2', 'Bộ hai', mkItems('b', 2), { layout: 'CAROUSEL' }),
      section('c3', 'Bộ ba', mkItems('c', 3), { kind: 'COMBO', layout: 'CAROUSEL', comboDiscountPct: 10 }),
    ],
  });
  const card = (name: RegExp) => screen.getByRole('button', { name });
  const openSection = (name: RegExp) => openCard(name);

  describe('màn chính', () => {
    it('mỗi khối là một thẻ có kiểu và số món; không còn nút đưa lên/xuống hay ô tên ở cuối trang', async () => {
      mocks.getMyStorefront.mockResolvedValue(three());
      renderPage();
      await screen.findByText('Bộ một');
      expect(screen.getAllByTestId('section-card')).toHaveLength(3);
      expect(screen.getByText('Lưới · 3 món')).toBeInTheDocument();
      expect(screen.getByText('Kệ ngang · 2 món')).toBeInTheDocument();
      expect(screen.getByText('Combo -10% · 3 món')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Đưa / })).not.toBeInTheDocument();
      expect(screen.queryByPlaceholderText('Tên bộ sưu tập')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Thêm khối' })).toBeInTheDocument();
    });

    it('bảy khối khách thấy: nhắc tab Shop chỉ hiện sáu khối đầu, khối thứ bảy ghi "Chỉ hiện ở tab Danh mục"', async () => {
      mocks.getMyStorefront.mockResolvedValue(storefront({
        collections: Array.from({ length: 7 }, (_, k) => section(`s${k + 1}`, `Khối ${k + 1}`, mkItems(`s${k + 1}-`, 3))),
      }));
      renderPage();
      expect(await screen.findByText('Tab Shop hiện 6 khối đầu; từ khối thứ 7 trở đi chỉ hiện ở tab Danh mục.')).toBeInTheDocument();
      expect(card(/^Khối 7,/)).toHaveAccessibleName(/Chỉ hiện ở tab Danh mục/);
      expect(card(/^Khối 1,/)).not.toHaveAccessibleName(/Chỉ hiện ở tab Danh mục/);
    });

    it('khối chưa có món khách thấy được hiện cảnh báo ngay trên thẻ', async () => {
      mocks.getMyStorefront.mockResolvedValue(storefront({
        collections: [section('c1', 'Bộ trống', []), section('c2', 'Bộ ẩn hết', [mkItem('h1', 'Món ẩn', { isHidden: true })])],
      }));
      renderPage();
      await screen.findByText('Bộ trống');
      expect(screen.getAllByText('Chưa có món nào khách thấy được.')).toHaveLength(2);
    });

    it('chưa có khối nào: lời mời thêm khối đầu tiên', async () => {
      mocks.getMyStorefront.mockResolvedValue(storefront({ collections: [] }));
      renderPage();
      expect(await screen.findByText('Chưa có khối nào. Thêm khối đầu tiên để khách có gì xem.')).toBeInTheDocument();
    });
  });

  describe('thêm khối', () => {
    const openSheet = async () => {
      mocks.getMyStorefront.mockResolvedValue(three());
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Thêm khối' }));
      return screen.findByRole('radiogroup', { name: 'Kiểu hiển thị' });
    };
    const nameInput = () => screen.getByRole('textbox', { name: 'Tên khối' }) as HTMLInputElement;
    const createBtn = () => screen.getByRole('button', { name: 'Tạo và thêm món' });
    const created = (over: Record<string, unknown> = {}) => section('c9', 'Mới', [], over);

    it('khối Combo gửi kind, layout và comboDiscountPct', async () => {
      mocks.createCollection.mockResolvedValue(created({ kind: 'COMBO', layout: 'CAROUSEL', comboDiscountPct: 15 }));
      const group = await openSheet();
      fireEvent.click(within(group).getByRole('radio', { name: /Combo/ }));
      fireEvent.change(nameInput(), { target: { value: '  Combo hè  ' } });
      fireEvent.change(screen.getByRole('textbox', { name: 'Giảm khi mua cả bộ' }), { target: { value: '15' } });
      fireEvent.click(createBtn());
      await waitFor(() => expect(mocks.createCollection).toHaveBeenCalledWith({ title: 'Combo hè', kind: 'COMBO', layout: 'CAROUSEL', comboDiscountPct: 15 }));
    });

    it('khối Lưới gửi kind NORMAL và layout GRID, không có comboDiscountPct', async () => {
      mocks.createCollection.mockResolvedValue(created());
      const group = await openSheet();
      fireEvent.click(within(group).getByRole('radio', { name: /Lưới/ }));
      fireEvent.change(nameInput(), { target: { value: 'Bán chạy' } });
      fireEvent.click(createBtn());
      await waitFor(() => expect(mocks.createCollection).toHaveBeenCalledWith({ title: 'Bán chạy', kind: 'NORMAL', layout: 'GRID' }));
      expect(mocks.createCollection.mock.calls[0]![0]).not.toHaveProperty('comboDiscountPct');
    });

    it('tên điền sẵn theo kiểu; gõ tên rồi đổi kiểu thì giữ tên đã gõ; xoá trống thì nút tắt', async () => {
      const group = await openSheet();
      expect(nameInput().value).toBe('Gợi ý của mình');
      fireEvent.click(within(group).getByRole('radio', { name: /Danh sách/ }));
      expect(nameInput().value).toBe('Ba món mình chọn');
      fireEvent.change(nameInput(), { target: { value: 'Của riêng tôi' } });
      fireEvent.click(within(group).getByRole('radio', { name: /Kệ ngang/ }));
      expect(nameInput().value).toBe('Của riêng tôi');
      fireEvent.change(nameInput(), { target: { value: '   ' } });
      expect(createBtn()).toBeDisabled();
      expect(mocks.createCollection).not.toHaveBeenCalled();
    });

    it('chọn Combo mới hiện ô %; % không hợp lệ ("abc", "0", trống) thì nút tạo tắt', async () => {
      const group = await openSheet();
      expect(screen.queryByRole('textbox', { name: 'Giảm khi mua cả bộ' })).not.toBeInTheDocument();
      fireEvent.click(within(group).getByRole('radio', { name: /Combo/ }));
      const pct = screen.getByRole('textbox', { name: 'Giảm khi mua cả bộ' }) as HTMLInputElement;
      expect(pct.value).toBe('10');
      for (const bad of ['abc', '0', '']) {
        fireEvent.change(pct, { target: { value: bad } });
        expect(createBtn()).toBeDisabled();
      }
      fireEvent.change(pct, { target: { value: '99' } });
      fireEvent.click(createBtn());
      await waitFor(() => expect(mocks.createCollection).toHaveBeenCalledWith(expect.objectContaining({ kind: 'COMBO', comboDiscountPct: 99 })));
    });

    it('tạo Combo mà máy chủ hạ % xuống (trần 20): báo "Mức giảm tối đa hiện là 20%."; không hạ thì không báo', async () => {
      mocks.createCollection.mockResolvedValue(created({ kind: 'COMBO', layout: 'CAROUSEL', comboDiscountPct: 20 }));
      const group = await openSheet();
      fireEvent.click(within(group).getByRole('radio', { name: /Combo/ }));
      fireEvent.change(screen.getByRole('textbox', { name: 'Giảm khi mua cả bộ' }), { target: { value: '50' } });
      fireEvent.click(createBtn());
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Mức giảm tối đa hiện là 20%.', type: 'warning' }));
      expect(mocks.createCollection).toHaveBeenCalledWith(expect.objectContaining({ comboDiscountPct: 50 }));
    });

    it('tạo Combo mà máy chủ giữ nguyên % đã gửi: không có cảnh báo', async () => {
      const made = created({ kind: 'COMBO', layout: 'CAROUSEL', comboDiscountPct: 15 });
      mocks.createCollection.mockResolvedValue(made);
      const group = await openSheet();
      mocks.getMyStorefront.mockResolvedValue(storefront({ collections: [...three().collections, made] }));
      fireEvent.click(within(group).getByRole('radio', { name: /Combo/ }));
      fireEvent.change(screen.getByRole('textbox', { name: 'Giảm khi mua cả bộ' }), { target: { value: '15' } });
      fireEvent.click(createBtn());
      await waitFor(() => expect(mocks.createCollection).toHaveBeenCalled());
      await screen.findByTestId('section-detail');
      expect(mocks.openSnackbar).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'warning' }));
    });

    it('máy chủ từ chối: tên còn nguyên, báo lỗi, sheet không đóng', async () => {
      mocks.createCollection.mockRejectedValue({ response: { data: { message: 'Tên khối trùng' } }, message: 'x' });
      await openSheet();
      fireEvent.change(nameInput(), { target: { value: 'Bán chạy' } });
      fireEvent.click(createBtn());
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
      expect(nameInput().value).toBe('Bán chạy');
      expect(createBtn()).not.toBeDisabled();
    });

    it('tạo xong: mở trang chi tiết của khối mới và bảng chọn sản phẩm của nó', async () => {
      mocks.createCollection.mockResolvedValue(created());
      await openSheet();
      // Sau khi tạo, máy chủ trả thêm khối mới ở lần tải lại.
      mocks.getMyStorefront.mockResolvedValue(storefront({ collections: [...three().collections, created()] }));
      fireEvent.change(nameInput(), { target: { value: 'Mới' } });
      fireEvent.click(createBtn());
      expect(await screen.findByRole('heading', { level: 1, name: 'Mới' })).toBeInTheDocument();
      expect(await screen.findByText('Xà phòng')).toBeInTheDocument();
    });
  });

  describe('trang chi tiết khối', () => {
    it('bấm thẻ mở trang chi tiết, focus vào h1 là tên khối; nút quay lại trả focus về đúng thẻ', async () => {
      mocks.getMyStorefront.mockResolvedValue(three());
      renderPage();
      await openSection(/^Bộ hai,/);
      const h1 = screen.getByRole('heading', { level: 1, name: 'Bộ hai' });
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(h1).toHaveFocus();
      fireEvent.click(screen.getByRole('button', { name: 'Gian hàng của tôi' }));
      expect(await screen.findAllByTestId('section-card')).toHaveLength(3);
      expect(card(/^Bộ hai,/)).toHaveFocus();
    });

    describe('lùi từ trang chi tiết (nút lùi nổi và nút lùi của máy)', () => {
      const renderWithBack = () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
        return render(<QueryClientProvider client={qc}><BackButton /><StorefrontBuilderPage /></QueryClientProvider>);
      };
      const here = () => `${router.loc.pathname}${router.loc.search}`;

      it('mở khối là thêm một mục lịch sử của /storefront (?khoi=); nút "Quay lại" nổi trả về danh sách khối, không rời màn dựng', async () => {
        mocks.getMyStorefront.mockResolvedValue(three());
        renderWithBack();
        await openSection(/^Bộ hai,/);
        expect(here()).toBe('/storefront?khoi=c2');
        expect(router.stack).toHaveLength(2);
        fireEvent.click(screen.getByRole('button', { name: 'Quay lại' }));
        expect(await screen.findAllByTestId('section-card')).toHaveLength(3);
        expect(screen.queryByTestId('section-detail')).not.toBeInTheDocument();
        expect(here()).toBe('/storefront');
        expect(card(/^Bộ hai,/)).toHaveFocus();
      });

      it('nút lùi của máy (popstate) cũng về danh sách khối', async () => {
        mocks.getMyStorefront.mockResolvedValue(three());
        renderPage();
        await openSection(/^Bộ một,/);
        act(() => router.go(-1));
        expect(await screen.findAllByTestId('section-card')).toHaveLength(3);
        expect(here()).toBe('/storefront');
      });

      it('lùi rồi tiến lại thì trang chi tiết mở lại đúng khối đó', async () => {
        mocks.getMyStorefront.mockResolvedValue(three());
        renderPage();
        await openSection(/^Bộ hai,/);
        act(() => router.go(-1));
        await screen.findAllByTestId('section-card');
        act(() => router.go(1));
        expect(await screen.findByRole('heading', { level: 1, name: 'Bộ hai' })).toBeInTheDocument();
      });

      it('"Gian hàng của tôi" trong trang lùi đúng một mục lịch sử (cùng chỗ với nút lùi nổi)', async () => {
        mocks.getMyStorefront.mockResolvedValue(three());
        renderPage();
        await openSection(/^Bộ một,/);
        fireEvent.click(screen.getByRole('button', { name: 'Gian hàng của tôi' }));
        expect(await screen.findAllByTestId('section-card')).toHaveLength(3);
        expect(router.idx).toBe(0);
      });

      it('mở thẳng bằng link có ?khoi= (không có danh sách phía trước): vào trang chi tiết, "Gian hàng của tôi" thay mục hiện tại thay vì lùi ra ngoài', async () => {
        mocks.getMyStorefront.mockResolvedValue(three());
        router.go('/storefront?khoi=c2', { replace: true });
        renderPage();
        expect(await screen.findByRole('heading', { level: 1, name: 'Bộ hai' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Gian hàng của tôi' }));
        expect(await screen.findAllByTestId('section-card')).toHaveLength(3);
        expect(router.stack).toHaveLength(1);
        expect(here()).toBe('/storefront');
      });

      it('khối đang mở bị xoá: về danh sách khối, không kẹt ở trang chi tiết trống', async () => {
        mocks.getMyStorefront.mockResolvedValue(three());
        renderPage();
        await openSection(/^Bộ một,/);
        fireEvent.click(screen.getByRole('button', { name: 'Tuỳ chọn khối' }));
        fireEvent.click(within(await screen.findByTestId('sheet')).getByRole('button', { name: 'Xoá khối' }));
        fireEvent.click(within(await screen.findByTestId('sheet')).getByRole('button', { name: 'Xoá khối' }));
        await waitFor(() => expect(mocks.deleteCollection).toHaveBeenCalledWith('c1'));
        expect(await screen.findAllByTestId('section-card')).toHaveLength(3);
        expect(here()).toBe('/storefront');
      });

      it('?khoi= cũ (khối đã xoá) rồi mở khối khác: "Gian hàng của tôi" về danh sách, không kẹt và không rời màn dựng', async () => {
        mocks.getMyStorefront.mockResolvedValue(three());
        router.go('/storefront?khoi=khong-co', { replace: true });
        renderPage();
        await openSection(/^Bộ hai,/);
        // Đang ở danh sách (dù địa chỉ còn ?khoi= cũ) nên mở khối là đẩy mục mới, không thay mục danh sách.
        expect(router.stack).toHaveLength(2);
        expect(here()).toBe('/storefront?khoi=c2');
        fireEvent.click(screen.getByRole('button', { name: 'Gian hàng của tôi' }));
        expect(await screen.findAllByTestId('section-card')).toHaveLength(3);
        expect(screen.queryByTestId('section-detail')).not.toBeInTheDocument();
        expect(router.idx).toBe(0);
      });

      it('?khoi= trỏ tới khối không còn: hiện danh sách khối', async () => {
        mocks.getMyStorefront.mockResolvedValue(three());
        router.go('/storefront?khoi=khong-co', { replace: true });
        renderPage();
        expect(await screen.findAllByTestId('section-card')).toHaveLength(3);
      });
    });

    it('menu của khối và tên gọi trong trang chi tiết đều nói "khối", không lẫn "bộ sưu tập"', async () => {
      mocks.getMyStorefront.mockResolvedValue(three());
      renderPage();
      await openSection(/^Bộ một,/);
      fireEvent.click(screen.getByRole('button', { name: 'Tuỳ chọn khối' }));
      const sheet = await screen.findByTestId('sheet');
      expect(within(sheet).getAllByRole('button').map((b) => b.textContent).filter(Boolean)).toEqual(['Đổi tên khối', 'Xoá khối']);
      fireEvent.click(within(sheet).getByRole('button', { name: 'Đổi tên khối' }));
      expect(within(await screen.findByTestId('sheet')).getByRole('textbox', { name: 'Đổi tên khối' })).toBeInTheDocument();
    });

    it('khung xem trước ghi rõ là chỉ để xem (nút "Thêm cả combo" trong đó không bấm được)', async () => {
      mocks.getMyStorefront.mockResolvedValue(three());
      renderPage();
      await openSection(/^Bộ ba,/);
      expect(screen.getByText('Chỉ để xem, chưa bấm được.')).toBeInTheDocument();
      expect(screen.getByTestId('shop-section-preview')).toHaveAttribute('inert');
    });

    it.each([
      ['GRID', 'NORMAL', 'shop-grid'],
      ['CAROUSEL', 'NORMAL', 'shop-rail'],
      ['STACK', 'NORMAL', 'shop-line'],
      ['CAROUSEL', 'COMBO', 'shop-combo'],
    ])('xem trước dựng bằng ShopSection thật: layout %s kind %s -> %s', async (layout, kind, testId) => {
      mocks.getMyStorefront.mockResolvedValue(storefront({
        collections: [section('c1', 'Bộ một', mkItems('a', 3), { layout, kind, comboDiscountPct: kind === 'COMBO' ? 10 : null })],
      }));
      renderPage();
      await openSection(/^Bộ một,/);
      const frame = screen.getByTestId('shop-section-preview');
      expect(within(frame).getByTestId(testId)).toBeInTheDocument();
      expect(frame).toHaveAttribute('inert');
    });

    it('xem trước không có món ẩn; khối chưa có món khách thấy thì không vẽ khung xem trước', async () => {
      mocks.getMyStorefront.mockResolvedValue(storefront({
        collections: [
          section('c1', 'Bộ một', [mkItem('v', 'Món hiện'), mkItem('h', 'Món ẩn', { isHidden: true })]),
          section('c2', 'Bộ trống', []),
        ],
      }));
      renderPage();
      await openSection(/^Bộ một,/);
      const frame = screen.getByTestId('shop-section-preview');
      expect(within(frame).getByText('Món hiện')).toBeInTheDocument();
      expect(within(frame).queryByText('Món ẩn')).not.toBeInTheDocument();
      expect(screen.getByText('Món ẩn')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Gian hàng của tôi' }));
      await openSection(/^Bộ trống,/);
      expect(screen.queryByTestId('shop-section-preview')).not.toBeInTheDocument();
      expect(screen.getByText('Chưa có món nào khách thấy được.')).toBeInTheDocument();
    });

    it('đổi bố cục chỉ gửi layout; bộ chọn đổi ngay khi đang gửi', async () => {
      mocks.getMyStorefront.mockResolvedValue(three());
      mocks.updateCollection.mockReturnValue(new Promise(() => {}));
      renderPage();
      await openSection(/^Bộ một,/);
      const group = screen.getByRole('radiogroup', { name: 'Kiểu hiển thị' });
      expect(within(group).getByRole('radio', { name: /Lưới/ })).toHaveAttribute('aria-checked', 'true');
      fireEvent.click(within(group).getByRole('radio', { name: /Danh sách/ }));
      await waitFor(() => expect(mocks.updateCollection).toHaveBeenCalledWith('c1', { layout: 'STACK' }));
      expect(within(group).getByRole('radio', { name: /Danh sách/ })).toHaveAttribute('aria-checked', 'true');
      expect(within(group).getByRole('radio', { name: /Lưới/ })).toHaveAttribute('aria-checked', 'false');
    });

    it('đổi bố cục xong: xem trước theo dữ liệu máy chủ trả về', async () => {
      mocks.getMyStorefront.mockResolvedValueOnce(three());
      renderPage();
      await openSection(/^Bộ một,/);
      expect(within(screen.getByTestId('shop-section-preview')).getByTestId('shop-grid')).toBeInTheDocument();
      mocks.getMyStorefront.mockResolvedValue(storefront({
        collections: [section('c1', 'Bộ một', mkItems('a', 3), { layout: 'STACK' }), ...three().collections.slice(1)],
      }));
      fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Kiểu hiển thị' })).getByRole('radio', { name: /Danh sách/ }));
      expect(await within(screen.getByTestId('shop-section-preview')).findByTestId('shop-line')).toBeInTheDocument();
    });

    it('đổi bố cục bị từ chối: bộ chọn về ô cũ và báo lỗi', async () => {
      mocks.getMyStorefront.mockResolvedValue(three());
      mocks.updateCollection.mockRejectedValue({ response: { data: { message: 'Lỗi' } }, message: 'x' });
      renderPage();
      await openSection(/^Bộ một,/);
      const group = screen.getByRole('radiogroup', { name: 'Kiểu hiển thị' });
      fireEvent.click(within(group).getByRole('radio', { name: /Kệ ngang/ }));
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
      expect(within(group).getByRole('radio', { name: /Lưới/ })).toHaveAttribute('aria-checked', 'true');
    });

    describe('chọn kiểu bằng bàn phím (mũi tên đổi ô ngay mỗi lần bấm)', () => {
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const radioOf = (name: RegExp) => within(screen.getByRole('radiogroup', { name: 'Kiểu hiển thị' })).getByRole('radio', { name });

      it('Lưới → Danh sách → Kệ ngang: ô cuối hiện ngay nhưng chỉ có một lần ghi, gửi ô cuối', async () => {
        mocks.getMyStorefront.mockResolvedValue(three());
        mocks.updateCollection.mockResolvedValue({});
        renderPage();
        await openSection(/^Bộ một,/);
        fireEvent.keyDown(radioOf(/Lưới/), { key: 'ArrowRight' });
        fireEvent.keyDown(radioOf(/Danh sách/), { key: 'ArrowRight' });
        expect(radioOf(/Kệ ngang/)).toHaveAttribute('aria-checked', 'true');
        expect(mocks.updateCollection).not.toHaveBeenCalled();
        await waitFor(() => expect(mocks.updateCollection).toHaveBeenCalledTimes(1));
        expect(mocks.updateCollection).toHaveBeenCalledWith('c1', { layout: 'CAROUSEL' });
        await wait(500);
        expect(mocks.updateCollection).toHaveBeenCalledTimes(1);
        expect(mocks.announce.mock.calls.filter(([, text]) => text === 'Đã đổi kiểu hiển thị.')).toHaveLength(1);
      });

      it('đổi đi rồi về đúng ô đang lưu: không gửi gì', async () => {
        mocks.getMyStorefront.mockResolvedValue(three());
        renderPage();
        await openSection(/^Bộ một,/);
        fireEvent.keyDown(radioOf(/Lưới/), { key: 'ArrowRight' });
        fireEvent.keyDown(radioOf(/Danh sách/), { key: 'ArrowLeft' });
        expect(radioOf(/Lưới/)).toHaveAttribute('aria-checked', 'true');
        await wait(600);
        expect(mocks.updateCollection).not.toHaveBeenCalled();
        expect(radioOf(/Lưới/)).toHaveAttribute('aria-checked', 'true');
      });

      it('lần ghi trước chưa xong thì lần chọn kế tiếp chờ, không gửi chồng; xong rồi mới gửi ô cuối', async () => {
        mocks.getMyStorefront.mockResolvedValue(three());
        let first!: (v: unknown) => void;
        mocks.updateCollection.mockReturnValueOnce(new Promise((r) => { first = r; })).mockResolvedValue({});
        renderPage();
        await openSection(/^Bộ một,/);
        fireEvent.click(radioOf(/Danh sách/));
        await waitFor(() => expect(mocks.updateCollection).toHaveBeenCalledTimes(1));
        fireEvent.click(radioOf(/Kệ ngang/));
        await wait(700);
        expect(mocks.updateCollection).toHaveBeenCalledTimes(1);
        expect(radioOf(/Kệ ngang/)).toHaveAttribute('aria-checked', 'true');
        first({ layout: 'STACK' });
        await waitFor(() => expect(mocks.updateCollection).toHaveBeenCalledTimes(2));
        expect(mocks.updateCollection).toHaveBeenNthCalledWith(2, 'c1', { layout: 'CAROUSEL' });
      });
    });

    it('khối Thường khoá ô Combo, khối Combo khoá ba ô còn lại; bấm ô khoá không gọi API', async () => {
      mocks.getMyStorefront.mockResolvedValue(three());
      renderPage();
      await openSection(/^Bộ một,/);
      let group = screen.getByRole('radiogroup', { name: 'Kiểu hiển thị' });
      expect(within(group).getByRole('radio', { name: /Combo/ })).toHaveAttribute('aria-disabled', 'true');
      expect(screen.getByText('Kiểu Combo chọn lúc tạo khối.')).toBeInTheDocument();
      fireEvent.click(within(group).getByRole('radio', { name: /Combo/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Gian hàng của tôi' }));
      await openSection(/^Bộ ba,/);
      group = screen.getByRole('radiogroup', { name: 'Kiểu hiển thị' });
      for (const n of [/Lưới/, /Kệ ngang/, /Danh sách/]) expect(within(group).getByRole('radio', { name: n })).toHaveAttribute('aria-disabled', 'true');
      expect(screen.getByText('Khối Combo giữ kiểu Combo; bạn chỉnh được mức giảm.')).toBeInTheDocument();
      fireEvent.click(within(group).getByRole('radio', { name: /Lưới/ }));
      expect(mocks.updateCollection).not.toHaveBeenCalled();
    });
  });

  describe('% giảm của khối Combo', () => {
    const pctInput = () => screen.getByRole('textbox', { name: 'Giảm khi mua cả bộ' }) as HTMLInputElement;
    const saveBtn = () => screen.getByRole('button', { name: 'Lưu mức giảm' });
    const open = async () => {
      mocks.getMyStorefront.mockResolvedValue(three());
      renderPage();
      await openSection(/^Bộ ba,/);
    };

    it('khối Thường không có ô %; khối Combo có ô điền sẵn mức hiện tại', async () => {
      await open();
      expect(pctInput().value).toBe('10');
      fireEvent.click(screen.getByRole('button', { name: 'Gian hàng của tôi' }));
      await openSection(/^Bộ một,/);
      expect(screen.queryByRole('textbox', { name: 'Giảm khi mua cả bộ' })).not.toBeInTheDocument();
    });

    it('"abc", trống, "0" tắt nút Lưu; số hợp lệ thì lưu chỉ gửi comboDiscountPct', async () => {
      mocks.updateCollection.mockResolvedValue({ id: 'c3', comboDiscountPct: 15 });
      await open();
      for (const bad of ['abc', '', '0']) {
        fireEvent.change(pctInput(), { target: { value: bad } });
        expect(saveBtn()).toBeDisabled();
      }
      fireEvent.change(pctInput(), { target: { value: '15' } });
      fireEvent.click(saveBtn());
      await waitFor(() => expect(mocks.updateCollection).toHaveBeenCalledWith('c3', { comboDiscountPct: 15 }));
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã lưu mức giảm 15%.', type: 'success' }));
    });

    it('trần cấu hình do máy chủ giữ: nhập 35 gửi đúng 35 (không bị cắt về 30 ở máy khách) và báo đã lưu 35', async () => {
      mocks.updateCollection.mockResolvedValue({ id: 'c3', comboDiscountPct: 35 });
      await open();
      fireEvent.change(pctInput(), { target: { value: '35' } });
      fireEvent.click(saveBtn());
      await waitFor(() => expect(mocks.updateCollection).toHaveBeenCalledWith('c3', { comboDiscountPct: 35 }));
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã lưu mức giảm 35%.', type: 'success' }));
    });

    it('dòng gợi ý không ghi số trần cố định; mức đang là 30 mà nhập 50 thì nút Lưu vẫn bấm được và máy chủ trả lời trần', async () => {
      mocks.getMyStorefront.mockResolvedValue(storefront({
        collections: [section('c3', 'Bộ ba', mkItems('c', 3), { kind: 'COMBO', layout: 'CAROUSEL', comboDiscountPct: 30 })],
      }));
      mocks.updateCollection.mockResolvedValue({ id: 'c3', comboDiscountPct: 30 });
      renderPage();
      await openSection(/^Bộ ba,/);
      expect(screen.getByTestId('combo-pct-hint').textContent).not.toMatch(/\d/);
      fireEvent.change(pctInput(), { target: { value: '50' } });
      expect(saveBtn()).not.toBeDisabled();
      fireEvent.click(saveBtn());
      await waitFor(() => expect(mocks.updateCollection).toHaveBeenCalledWith('c3', { comboDiscountPct: 50 }));
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Mức giảm tối đa hiện là 30%.', type: 'warning' }));
      expect(pctInput().value).toBe('30');
      expect(screen.getByTestId('combo-pct-hint')).toHaveTextContent('Mức giảm tối đa hiện là 30%.');
    });

    it('đang lưu: nút báo bận và bấm lại không gửi lần hai, không có hai thông báo', async () => {
      let resolve!: (v: unknown) => void;
      mocks.updateCollection.mockReturnValue(new Promise((r) => { resolve = r; }));
      await open();
      fireEvent.change(pctInput(), { target: { value: '15' } });
      fireEvent.click(saveBtn());
      await waitFor(() => expect(saveBtn()).toHaveAttribute('aria-busy', 'true'));
      fireEvent.click(saveBtn());
      fireEvent.click(saveBtn());
      expect(mocks.updateCollection).toHaveBeenCalledTimes(1);
      resolve({ id: 'c3', comboDiscountPct: 15 });
      await waitFor(() => expect(saveBtn()).not.toHaveAttribute('aria-busy', 'true'));
      expect(mocks.openSnackbar.mock.calls.filter(([o]) => (o as { text: string }).text === 'Đã lưu mức giảm 15%.')).toHaveLength(1);
    });

    it('máy chủ kẹp thấp hơn (trần 20): ô hiện 20 và báo mức tối đa', async () => {
      mocks.updateCollection.mockResolvedValue({ id: 'c3', comboDiscountPct: 20 });
      await open();
      fireEvent.change(pctInput(), { target: { value: '25' } });
      fireEvent.click(saveBtn());
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: 'Mức giảm tối đa hiện là 20%.' })));
      expect(pctInput().value).toBe('20');
    });
  });

  describe('chế độ Sắp xếp', () => {
    const detailWith = async (items: unknown[], extra: unknown[] = []) => {
      mocks.getMyStorefront.mockResolvedValue(storefront({ collections: [section('c1', 'Bộ một', items), ...extra] }));
      renderPage();
      await openSection(/^Bộ một,/);
    };
    const abc = () => [mkItem('a', 'Món A'), mkItem('b', 'Món B'), mkItem('c', 'Món C')];
    const order = () => screen.getAllByTestId('item-name').map((e) => e.textContent);

    it('ngoài chế độ Sắp xếp không có mũi tên; bật lên thì mỗi món có hai nút mang tên món', async () => {
      await detailWith(abc());
      expect(screen.queryByRole('button', { name: /^Đưa / })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Sắp xếp' }));
      expect(screen.getByRole('button', { name: 'Đưa Món B lên' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Đưa Món B xuống' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Xong' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Xong' }));
      expect(screen.queryByRole('button', { name: /^Đưa / })).not.toBeInTheDocument();
    });

    it('Sắp xếp ẩn khung xem trước (danh sách ↑↓ lên màn đầu); Xong thì khung hiện lại', async () => {
      await detailWith(abc());
      expect(screen.getByTestId('shop-section-preview')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Sắp xếp' }));
      expect(screen.queryByTestId('shop-section-preview')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Đưa Món B lên' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Xong' }));
      expect(screen.getByTestId('shop-section-preview')).toBeInTheDocument();
    });

    it('nút ↑ của món đầu là aria-disabled (không disabled), giữ focus, không gọi API và báo "đã ở đầu danh sách"', async () => {
      await detailWith(abc());
      fireEvent.click(screen.getByRole('button', { name: 'Sắp xếp' }));
      const up = screen.getByRole('button', { name: 'Đưa Món A lên' });
      expect(up).toHaveAttribute('aria-disabled', 'true');
      expect(up).not.toBeDisabled();
      up.focus();
      fireEvent.click(up);
      expect(mocks.reorderItems).not.toHaveBeenCalled();
      expect(up).toHaveFocus();
      expect(mocks.announce).toHaveBeenCalledWith('status', 'Món A đã ở đầu danh sách');
    });

    it('dời món xuống: gửi thứ tự mới, danh sách đổi ngay, báo vị trí mới, focus ở lại đúng nút', async () => {
      mocks.reorderItems.mockReturnValue(new Promise(() => {}));
      await detailWith(abc());
      fireEvent.click(screen.getByRole('button', { name: 'Sắp xếp' }));
      expect(order()).toEqual(['Món A', 'Món B', 'Món C']);
      const down = screen.getByRole('button', { name: 'Đưa Món A xuống' });
      down.focus();
      fireEvent.click(down);
      await waitFor(() => expect(mocks.reorderItems).toHaveBeenCalledWith('c1', ['i-b', 'i-a', 'i-c']));
      expect(order()).toEqual(['Món B', 'Món A', 'Món C']);
      expect(mocks.announce).toHaveBeenCalledWith('status', 'Đã đưa Món A xuống vị trí 2/3');
      await waitFor(() => expect(screen.getByRole('button', { name: 'Đưa Món A xuống' })).toHaveFocus());
    });

    it('món thường đứng ngay dưới món ghim: bấm ↑ không dời, báo "Món ghim luôn nằm trên món thường."', async () => {
      await detailWith([mkItem('a', 'Món A', { isPinned: true }), mkItem('b', 'Món B')]);
      fireEvent.click(screen.getByRole('button', { name: 'Sắp xếp' }));
      const up = screen.getByRole('button', { name: 'Đưa Món B lên' });
      expect(up).toHaveAttribute('aria-disabled', 'true');
      fireEvent.click(up);
      expect(mocks.reorderItems).not.toHaveBeenCalled();
      expect(mocks.announce).toHaveBeenCalledWith('status', 'Món ghim luôn nằm trên món thường.');
    });

    it('màn chính: Sắp xếp thu mỗi khối thành một dòng có ↑↓; dời khối gửi reorderCollections và báo vị trí', async () => {
      mocks.getMyStorefront.mockResolvedValue(three());
      mocks.reorderCollections.mockReturnValue(new Promise(() => {}));
      renderPage();
      await screen.findByText('Bộ một');
      fireEvent.click(screen.getByRole('button', { name: 'Sắp xếp' }));
      expect(screen.queryAllByTestId('section-card')).toHaveLength(0);
      expect(screen.getByRole('button', { name: 'Đưa khối Bộ một lên' })).toHaveAttribute('aria-disabled', 'true');
      expect(screen.getByRole('button', { name: 'Đưa khối Bộ ba xuống' })).toHaveAttribute('aria-disabled', 'true');
      fireEvent.click(screen.getByRole('button', { name: 'Đưa khối Bộ một xuống' }));
      await waitFor(() => expect(mocks.reorderCollections).toHaveBeenCalledWith(['c2', 'c1', 'c3']));
      expect(mocks.announce).toHaveBeenCalledWith('status', 'Đã đưa Bộ một xuống vị trí 2/3');
      fireEvent.click(screen.getByRole('button', { name: 'Xong' }));
      expect(await screen.findAllByTestId('section-card')).toHaveLength(3);
    });
  });

  describe('Hành trình và thống kê trên màn chính', () => {
    it('Hành trình là một dải nói thưởng đang chờ; bấm mở sheet có nhiệm vụ, nút nhận là nút phụ', async () => {
      renderPage();
      const strip = await screen.findByRole('button', { name: /phần thưởng đang chờ/ });
      expect(strip).toHaveTextContent('1 phần thưởng đang chờ · 2 điểm');
      expect(screen.queryByRole('heading', { name: 'Hành trình gian hàng' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Nhận 2 điểm' })).not.toBeInTheDocument();
      fireEvent.click(strip);
      const claim = await screen.findByRole('button', { name: 'Nhận 2 điểm' });
      expect(claim.className).not.toContain('zaui-btn-primary');
      fireEvent.click(claim);
      await waitFor(() => expect(mocks.claimQuest).toHaveBeenCalledWith('Q1'));
    });

    it('LIVE: ba ô thống kê nằm trước khối đầu tiên; nháp hoặc chờ duyệt thì không có thống kê', async () => {
      mocks.getMyStorefront.mockResolvedValue(storefront({ isPublished: true, status: 'LIVE' }));
      const view = renderPage();
      const orders = await screen.findByText('Đơn 30 ngày');
      const firstCard = screen.getAllByTestId('section-card')[0]!;
      expect(orders.compareDocumentPosition(firstCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(screen.getByText('9')).toBeInTheDocument();
      view.unmount();
      mocks.getMyStorefront.mockResolvedValue(storefront({ isPublished: true, status: 'PENDING_APPROVAL' }));
      renderPage();
      await screen.findByText('Chờ duyệt', { selector: 'span' });
      expect(screen.queryByText('Đơn 30 ngày')).not.toBeInTheDocument();
      expect(mocks.getStorefrontStats).toHaveBeenCalledTimes(1);
    });
  });
});
