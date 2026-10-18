import { maskPhone, maskPhoneEnds, maskPhoneOrNull, maskVnPhonesInText } from './mask-pii';

describe('mask-pii (R2-PLATFORM-10: không ghi SĐT nguyên văn vào log)', () => {
  it('SĐT giữ 3 số đầu + 3 số cuối', () => {
    expect(maskPhone('0910087109')).toBe('091****109');
    expect(maskPhone('+84910087109')).toBe('+84****109');
  });

  it('chuỗi ngắn hoặc rỗng không lộ gì', () => {
    expect(maskPhone('12345')).toBe('***');
    expect(maskPhone(null)).toBe('(không có SĐT)');
    expect(maskPhone('')).toBe('(không có SĐT)');
  });
});

describe('mask SĐT: ba biến thể đang chạy giữ nguyên đầu ra', () => {
  // [đầu vào, maskPhone (log), maskPhoneOrNull (merchant), maskPhoneEnds (loyalty; null do nơi gọi xử lý)]
  const table: Array<[string | null | undefined, string, string | null, string | null]> = [
    ['0910087109', '091****109', '091****109', '091****109'],
    ['+84910087109', '+84****109', '+84****109', '+84****109'],
    ['0123456', '012****456', '012****456', '012****456'],
    ['012345', '***', '***', '012****345'],
    ['12345', '***', '***', '123****345'],
    ['1', '***', '***', '1****1'],
    ['', '(không có SĐT)', null, null],
    [null, '(không có SĐT)', null, null],
    [undefined, '(không có SĐT)', null, null],
  ];

  it.each(table)('%j', (input, log, orNull, ends) => {
    expect(maskPhone(input)).toBe(log);
    expect(maskPhoneOrNull(input)).toBe(orNull);
    expect(input ? maskPhoneEnds(input) : null).toBe(ends);
  });
});

describe('maskVnPhonesInText: chỉ che SĐT VN, giữ mã đối soát của kế toán', () => {
  it('che SĐT có dấu cách, chấm, gạch, +84; giữ 3 số cuối', () => {
    expect(maskVnPhonesInText('gọi 0912 345 678 trước')).toBe('gọi **** *** 678 trước');
    expect(maskVnPhonesInText('0912.345.678')).toBe('****.***.678');
    expect(maskVnPhonesInText('+84 912-345-678')).not.toMatch(/912/);
    expect(maskVnPhonesInText('84912345678')).toBe('********678');
  });

  it('che cả SĐT dính sau chữ, ngăn cách nhiều ký tự, ngoặc, gạch dưới', () => {
    for (const raw of ['sdt0912345678', 'SĐT84912345678', '0912 - 345 - 678', '(091) 234 5678', '0912_345_678', 'liên hệ:0912/345/678']) {
      const out = maskVnPhonesInText(raw);
      expect(out).not.toMatch(/0912|912|091|2345|234 5678/);
      expect(out.replace(/\D/g, '').length).toBe(3);
    }
  });

  it('không che mã giao dịch ngân hàng, số tiền, mã đơn', () => {
    for (const keep of ['FT26270123456789', 'CK 12.500.000đ', '12500000', 'Mã GD FT26270001 · đơn TB-20261018-0007', 'đơn 900033', '84000000đ', 'TUBU20261018123', 'DLR1', 'TB-20261018-0007']) {
      expect(maskVnPhonesInText(keep)).toBe(keep);
    }
  });
});
