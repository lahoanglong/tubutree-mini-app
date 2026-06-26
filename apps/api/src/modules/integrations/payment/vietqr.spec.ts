import { crc16ccitt, buildVietQrPayload } from './vietqr';

describe('crc16ccitt (CRC-16/CCITT-FALSE)', () => {
  it('vector chuẩn "123456789" → 29B1', () => {
    expect(crc16ccitt('123456789')).toBe('29B1');
  });
});

describe('buildVietQrPayload (VietQR Napas 247)', () => {
  const qr = buildVietQrPayload({ bin: '970407', accountNo: '9984606774', amount: 50000, addInfo: 'TUBU123' });

  it('mở đầu đúng EMVCo + QR động (point-of-init 12)', () => {
    expect(qr.startsWith('000201')).toBe(true);
    expect(qr).toContain('010212'); // dynamic QR (có số tiền)
  });

  it('chứa BIN + số tài khoản + service QRIBFTTA + GUID Napas', () => {
    expect(qr).toContain('A000000727'); // GUID Napas
    expect(qr).toContain('970407'); // BIN
    expect(qr).toContain('9984606774'); // account
    expect(qr).toContain('QRIBFTTA'); // chuyển khoản tới tài khoản
  });

  it('tiền tệ VND (704), số tiền, quốc gia VN, nội dung chuyển khoản', () => {
    expect(qr).toContain('5303704'); // field 53 len 3 = 704
    expect(qr).toContain('540550000'); // field 54 len 5 = 50000
    expect(qr).toContain('5802VN');
    expect(qr).toContain('TUBU123'); // addInfo (field 62-08)
  });

  it('CRC ở cuối hợp lệ (field 63, tự kiểm chứng)', () => {
    expect(qr.slice(-8, -4)).toBe('6304'); // field 63 len 4
    const crc = qr.slice(-4);
    expect(crc).toMatch(/^[0-9A-F]{4}$/);
    // CRC tính trên toàn chuỗi gồm cả "6304"
    expect(crc16ccitt(qr.slice(0, -4))).toBe(crc);
  });

  it('QR tĩnh khi không có số tiền (point-of-init 11, không field 54)', () => {
    const stat = buildVietQrPayload({ bin: '970407', accountNo: '9984606774', addInfo: 'TUBU9' });
    expect(stat).toContain('010211');
    expect(stat).not.toContain('5405');
  });
});
