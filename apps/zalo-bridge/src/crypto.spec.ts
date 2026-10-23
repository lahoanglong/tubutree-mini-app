import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decrypt, encrypt } from './crypto';

const key = randomBytes(32);

describe('crypto', () => {
  it('mã rồi giải ra đúng chuỗi', () => {
    const blob = encrypt('xin chào Tubu', key);
    expect(blob.startsWith('v1:')).toBe(true);
    expect(decrypt(blob, key)).toBe('xin chào Tubu');
  });

  it('sửa một byte của ct thì decrypt ném lỗi', () => {
    const [v, iv, tag, ct] = encrypt('bí mật', key).split(':');
    const bytes = Buffer.from(ct, 'base64');
    bytes[0] ^= 1;
    expect(() => decrypt([v, iv, tag, bytes.toString('base64')].join(':'), key)).toThrow();
  });

  it('sai khoá hoặc sai định dạng thì ném lỗi', () => {
    const blob = encrypt('x', key);
    expect(() => decrypt(blob, randomBytes(32))).toThrow();
    expect(() => decrypt('rác', key)).toThrow();
  });
});
