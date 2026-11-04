import { describe, it, expect } from 'vitest';
import { usableProfileName } from './profile-name';

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
