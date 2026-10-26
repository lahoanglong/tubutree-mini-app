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
});

describe('BackButton — ẩn khi cuộn xuống để không đè nội dung', () => {
  const scrollTo = (el: HTMLElement, top: number) => {
    Object.defineProperty(el, 'scrollTop', { configurable: true, value: top });
    act(() => {
      el.dispatchEvent(new Event('scroll'));
    });
  };

  it('cuộn xuống thì ẩn (không bấm được), cuộn lên thì hiện lại', () => {
    mocks.location = { pathname: '/wallet', search: '', state: { from: '/profile' } };
    const scroller = document.createElement('div');
    document.body.appendChild(scroller);
    render(<BackButton />);
    const btn = screen.getByRole('button', { name: 'Quay lại' });
    scrollTo(scroller, 0);
    expect(btn.style.opacity).toBe('1');
    scrollTo(scroller, 300);
    expect(btn.style.opacity).toBe('0');
    expect(btn.style.pointerEvents).toBe('none');
    scrollTo(scroller, 250);
    expect(btn.style.opacity).toBe('1');
    expect(btn.style.pointerEvents).toBe('auto');
    scroller.remove();
  });

  it('cuộn ngang (scrollTop không đổi) không làm nút ẩn', () => {
    mocks.location = { pathname: '/wallet', search: '', state: { from: '/profile' } };
    const scroller = document.createElement('div');
    document.body.appendChild(scroller);
    render(<BackButton />);
    const btn = screen.getByRole('button', { name: 'Quay lại' });
    scrollTo(scroller, 300);
    scrollTo(scroller, 250);
    scrollTo(scroller, 250);
    expect(btn.style.opacity).toBe('1');
    scroller.remove();
  });
});
