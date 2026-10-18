import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';

vi.mock('zmp-ui', () => ({
  Box: () => null, Page: () => null, Text: () => null, Button: () => null, Avatar: () => null, Spinner: () => null,
  useNavigate: () => () => undefined, useSnackbar: () => ({ openSnackbar: () => undefined }),
}));
vi.mock('zmp-sdk/apis', () => ({ vibrate: async () => ({}), setStorage: async () => ({}), getStorage: async () => ({}), removeStorage: async () => ({}) }));

import { MENU } from './profile';

describe('Hub Cá nhân (spec 4a.1)', () => {
  const targets = MENU.flatMap((s) => s.items.map((i) => i.to));
  it('mục "Đổi rác lấy quà" thay "Trạm Refill & Đổi vỏ", luôn hiện (§16.1)', () => {
    const items = MENU.flatMap((s) => s.items);
    expect(items.find((i) => i.to === '/recycle')?.label).toBe('Đổi rác lấy quà');
    expect(targets).not.toContain('/refill');
    expect(items.some((i) => /Refill|Đổi vỏ/.test(i.label))).toBe(false);
  });
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
  it('mọi nhãn trong hub không nhắc "sàn ngoài"', () => {
    const labels = MENU.flatMap((s) => s.items.map((i) => `${i.label} ${i.hint ?? ''}`));
    expect(labels.filter((l) => /sàn ngoài|cashback/i.test(l))).toEqual([]);
  });
  it('bật cờ CASHBACK_ENABLED: mục quay lại nhóm "Hợp tác", giữa CTV và đại lý', async () => {
    vi.resetModules();
    vi.doMock('../utils/features', () => ({ CASHBACK_ENABLED: true }));
    try {
      const { MENU: enabled } = await import('./profile');
      const coop = enabled.find((s) => s.group === 'Hợp tác');
      expect(coop?.items.map((i) => i.to)).toEqual(['/affiliate', '/cashback', '/dealer']);
    } finally {
      vi.doUnmock('../utils/features');
      vi.resetModules();
    }
  });
});

describe('Lối vào Cộng đồng nói về hàng đang bán (C-073)', () => {
  it('mô tả không còn "chăm cây / khoe vườn"', () => {
    const entry = MENU.flatMap((s) => s.items).find((i) => i.to === '/feed');
    expect(entry?.hint).toBeTruthy();
    expect(entry?.hint).not.toMatch(/chăm cây|khoe vườn|cây cảnh/i);
  });
});

describe('Gợi ý mua chung không hứa sai mức giảm (ENGAGE-20)', () => {
  it('mục Mua chung nhóm không chép cứng con số phần trăm (mức thật do groupbuy.discount_pct quyết định)', () => {
    const item = MENU.flatMap((s) => s.items).find((i) => i.to === '/group-buy');
    expect(item?.hint).toBeTruthy();
    expect(item?.hint).not.toMatch(/\d/);
  });
});

describe('lối vào Đổi rác không thêm lệnh gọi mạng (§16.1)', () => {
  const SRC = join(process.cwd(), 'src');
  it.each(['pages/home.tsx', 'pages/game.tsx', 'pages/profile.tsx', 'pages/loyalty.tsx'])('%s không gọi waste-api', (f) => {
    expect(readFileSync(join(SRC, f), 'utf8')).not.toMatch(/waste-api|useWasteMe/);
  });
});
