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
    for (const raw of ['sdt:0912345678', 'SĐT: 84912345678', '0912 - 345 - 678', '(091) 234 5678', '0912_345_678', 'liên hệ:0912/345/678']) {
      const out = maskVnPhonesInText(raw);
      expect(out).not.toMatch(/0912|912|091|2345|234 5678/);
      expect(out.replace(/\D/g, '').length).toBe(3);
    }
  });

  it('che 0084, dấu phẩy, dấu gạch mềm U+00AD giữa các số', () => {
    expect(maskVnPhonesInText('0084901234567')).toBe('**********567');
    expect(maskVnPhonesInText('0901,234,567')).toBe('****,***,567');
    expect(maskVnPhonesInText('0901\u00AD234\u00AD567')).toBe('****\u00AD***\u00AD567');
    expect(maskVnPhonesInText('0912\u00AD345678')).not.toMatch(/912|345/);
  });

  it('GHN 0912345678 (cách một dấu trắng) vẫn che; 901 234 567 không đầu 0 để nguyên', () => {
    expect(maskVnPhonesInText('GHN 0912345678')).toBe('GHN *******678');
    expect(maskVnPhonesInText('901 234 567')).toBe('901 234 567');
  });

  it('không che dãy số dính sau chữ hoặc số trong mã vận đơn', () => {
    for (const keep of ['SPXVN0123456789', 'GHN0912345678', 'VN0084901234567', '10912345678', 'SPXVN84912345678']) {
      expect(maskVnPhonesInText(keep)).toBe(keep);
    }
  });

  it('không che số tiền dạng 84.000.000đ, 840.000.000, 1.000.000', () => {
    for (const keep of ['84.000.000đ', '840.000.000', '1.000.000', '1,000,000đ']) {
      expect(maskVnPhonesInText(keep)).toBe(keep);
    }
  });

  it('không che mã giao dịch ngân hàng, số tiền, mã đơn', () => {
    for (const keep of ['FT26270123456789', 'CK 12.500.000đ', '12500000', 'Mã GD FT26270001 · đơn TB-20261018-0007', 'đơn 900033', '84000000đ', 'TUBU20261018123', 'DLR1', 'TB-20261018-0007']) {
      expect(maskVnPhonesInText(keep)).toBe(keep);
    }
  });
});
