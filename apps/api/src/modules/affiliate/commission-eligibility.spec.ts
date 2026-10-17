import { DEFAULT_COMMISSION_ELIGIBLE_ROLES, eligibleRolesProblem, sanitizeEligibleRoles } from './commission-eligibility';

describe('affiliate.commission_eligible_roles', () => {
  it('mặc định chỉ CTV + đại lý', () => {
    expect([...DEFAULT_COMMISSION_ELIGIBLE_ROLES]).toEqual(['AFFILIATE', 'DEALER']);
    expect([...sanitizeEligibleRoles(undefined)]).toEqual(['AFFILIATE', 'DEALER']);
  });

  it('mảng vai trò hợp lệ (kể cả thêm CUSTOMER) giữ nguyên', () => {
    expect(eligibleRolesProblem(['AFFILIATE', 'DEALER', 'CUSTOMER'])).toBeNull();
    expect([...sanitizeEligibleRoles(['DEALER'])]).toEqual(['DEALER']);
  });

  it.each([[[]], ['AFFILIATE'], [['CTV']], [['AFFILIATE', 2]], [null], [{ AFFILIATE: true }]])('giá trị hỏng %j → báo lỗi, đọc ra mặc định', (v) => {
    expect(eligibleRolesProblem(v)).toEqual(expect.any(String));
    expect([...sanitizeEligibleRoles(v)]).toEqual(['AFFILIATE', 'DEALER']);
  });
});
