import { beforeEach, describe, expect, it, vi } from 'vitest';
import { needsTaxIdForAutoTransfer, commissionPendingNote, COMMISSION_PENDING_NOTE, CTV_TAB_KEYS, ctvHeadline, ctvHeroAmount, hasFirstOrder, heroShowsWalletBalance, isAutoWalletTransfer, nextMilestoneRows, transferBlockedText, transferHeroNote, isTransferRefreshing, subscribeTransferRefreshing, lockTransferUntil, resetTransferLock } from './ctv-dashboard';

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
    expect(transferBlockedText('9.520đ')).toBe('Hoa hồng được duyệt khi đơn đã giao và hết thời gian đổi/trả, rồi tự vào Ví Tubu lúc 8:00 sáng kế tiếp. Đang chờ: 9.520đ.');
  });
  it('tự chuyển tắt: không hứa tự vào Ví, chỉ nói khi nào chuyển được', () => {
    const t = transferBlockedText('9.520đ', false);
    expect(t).toBe('Hoa hồng chuyển được vào Ví Tubu khi đơn đã giao và hết thời gian đổi/trả. Đang chờ: 9.520đ.');
    expect(t).not.toMatch(/tự vào/);
  });
});

describe('transferHeroNote và isAutoWalletTransfer', () => {
  it('tự chuyển bật: phần còn lại chờ lượt 8:00, dặn bấm tay để nhận ngay; tắt: dặn bấm để chuyển', () => {
    expect(transferHeroNote(true)).toContain('lúc 8:00 sáng');
    expect(transferHeroNote(false)).toBe('Bấm Chuyển vào Ví để chuyển phần này vào Ví Tubu.');
  });
  it('tự chuyển bật mà CTV cần khai MST: nhắc mã số thuế thay vì hứa 8:00', () => {
    expect(transferHeroNote(true, true)).toContain('cần mã số thuế');
    expect(transferHeroNote(true, true)).not.toContain('8:00');
    expect(transferHeroNote(false, true)).toBe('Bấm Chuyển vào Ví để chuyển phần này vào Ví Tubu.');
  });
  it('needsTaxIdForAutoTransfer: chỉ khi có thuế và chưa có MST', () => {
    const pit = { pct: 0.1, threshold: 2_000_000 };
    expect(needsTaxIdForAutoTransfer(3_000_000, pit, null)).toBe(true);
    expect(needsTaxIdForAutoTransfer(3_000_000, pit, '0123456789')).toBe(false);
    expect(needsTaxIdForAutoTransfer(1_000_000, pit, null)).toBe(false);
    expect(needsTaxIdForAutoTransfer(3_000_000, undefined, null)).toBe(false);
  });
  it('chỉ đúng false mới là tắt; API cũ chưa trả trường này coi như bật', () => {
    expect(isAutoWalletTransfer(false)).toBe(false);
    expect(isAutoWalletTransfer(true)).toBe(true);
    expect(isAutoWalletTransfer(undefined)).toBe(false);
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

describe('ctvHeroAmount', () => {
  it('có tiền chuyển được → số to là tiền chuyển được', () => {
    expect(ctvHeroAmount(120000, true, 50000)).toEqual({ label: 'Có thể chuyển vào Ví', amount: 120000, waiting: false });
  });
  it('tự chuyển bật và không còn gì chờ chuyển → số to là số dư Ví (tiền dùng được ngay)', () => {
    expect(ctvHeroAmount(0, true, 5400000)).toEqual({ label: 'Số dư Ví Tubu', amount: 5400000, waiting: false });
  });
  it('chưa biết số dư Ví và Ví không còn đang tải (lỗi) hoặc tự chuyển tắt → giữ nhãn chuyển được', () => {
    expect(ctvHeroAmount(0, true, undefined)).toEqual({ label: 'Có thể chuyển vào Ví', amount: 0, waiting: false });
    expect(ctvHeroAmount(0, false, 5400000)).toEqual({ label: 'Có thể chuyển vào Ví', amount: 0, waiting: false });
  });
  it('dashboard về trước Ví: tự chuyển bật, chuyển được 0 và Ví đang tải → chờ, không vẽ số to', () => {
    expect(ctvHeroAmount(0, true, undefined, true).waiting).toBe(true);
  });
  it('Ví đang tải nhưng có tiền chuyển được hoặc tự chuyển tắt → không chờ (số to không đổi khi Ví về)', () => {
    expect(ctvHeroAmount(120000, true, undefined, true).waiting).toBe(false);
    expect(ctvHeroAmount(0, false, undefined, true).waiting).toBe(false);
  });
});

describe('heroShowsWalletBalance', () => {
  it('chỉ đúng khi hero là số dư Ví và không đang chờ', () => {
    expect(heroShowsWalletBalance(ctvHeroAmount(0, true, 5400000))).toBe(true);
    expect(heroShowsWalletBalance(ctvHeroAmount(120000, true, 5400000))).toBe(false);
    expect(heroShowsWalletBalance(ctvHeroAmount(0, true, undefined, true))).toBe(false);
  });
});

describe('commissionPendingNote', () => {
  it('chỉ hứa lịch 8:00 khi tự chuyển bật', () => {
    expect(commissionPendingNote(true)).toContain('vào Ví lúc 8:00');
    expect(commissionPendingNote(false)).toBe(COMMISSION_PENDING_NOTE);
    expect(COMMISSION_PENDING_NOTE).not.toContain('8:00');
  });
});

describe('khoá nút Chuyển vào Ví trong lúc làm mới sau khi chuyển', () => {
  beforeEach(() => resetTransferLock());

  it('mặc định không khoá', () => {
    expect(isTransferRefreshing()).toBe(false);
  });

  it('khoá trong lúc làm mới, mở khi làm mới xong; listener được báo hai lần', async () => {
    const seen: boolean[] = [];
    const off = subscribeTransferRefreshing(() => seen.push(isTransferRefreshing()));
    let done!: () => void;
    const p = lockTransferUntil(() => new Promise<void>((r) => (done = r)));
    expect(isTransferRefreshing()).toBe(true);
    done();
    await p;
    expect(isTransferRefreshing()).toBe(false);
    expect(seen).toEqual([true, false]);
    off();
  });

  it('làm mới lỗi vẫn mở nút', async () => {
    await expect(lockTransferUntil(() => Promise.reject(new Error('x')))).resolves.toBeUndefined();
    expect(isTransferRefreshing()).toBe(false);
  });

  it('bỏ đăng ký thì listener không được báo nữa', async () => {
    const fn = vi.fn();
    subscribeTransferRefreshing(fn)();
    await lockTransferUntil(async () => undefined);
    expect(fn).not.toHaveBeenCalled();
  });
});
