import { describe, expect, it } from 'vitest';
import { inviteShareOffer, inviteShareStats } from './share-card';

const card = (points: number, minOrderAmount: number, earnsPoints = true) => ({ firstOrderReward: { points, minOrderAmount }, earnsPoints });

describe('inviteShareOffer', () => {
  it('đọc đúng số máy chủ trả: +100 Điểm Xanh, đơn đầu từ 199.000đ', () => {
    expect(inviteShareOffer(card(100, 199_000))).toEqual({
      title: 'Tặng bạn trải nghiệm thuần khiết',
      line: 'Nhận +100 Điểm Xanh khi bạn đặt đơn đầu từ 199.000đ',
      message: 'Tặng bạn trải nghiệm thuần khiết — nhận +100 Điểm Xanh khi bạn đặt đơn đầu từ 199.000đ',
    });
  });

  it('Admin đổi số thì chữ đổi theo (không ghi cứng 100 / 199.000đ); số lớn có dấu chấm', () => {
    const o = inviteShareOffer(card(5_000, 250_000))!;
    expect(o.line).toBe('Nhận +5.000 Điểm Xanh khi bạn đặt đơn đầu từ 250.000đ');
    expect(o.message).toContain('+5.000 Điểm Xanh');
  });

  it('đơn tối thiểu 0: câu không nêu mốc', () => {
    expect(inviteShareOffer(card(100, 0))!.line).toBe('Nhận +100 Điểm Xanh khi bạn đặt đơn đầu');
  });

  it('không hứa thưởng mà máy chủ sẽ không trả: CTV / chạm trần tháng (earnsPoints false), thưởng 0, chưa có thẻ', () => {
    expect(inviteShareOffer(card(100, 199_000, false))).toBeNull();
    expect(inviteShareOffer(card(0, 199_000))).toBeNull();
    expect(inviteShareOffer(null)).toBeNull();
    expect(inviteShareOffer(undefined)).toBeNull();
  });
});

describe('inviteShareStats', () => {
  it('hai ô số: bạn bè đã mời và Điểm Xanh đã nhận (số có dấu chấm)', () => {
    expect(inviteShareStats({ invitedCount: 12, successCount: 3, earnedPoints: 5_000 }, true)).toEqual([
      { key: 'friends', value: '12', label: 'Bạn bè đã mời' },
      { key: 'points', value: '5.000', label: 'Điểm Xanh đã nhận' },
    ]);
  });

  it('API cũ chưa có invitedCount: đếm bạn mời thành công', () => {
    expect(inviteShareStats({ successCount: 3, earnedPoints: 0 }, true)[0]).toEqual({ key: 'friends', value: '3', label: 'Bạn mời thành công' });
  });

  it('CTV không nhận Điểm Xanh giới thiệu: chỉ ô bạn bè', () => {
    expect(inviteShareStats({ invitedCount: 2, earnedPoints: 900 }, false).map((s) => s.key)).toEqual(['friends']);
  });

  it('chưa mời ai (mọi số bằng 0): không có ô, khối mời không khoe hàng số 0', () => {
    expect(inviteShareStats({ invitedCount: 0, successCount: 0, earnedPoints: 0 }, true)).toEqual([]);
    expect(inviteShareStats({ invitedCount: 1, earnedPoints: 0 }, true).map((s) => s.value)).toEqual(['1', '0']);
  });

  it('chưa tải hay số hỏng: không có ô (không vẽ 0 giả)', () => {
    expect(inviteShareStats(undefined, true)).toEqual([]);
    expect(inviteShareStats({ invitedCount: -1, successCount: 'x', earnedPoints: 1.5 }, true)).toEqual([]);
  });
});
