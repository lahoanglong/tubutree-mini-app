// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, type Rendered } from '@/test-utils/dom';
import PosPage from './page';

const mocks = vi.hoisted(() => ({
  auth: { user: null as { role: string; fullName?: string } | null, status: 'authenticated', initialized: true },
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/components/admin/pos-screen', () => ({ PosScreen: () => <div data-testid="pos-screen" /> }));

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});
const mount = (ui: Parameters<typeof render>[0]) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};

// C-097 (Q-25/Q-29): trang thu ngân dùng token DS v2; liên kết chạm được ở điện thoại.
describe('Trang thu ngân /admin/pos — DS v2', () => {
  it('chưa đăng nhập: liên kết "Đăng nhập" cao 44px, tông forest', () => {
    mocks.auth = { user: null, status: 'unauthenticated', initialized: true };
    const { container } = mount(<PosPage />);
    const link = container.querySelector('a')!;
    expect(link.textContent).toBe('Đăng nhập');
    expect(link.className).toContain('min-h-[44px]');
    expect(link.className).toContain('text-forest-700');
  });

  it('ADMIN: tiêu đề font-display, liên kết sổ tích điểm cao 44px; STAFF không thấy liên kết sổ', () => {
    mocks.auth = { user: { role: 'ADMIN', fullName: 'Thu Hà' }, status: 'authenticated', initialized: true };
    const a = mount(<PosPage />);
    expect(a.container.querySelector('h1')?.className).toContain('font-display');
    const link = a.container.querySelector('a[href="/admin?tab=posCredits"]');
    expect(link?.className).toContain('min-h-[44px]');
    expect(a.container.querySelector('[data-testid="pos-screen"]')).not.toBeNull();

    mocks.auth = { user: { role: 'STAFF', fullName: 'Lê Bình' }, status: 'authenticated', initialized: true };
    const s = mount(<PosPage />);
    expect(s.container.querySelector('a[href="/admin?tab=posCredits"]')).toBeNull();
    expect(s.container.querySelector('[data-testid="pos-screen"]')).not.toBeNull();
  });

  it('vai trò khác: chỉ báo không có quyền, không hiện màn thu ngân', () => {
    mocks.auth = { user: { role: 'CUSTOMER' }, status: 'authenticated', initialized: true };
    const { container } = mount(<PosPage />);
    expect(container.textContent).toMatch(/Chỉ nhân viên/);
    expect(container.querySelector('[data-testid="pos-screen"]')).toBeNull();
  });
});
