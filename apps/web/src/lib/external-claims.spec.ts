import { describe, it, expect } from 'vitest';
import { EVENT_ACTION_LABEL, adminClaimErrorText, approveNeedsNote, approveNoteError, noteContentLength, attachDialogMessage, claimActions, creditedOnClosedOrder, groupThousands, isIntroducer } from './external-claims';

const who = (over: Partial<Parameters<typeof claimActions>[1]> = {}) => ({ isAdmin: false, canAct: false, meId: 'x', ...over });
const c = (over: Record<string, unknown> = {}) => ({ state: 'REVIEW' as const, userId: 'u1', reviewReason: null as string | null, ...over });

describe('claimActions', () => {
  it('KE_TOAN không có nút; CSKH duyệt/huỷ claim chưa cộng; chỉ ADMIN đảo và giữ điểm', () => {
    expect(claimActions(c(), who())).toEqual({ approve: false, void: false, voidAndReopen: false, reverse: false, keepPoints: false });
    expect(claimActions(c(), who({ canAct: true }))).toMatchObject({ approve: true, void: true, voidAndReopen: true, reverse: false });
    expect(claimActions(c({ state: 'PENDING' }), who({ canAct: true }))).toMatchObject({ approve: false, void: true });
    const credited = c({ state: 'CREDITED', reviewReason: 'hoàn một phần' });
    expect(claimActions(credited, who({ canAct: true }))).toMatchObject({ void: false, reverse: false, keepPoints: false });
    expect(claimActions(credited, who({ isAdmin: true, canAct: true }))).toMatchObject({ reverse: true, keepPoints: true });
    expect(claimActions(c({ state: 'CREDITED' }), who({ isAdmin: true }))).toMatchObject({ reverse: true, keepPoints: false });
  });
  it('claim của chính mình: không nút nào', () => {
    expect(claimActions(c({ userId: 'x' }), who({ isAdmin: true, canAct: true }))).toEqual({ approve: false, void: false, voidAndReopen: false, reverse: false, keepPoints: false });
  });
});

describe('helpers', () => {
  it('isIntroducer chỉ tính ATTACH và TO_REVIEW của chính mình', () => {
    expect(isIntroducer([{ action: 'ATTACH', actorId: 'x' }], 'x')).toBe(true);
    expect(isIntroducer([{ action: 'VOID_REOPEN', actorId: 'x' }], 'x')).toBe(true);
    expect(isIntroducer([{ action: 'VOID', actorId: 'x' }], 'x')).toBe(false);
    expect(isIntroducer([{ action: 'TO_REVIEW', actorId: 'y' }], 'x')).toBe(false);
    expect(isIntroducer([{ action: 'ATTACH', actorId: 'x' }], undefined)).toBe(false);
  });
  it('creditedOnClosedOrder', () => {
    expect(creditedOnClosedOrder({ state: 'CREDITED', orderStatus: 'CANCELLED' })).toBe(true);
    expect(creditedOnClosedOrder({ state: 'CREDITED', orderStatus: 'PARTIAL_RETURN' })).toBe(false);
    expect(creditedOnClosedOrder({ state: 'PENDING', orderStatus: 'RETURNED' })).toBe(false);
  });
  it('adminClaimErrorText: mỗi mã có câu riêng, mã lạ dùng message', () => {
    for (const code of ['SELF_ACTION', 'SAME_INTRODUCER', 'ATTACH_ADMIN_ONLY', 'NOTE_REQUIRED', 'NOT_FLAGGED']) {
      const t = adminClaimErrorText(Object.assign(new Error('english'), { code }));
      expect(t).toMatch(/[ăâêôơưđ]/);
      expect(t).not.toBe('english');
    }
    expect(adminClaimErrorText(Object.assign(new Error('Không tìm thấy claim.'), { code: 'KHAC' }))).toBe('Không tìm thấy claim.');
  });
  it('groupThousands', () => {
    expect(groupThousands(1250000)).toBe('1.250.000');
    expect(groupThousands(999)).toBe('999');
  });

  it('mọi mã từ chối của API có câu dành cho nhân viên, không phải câu của khách', () => {
    for (const code of ['DISABLED', 'NOT_ELIGIBLE_USER', 'INVALID_CODE', 'LOCKED', 'DAILY_ATTEMPTS', 'APP_ORDER', 'CHAT_ORDER', 'TOO_OLD', 'BEFORE_SINCE', 'CLOSED', 'ALREADY_CLAIMED', 'DAILY_MAX', 'MONTHLY_CAP', 'ZERO_POINTS']) {
      const t = adminClaimErrorText(Object.assign(new Error('Bạn đã đạt mức điểm tối đa'), { code }));
      expect(t).not.toMatch(/\bBạn\b/);
      expect(t).not.toBe('Bạn đã đạt mức điểm tối đa');
    }
    expect(adminClaimErrorText(Object.assign(new Error('x'), { code: 'MONTHLY_CAP' }))).toBe('Khách đã đạt trần điểm đơn sàn trong tháng này.');
  });

  it('nhãn lịch sử có cho mọi action API ghi', () => {
    for (const a of ['CLAIM_CREATED', 'ATTACH', 'APPROVE', 'VOID', 'VOID_REOPEN', 'REOPEN_CLAIM', 'REVERSE', 'KEEP_POINTS', 'CREDIT', 'AUTO_VOID', 'AUTO_REVERSE', 'TO_REVIEW', 'FLAG_PARTIAL']) {
      expect(EVENT_ACTION_LABEL[a]).toMatch(/[A-Za-zÀ-ỹ]/);
    }
  });

  it('lời nhắc gắn đơn nói đúng luật: vẫn áp trần và tuổi đơn, có thể vào chờ duyệt, ADMIN gắn mã lệch không cần người duyệt', () => {
    const admin = attachDialogMessage('SPX***789', true);
    expect(admin).toContain('Vẫn áp tuổi đơn, mốc bắt đầu chương trình, trần số đơn mỗi ngày và trần điểm mỗi tháng');
    expect(admin).toContain('vẫn có thể vào chờ duyệt');
    expect(admin).toContain('chưa tính được tiền hàng');
    expect(admin).toContain('khách là nhân viên');
    expect(admin).toContain('không cần người khác duyệt, thao tác được ghi vào lịch sử');
    expect(admin).not.toContain('bỏ qua');
    const staff = attachDialogMessage('SPX***789', false);
    expect(staff).toContain('chỉ ADMIN gắn được');
    expect(staff).not.toContain('không cần người khác duyệt');
  });
});

describe('approveNeedsNote', () => {
  it('claim PHONE mà mốc xác minh vẫn cũ thì cần ghi chú, bất kể lý do REVIEW', () => {
    expect(approveNeedsNote({ kind: 'PHONE', memberPhoneStale: true })).toBe(true);
    expect(approveNeedsNote({ kind: 'PHONE', memberPhoneStale: false })).toBe(false);
    expect(approveNeedsNote({ kind: 'PHONE' })).toBe(false);
    expect(approveNeedsNote({ kind: 'SCAN', memberPhoneStale: true })).toBe(false);
  });
});

describe('độ dài ghi chú duyệt', () => {
  it.each([
    ['zero-width', '\u200B\u200C\u200D\u2060\uFEFF'],
    ['đánh dấu chiều chữ', '\u200E\u202E'],
    ['soft hyphen, ký hiệu toán ẩn', '\u00AD\u2061'],
    ['Mông Cổ, Khmer', '\u180E\u17B4\u17B5'],
    ['Hangul trống', '\u115F\u1160\u3164\uFFA0'],
    ['Braille trống, combining joiner', '\u2800\u034F'],
  ])('%s: tính 0 ký tự và bị báo quá ngắn', (_n, chars) => {
    expect(noteContentLength(` ${chars} `)).toBe(0);
    expect(approveNoteError(`a${chars}b`)).toBe('Ghi chú cần ít nhất 3 ký tự');
  });
  it('ô trống không báo lỗi; đủ 3 ký tự thật thì hợp lệ', () => {
    expect(approveNoteError('')).toBeNull();
    expect(approveNoteError('   ')).toBeNull();
    expect(approveNoteError('ok')).toBe('Ghi chú cần ít nhất 3 ký tự');
    expect(approveNoteError('Đã gọi')).toBeNull();
  });
});
