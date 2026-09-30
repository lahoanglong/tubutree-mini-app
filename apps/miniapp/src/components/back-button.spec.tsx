import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), location: { pathname: '/orders', search: '', state: null as unknown } }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => mocks.navigate,
  useLocation: () => mocks.location,
}));
vi.mock('../store/storefront-context', () => ({
  useStorefrontContext: (sel: (s: { slug: null; kind: null }) => unknown) => sel({ slug: null, kind: null }),
}));

import BackButton from './back-button';

describe('BackButton — ROOTS từ nav-config', () => {
  beforeEach(() => {
    mocks.location = { pathname: '/orders', search: '', state: null };
  });
  it('/orders là trang gốc → không có nút back', () => {
    render(<BackButton />);
    expect(screen.queryByRole('button', { name: 'Quay lại' })).toBeNull();
  });
  it('/wallet giờ là trang con → có nút back, dùng token (không rgba thô)', () => {
    mocks.location = { pathname: '/wallet', search: '', state: { from: '/profile' } };
    render(<BackButton />);
    const btn = screen.getByRole('button', { name: 'Quay lại' });
    expect(btn.getAttribute('style')).not.toContain('rgba(');
  });
});
