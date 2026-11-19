import { describe, expect, it, vi } from 'vitest';
import { getGreenCard, greenCardRewardLine, greenCardStats, parseGreenCard, referralViralOn, type GreenCard } from './green-card';

const card = (over: Partial<GreenCard> = {}): GreenCard => ({
  referralCode: 'TUBU123',
  album: { seen: 12, total: 40 },
  wasteItems: 7,
  firstOrderReward: { points: 100, minOrderAmount: 199_000 },
  earnsPoints: true,
  ...over,
});

describe('parseGreenCard', () => {
  it('nhận đúng dạng, bỏ trường lạ', () => {
    expect(parseGreenCard({ ...card(), extra: 1 })).toEqual(card());
    expect(parseGreenCard({ ...card(), album: null })).toEqual(card({ album: null }));
  });

  it.each([
    ['mã mời lạ', { referralCode: 'a b/../' }],
    ['số âm', { wasteItems: -1 }],
    ['thiếu thưởng', { firstOrderReward: undefined }],
    ['album sai', { album: { seen: '1', total: 2 } }],
    ['earnsPoints thiếu', { earnsPoints: undefined }],
  ])('ném khi %s', (_n, over) => {
    expect(() => parseGreenCard({ ...card(), ...over })).toThrow();
  });

  it('getGreenCard đọc /me/green-card', async () => {
    const http = { get: vi.fn(async () => card()) };
    expect(await getGreenCard(http as never)).toEqual(card());
    expect(http.get).toHaveBeenCalledWith('/me/green-card');
  });
});

describe('chữ của thẻ', () => {
  it('dòng số: thẻ đã mở và vỏ đã đổi; Sổ tay tắt thì chỉ còn vỏ', () => {
    expect(greenCardStats(card())).toBe('12 thẻ xanh đã mở · 7 vỏ đã đổi');
    expect(greenCardStats(card({ album: null, wasteItems: 0 }))).toBe('0 vỏ đã đổi');
  });

  it('thưởng đơn đầu cho cả hai bên, đúng số máy chủ trả', () => {
    expect(greenCardRewardLine(card())).toBe('Bạn bè mua đơn đầu từ 199k, cả hai nhận +100 Điểm Xanh');
    expect(greenCardRewardLine(card({ firstOrderReward: { points: 5000, minOrderAmount: 0 } }))).toBe('Bạn bè mua đơn đầu, cả hai nhận +5.000 Điểm Xanh');
  });

  it('CTV hoặc thưởng 0: không hứa Điểm Xanh', () => {
    expect(greenCardRewardLine(card({ earnsPoints: false }))).toBe('Gửi link mời để bạn bè sống xanh cùng bạn');
    expect(greenCardRewardLine(card({ firstOrderReward: { points: 0, minOrderAmount: 199_000 } }))).toBe('Gửi link mời để bạn bè sống xanh cùng bạn');
  });

  it('cờ chỉ bật với boolean true', () => {
    expect(referralViralOn({ referralViralEnabled: true })).toBe(true);
    expect(referralViralOn({ referralViralEnabled: 'true' })).toBe(false);
    expect(referralViralOn(undefined)).toBe(false);
  });
});
