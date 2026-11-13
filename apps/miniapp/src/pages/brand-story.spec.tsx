import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

import { BRAND_ORIGINS, brandBrowseTarget } from '../utils/brand-origins';
import BrandStoryPage from './brand-story';

const here = dirname(fileURLToPath(import.meta.url));
const MAP_CSS = readFileSync(join(here, '../css/brand-map.css'), 'utf8');
const origin = (brand: string) => {
  const o = BRAND_ORIGINS.find((x) => x.brand === brand);
  if (!o) throw new Error(`không có nhãn ${brand}`);
  return o;
};
const mapLabel = (brand: string) => screen.getByTestId(`brand-map-label-${origin(brand).id}`);
const card = (brand: string) => screen.getByTestId(`brand-card-${origin(brand).id}`);

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

  it.each(BRAND_ORIGINS.map((o) => [o.brand, o.searchKeyword] as const))(
    'bấm %s rồi "Khám phá sản phẩm" mở /browse?q= theo từ khoá trong tên sản phẩm (%s)',
    (brand, keyword) => {
      render(<BrandStoryPage />);
      fireEvent.click(mapLabel(brand));
      const sheet = screen.getByTestId('sheet');
      fireEvent.click(within(sheet).getByRole('button', { name: new RegExp(`Khám phá sản phẩm ${brand}`) }));
      expect(mocks.navigate).toHaveBeenCalledTimes(1);
      expect(mocks.navigate).toHaveBeenCalledWith(brandBrowseTarget(origin(brand), '/browse'));
      const target = new URL(mocks.navigate.mock.calls[0]![0] as string, 'https://x.test');
      expect(target.pathname).toBe('/browse');
      expect(target.searchParams.get('q')).toBe(keyword);
      expect(target.searchParams.has('brand')).toBe(false);
    },
  );

  it('hai nhãn từng ra danh sách rỗng nay tìm theo từ khoá đúng viết trong tên sản phẩm', () => {
    render(<BrandStoryPage />);
    fireEvent.click(mapLabel('Le Plateau'));
    fireEvent.click(within(screen.getByTestId('sheet')).getByRole('button', { name: /Khám phá sản phẩm/ }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/browse?q=Le+Plateau');

    fireEvent.click(mapLabel('Sokfarm'));
    fireEvent.click(within(screen.getByTestId('sheet')).getByRole('button', { name: /Khám phá sản phẩm/ }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/browse?q=Sokfarm');
  });
});

describe('BrandStoryPage — cấu trúc và vùng chạm (C-076, C-114)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('có đúng một h1 là tiêu đề trang', () => {
    render(<BrandStoryPage />);
    const h1 = screen.getAllByRole('heading', { level: 1 });
    expect(h1).toHaveLength(1);
    expect(h1[0]!.textContent).toBe('Hành trình nguyên liệu');
  });

  it('8 thẻ là nút thật có huy hiệu SVG riêng, tên nhãn, tỉnh, nguyên liệu; mở cùng sheet với nhãn trên bản đồ', () => {
    render(<BrandStoryPage />);
    const shapes = new Set<string>();
    for (const o of BRAND_ORIGINS) {
      const el = card(o.brand);
      expect(el.tagName).toBe('BUTTON');
      expect(el.tabIndex).toBe(0);
      expect(el.textContent).toContain(o.brand);
      expect(el.textContent).toContain(o.province);
      expect(el.textContent).toContain(o.ingredient);
      const badge = within(el).getByTestId(`brand-badge-${o.id}`);
      expect(badge).toHaveAttribute('aria-hidden', 'true');
      shapes.add(Array.from(badge.querySelectorAll('path')).map((p) => p.getAttribute('d')).join('|'));
    }
    expect(shapes.size).toBe(8);
    fireEvent.click(card('Cobote'));
    expect(within(screen.getByTestId('sheet')).getByRole('heading', { level: 2, name: 'Cobote' })).toBeTruthy();
  });

  it('thẻ và nhãn bản đồ cao ít nhất 44px (khai trong CSS)', () => {
    const block = (sel: string) => new RegExp(`${sel.replace('.', '\\.')}\\s*\\{[^}]*min-height:\\s*44px`).test(MAP_CSS);
    expect(block('.brandcard')).toBe(true);
    expect(block('.brandmap-label')).toBe(true);
  });

  it('sheet có tiêu đề h2 là tên nhãn, tỉnh, nguyên liệu, câu chuyện và nút Đóng', () => {
    render(<BrandStoryPage />);
    fireEvent.click(mapLabel('Visante'));
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
    fireEvent.click(mapLabel('Hector'));
    fireEvent.click(within(screen.getByTestId('sheet')).getByRole('button', { name: /Khám phá sản phẩm Hector/ }));
    expect(screen.queryByTestId('sheet')).toBeNull();
    expect(mocks.navigate).toHaveBeenCalledWith('/browse?q=Hector');
  });

  it('không còn gradient, lớp phủ tối hay emoji ở ô nhãn và câu dẫn (D8-1, D6-19)', () => {
    const { container } = render(<BrandStoryPage />);
    expect(container.innerHTML).not.toMatch(/gradient|brand-tile-scrim/);
    expect(container.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(screen.getByText(/Mỗi thương hiệu Tubu Tree đều gắn liền/).textContent).toContain('Chạm tên thương hiệu trên bản đồ vùng nguyên liệu Việt Nam');
  });

  it('bản đồ có nhãn cho trình đọc màn hình, không còn chữ "Gỗ 3D"', () => {
    render(<BrandStoryPage />);
    expect(screen.getByRole('img', { name: 'Bản đồ vùng nguyên liệu Việt Nam, vẽ sơ đồ' })).toBeTruthy();
    expect(screen.queryByRole('img', { name: /Gỗ 3D/ })).toBeNull();
  });
});

describe('BrandStoryPage — bản đồ chú thích', () => {
  beforeEach(() => vi.clearAllMocks());

  it('8 nhãn trên bản đồ là nút thật: Tab tới được, không aria-hidden, tên có nhãn và tỉnh; bấm mở sheet', () => {
    render(<BrandStoryPage />);
    for (const o of BRAND_ORIGINS) {
      const label = mapLabel(o.brand);
      expect(label.tagName).toBe('BUTTON');
      expect(label.tabIndex).toBe(0);
      expect(label).not.toHaveAttribute('aria-hidden');
      expect(label.textContent).toContain(o.brand);
      expect(label.textContent).toContain(o.province);
    }
    fireEvent.click(mapLabel('Hector'));
    expect(within(screen.getByTestId('sheet')).getByRole('heading', { level: 2, name: 'Hector' })).toBeTruthy();
  });

  it('chấm ghim chỉ để nhìn: ẩn khỏi trình đọc, không phải nút', () => {
    render(<BrandStoryPage />);
    for (const o of BRAND_ORIGINS) {
      const pin = screen.getByTestId(`brand-map-pin-${o.id}`);
      expect(pin.tagName).toBe('SPAN');
      expect(pin).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('ba đảo có chấm số và tên ở dải chú giải', () => {
    render(<BrandStoryPage />);
    const legend = screen.getByTestId('brand-map-legend');
    for (const name of ['Hoàng Sa', 'Trường Sa', 'Phú Quốc']) expect(legend.textContent).toContain(name);
    expect(document.querySelectorAll('[data-testid^="brand-map-island-"]')).toHaveLength(3);
  });

  it('chọn nhãn sáng đúng nhãn đó trên bản đồ, không có chuyển động vĩnh viễn', () => {
    const { container } = render(<BrandStoryPage />);
    expect(container.querySelectorAll('[data-active]')).toHaveLength(0);
    expect(container.innerHTML).not.toContain('pulse');
    fireEvent.click(mapLabel('Visante'));
    expect(mapLabel('Visante')).toHaveAttribute('data-active');
    expect(screen.getByTestId(`brand-map-pin-${origin('Visante').id}`)).toHaveAttribute('data-active');
    expect(mapLabel('Hector')).not.toHaveAttribute('data-active');
  });
});
