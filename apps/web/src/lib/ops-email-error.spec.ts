import { describe, it, expect } from 'vitest';
import { smtpErrorSummary } from './ops-email-error';

const AUTH_HINT = 'Lỗi xác thực SMTP — kiểm tra SMTP_USER/SMTP_PASS. Hệ thống không tự gửi lại liên tục (tránh khoá tài khoản gửi): sửa cấu hình rồi bấm "Gửi email thử".';

describe('smtpErrorSummary — câu tiếng Việt duy nhất cho lỗi gửi email báo động', () => {
  it('API đã có lời chỉ (AUTH/PERMANENT): dùng nguyên lời đó, không dịch thêm', () => {
    expect(smtpErrorSummary({ kind: 'AUTH', hint: AUTH_HINT, raw: 'EAUTH: Invalid login: 535 5.7.8 Username and Password not accepted' })).toBe(AUTH_HINT);
  });

  it.each([
    ['EAUTH: Invalid login: 535 5.7.8 Authentication credentials invalid', 'AUTH', 'sai tài khoản hoặc mật khẩu SMTP'],
    ['ENOAUTH: Missing credentials for "PLAIN"', null, 'sai tài khoản hoặc mật khẩu SMTP'],
    ["EENVELOPE: Can't send mail - all recipients were rejected: 550 5.1.1 user unknown", 'PERMANENT', 'OPS_ALERT_EMAIL_TO'],
    ['EMESSAGE: 554 5.7.1 Relay access denied', null, 'quyền gửi của tài khoản'],
    ['ETIMEDOUT: Greeting never received', 'TRANSIENT', 'Hết thời gian chờ máy chủ SMTP'],
    ['quá 30 giây không gửi xong', 'TRANSIENT', 'Hết thời gian chờ máy chủ SMTP'],
    ['ECONNECTION: connect ECONNREFUSED 10.0.0.5:587', 'TRANSIENT', 'Không kết nối được tới máy chủ SMTP'],
    ['EDNS: getaddrinfo ENOTFOUND smtp.sai-ten.com', 'TRANSIENT', 'Không kết nối được tới máy chủ SMTP'],
    ['ESOCKET: read ECONNRESET', null, 'Không kết nối được tới máy chủ SMTP'],
    ['ETLS: 454 TLS not available due to temporary reason', 'TRANSIENT', 'mã hoá TLS'],
    ['ESOCKET: error:0A00010B:SSL routines:ssl3_get_record:wrong version number', 'TRANSIENT', 'mã hoá TLS'],
    ['EAUTH: 454 4.7.0 Too many login attempts, please try again later', 'TRANSIENT', 'tạm từ chối'],
    ['EMESSAGE: 451 4.3.0 Temporary local problem', 'TRANSIENT', 'tạm từ chối'],
  ])('%s → câu tiếng Việt chứa "%s" khi API chưa có lời chỉ', (raw, kind, expected) => {
    const text = smtpErrorSummary({ kind: kind as 'AUTH' | 'PERMANENT' | 'TRANSIENT' | null, hint: null, raw });
    expect(text).toContain(expected);
  });

  it('không in lại mã/tiếng Anh thô: kết quả không chứa nguyên văn lỗi', () => {
    const raw = 'ETIMEDOUT: Greeting never received';
    const text = smtpErrorSummary({ kind: 'TRANSIENT', hint: null, raw });
    expect(text).not.toContain('Greeting');
    expect(text).not.toContain('ETIMEDOUT');
  });

  it('lỗi lạ hoặc không có chi tiết: câu chung, vẫn tiếng Việt', () => {
    expect(smtpErrorSummary({ kind: 'TRANSIENT', hint: null, raw: 'something odd happened' })).toContain('Gửi email không thành công');
    expect(smtpErrorSummary({ kind: null, hint: null, raw: null })).toContain('Gửi email không thành công');
    expect(smtpErrorSummary({ kind: undefined, hint: undefined, raw: '' })).toContain('Gửi email không thành công');
  });

  it('lời chỉ rỗng hoặc toàn khoảng trắng coi như không có', () => {
    expect(smtpErrorSummary({ kind: 'AUTH', hint: '   ', raw: 'EAUTH: 535' })).toContain('sai tài khoản hoặc mật khẩu SMTP');
  });
});
