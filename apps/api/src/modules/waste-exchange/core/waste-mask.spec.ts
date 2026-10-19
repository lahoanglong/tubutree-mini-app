import { maskPhoneOrNull } from '../../../common/mask-pii';
import { customerView } from './waste-mask';

const u = { fullName: 'Nguyễn Văn An', phone: '0901234567', id: 'u1' };
describe('customerView (spec 15.1: masked unless the re-read role is ADMIN; userId only for ADMIN and when needed)', () => {
  it('non-admin: masked name and phone, never userId', () => {
    expect(customerView(u, false)).toEqual({ name: 'An***', phone: maskPhoneOrNull('0901234567') });
    expect(customerView(u, false, true)).toEqual({ name: 'An***', phone: maskPhoneOrNull('0901234567') });
  });
  it('admin: full values; userId only when asked', () => {
    expect(customerView(u, true)).toEqual({ name: 'Nguyễn Văn An', phone: '0901234567' });
    expect(customerView(u, true, true)).toEqual({ name: 'Nguyễn Văn An', phone: '0901234567', userId: 'u1' });
  });
  it('missing name -> Khách Tubu for both', () => {
    expect(customerView({ ...u, fullName: null }, true).name).toBe('Khách Tubu');
    expect(customerView({ ...u, fullName: '  ' }, true).name).toBe('Khách Tubu');
    expect(customerView({ ...u, fullName: null, phone: null }, false)).toEqual({ name: 'Khách Tubu', phone: null });
  });
});
