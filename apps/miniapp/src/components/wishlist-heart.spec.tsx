import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';

const login = vi.fn();
vi.mock('../store/auth', () => ({ useAuthStore: () => ({ status: 'anonymous', login }) }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../services/wishlist-api', () => ({ getWishlistIds: vi.fn(), addWishlist: vi.fn(), removeWishlist: vi.fn() }));

import { WishlistHeart } from './wishlist-heart';

function renderHeart(parentClick: () => void, floating = true) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <div onClick={parentClick}>
        <WishlistHeart productId="p1" floating={floating} />
      </div>
    </QueryClientProvider>,
  );
}

describe('WishlistHeart', () => {
  it('có tên truy cập và vùng chạm tối thiểu 44x44 kể cả khi nổi trên ảnh thẻ', () => {
    renderHeart(() => {});
    const btn = screen.getByRole('button', { name: 'Thêm yêu thích' });
    expect(btn.style.width).toBe('44px');
    expect(btn.style.height).toBe('44px');
  });

  it('chạm tim không nổi bọt lên thẻ cha (không mở trang sản phẩm)', () => {
    const parentClick = vi.fn();
    renderHeart(parentClick);
    fireEvent.click(screen.getByRole('button', { name: 'Thêm yêu thích' }));
    expect(parentClick).not.toHaveBeenCalled();
    expect(login).toHaveBeenCalledTimes(1);
  });
});
