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

describe('Hub Cá nhân gọn lại (C-086, Q-15)', () => {
  const targets = MENU.flatMap((s) => s.items.map((i) => i.to));
  it('bỏ "Hoàn tiền sàn ngoài" khỏi hub', () => {
    expect(targets).not.toContain('/cashback');
  });
  it('CTV và đại lý gom vào nhóm "Hợp tác", không chen giữa nhóm mua sắm', () => {
    const coop = MENU.find((s) => s.group === 'Hợp tác');
    expect(coop?.items.map((i) => i.to)).toEqual(['/affiliate', '/dealer']);
    const others = MENU.filter((s) => s.group !== 'Hợp tác').flatMap((s) => s.items.map((i) => i.to));
    expect(others).not.toContain('/affiliate');
    expect(others).not.toContain('/dealer');
  });
  it('không còn trùng đích trong menu', () => {
    expect(new Set(targets).size).toBe(targets.length);
  });
});

describe('Lối vào Cộng đồng nói về hàng đang bán (C-073)', () => {
  it('mô tả không còn "chăm cây / khoe vườn"', () => {
    const entry = MENU.flatMap((s) => s.items).find((i) => i.to === '/feed');
    expect(entry?.hint).toBeTruthy();
    expect(entry?.hint).not.toMatch(/chăm cây|khoe vườn|cây cảnh/i);
  });
});
