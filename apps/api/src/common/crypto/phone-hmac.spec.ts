import { createHash } from 'node:crypto';
import { PHONE_HMAC_SECRET_ENV, hmacPhone, phoneHmacKeySource } from './phone-hmac';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const PHONE = '0912345678';

describe('hmacPhone', () => {
  it('cùng SĐT, cùng bí mật → cùng mã (dùng làm khoá tra cứu được)', () => {
    expect(hmacPhone(PHONE, 'secret-a')).toBe(hmacPhone(PHONE, 'secret-a'));
    expect(hmacPhone(PHONE, 'secret-a')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('khác bí mật → khác mã: không có bí mật thì không vét cạn được ~1 tỷ số di động', () => {
    expect(hmacPhone(PHONE, 'secret-a')).not.toBe(hmacPhone(PHONE, 'secret-b'));
  });

  it('khác SĐT → khác mã', () => {
    expect(hmacPhone(PHONE, 's')).not.toBe(hmacPhone('0987654321', 's'));
  });

  it('mọi cách ghi cùng một số (0…, +84…, 84…, có dấu cách, chấm) ra cùng một mã', () => {
    const forms = [PHONE, '+84912345678', '84912345678', '0912 345 678', '091.234.5678'];
    expect(new Set(forms.map((p) => hmacPhone(p, 's'))).size).toBe(1);
  });

  it('mã không chứa số thô và không phải sha256 trần (kể cả có tiền tố) của số', () => {
    const h = hmacPhone(PHONE, 's')!;
    expect(h).not.toContain('912345678');
    expect(h).not.toBe(sha256(PHONE));
    expect(h).not.toBe(sha256(`flash-phone:${PHONE}`));
  });

  it('không có SĐT → null', () => {
    expect(hmacPhone('', 's')).toBeNull();
    expect(hmacPhone(null, 's')).toBeNull();
    expect(hmacPhone(undefined, 's')).toBeNull();
    expect(hmacPhone(' - ', 's')).toBeNull();
  });
});

describe('bí mật mặc định (đọc môi trường lúc gọi)', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it(`${PHONE_HMAC_SECRET_ENV} có giá trị → dùng nó`, () => {
    process.env[PHONE_HMAC_SECRET_ENV] = 'x'.repeat(40);
    process.env.JWT_ACCESS_SECRET = 'j'.repeat(40);
    expect(phoneHmacKeySource()).toBe('env');
    expect(hmacPhone(PHONE)).toBe(hmacPhone(PHONE, 'x'.repeat(40)));
  });

  it(`chưa đặt ${PHONE_HMAC_SECRET_ENV} → khoá suy ra từ JWT_ACCESS_SECRET: production không hỏng khi deploy, mã vẫn cần bí mật`, () => {
    delete process.env[PHONE_HMAC_SECRET_ENV];
    process.env.JWT_ACCESS_SECRET = 'j'.repeat(40);
    expect(phoneHmacKeySource()).toBe('jwt');
    const fromJwt = hmacPhone(PHONE)!;
    expect(fromJwt).toMatch(/^[0-9a-f]{64}$/);
    // Không dùng thẳng khoá JWT làm khoá HMAC: mã của SĐT không giúp gì cho việc đoán khoá ký phiên.
    expect(fromJwt).not.toBe(hmacPhone(PHONE, 'j'.repeat(40)));
    process.env.JWT_ACCESS_SECRET = 'k'.repeat(40);
    expect(hmacPhone(PHONE)).not.toBe(fromJwt);
  });

  it('khoảng trắng hai đầu không tính; chuỗi toàn khoảng trắng coi như chưa đặt', () => {
    process.env.JWT_ACCESS_SECRET = 'j'.repeat(40);
    process.env[PHONE_HMAC_SECRET_ENV] = '   ';
    expect(phoneHmacKeySource()).toBe('jwt');
    process.env[PHONE_HMAC_SECRET_ENV] = ` ${'x'.repeat(40)} `;
    expect(hmacPhone(PHONE)).toBe(hmacPhone(PHONE, 'x'.repeat(40)));
  });

  it('máy dev/test không có bí mật nào → khoá dev cố định, kết quả vẫn tất định và khác bản suy ra từ JWT', () => {
    delete process.env[PHONE_HMAC_SECRET_ENV];
    delete process.env.JWT_ACCESS_SECRET;
    expect(phoneHmacKeySource()).toBe('dev');
    const dev = hmacPhone(PHONE);
    expect(hmacPhone(PHONE)).toBe(dev);
    process.env.JWT_ACCESS_SECRET = 'j'.repeat(40);
    expect(hmacPhone(PHONE)).not.toBe(dev);
  });
});
