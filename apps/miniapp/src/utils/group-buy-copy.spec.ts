import { describe, expect, it } from 'vitest';
import { GROUP_BUY_MENU_HINT, groupBuyPitch } from './group-buy-copy';

// ENGAGE-20 / BUYERMINI-20: menu hứa "Tiết kiệm đến 30%" trong khi mua chung thật là mã giảm 15% (groupbuy.discount_pct)
// chỉ phát sau khi đủ người.
describe('copy mua chung', () => {
  it('có cấu hình từ server → nêu đúng số người và % giảm, nói rõ là mã giảm sau khi đủ nhóm', () => {
    expect(groupBuyPitch({ discountPct: 15, targetSize: 3 })).toBe('Rủ đủ 3 người, mỗi người nhận mã giảm 15% khi nhóm đủ');
    expect(groupBuyPitch({ discountPct: 20, targetSize: 5 })).toBe('Rủ đủ 5 người, mỗi người nhận mã giảm 20% khi nhóm đủ');
  });

  it('chưa có cấu hình (đang tải / API cũ) → không hứa con số nào', () => {
    for (const cfg of [undefined, null]) {
      const copy = groupBuyPitch(cfg);
      expect(copy).toBe('Rủ bạn bè cho đủ nhóm, mỗi người nhận mã giảm giá');
      expect(copy).not.toMatch(/\d/);
    }
  });

  it('cấu hình hỏng (không phải số dương) → rơi về câu không số', () => {
    expect(groupBuyPitch({ discountPct: 0, targetSize: 3 })).not.toMatch(/\d/);
    expect(groupBuyPitch({ discountPct: Number.NaN, targetSize: 3 })).not.toMatch(/\d/);
  });

  it('gợi ý ở menu Cá nhân không chép cứng con số', () => {
    expect(GROUP_BUY_MENU_HINT).not.toMatch(/\d/);
  });
});
