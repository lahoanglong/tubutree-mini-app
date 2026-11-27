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
import { ShopTopBar } from './ui/shop-top-bar';

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
  it('nút lùi vẽ trên thanh tên shop dù thanh đứng trước hay sau nó trong DOM (thứ tự vẽ không phụ thuộc thứ tự DOM)', () => {
    mocks.location = { pathname: '/s/lan', search: '', state: null };
    render(
      <>
        <ShopTopBar title="Gian hàng Lan" />
        <BackButton />
      </>,
    );
    const z = (el: HTMLElement) => Number(el.style.zIndex);
    const button = screen.getByRole('button', { name: 'Quay lại' });
    const bar = document.querySelector('[data-back-bar]') as HTMLElement;
    expect(z(button)).toBeGreaterThan(z(screen.getByTestId('shop-top-bar')));
    expect(z(screen.getByTestId('shop-top-bar'))).toBeGreaterThan(z(bar));
  });
});

function setIdx(idx: number) {
  window.history.replaceState({ idx, key: `k${idx}`, usr: null }, '');
}

describe('BackButton: lùi thật, không đẩy chồng (W163)', () => {
  beforeEach(() => {
    mocks.navigate.mockClear();
    setIdx(0);
  });
  it('tab gốc luôn ẩn nút, kể cả khi state còn `from` (bám theo từ trang khác)', () => {
    mocks.location = { pathname: '/profile', search: '', state: { from: '/wallet' } };
    render(<BackButton />);
    expect(screen.queryByRole('button', { name: 'Quay lại' })).toBeNull();
    expect(document.body.classList.contains('with-back-btn')).toBe(false);
  });
  it('Hồ sơ → Ví → Quay lại: navigate(-1), không navigate("/profile") chồng', () => {
    setIdx(2);
    mocks.location = { pathname: '/wallet', search: '', state: { from: '/profile' } };
    render(<BackButton />);
    act(() => screen.getByRole('button', { name: 'Quay lại' }).click());
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith(-1);
  });
  it('mở thẳng Ví (idx 0) có `from`: replace về trang `from`', () => {
    mocks.location = { pathname: '/wallet', search: '', state: { from: '/profile' } };
    render(<BackButton />);
    act(() => screen.getByRole('button', { name: 'Quay lại' }).click());
    expect(mocks.navigate).toHaveBeenCalledWith('/profile', { replace: true });
  });
  it('mở thẳng trang con không có `from` (idx 0): replace về trang chủ', () => {
    mocks.location = { pathname: '/orders', search: '', state: null };
    render(<BackButton />);
    act(() => screen.getByRole('button', { name: 'Quay lại' }).click());
    expect(mocks.navigate).toHaveBeenCalledWith('/', { replace: true });
  });
  it('trang con có lịch sử, không có `from`: navigate(-1)', () => {
    setIdx(1);
    mocks.location = { pathname: '/orders', search: '', state: null };
    render(<BackButton />);
    act(() => screen.getByRole('button', { name: 'Quay lại' }).click());
    expect(mocks.navigate).toHaveBeenCalledWith(-1);
  });
});

describe('BackButton: /points/scan vào bằng PUSH từ trang con (W44)', () => {
  beforeEach(() => {
    mocks.navigate.mockClear();
    setIdx(0);
  });
  it('từ trang sản phẩm (popup Cách tính Điểm Xanh), còn lịch sử: hiện nút, bấm thì lùi thật về trang sản phẩm', () => {
    setIdx(3);
    mocks.location = { pathname: '/points/scan', search: '', state: { from: '/product/dau-goi-buoi' } };
    render(<BackButton />);
    const btn = screen.getByRole('button', { name: 'Quay lại' });
    expect(document.body.classList.contains('with-back-btn')).toBe(true);
    act(() => btn.click());
    expect(mocks.navigate).toHaveBeenCalledWith(-1);
  });
  it('vào bằng thanh đáy (thay trang, không state): ẩn nút', () => {
    setIdx(3);
    mocks.location = { pathname: '/points/scan', search: '', state: null };
    render(<BackButton />);
    expect(screen.queryByRole('button', { name: 'Quay lại' })).toBeNull();
    expect(document.body.classList.contains('with-back-btn')).toBe(false);
  });
  it('state.from là tab gốc khác: ẩn nút (không lùi vòng giữa các tab)', () => {
    setIdx(3);
    mocks.location = { pathname: '/points/scan', search: '', state: { from: '/offers' } };
    render(<BackButton />);
    expect(screen.queryByRole('button', { name: 'Quay lại' })).toBeNull();
  });
  it('mở nguội hay deep link (idx 0) dù có `from`: ẩn nút', () => {
    mocks.location = { pathname: '/points/scan', search: '', state: { from: '/product/dau-goi-buoi' } };
    render(<BackButton />);
    expect(screen.queryByRole('button', { name: 'Quay lại' })).toBeNull();
  });
  it('tab gốc khác có `from` trang con vẫn ẩn nút', () => {
    setIdx(3);
    mocks.location = { pathname: '/offers', search: '', state: { from: '/product/dau-goi-buoi' } };
    render(<BackButton />);
    expect(screen.queryByRole('button', { name: 'Quay lại' })).toBeNull();
  });
});
