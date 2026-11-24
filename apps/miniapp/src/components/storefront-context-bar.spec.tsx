import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/s/lan', search: '', hash: '', state: null, key: 'default' }),
}));

import { StorefrontContextBar } from './storefront-context-bar';
import { useStorefrontContext } from '../store/storefront-context';
import { viStorefront } from '../i18n/vi-storefront';

describe('StorefrontContextBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStorefrontContext.getState().clear();
  });

  it('không ở trong gian hàng thì không vẽ gì', () => {
    const { container } = render(<StorefrontContextBar />);
    expect(container).toBeEmptyDOMElement();
  });

  it('ở trong gian hàng: hiện nhãn ngữ cảnh và nút về Tubu Tree', () => {
    useStorefrontContext.getState().setContext({ slug: 'an-lanh', referralCode: 'CTV1' });
    render(<StorefrontContextBar />);
    expect(screen.getByText('Đang xem gian hàng')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: viStorefront.backToTubu })).toBeInTheDocument();
  });

  it('bấm "Về Tubu Tree": xoá ngữ cảnh gian hàng rồi về trang chủ', () => {
    useStorefrontContext.getState().setContext({ slug: 'an-lanh', referralCode: 'CTV1' });
    render(<StorefrontContextBar />);
    fireEvent.click(screen.getByRole('button', { name: viStorefront.backToTubu }));
    expect(useStorefrontContext.getState().slug).toBeNull();
    expect(mocks.navigate).toHaveBeenCalledWith('/');
  });

  it('nút về Tubu Tree cao >= 44px (vùng chạm)', () => {
    useStorefrontContext.getState().setContext({ slug: 'an-lanh' });
    render(<StorefrontContextBar />);
    const btn = screen.getByRole('button', { name: viStorefront.backToTubu });
    expect(parseFloat(btn.style.minHeight)).toBeGreaterThanOrEqual(44);
  });
});
