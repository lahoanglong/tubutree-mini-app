import { describe, expect, it } from 'vitest';
import {
  inviteBody,
  inviteFriendGiftLine,
  inviteLandingLink,
  inviteLandingOn,
  inviteLandingTarget,
  inviteLink,
  inviteProgressLine,
  inviteRewardLine,
  inviteShareLink,
  inviteShareText,
} from './invite-card';
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
    for (const r of [null, undefined, {}, { referrerPoints: null }, { referrerPoints: 2.5 }, { referrerPoints: Number.NaN }]) {
      const text = inviteRewardLine(r, true);
      expect(text).toBe('Bạn nhận Điểm Xanh khi bạn ấy hoàn tất đơn thứ hai.');
      expect(text).not.toMatch(/\d/);
    }
  });
  it('Admin tắt thưởng (máy chủ trả 0): không hứa Điểm Xanh, khối chỉ còn quà bạn mới', () => {
    expect(inviteRewardLine({ referrerPoints: 0, minOrderAmount: 200_000, windowDays: 30 }, true)).toBe('');
    expect(inviteRewardLine({ referrerPoints: -1 }, true)).toBe('');
    expect(inviteBody(PROD, { referrerPoints: 0 }, true)).toBe('Bạn mới nhận mã 30.000đ cho đơn đầu từ 199k.');
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

describe('trang đích link mời và tiến độ (cờ referral.share_card_enabled)', () => {
  it('cờ chỉ bật khi cấu hình công khai có boolean true thật', () => {
    expect(inviteLandingOn({ referralShareCardEnabled: true })).toBe(true);
    for (const off of [{ referralShareCardEnabled: false }, { referralShareCardEnabled: 'true' }, { referralShareCardEnabled: 1 }, {}, null, undefined, 'x']) {
      expect(inviteLandingOn(off)).toBe(false);
    }
  });

  it('link trang đích /moi/<mã>; mã sai khuôn thì trang chủ trơn', () => {
    expect(inviteLandingLink('ABC123')).toBe('https://tubutree.com/moi/ABC123');
    expect(inviteLandingLink('ABC123', 'http://localhost:3000/')).toBe('http://localhost:3000/moi/ABC123');
    expect(inviteLandingLink('a b<script>')).toBe('https://tubutree.com/');
    expect(inviteLandingLink('')).toBe('https://tubutree.com/');
  });

  it('cờ tắt giữ link cũ, cờ bật đổi sang trang đích', () => {
    expect(inviteShareLink({ landing: false, baseUrl: 'https://zalo.me/s/123', referralCode: 'ABC123' })).toBe('https://zalo.me/s/123/?ref=ABC123');
    expect(inviteShareLink({ landing: true, baseUrl: 'https://zalo.me/s/123', referralCode: 'ABC123' })).toBe('https://tubutree.com/moi/ABC123');
  });

  it('nút Bắt đầu mua sắm về Trang chủ kèm ?ref= (ghi nhận lượt giới thiệu như link cũ); mã sai khuôn thì không kèm', () => {
    expect(inviteLandingTarget('ABC123')).toBe('/?ref=ABC123');
    expect(inviteLandingTarget('../x')).toBe('/');
  });

  it('tiến độ: chỉ số đếm; CTV không thấy phần điểm; API cũ thiếu số thì không có dòng', () => {
    const r = { invitedCount: 4, firstOrderCount: 2, successCount: 1, earnedPoints: 5000 };
    expect(inviteProgressLine(r, true)).toBe('4 bạn đã nhận mã · 2 bạn đã mua đơn đầu · 1 bạn đã đủ điều kiện, bạn nhận 5.000 Điểm Xanh');
    expect(inviteProgressLine(r, false)).toBe('4 bạn đã nhận mã · 2 bạn đã mua đơn đầu');
    expect(inviteProgressLine({ successCount: 1, earnedPoints: 5000 }, true)).toBeNull();
    expect(inviteProgressLine({ ...r, invitedCount: -1 }, true)).toBeNull();
    expect(inviteProgressLine(null, true)).toBeNull();
  });

  it('chữ trang đích và tiến độ không dùng thuật ngữ cấm', () => {
    const texts = [inviteProgressLine({ invitedCount: 1, firstOrderCount: 1, successCount: 1, earnedPoints: 1 }, true)!];
    for (const t of texts) expect(FORBIDDEN_TERMS.filter((f) => f.pattern.test(t))).toEqual([]);
  });
});
