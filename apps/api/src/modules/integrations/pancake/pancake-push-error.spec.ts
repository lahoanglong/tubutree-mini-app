import { PancakeApiError, PancakeOrderDataError } from './pancake-outbound';
import { classifyPushError, isPermanentPushError, nextPushRetryAt, PUSH_RETRY } from './pancake-push-error';

describe('classifyPushError', () => {
  it('thiếu dữ liệu người nhận là DATA (vĩnh viễn)', () => {
    expect(classifyPushError(new PancakeOrderDataError('thiếu SĐT'))).toBe('DATA');
  });

  it.each([401, 403])('HTTP %s là CONFIG: khoá API sai, không thử dồn', (status) => {
    expect(classifyPushError(new PancakeApiError('x', false, false, status))).toBe('CONFIG');
  });

  it.each([400, 404, 410, 422])('HTTP %s dứt khoát là REJECTED (vĩnh viễn)', (status) => {
    expect(classifyPushError(new PancakeApiError('x', false, false, status))).toBe('REJECTED');
  });

  it('success:false không kèm mã HTTP là REJECTED', () => {
    expect(classifyPushError(new PancakeApiError('Pancake từ chối tạo đơn: x', false))).toBe('REJECTED');
  });

  it.each([408, 409, 425, 429, 500, 502, 503])('HTTP %s là TRANSIENT', (status) => {
    expect(classifyPushError(new PancakeApiError('x', true, false, status))).toBe('TRANSIENT');
  });

  it('mất kết nối là TRANSIENT', () => {
    expect(classifyPushError(new PancakeApiError('Không kết nối được Pancake', true))).toBe('TRANSIENT');
  });

  it('lỗi lạ (DB, mã) coi là tạm: không đóng cửa thử lại vì lỗi không rõ', () => {
    expect(classifyPushError(new Error('boom'))).toBe('TRANSIENT');
    expect(classifyPushError('chuỗi')).toBe('TRANSIENT');
  });

  it('chỉ TRANSIENT là không vĩnh viễn', () => {
    expect(isPermanentPushError('TRANSIENT')).toBe(false);
    expect(['DATA', 'CONFIG', 'REJECTED'].every((k) => isPermanentPushError(k as never))).toBe(true);
  });
});

describe('nextPushRetryAt', () => {
  const now = new Date('2026-11-05T10:07:00.000Z');
  const base = { pancakeOrderId: null, pancakePushStatus: 'PENDING', pancakeErrorKind: 'TRANSIENT', pancakePushAttempts: 3, pancakeLastAttemptAt: new Date('2026-11-05T10:01:00.000Z'), createdAt: new Date('2026-11-05T09:00:00.000Z') };

  it('lỗi tạm: tới nhịp cron 15 phút kế sau lần thử gần nhất + 15 phút', () => {
    expect(nextPushRetryAt(base, now)?.toISOString()).toBe('2026-11-05T10:30:00.000Z');
  });

  it('đã quá nhịp thì lấy nhịp kế tiếp sau bây giờ', () => {
    expect(nextPushRetryAt({ ...base, pancakeLastAttemptAt: new Date('2026-11-05T09:00:00.000Z') }, now)?.toISOString()).toBe('2026-11-05T10:15:00.000Z');
  });

  it('từ lượt thứ 20 cron chỉ thử mỗi giờ', () => {
    expect(nextPushRetryAt({ ...base, pancakePushAttempts: PUSH_RETRY.SLOW_AFTER_ATTEMPTS }, now)?.toISOString()).toBe('2026-11-05T11:15:00.000Z');
  });

  it('lỗi vĩnh viễn (DATA/REJECTED) cron chỉ hỏi lại mỗi giờ', () => {
    expect(nextPushRetryAt({ ...base, pancakeErrorKind: 'REJECTED' }, now)?.toISOString()).toBe('2026-11-05T11:15:00.000Z');
  });

  it('đơn chờ thanh toán/đủ hàng hay đã rời kho thì không có lần tự đẩy', () => {
    expect(nextPushRetryAt({ ...base, pancakePushStatus: 'WAITING_PAYMENT' }, now)).toBeNull();
    expect(nextPushRetryAt({ ...base, pancakePushStatus: 'WAITING_STOCK' }, now)).toBeNull();
    expect(nextPushRetryAt({ ...base, status: 'SHIPPING' }, now)).toBeNull();
    expect(nextPushRetryAt({ ...base, status: 'CONFIRMED' }, now)).not.toBeNull();
  });

  it('đã lên Pancake, STALE, hay quá cửa sổ 72 giờ thì không còn lần tự thử', () => {
    expect(nextPushRetryAt({ ...base, pancakeOrderId: '1' }, now)).toBeNull();
    expect(nextPushRetryAt({ ...base, pancakePushStatus: 'STALE' }, now)).toBeNull();
    expect(nextPushRetryAt({ ...base, createdAt: new Date('2026-11-01T00:00:00.000Z') }, now)).toBeNull();
  });
});
