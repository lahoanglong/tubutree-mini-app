// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, type Rendered } from '@/test-utils/dom';
import CatalogWpImagesPage from './page';

const mocks = vi.hoisted(() => ({
  auth: { user: null as { role: string } | null, status: 'authenticated', initialized: true },
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));
vi.mock('./wp-image-triage', () => ({ WpImageTriage: () => <div data-testid="triage" /> }));

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});
const mount = () => {
  const r = render(<CatalogWpImagesPage />);
  mounted.push(r);
  return r;
};

describe('Trang /admin/catalog-wp-images', () => {
  it('đang khởi tạo: chỉ báo đang tải', () => {
    mocks.auth = { user: null, status: 'loading', initialized: false };
    const { container } = mount();
    expect(container.textContent).toContain('Đang tải');
    expect(container.querySelector('[data-testid="triage"]')).toBeNull();
  });

  it('chưa đăng nhập: liên kết "Đăng nhập" cao 44px, không vẽ bàn duyệt', () => {
    mocks.auth = { user: null, status: 'unauthenticated', initialized: true };
    const { container } = mount();
    const link = container.querySelector('a[href="/dang-nhap"]')!;
    expect(link.className).toContain('min-h-[44px]');
    expect(container.querySelector('[data-testid="triage"]')).toBeNull();
  });

  it('STAFF bị chặn (API chỉ nhận ADMIN): nói rõ, không vẽ bàn duyệt', () => {
    mocks.auth = { user: { role: 'STAFF' }, status: 'authenticated', initialized: true };
    const { container } = mount();
    expect(container.textContent).toContain('Chỉ quản trị viên');
    expect(container.querySelector('[data-testid="triage"]')).toBeNull();
  });

  it('ADMIN: tiêu đề h1, liên kết về trang quản trị cao 44px, vẽ bàn duyệt', () => {
    mocks.auth = { user: { role: 'ADMIN' }, status: 'authenticated', initialized: true };
    const { container } = mount();
    expect(container.querySelector('h1')?.textContent).toBe('Duyệt ảnh WordPress cho sản phẩm');
    expect(container.querySelector('a[href="/admin"]')?.className).toContain('min-h-[44px]');
    expect(container.querySelector('[data-testid="triage"]')).not.toBeNull();
  });
});
