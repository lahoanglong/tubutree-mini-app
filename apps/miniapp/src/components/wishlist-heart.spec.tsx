import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, it, expect, vi } from 'vitest';

const login = vi.fn();
const auth = vi.hoisted(() => ({ status: 'anonymous' as 'anonymous' | 'authenticated' }));
const api = vi.hoisted(() => ({ getWishlistIds: vi.fn(), addWishlist: vi.fn(), removeWishlist: vi.fn() }));
vi.mock('../store/auth', () => ({ useAuthStore: () => ({ status: auth.status, login }) }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../services/wishlist-api', () => api);

import { WishlistHeart } from './wishlist-heart';

beforeEach(() => {
  auth.status = 'anonymous';
  login.mockClear();
  api.getWishlistIds.mockReset();
  api.addWishlist.mockReset();
  api.removeWishlist.mockReset();
});

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

describe('WishlistHeart — chạm nhanh nhiều lần (R4-BUYER-8)', () => {
  const defer = () => {
    let resolve!: () => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<{ ok: boolean }>((res, rej) => {
      resolve = () => res({ ok: true });
      reject = rej;
    });
    return { promise, resolve, reject };
  };

  let server: string[];
  function setup(initial: string[]) {
    auth.status = 'authenticated';
    server = [...initial];
    api.getWishlistIds.mockImplementation(async () => [...server]);
    api.addWishlist.mockImplementation(async (id: string) => {
      if (!server.includes(id)) server.push(id);
      return { ok: true };
    });
    api.removeWishlist.mockImplementation(async (id: string) => {
      server = server.filter((x) => x !== id);
      return { ok: true };
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={qc}>
        <WishlistHeart productId="p1" />
      </QueryClientProvider>,
    );
    return { qc, ...view };
  }
  const heart = () => screen.getByRole('button', { name: /yêu thích/ });

  it('chạm đúp lúc chưa thích: thêm rồi bỏ, kết quả cuối là chưa thích, không gửi hai lần "thêm"', async () => {
    setup([]);
    await waitFor(() => expect(api.getWishlistIds).toHaveBeenCalled());
    await screen.findByRole('button', { name: 'Thêm yêu thích' });

    fireEvent.click(heart());
    fireEvent.click(heart());

    await waitFor(() => expect(api.removeWishlist).toHaveBeenCalledTimes(1));
    expect(api.addWishlist).toHaveBeenCalledTimes(1);
    expect(api.addWishlist.mock.invocationCallOrder[0]).toBeLessThan(api.removeWishlist.mock.invocationCallOrder[0]!);
    await waitFor(() => expect(heart()).toHaveAttribute('aria-pressed', 'false'));
    expect(server).toEqual([]);
  });

  it('chạm đúp lúc đã thích: bỏ rồi thêm lại, kết quả cuối vẫn là đã thích', async () => {
    setup(['p1']);
    await screen.findByRole('button', { name: 'Bỏ yêu thích' });

    fireEvent.click(heart());
    fireEvent.click(heart());

    await waitFor(() => expect(api.addWishlist).toHaveBeenCalledTimes(1));
    expect(api.removeWishlist).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(heart()).toHaveAttribute('aria-pressed', 'true'));
    expect(server).toEqual(['p1']);
  });

  it('tim đổi ngay khi chạm (không chờ máy chủ) và các lệnh gửi lần lượt, lệnh sau chờ lệnh trước xong', async () => {
    setup([]);
    await screen.findByRole('button', { name: 'Thêm yêu thích' });
    const first = defer();
    api.addWishlist.mockReturnValueOnce(first.promise);

    fireEvent.click(heart());
    await waitFor(() => expect(heart()).toHaveAttribute('aria-pressed', 'true'));
    expect(api.addWishlist).toHaveBeenCalledTimes(1);
    fireEvent.click(heart());
    await waitFor(() => expect(heart()).toHaveAttribute('aria-pressed', 'false'));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(api.removeWishlist).not.toHaveBeenCalled();

    await act(async () => {
      first.resolve();
    });
    await waitFor(() => expect(api.removeWishlist).toHaveBeenCalledTimes(1));
  });

  it('một lệnh lỗi: tim trở về đúng trạng thái trên máy chủ, không kẹt ở trạng thái lạc quan', async () => {
    const { qc } = setup([]);
    await screen.findByRole('button', { name: 'Thêm yêu thích' });
    api.addWishlist.mockRejectedValueOnce(new Error('500'));

    fireEvent.click(heart());
    expect(qc.getQueryData(['wishlist-ids'])).toEqual(['p1']);

    await waitFor(() => expect(heart()).toHaveAttribute('aria-pressed', 'false'));
    expect(server).toEqual([]);
  });

  it('chạm một lần vẫn như cũ: đúng một lệnh, rồi làm mới danh sách yêu thích', async () => {
    const { qc } = setup([]);
    await screen.findByRole('button', { name: 'Thêm yêu thích' });
    const invalidate = vi.spyOn(qc, 'invalidateQueries');

    fireEvent.click(heart());

    await waitFor(() => expect(api.addWishlist).toHaveBeenCalledTimes(1));
    expect(api.removeWishlist).not.toHaveBeenCalled();
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['wishlist'] }));
    await waitFor(() => expect(heart()).toHaveAttribute('aria-pressed', 'true'));
  });
});
