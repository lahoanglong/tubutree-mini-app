import { describe, it, expect, vi } from 'vitest';

vi.mock('zmp-ui', () => ({
  Box: () => null, Page: () => null, Text: () => null, Button: () => null, Avatar: () => null, Spinner: () => null,
  useNavigate: () => () => undefined, useSnackbar: () => ({ openSnackbar: () => undefined }),
}));
vi.mock('zmp-sdk/apis', () => ({ vibrate: async () => ({}), setStorage: async () => ({}), getStorage: async () => ({}), removeStorage: async () => ({}) }));

import { MENU } from './profile';

describe('Hub Cá nhân (spec 4a.1)', () => {
  const targets = MENU.flatMap((s) => s.items.map((i) => i.to));
  it('bỏ mục đã có ở tab bar: Đơn hàng, Đặt định kỳ', () => {
    expect(targets).not.toContain('/orders');
    expect(targets).not.toContain('/subscriptions');
  });
  it('giữ Ví, Ưu đãi (Điểm Xanh), Yêu thích, Sổ địa chỉ', () => {
    expect(targets).toEqual(expect.arrayContaining(['/wallet', '/loyalty', '/wishlist', '/addresses']));
  });
});
