import { isRealUser } from './real-user';

describe('isRealUser', () => {
  it('khách guest_ không SĐT → không phải user thật', () => {
    expect(isRealUser({ zaloId: 'guest_dev1', phone: null })).toBe(false);
    expect(isRealUser({ zaloId: 'guest_dev1_merged_x', phone: null })).toBe(false);
  });
  it('guest đã có SĐT xác thực → user thật', () => {
    expect(isRealUser({ zaloId: 'guest_dev1', phone: '0912345678' })).toBe(true);
  });
  it('zaloId Zalo thật → user thật', () => {
    expect(isRealUser({ zaloId: '123456789', phone: null })).toBe(true);
  });
  it('không zaloId, không SĐT, hoặc null → không phải user thật', () => {
    expect(isRealUser({ zaloId: null, phone: null })).toBe(false);
    expect(isRealUser(null)).toBe(false);
  });
});
