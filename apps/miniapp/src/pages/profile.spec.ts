import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';

vi.mock('zmp-ui', () => ({
  Box: () => null, Page: () => null, Text: () => null, Button: () => null, Avatar: () => null, Spinner: () => null,
  useNavigate: () => () => undefined, useSnackbar: () => ({ openSnackbar: () => undefined }),
}));
vi.mock('zmp-sdk/apis', () => ({ vibrate: async () => ({}), setStorage: async () => ({}), getStorage: async () => ({}), removeStorage: async () => ({}) }));

import { MENU } from './profile';

describe('Hub Cá nhân gọn (KP mục 3, phương án A)', () => {
  const targets = MENU.flatMap((s) => s.items.map((i) => i.to));
  it('ba nhóm: Kiếm tiền cùng Tubu, Tài khoản, Hỗ trợ', () => {
    expect(MENU.map((s) => s.group)).toEqual(['Kiếm tiền cùng Tubu', 'Tài khoản', 'Hỗ trợ']);
  });
  it('"Kiếm tiền cùng Tubu" gom CTV, Học viện, Đại lý', () => {
    const earn = MENU.find((s) => s.group === 'Kiếm tiền cùng Tubu');
    expect(earn?.items.map((i) => i.to)).toEqual(['/affiliate', '/academy', '/dealer']);
  });
  it('đã chuyển sang tab Ưu đãi / dải trạng thái đơn / Trang chủ: không còn Đơn hàng, Đặt định kỳ, Ví, Điểm Xanh, Đổi rác, Mua chung, Tích điểm đơn sàn, Cộng đồng trong menu', () => {
    for (const t of ['/orders', '/subscriptions', '/wallet', '/loyalty', '/recycle', '/group-buy', '/points/scan', '/cashback', '/feed']) {
      expect(targets).not.toContain(t);
    }
  });
  it('giữ Yêu thích, Sổ địa chỉ, Thông báo, Cài đặt, Chat, Về Tubu Tree', () => {
    expect(targets).toEqual(expect.arrayContaining(['/wishlist', '/addresses', '/notifications', '/settings', '/chat', '/about']));
  });
  it('không còn trùng đích trong menu', () => {
    expect(new Set(targets).size).toBe(targets.length);
  });
  it('mọi nhãn trong hub không nhắc "sàn ngoài"', () => {
    const labels = MENU.flatMap((s) => s.items.map((i) => `${i.label} ${i.hint ?? ''}`));
    expect(labels.filter((l) => /sàn ngoài|cashback/i.test(l))).toEqual([]);
  });
});

describe('lối vào Đổi rác không thêm lệnh gọi mạng (§16.1)', () => {
  const SRC = join(process.cwd(), 'src');
  it.each(['pages/home.tsx', 'pages/game.tsx', 'pages/profile.tsx', 'pages/loyalty.tsx'])('%s không gọi waste-api', (f) => {
    expect(readFileSync(join(SRC, f), 'utf8')).not.toMatch(/waste-api|useWasteMe/);
  });
});
