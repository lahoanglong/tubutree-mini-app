import { describeError, describeSecret, envValue, looksLikePlaceholder } from './secrets';

describe('describeSecret', () => {
  it('chưa đặt', () => expect(describeSecret('')).toBe('chưa đặt'));
  it('phân nhóm theo độ dài', () => {
    expect(describeSecret('abc')).toContain('dưới 16');
    expect(describeSecret('a'.repeat(15))).toContain('dưới 16');
    expect(describeSecret('a'.repeat(16))).toContain('16 đến 31');
    expect(describeSecret('a'.repeat(31))).toContain('16 đến 31');
    expect(describeSecret('a'.repeat(32))).toContain('từ 32');
  });
  it('không bao giờ chứa ký tự nào của giá trị', () => {
    const secret = 'Zx9Qw3Er7Ty1Ui5Op8As2Df6Gh0Jk4LmNb';
    const out = describeSecret(secret);
    for (let i = 0; i + 3 <= secret.length; i += 1) expect(out).not.toContain(secret.slice(i, i + 3));
  });
});

describe('looksLikePlaceholder', () => {
  it.each(['dev-access-secret-change-me-please', 'changeme', 'CHANGE_ME', 'replace-me', 'your-secret-here', 'example', 'secret', 'xxxxxxxx'])('%s là mẫu', (v) => {
    expect(looksLikePlaceholder(v)).toBe(true);
  });
  it.each(['k9Zq-access-Vb3nT7xW2mLpR8sYd4HfGc6JaQe1UoNi', 'Zx9Qw3Er7Ty1Ui5Op8As2Df6Gh0Jk4LmNb'])('%s không phải mẫu', (v) => {
    expect(looksLikePlaceholder(v)).toBe(false);
  });
});

describe('envValue', () => {
  it('cắt khoảng trắng, thiếu thì rỗng', () => {
    expect(envValue({ A: '  x  ' }, 'A')).toBe('x');
    expect(envValue({}, 'A')).toBe('');
    expect(envValue({ A: undefined }, 'A')).toBe('');
  });
});

describe('describeError', () => {
  it('ưu tiên mã lỗi, rồi tên lỗi, và không lộ thông điệp', () => {
    expect(describeError(Object.assign(new Error('Authentication failed for user tubu at db.internal'), { code: 'P1000' }))).toBe('P1000');
    expect(describeError(Object.assign(new Error('Can not reach db at tubu:pw@host'), { errorCode: 'P1001' }))).toBe('P1001');
    const named = new TypeError('password=hunter2');
    expect(describeError(named)).toBe('TypeError');
    expect(describeError(named)).not.toContain('hunter2');
  });
  it('giá trị lạ', () => {
    expect(describeError(undefined)).toBe('lỗi không rõ');
    expect(describeError('chuỗi')).toBe('lỗi không rõ');
    expect(describeError({})).toBe('lỗi không rõ');
  });
});
