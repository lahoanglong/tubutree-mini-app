import { describe, expect, it } from 'vitest';
import { inviteBody, inviteFriendGiftLine, inviteLink, inviteRewardLine, inviteShareText } from './invite-card';
import { FORBIDDEN_TERMS } from '../shop-copy';

const PROD = { amount: 30_000, minOrder: 199_000 };
const RULES = { referrerPoints: 5_000, minOrderAmount: 200_000, windowDays: 30 };

describe('inviteFriendGiftLine', () => {
  it('nêu mã 30.000đ cho bạn mới theo số của máy chủ', () => {
    expect(inviteFriendGiftLine(PROD)).toBe('Bạn mới nhận mã 30.000đ cho đơn đầu từ 199k.');
  });
  it('không đơn tối thiểu, hoặc chưa có số', () => {
    expect(inviteFriendGiftLine({ amount: 30_000, minOrder: 0 })).toBe('Bạn mới nhận mã 30.000đ cho đơn đầu.');
    expect(inviteFriendGiftLine(null)).toBe('Bạn mới nhận mã giảm giá cho đơn đầu.');
  });
});

describe('inviteRewardLine', () => {
  it('nêu 5.000 Điểm Xanh, đơn thứ hai và hạn khi máy chủ trả đủ số', () => {
    expect(inviteRewardLine(RULES, true)).toBe('Bạn nhận 5.000 Điểm Xanh khi bạn ấy hoàn tất đơn thứ hai từ 200k trong 30 ngày.');
  });
  it('thiếu đơn tối thiểu hoặc hạn thì bỏ vế điều kiện nhưng vẫn nêu điểm', () => {
    expect(inviteRewardLine({ referrerPoints: 5_000 }, true)).toBe('Bạn nhận 5.000 Điểm Xanh khi bạn ấy hoàn tất đơn thứ hai.');
    expect(inviteRewardLine({ referrerPoints: 5_000, windowDays: 30 }, true)).toBe('Bạn nhận 5.000 Điểm Xanh khi bạn ấy hoàn tất đơn thứ hai.');
  });
  it('API cũ chưa trả điểm thì nói chung, không hứa con số', () => {
    for (const r of [null, undefined, {}, { referrerPoints: null }, { referrerPoints: 0 }]) {
      const text = inviteRewardLine(r, true);
      expect(text).toBe('Bạn nhận Điểm Xanh khi bạn ấy hoàn tất đơn thứ hai.');
      expect(text).not.toMatch(/\d/);
    }
  });
  it('CTV không nhận Điểm Xanh giới thiệu: không hứa thưởng', () => {
    expect(inviteRewardLine(RULES, false)).toBe('');
  });
});

describe('inviteBody', () => {
  it('ghép quà bạn mới và thưởng người mời', () => {
    expect(inviteBody(PROD, RULES, true)).toBe('Bạn mới nhận mã 30.000đ cho đơn đầu từ 199k. Bạn nhận 5.000 Điểm Xanh khi bạn ấy hoàn tất đơn thứ hai từ 200k trong 30 ngày.');
  });
  it('CTV chỉ còn quà bạn mới', () => {
    expect(inviteBody(PROD, RULES, false)).toBe('Bạn mới nhận mã 30.000đ cho đơn đầu từ 199k.');
  });
  it('không dính thuật ngữ cấm', () => {
    for (const t of [inviteBody(PROD, RULES, true), inviteBody(null, null, true), inviteShareText('https://x.test/?ref=A')]) {
      expect(FORBIDDEN_TERMS.filter((f) => f.pattern.test(t)).map((f) => f.use)).toEqual([]);
    }
  });
});

describe('inviteLink', () => {
  it('gắn ?ref= của chính khách vào trang chủ, bỏ dấu / thừa ở gốc', () => {
    expect(inviteLink('https://zalo.me/s/123/', 'TUBU2A9')).toBe('https://zalo.me/s/123/?ref=TUBU2A9');
    expect(inviteLink('https://tubutree.com', 'ab_c-1')).toBe('https://tubutree.com/?ref=ab_c-1');
  });
  it('mã sai khuôn thì link trơn, không đưa chuỗi lạ vào URL', () => {
    expect(inviteLink('https://tubutree.com', 'a b&x=1')).toBe('https://tubutree.com/');
    expect(inviteLink('https://tubutree.com', '')).toBe('https://tubutree.com/');
  });
});

describe('inviteShareText', () => {
  it('lời chia sẻ có link', () => {
    expect(inviteShareText('https://tubutree.com/?ref=A1')).toContain('https://tubutree.com/?ref=A1');
  });
});
