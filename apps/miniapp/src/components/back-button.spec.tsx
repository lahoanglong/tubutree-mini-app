import { act, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), location: { pathname: '/offers', search: '', state: null as unknown } }));
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
    mocks.location = { pathname: '/offers', search: '', state: null };
  });
  it('/offers là trang gốc → không có nút back', () => {
    render(<BackButton />);
    expect(screen.queryByRole('button', { name: 'Quay lại' })).toBeNull();
  });
  it('/orders giờ là trang con → có nút back', () => {
    mocks.location = { pathname: '/orders', search: '', state: null };
    render(<BackButton />);
    expect(screen.getByRole('button', { name: 'Quay lại' })).toBeInTheDocument();
  });
  it('/wallet giờ là trang con → có nút back, dùng token (không rgba thô)', () => {
    mocks.location = { pathname: '/wallet', search: '', state: { from: '/profile' } };
    render(<BackButton />);
    const btn = screen.getByRole('button', { name: 'Quay lại' });
    expect(btn.getAttribute('style')).not.toContain('rgba(');
  });
  it('thanh nền trong suốt ở đỉnh, đặc lên khi .zaui-page cuộn quá 8px', () => {
    mocks.location = { pathname: '/orders', search: '', state: null };
    const { container } = render(<BackButton />);
    const bar = container.querySelector('[data-back-bar]') as HTMLElement;
    expect(bar.dataset.scrolled).toBe('false');
    const page = document.createElement('div');
    page.className = 'zaui-page';
    document.body.appendChild(page);
    Object.defineProperty(page, 'scrollTop', { value: 200, configurable: true });
    act(() => {
      page.dispatchEvent(new Event('scroll'));
    });
    expect(bar.dataset.scrolled).toBe('true');
    page.remove();
  });
  it('cuộn hàng ngang hay sheet bên trong không làm đổi thanh', () => {
    mocks.location = { pathname: '/orders', search: '', state: null };
    const { container } = render(<BackButton />);
    const bar = container.querySelector('[data-back-bar]') as HTMLElement;
    const page = document.createElement('div');
    page.className = 'zaui-page';
    const rail = document.createElement('div');
    page.appendChild(rail);
    document.body.appendChild(page);
    Object.defineProperty(page, 'scrollTop', { value: 200, configurable: true });
    act(() => {
      page.dispatchEvent(new Event('scroll'));
    });
    expect(bar.dataset.scrolled).toBe('true');
    // Vuốt hàng ngang về 0 không được làm thanh trong suốt trở lại.
    Object.defineProperty(rail, 'scrollTop', { value: 0, configurable: true });
    act(() => {
      rail.dispatchEvent(new Event('scroll'));
    });
    expect(bar.dataset.scrolled).toBe('true');
    // Trang ở đỉnh, sheet cuộn xuống không làm thanh đặc.
    Object.defineProperty(page, 'scrollTop', { value: 0, configurable: true });
    act(() => {
      page.dispatchEvent(new Event('scroll'));
    });
    expect(bar.dataset.scrolled).toBe('false');
    Object.defineProperty(rail, 'scrollTop', { value: 300, configurable: true });
    act(() => {
      rail.dispatchEvent(new Event('scroll'));
    });
    expect(bar.dataset.scrolled).toBe('false');
    page.remove();
  });
});
