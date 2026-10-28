import { describe, expect, it } from 'vitest';
import { CTV_TAB_KEYS, ctvHeadline, hasFirstOrder, isAutoWalletTransfer, nextMilestoneRows, transferBlockedText, transferHeroNote } from './ctv-dashboard';

const ZERO = { monthCommission: 0, pendingCommission: 0, withdrawableCommission: 0, totalConversions: 0 };

describe('CTV_TAB_KEYS', () => {
  it('ba tab theo thứ tự Tổng quan, Hoa hồng, Chia sẻ', () => {
    expect(CTV_TAB_KEYS).toEqual(['overview', 'commission', 'share']);
  });
});

describe('ctvHeadline', () => {
  it('số to là số có thể chuyển vào Ví, hoa hồng đang chờ là dòng phụ, không cộng vào số to', () => {
    const h = ctvHeadline({ ...ZERO, monthCommission: 9520, pendingCommission: 9520 });
    expect(h.big).toBe(0);
    expect(h.pending).toBe(9520);
    expect(h.monthEstimate).toBe(9520);
  });
  it('có tiền đã duyệt thì số to là số đó', () => {
    expect(ctvHeadline({ ...ZERO, withdrawableCommission: 120000 }).big).toBe(120000);
  });
  it('chưa có dữ liệu (đang tải) thì toàn 0', () => {
    expect(ctvHeadline(undefined)).toEqual({ big: 0, pending: 0, monthEstimate: 0 });
  });
});

describe('transferBlockedText', () => {
  it('tự chuyển bật (mặc định): nói hoa hồng tự vào Ví khi nào, kèm số đang chờ', () => {
    expect(transferBlockedText('9.520đ')).toBe('Hoa hồng tự vào Ví Tubu khi đơn đã giao và hết thời gian đổi/trả. Đang chờ: 9.520đ.');
  });
  it('tự chuyển tắt: không hứa tự vào Ví, chỉ nói khi nào chuyển được', () => {
    const t = transferBlockedText('9.520đ', false);
    expect(t).toBe('Hoa hồng chuyển được vào Ví Tubu khi đơn đã giao và hết thời gian đổi/trả. Đang chờ: 9.520đ.');
    expect(t).not.toMatch(/tự vào/);
  });
});

describe('transferHeroNote và isAutoWalletTransfer', () => {
  it('tự chuyển bật: phần còn lại là phần chưa tự vào Ví được, dặn bấm tay; tắt: dặn bấm để chuyển', () => {
    expect(transferHeroNote(true)).toContain('chưa tự vào Ví được');
    expect(transferHeroNote(false)).toBe('Bấm Chuyển vào Ví để chuyển phần này vào Ví Tubu.');
  });
  it('chỉ đúng false mới là tắt; API cũ chưa trả trường này coi như bật', () => {
    expect(isAutoWalletTransfer(false)).toBe(false);
    expect(isAutoWalletTransfer(true)).toBe(true);
    expect(isAutoWalletTransfer(undefined)).toBe(true);
  });
});

describe('hasFirstOrder', () => {
  it('CTV mới toàn 0 thì chưa có đơn đầu', () => {
    expect(hasFirstOrder(ZERO)).toBe(false);
    expect(hasFirstOrder(undefined)).toBe(false);
  });
  it('có chuyển đổi hoặc bất kỳ khoản hoa hồng nào thì đã có đơn đầu', () => {
    expect(hasFirstOrder({ ...ZERO, totalConversions: 1 })).toBe(true);
    expect(hasFirstOrder({ ...ZERO, pendingCommission: 5 })).toBe(true);
    expect(hasFirstOrder({ ...ZERO, withdrawableCommission: 5 })).toBe(true);
    expect(hasFirstOrder({ ...ZERO, monthCommission: 5 })).toBe(true);
  });
});

describe('nextMilestoneRows', () => {
  const m = (id: string, achieved: boolean, canClaim = false) => ({ id, achieved, canClaim });
  it('giữ mốc nhận được và mốc kế tiếp, giữ thứ tự gốc', () => {
    const rows = nextMilestoneRows([m('A', true), m('B', true, true), m('C', false), m('D', false)]);
    expect(rows.map((r) => r.id)).toEqual(['B', 'C']);
  });
  it('CTV mới chưa đạt mốc nào: chỉ mốc đầu', () => {
    expect(nextMilestoneRows([m('A', false), m('B', false)]).map((r) => r.id)).toEqual(['A']);
  });
  it('đã đạt hết và nhận hết: giữ mốc cuối', () => {
    expect(nextMilestoneRows([m('A', true), m('B', true)]).map((r) => r.id)).toEqual(['B']);
  });
  it('danh sách rỗng', () => {
    expect(nextMilestoneRows([])).toEqual([]);
  });
});
