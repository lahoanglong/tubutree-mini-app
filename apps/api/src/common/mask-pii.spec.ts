import { maskPhone } from './mask-pii';

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
