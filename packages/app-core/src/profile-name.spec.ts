import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
    for (const name of ['', '   ', '\t\n', '\u200b', ' \u200b\ufeff\u00a0 ', '\u3164', '\u3164 \u3164', '\u2800', '\u115f\u1160\uffa0']) {
      expect(profileNameError(name), JSON.stringify(name)).toBe(PROFILE_NAME_REQUIRED);
    }
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

describe('tập ký tự vô hình khớp API', () => {
  it('profile-name.ts và Trim của API (text-trim.ts) dùng cùng một chuỗi INVISIBLE, viết bằng mã \\u', () => {
    const line = (file: string) => readFileSync(resolve(__dirname, file), 'utf8').match(/^const INVISIBLE = '([^']*)';$/m)?.[1];
    const mine = line('profile-name.ts');
    expect(mine).toMatch(/^(\\u[0-9a-f]{4}-?)+$/);
    expect(mine).toBe(line('../../../apps/api/src/common/text-trim.ts'));
  });
});
