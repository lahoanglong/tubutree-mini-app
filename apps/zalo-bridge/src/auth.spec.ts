import { describe, expect, it } from 'vitest';
import { isAuthorized } from './auth';

const secret = 'a'.repeat(32);

describe('isAuthorized', () => {
  it('Bearer đúng secret thì true', () => {
    expect(isAuthorized(`Bearer ${secret}`, secret)).toBe(true);
  });
  it('thiếu header thì false', () => {
    expect(isAuthorized(undefined, secret)).toBe(false);
  });
  it('sai một ký tự thì false', () => {
    expect(isAuthorized(`Bearer ${'a'.repeat(31)}b`, secret)).toBe(false);
  });
  it('độ dài khác thì false', () => {
    expect(isAuthorized(`Bearer ${secret}x`, secret)).toBe(false);
    expect(isAuthorized('Bearer ', secret)).toBe(false);
  });
  it('không có tiền tố Bearer thì false', () => {
    expect(isAuthorized(secret, secret)).toBe(false);
  });
});
