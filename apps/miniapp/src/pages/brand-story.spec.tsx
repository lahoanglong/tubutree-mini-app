import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), search: '' }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  Sheet: ({ visible, children }: { visible: boolean; children: ReactNode }) =>
    visible ? <div data-testid="sheet">{children}</div> : null,
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/brand-story', search: mocks.search, hash: '', state: null, key: 'k' }),
}));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import { BRAND_ORIGINS } from '../utils/brand-origins';
import BrandStoryPage from './brand-story';

// Ghim trên bản đồ: nút data-testid "brand-pin-<id>", cùng mở sheet với ô lưới bên dưới. Ghim aria-hidden (xem
// test target-size bên dưới) nên getByRole không thấy và cũng không có aria-label (tên vô nghĩa trên phần tử ẩn).
const tile = (brand: string) => {
  const origin = BRAND_ORIGINS.find((o) => o.brand === brand);
  if (!origin) throw new Error(`không có nhãn ${brand}`);
  return screen.getByTestId(`brand-pin-${origin.id}`);
};

describe('BrandStoryPage — Hành trình nguyên liệu dẫn đúng danh sách (C-079)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.search = '';
  });

  it('?brand=<id> mở sẵn sheet của nhãn đó; id lạ thì không mở', () => {
    mocks.search = '?brand=fuwa3e';
    const { unmount } = render(<BrandStoryPage />);
    expect(within(screen.getByTestId('sheet')).getByRole('button', { name: /Khám phá sản phẩm Fuwa3e/ })).toBeInTheDocument();
    unmount();
    mocks.search = '?brand=khong-co';
    render(<BrandStoryPage />);
    expect(screen.queryByTestId('sheet')).toBeNull();
  });

  it.each(BRAND_ORIGINS.map((o) => [o.brand, o.catalogBrand] as const))(
    'bấm %s rồi "Khám phá sản phẩm" mở /browse?brand= theo tên nhãn trong catalog (%s)',
    (brand, catalogBrand) => {
      render(<BrandStoryPage />);
      fireEvent.click(tile(brand));
      const sheet = screen.getByTestId('sheet');
      fireEvent.click(within(sheet).getByRole('button', { name: new RegExp(`Khám phá sản phẩm ${brand}`) }));
      expect(mocks.navigate).toHaveBeenCalledTimes(1);
      expect(mocks.navigate).toHaveBeenCalledWith(`/browse?brand=${encodeURIComponent(catalogBrand)}`);
    },
  );

  it('hai nhãn từng ra danh sách rỗng nay dẫn tới tên catalog', () => {
    render(<BrandStoryPage />);
    fireEvent.click(tile('Le Plateau'));
    fireEvent.click(within(screen.getByTestId('sheet')).getByRole('button', { name: /Khám phá sản phẩm/ }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/browse?brand=Le%20Plateau%20Coffee');

    fireEvent.click(tile('Sokfarm'));
    fireEvent.click(within(screen.getByTestId('sheet')).getByRole('button', { name: /Khám phá sản phẩm/ }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/browse?brand=Sokfram');
  });
});

/** Ô lưới dưới bản đồ: tên đọc ra từ chữ bên trong. getAllByRole bỏ qua ghim bản đồ vì chúng aria-hidden. */
const gridTile = (brand: string) => {
  const found = screen.getAllByRole('button').find((b) => (b.textContent ?? '').includes(brand));
  if (!found) throw new Error(`không có ô lưới cho ${brand}`);
  return found;
};
const minHeightOf = (el: HTMLElement) => parseInt(el.style.minHeight, 10);

describe('BrandStoryPage — cấu trúc và vùng chạm (C-076, C-114)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('có đúng một h1 là tiêu đề trang', () => {
    render(<BrandStoryPage />);
    const h1 = screen.getAllByRole('heading', { level: 1 });
    expect(h1).toHaveLength(1);
    expect(h1[0]!.textContent).toBe('Hành trình nguyên liệu');
  });

  it('8 ô lưới là nút thật cao ít nhất 44px và mở cùng sheet với ghim bản đồ', () => {
    render(<BrandStoryPage />);
    for (const o of BRAND_ORIGINS) {
      const el = gridTile(o.brand);
      expect(el.tagName).toBe('BUTTON');
      expect(minHeightOf(el)).toBeGreaterThanOrEqual(44);
    }
    fireEvent.click(gridTile('Cobote'));
    expect(within(screen.getByTestId('sheet')).getByRole('heading', { level: 2, name: 'Cobote' })).toBeTruthy();
  });

  it('8 ghim bản đồ là nút có vùng chạm ít nhất 44px', () => {
    render(<BrandStoryPage />);
    for (const o of BRAND_ORIGINS) {
      const pin = tile(o.brand);
      expect(pin.tagName).toBe('BUTTON');
      expect(minHeightOf(pin)).toBeGreaterThanOrEqual(44);
    }
  });

  it('sheet có tiêu đề h2 là tên nhãn, tỉnh, nguyên liệu, câu chuyện và nút Đóng', () => {
    render(<BrandStoryPage />);
    fireEvent.click(tile('Visante'));
    const sheet = within(screen.getByTestId('sheet'));
    expect(sheet.getByRole('heading', { level: 2, name: 'Visante' })).toBeTruthy();
    expect(sheet.getByText(/Khánh Hòa \(Nha Trang\)/)).toBeTruthy();
    expect(sheet.getByText(/Muối khoáng & rong biển/)).toBeTruthy();
    expect(sheet.getByText(/Visante tận dụng tinh chất muối khoáng/)).toBeTruthy();
    fireEvent.click(sheet.getByRole('button', { name: 'Đóng' }));
    expect(screen.queryByTestId('sheet')).toBeNull();
  });

  it('bấm Khám phá sản phẩm đóng sheet trước khi chuyển trang', () => {
    render(<BrandStoryPage />);
    fireEvent.click(tile('Hector'));
    fireEvent.click(within(screen.getByTestId('sheet')).getByRole('button', { name: /Khám phá sản phẩm Hector/ }));
    expect(screen.queryByTestId('sheet')).toBeNull();
    expect(mocks.navigate).toHaveBeenCalledWith('/browse?brand=Hector');
  });

  it('mỗi ô nhãn có lớp phủ tối dưới chữ trắng để đạt 4,5:1 (D8-1)', () => {
    render(<BrandStoryPage />);
    for (const o of BRAND_ORIGINS) {
      const scrim = within(gridTile(o.brand)).getByTestId('brand-tile-scrim');
      expect(scrim.style.background).toContain('--color-brand-tile-scrim');
      expect(scrim.textContent).toContain(o.brand);
      expect(scrim.textContent).toContain(o.province);
    }
  });

  it('câu dẫn đầu trang không kết bằng emoji 🌿 (D6-19)', () => {
    render(<BrandStoryPage />);
    const intro = screen.getByText(/Mỗi thương hiệu Tubu Tree đều gắn liền/);
    expect(intro.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('bản đồ có nhãn cho trình đọc màn hình', () => {
    render(<BrandStoryPage />);
    expect(screen.getByRole('img', { name: /Bản đồ Gỗ 3D Việt Nam/ })).toBeTruthy();
  });
});

describe('BrandStoryPage — ghim bản đồ và vùng chạm (axe target-size, WCAG 2.5.8)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('8 ghim chỉ là lối tắt bằng hình trùng với 8 ô lưới: ẩn khỏi trình đọc màn hình và khỏi thứ tự Tab, vẫn chạm được', () => {
    render(<BrandStoryPage />);
    for (const o of BRAND_ORIGINS) {
      const pin = tile(o.brand);
      expect(pin).toHaveAttribute('aria-hidden', 'true');
      expect(pin).not.toHaveAttribute('aria-label');
      expect(pin.tabIndex).toBe(-1);
      expect(minHeightOf(pin)).toBeGreaterThanOrEqual(44);
    }
    fireEvent.click(tile('Hector'));
    expect(within(screen.getByTestId('sheet')).getByRole('heading', { level: 2, name: 'Hector' })).toBeTruthy();
  });

  it('người dùng trình đọc màn hình/bàn phím vẫn có đủ 8 nhãn qua ô lưới: nút Tab tới được, tên có nhãn và tỉnh, bấm mở sheet', () => {
    render(<BrandStoryPage />);
    const accessible = screen.getAllByRole('button');
    for (const o of BRAND_ORIGINS) {
      const grid = accessible.find((b) => (b.textContent ?? '').includes(o.brand));
      expect(grid, `ô lưới ${o.brand}`).toBeDefined();
      expect(grid!.textContent).toContain(o.province);
      expect(grid!.tabIndex).toBe(0);
    }
    fireEvent.click(accessible.find((b) => (b.textContent ?? '').includes('Cobote'))!);
    expect(within(screen.getByTestId('sheet')).getByRole('heading', { level: 2, name: 'Cobote' })).toBeTruthy();
    // Không có ghim nào trong cây truy cập.
    expect(accessible.filter((b) => (b.getAttribute('data-testid') ?? '').startsWith('brand-pin-'))).toEqual([]);
  });
});
