import { describe, it, expect } from 'vitest';
import { PROFILE_NAME_REQUIRED, cleanProfileName, profileNameError, usableProfileName } from './profile-name';

describe('usableProfileName', () => {
  it('giữ tên thật và cắt khoảng trắng', () => {
    expect(usableProfileName('  Phạm Văn CTV ')).toBe('Phạm Văn CTV');
  });
  it('bỏ tên giữ chỗ "Khách" không phân biệt hoa thường', () => {
    expect(usableProfileName('Khách')).toBe('');
    expect(usableProfileName(' khách ')).toBe('');
  });
  it('rỗng, null, undefined cho chuỗi rỗng', () => {
    expect(usableProfileName('')).toBe('');
    expect(usableProfileName(null)).toBe('');
    expect(usableProfileName(undefined)).toBe('');
  });
});

describe('profileNameError: chặn lưu hồ sơ khi họ tên rỗng', () => {
  it('rỗng, chỉ khoảng trắng, chỉ ký tự vô hình: báo lỗi yêu cầu nhập họ tên', () => {
    for (const name of ['', '   ', '\t\n', '\u200b', ' \u200b\ufeff\u00a0 ']) expect(profileNameError(name), JSON.stringify(name)).toBe(PROFILE_NAME_REQUIRED);
    expect(PROFILE_NAME_REQUIRED).toBe('Nhập họ tên để lưu hồ sơ.');
  });
  it('tên thật (kể cả một ký tự, có dấu, emoji ghép) thì không lỗi', () => {
    for (const name of ['An', 'A', '  Lã Hoàng Long  ', 'Hoa 👨\u200d👩\u200d👧']) expect(profileNameError(name), name).toBeNull();
  });
});

describe('cleanProfileName: cắt hai đầu như API, giữ phần giữa', () => {
  it('bỏ khoảng trắng và ký tự vô hình hai đầu', () => {
    expect(cleanProfileName('\u200b  Nguyễn Văn An \ufeff')).toBe('Nguyễn Văn An');
    expect(cleanProfileName('   ')).toBe('');
  });
  it('giữ ký tự nối emoji ở giữa', () => {
    expect(cleanProfileName(' Hoa 👨\u200d👩 ')).toBe('Hoa 👨\u200d👩');
  });
});
