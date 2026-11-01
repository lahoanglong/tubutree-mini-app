// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock('./client-api', () => ({ apiFetch }));
import { coreHttp } from './core-http';
import { armHomeFeed, disarmHomeFeed, resetHomeFeed } from './home-feed';

const pub = { publicConfig: { freeshipThreshold: 5 }, flashActive: [{ id: 'f' }] };
const me = { flashUpcoming: [], forYou: [{ id: 'p' }], activeOrderCount: { count: 1 }, purchasedItems: { items: [], nextCursor: null }, shippingOrders: { data: [] } };
const paths = () => apiFetch.mock.calls.map(([p]) => p as string);

beforeEach(() => {
  disarmHomeFeed();
  apiFetch.mockReset().mockImplementation(async (path: string) => {
    if (path === '/home') return pub;
    if (path.startsWith('/home/me')) return me;
    return 'SINGLE';
  });
});

describe('web home-feed', () => {
  it('chưa arm: mọi request đi lẻ', async () => {
    await expect(coreHttp.get('/flash-sales/active')).resolves.toBe('SINGLE');
    expect(paths()).toEqual(['/flash-sales/active']);
  });

  it('arm: các request lẻ của Trang chủ chỉ tốn /home và /home/me, mỗi khối một lần', async () => {
    armHomeFeed('u1');
    expect(await coreHttp.get('/config/public')).toEqual({ freeshipThreshold: 5 });
    expect(await coreHttp.get('/flash-sales/active')).toEqual([{ id: 'f' }]);
    expect(await coreHttp.get('/products/for-you')).toEqual([{ id: 'p' }]);
    expect(await coreHttp.get('/orders/active-count')).toEqual({ count: 1 });
    expect(await coreHttp.get('/me/purchased-items', { query: { limit: 10 } })).toEqual({ items: [], nextCursor: null });
    expect(await coreHttp.get('/orders', { query: { status: 'SHIPPING', page: 1, limit: 1 } })).toEqual({ data: [] });
    expect(paths()).toEqual(['/home', '/home/me?purchasedLimit=10']);
    // Lần hỏi lại (làm mới nền) đi request lẻ để lấy dữ liệu mới.
    expect(await coreHttp.get('/flash-sales/active')).toBe('SINGLE');
    expect(paths()).toContain('/flash-sales/active');
  });

  it('gợi ý cá nhân kèm seed ngày VN vẫn lấy từ khối gộp, không thêm request lẻ', async () => {
    armHomeFeed('u1');
    expect(await coreHttp.get('/products/for-you', { query: { seed: '20261101' } })).toEqual([{ id: 'p' }]);
    expect(paths()).toEqual(['/home/me?purchasedLimit=10']);
  });

  it('suất sắp mở của khách chưa đăng nhập đi request lẻ: không khởi động /home/me và không khoá định danh rỗng cho lần đăng nhập sau', async () => {
    armHomeFeed(null);
    expect(await coreHttp.get('/flash-sales/upcoming')).toBe('SINGLE');
    expect(paths()).toEqual(['/flash-sales/upcoming']);
    armHomeFeed('u1');
    expect(await coreHttp.get('/products/for-you')).toEqual([{ id: 'p' }]);
    expect(await coreHttp.get('/flash-sales/upcoming')).toEqual([]);
  });

  it('khối gộp thiếu (null) hoặc /home lỗi: lùi về request lẻ', async () => {
    apiFetch.mockImplementation(async (path: string) => {
      if (path === '/home') throw new Error('404');
      return path.startsWith('/home/me') ? { forYou: null } : 'SINGLE';
    });
    armHomeFeed('u1');
    expect(await coreHttp.get('/config/public')).toBe('SINGLE');
    expect(await coreHttp.get('/products/for-you')).toBe('SINGLE');
  });

  it('request khác Trang chủ (danh mục lọc, giỏ, đơn khác) không bị chặn', async () => {
    armHomeFeed('u1');
    expect(await coreHttp.get('/cart')).toBe('SINGLE');
    expect(await coreHttp.get('/orders', { query: { status: 'PENDING_PAYMENT', page: 1, limit: 1 } })).toBe('SINGLE');
    expect(paths()).not.toContain('/home/me?purchasedLimit=10');
  });

  it('kéo để làm mới: reset rồi lấy lại từ request gộp mới', async () => {
    armHomeFeed('u1');
    await coreHttp.get('/products/for-you');
    resetHomeFeed();
    expect(await coreHttp.get('/products/for-you')).toEqual([{ id: 'p' }]);
    expect(paths().filter((p) => p.startsWith('/home/me'))).toHaveLength(2);
  });

  it('đổi tài khoản khi trang còn mở: không trao khối cá nhân của người trước', async () => {
    armHomeFeed('u1');
    await coreHttp.get('/orders/active-count');
    armHomeFeed('u2');
    expect(await coreHttp.get('/products/for-you')).toBe('SINGLE');
  });

  it('tắt: trả về request lẻ', async () => {
    armHomeFeed('u1');
    disarmHomeFeed();
    expect(await coreHttp.get('/config/public')).toBe('SINGLE');
  });
});
