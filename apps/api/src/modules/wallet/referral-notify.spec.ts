import { maskFriendName, revokeDetail, sendReferralNotices, type ReferralNotice } from './referral-notify';

function ctx(fullName: string | null = 'Nguyễn Văn An', notify = jest.fn().mockResolvedValue(undefined)) {
  const findUnique = jest.fn().mockResolvedValue({ fullName });
  const warn = jest.fn();
  return { c: { prisma: { user: { findUnique } } as never, notifications: { notify }, logger: { warn } }, notify, findUnique, warn };
}

describe('maskFriendName', () => {
  it.each([
    ['Nguyễn Văn An', 'An'],
    ['  Trần   Thị Bích  ', 'Bích'],
    ['Khách', 'bạn bè'],
    [null, 'bạn bè'],
    ['', 'bạn bè'],
    ['0912345678', 'bạn bè'],
    ['Lan 0912345678', 'bạn bè'],
    ['lan@example.com', 'bạn bè'],
  ])('%p → %p', (name, out) => expect(maskFriendName(name)).toBe(out));
});

describe('revokeDetail', () => {
  it('nêu đúng số đã trừ và số còn thiếu', () => {
    expect(revokeDetail(3, 0)).toBe('đã trừ 3 Điểm Xanh');
    expect(revokeDetail(3, 2)).toContain('đã trừ 3 Điểm Xanh; số dư không đủ nên còn thiếu 2 điểm');
    expect(revokeDetail(0, 5)).toContain('chưa trừ được, còn thiếu 5 điểm');
  });
});

describe('sendReferralNotices', () => {
  const paid: ReferralNotice = { kind: 'PAID', referrerId: 'R', refereeId: 'X', points: 100, key: 'REFERRAL_ORDER2:X' };

  it('PAID: gửi người mời, chỉ tên gọi của người được mời, khoá chống trùng đã băm (không mang id người được mời)', async () => {
    const { c, notify } = ctx();
    await sendReferralNotices(c, [paid]);
    expect(notify).toHaveBeenCalledTimes(1);
    const [userId, code, data, opts] = notify.mock.calls[0];
    expect([userId, code]).toEqual(['R', 'REFERRAL_REWARD_PAID']);
    expect(data).toEqual({ points: '100', friend: 'An' });
    expect(opts.dedupeKey).toMatch(/^referral:[0-9a-f]{32}$/);
    expect(JSON.stringify([data, opts])).not.toContain('X');
  });

  it('cùng dòng sổ cho cùng khoá chống trùng', async () => {
    const { c, notify } = ctx();
    await sendReferralNotices(c, [paid, { ...paid }]);
    expect(notify.mock.calls[0][3]).toEqual(notify.mock.calls[1][3]);
  });

  it('REVOKED: số đã trừ, số nợ và nguyên nhân', async () => {
    const { c, notify } = ctx();
    await sendReferralNotices(c, [{ kind: 'REVOKED', referrerId: 'T', refereeId: 'X', taken: 33, debt: 7, cause: 'PARTIAL_RETURN', key: 'k' }]);
    const [userId, code, data] = notify.mock.calls[0];
    expect([userId, code]).toEqual(['T', 'REFERRAL_REWARD_REVOKED']);
    expect(data).toMatchObject({ friend: 'An', points: '33', debt: '7', cause: 'một phần đơn hàng của bạn ấy đã được trả lại' });
  });

  it('MILESTONE: số lượt và số điểm', async () => {
    const { c, notify, findUnique } = ctx();
    await sendReferralNotices(c, [{ kind: 'MILESTONE', referrerId: 'R', count: 3, points: 20, key: 'REFERRAL_MILESTONE:R:3' }]);
    expect(notify.mock.calls[0].slice(0, 3)).toEqual(['R', 'REFERRAL_MILESTONE_PAID', { points: '20', count: '3' }]);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('không báo khi 0 điểm hoặc thu hồi không trừ/không nợ gì', async () => {
    const { c, notify } = ctx();
    await sendReferralNotices(c, [
      { ...paid, points: 0 },
      { kind: 'REVOKED', referrerId: 'R', refereeId: 'X', taken: 0, debt: 0, cause: 'RETURN', key: 'k' },
      { kind: 'MILESTONE', referrerId: 'R', count: 3, points: 0, key: 'm' },
    ]);
    expect(notify).not.toHaveBeenCalled();
  });

  it('gửi lỗi chỉ ghi cảnh báo, không ném, tin sau vẫn gửi', async () => {
    const notify = jest.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValue(undefined);
    const { c, warn } = ctx('An', notify);
    await expect(sendReferralNotices(c, [paid, { ...paid, key: 'other' }])).resolves.toBeUndefined();
    expect(notify).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('thiếu NotificationsService thì bỏ qua', async () => {
    const { c } = ctx();
    await expect(sendReferralNotices({ ...c, notifications: undefined }, [paid])).resolves.toBeUndefined();
  });
});
