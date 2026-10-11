import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  Sheet: ({ visible, children }: { visible: boolean; children: ReactNode }) =>
    visible ? <div data-testid="sheet">{children}</div> : null,
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/brand-story', search: '', hash: '', state: null, key: 'k' }),
}));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import { BRAND_ORIGINS } from '../utils/brand-origins';
import BrandStoryPage from './brand-story';

// Ghim trên bản đồ: nút có nhãn "<nhãn> — <tỉnh>", cùng mở sheet với ô lưới bên dưới.
const tile = (brand: string) => screen.getByRole('button', { name: new RegExp(`^${brand} — `) });

describe('BrandStoryPage — Hành trình nguyên liệu dẫn đúng danh sách (C-079)', () => {
  beforeEach(() => vi.clearAllMocks());

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
