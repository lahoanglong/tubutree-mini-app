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

  it('IV ngắn, tag ngắn hoặc tag bị sửa đều ném đúng một lỗi rõ ràng, không lộ lỗi OpenSSL', () => {
    const [v, iv, tag, ct] = encrypt('bí mật', key).split(':');
    const shortIv = Buffer.from(iv, 'base64').subarray(0, 8).toString('base64');
    const shortTag = Buffer.from(tag, 'base64').subarray(0, 4).toString('base64');
    const badTag = Buffer.from(tag, 'base64');
    badTag[0] ^= 1;
    for (const bad of [[v, shortIv, tag, ct], [v, iv, shortTag, ct], [v, iv, badTag.toString('base64'), ct]]) {
      expect(() => decrypt(bad.join(':'), key)).toThrow('credentials file corrupt');
    }
  });
});
