// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount as mountRaw } from '@/components/mini/harness';
import { STOREFRONT_TRUST_TITLE } from '@tubutree/app-core/commerce/storefront-trust';

vi.mock('next/link', () => ({
  default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a>,
}));
vi.mock('@/lib/auth-phase', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), useAuthPhase: () => 'guest' }));
vi.mock('next/navigation', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), useRouter: () => ({ push: vi.fn() }) }));

import DsGalleryPage from './page';

// Thẻ cây thông Noel Xanh trong gallery là thẻ thật (đọc phiên và trạng thái điểm danh) nên cần QueryClient, router và phiên (ở đây: khách) như ở app.
const mount = (ui: ReactElement) => mountRaw(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

const GROUPS = ['section-header', 'section', 'countdown', 'flash-sold-bar', 'sort-bar', 'voucher-ticket', 'combo-card', 'banner-carousel', 'product-story-showcase', 'christmas-home-hero'];

afterEach(() => vi.unstubAllEnvs());

describe('/ds-gallery (web)', () => {
  it('ngoài production: có đủ 10 mục, mỗi mục ít nhất 2 biến thể hoặc trạng thái', () => {
    vi.stubEnv('NODE_ENV', 'development');
    mount(<DsGalleryPage />);
    for (const g of GROUPS) {
      const el = document.getElementById(`ds-${g}`);
      expect(el, g).not.toBeNull();
      expect(el!.querySelectorAll('[data-variant]').length, g).toBeGreaterThanOrEqual(2);
    }
  });

  it('production: gọi trang ném lỗi not-found của Next (trả 404), không dựng gallery', () => {
    vi.stubEnv('NODE_ENV', 'production');
    let caught: unknown;
    try {
      DsGalleryPage();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeTruthy();
    expect(String((caught as { digest?: string }).digest)).toMatch(/NEXT_NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK;404/);
  });

  it('một h1, khung giữa tối đa 480px, không vẽ ProductTile (gói P4 giữ)', () => {
    vi.stubEnv('NODE_ENV', 'development');
    mount(<DsGalleryPage />);
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    const main = document.querySelector('main')!;
    expect(main.style.maxWidth).toBe('480px');
    expect(main.style.margin).toBe('0px auto');
    expect(document.querySelector('[data-testid="product-tile"]')).toBeNull();
  });

  it('đủ 3 biến thể ticket, chip, row và đủ 6 trạng thái của mã giảm giá', () => {
    vi.stubEnv('NODE_ENV', 'development');
    mount(<DsGalleryPage />);
    const labels = Array.from(document.querySelectorAll('#ds-voucher-ticket [data-variant]')).map((e) => e.getAttribute('data-variant')!);
    for (const v of ['ticket', 'chip', 'row']) expect(labels.some((l) => l.startsWith(v)), v).toBe(true);
    for (const s of ['collectable', 'saved', 'used', 'expired', 'soldout', 'ineligible']) expect(labels.some((l) => l.endsWith(`· ${s}`)), s).toBe(true);
  });

  it('tubu-w19-03: không có id trùng (hai dải cam kết gian hàng dùng id riêng cho tiêu đề)', () => {
    vi.stubEnv('NODE_ENV', 'development');
    mount(<DsGalleryPage />);
    const ids = Array.from(document.querySelectorAll('[id]')).map((e) => e.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
    const trust = Array.from(document.querySelectorAll<HTMLElement>('section[aria-labelledby]')).filter(
      (s) => document.getElementById(s.getAttribute('aria-labelledby')!)?.textContent === STOREFRONT_TRUST_TITLE,
    );
    expect(trust).toHaveLength(2);
  });

  it('metadata: không cho công cụ tìm kiếm lập chỉ mục', async () => {
    const { metadata } = await import('./page');
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
