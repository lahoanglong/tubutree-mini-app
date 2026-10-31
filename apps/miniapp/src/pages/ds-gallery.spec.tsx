import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => vi.fn(),
}));

import DsGalleryPage from './ds-gallery';

const GROUPS = ['section-header', 'section', 'countdown', 'flash-sold-bar', 'sort-bar', 'voucher-ticket', 'combo-card', 'banner-carousel'];

describe('ds-gallery (Mini)', () => {
  it('có đủ 8 mục, mỗi mục ít nhất 2 biến thể hoặc trạng thái', () => {
    render(<DsGalleryPage />);
    for (const g of GROUPS) {
      const el = document.getElementById(`ds-${g}`);
      expect(el, g).not.toBeNull();
      expect(el!.querySelectorAll('[data-variant]').length, g).toBeGreaterThanOrEqual(2);
    }
  });

  it('một h1; không vẽ ProductTile (gói P4 giữ)', () => {
    const { container } = render(<DsGalleryPage />);
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(container.querySelector('[data-testid="product-tile"]')).toBeNull();
  });

  it('mã giảm giá vẽ đủ 3 biến thể ticket, chip, row và đủ 6 trạng thái', () => {
    render(<DsGalleryPage />);
    const labels = Array.from(document.querySelectorAll('#ds-voucher-ticket [data-variant]')).map((e) => e.getAttribute('data-variant')!);
    for (const v of ['ticket', 'chip', 'row']) expect(labels.some((l) => l.startsWith(v)), v).toBe(true);
    for (const s of ['collectable', 'saved', 'used', 'expired', 'soldout', 'ineligible']) expect(labels.some((l) => l.endsWith(`· ${s}`)), s).toBe(true);
  });

  it('banner 1 slide không có nút Dừng; banner 3 slide có', () => {
    render(<DsGalleryPage />);
    expect(document.querySelectorAll('#ds-banner-carousel button[aria-label="Dừng tự chuyển"]')).toHaveLength(1);
  });
});
