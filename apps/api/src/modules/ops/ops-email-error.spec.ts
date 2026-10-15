import { classifySmtpError, smtpFailureHint, type SmtpFailureKind } from './ops-email-error';

const err = (props: Record<string, unknown>, message = 'smtp error') => Object.assign(new Error(message), props);

describe('classifySmtpError — lỗi vĩnh viễn (không tự gửi lại)', () => {
  it.each<[string, unknown, SmtpFailureKind]>([
    ['EAUTH + 535 (sai mật khẩu Gmail)', err({ code: 'EAUTH', responseCode: 535, response: '535-5.7.8 Username and Password not accepted' }), 'AUTH'],
    ['EAUTH + 535 chỉ có chuỗi response', err({ code: 'EAUTH', response: '535 5.7.8 Authentication failed' }), 'AUTH'],
    ['EAUTH + 534 (cần mật khẩu ứng dụng)', err({ code: 'EAUTH', responseCode: 534 }), 'AUTH'],
    ['EAUTH không có mã đáp (thiếu thông tin đăng nhập, cơ chế lạ)', err({ code: 'EAUTH' }), 'AUTH'],
    ['EAUTH + 5xx lạ', err({ code: 'EAUTH', responseCode: 554 }), 'AUTH'],
    ['ENOAUTH', err({ code: 'ENOAUTH' }), 'AUTH'],
    ['535 không kèm mã nodemailer', err({ responseCode: 535 }), 'AUTH'],
    ['530 cần xác thực (EENVELOPE ở MAIL FROM)', err({ code: 'EENVELOPE', responseCode: 530, command: 'MAIL FROM' }), 'AUTH'],
    ['538 bắt buộc mã hoá', err({ code: 'EAUTH', responseCode: 538 }), 'AUTH'],
    ['550 người nhận không tồn tại', err({ code: 'EENVELOPE', responseCode: 550, response: '550 5.1.1 User unknown', command: 'RCPT TO' }), 'PERMANENT'],
    ['553 địa chỉ không hợp lệ', err({ code: 'EENVELOPE', responseCode: 553 }), 'PERMANENT'],
    ['554 relay bị cấm', err({ code: 'EENVELOPE', responseCode: 554, response: '554 5.7.1 Relay access denied' }), 'PERMANENT'],
    ['554 thư bị từ chối sau DATA', err({ code: 'EMESSAGE', responseCode: 554, command: 'DATA' }), 'PERMANENT'],
    ['552 thư quá lớn', err({ code: 'EMESSAGE', responseCode: 552 }), 'PERMANENT'],
    ['500 lệnh không nhận ra', err({ code: 'EPROTOCOL', responseCode: 500 }), 'PERMANENT'],
    ['5xx chỉ có chuỗi response', err({ response: '550 5.7.1 rejected' }), 'PERMANENT'],
  ])('%s', (_n, e, kind) => {
    expect(classifySmtpError(e)).toBe(kind);
  });
});

describe('classifySmtpError — lỗi tạm thời (giữ gửi lại mỗi lượt kiểm)', () => {
  it.each<[string, unknown]>([
    ['hết thời gian chờ', err({ code: 'ETIMEDOUT' })],
    ['ECONNECTION', err({ code: 'ECONNECTION' })],
    ['ESOCKET', err({ code: 'ESOCKET' })],
    ['DNS (EDNS)', err({ code: 'EDNS' })],
    ['DNS hệ điều hành (ENOTFOUND)', err({ code: 'ENOTFOUND' })],
    ['ECONNREFUSED', err({ code: 'ECONNREFUSED' })],
    ['ECONNRESET', err({ code: 'ECONNRESET' })],
    ['TLS (ETLS)', err({ code: 'ETLS' })],
    ['ETLS kèm 454 TLS not available', err({ code: 'ETLS', responseCode: 454 })],
    ['421 dịch vụ tạm ngưng', err({ code: 'ECONNECTION', responseCode: 421 })],
    ['450 hộp thư bận', err({ code: 'EENVELOPE', responseCode: 450 })],
    ['451 lỗi cục bộ', err({ code: 'EMESSAGE', responseCode: 451 })],
    ['452 hết dung lượng', err({ code: 'EMESSAGE', responseCode: 452 })],
    ['EAUTH + 454 (thử đăng nhập quá nhiều, đợi chút)', err({ code: 'EAUTH', responseCode: 454, response: '454 4.7.0 Too many login attempts' })],
    ['EAUTH + 4xx chỉ có chuỗi response', err({ code: 'EAUTH', response: '454 4.7.0 try later' })],
    ['quá hạn do chính dịch vụ (Error không mã)', new Error('quá 30 giây không gửi xong')],
    ['EPROTOCOL không kèm mã đáp', err({ code: 'EPROTOCOL' })],
    ['không phải Error (chuỗi)', 'boom'],
    ['null', null],
    ['undefined', undefined],
    ['mã đáp ngoài khoảng bị bỏ qua', err({ responseCode: 999 })],
    ['response không bắt đầu bằng mã', err({ response: 'server said: 535 nope' })],
  ])('%s', (_n, e) => {
    expect(classifySmtpError(e)).toBe('TRANSIENT');
  });
});

describe('smtpFailureHint', () => {
  it('xác thực: nói rõ kiểm SMTP_USER/SMTP_PASS và rằng không tự gửi lại liên tục', () => {
    const h = smtpFailureHint('AUTH')!;
    expect(h).toContain('Lỗi xác thực SMTP — kiểm tra SMTP_USER/SMTP_PASS');
    expect(h).toContain('Gửi email thử');
  });

  it('từ chối vĩnh viễn: chỉ tới người nhận, địa chỉ gửi, quyền gửi', () => {
    const h = smtpFailureHint('PERMANENT')!;
    expect(h).toContain('OPS_ALERT_EMAIL_TO');
    expect(h).toContain('SMTP_FROM');
  });

  it('lỗi tạm thời hoặc không rõ: không có lời hướng dẫn (hệ thống tự gửi lại)', () => {
    expect(smtpFailureHint('TRANSIENT')).toBeNull();
    expect(smtpFailureHint(null)).toBeNull();
    expect(smtpFailureHint(undefined)).toBeNull();
  });
});
