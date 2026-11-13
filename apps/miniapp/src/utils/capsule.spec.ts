import { describe, expect, it } from 'vitest';
import { CAPSULE_INSET_END, capsuleExtra } from './capsule';

describe('capsule', () => {
  it('khớp quy ước 96px phải của ShopTopBar', () => {
    expect(CAPSULE_INSET_END).toBe(96);
  });

  it('phần bù cộng với lề sẵn có bằng đúng vùng viên thuốc', () => {
    expect(capsuleExtra(16) + 16).toBe(CAPSULE_INSET_END);
  });

  it('lề sẵn có đã rộng hơn vùng viên thuốc thì không bù và không âm', () => {
    expect(capsuleExtra(CAPSULE_INSET_END + 40)).toBe(0);
  });
});
