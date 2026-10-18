import { ForbiddenException } from '@nestjs/common';
import { assertActiveAdmin, assertActiveStaff } from './staff-access';

const STAFF_MSG = 'Chỉ nhân viên hoặc quản trị viên mới làm được thao tác này.';
const db = (...rows: unknown[]) => {
  const findUnique = jest.fn();
  for (const r of rows) findUnique.mockResolvedValueOnce(r);
  return { db: { user: { findUnique } } as never, findUnique };
};
const row = (over: Record<string, unknown> = {}) => ({ id: 's1', role: 'STAFF', isBlocked: false, mergedIntoId: null, phone: '0901234567', ...over });

describe('assertActiveStaff (spec 15.1 b, c; re-read from DB on every call)', () => {
  it.each(['STAFF', 'ADMIN'])('%s active -> { id, role, phone }', async (role) => {
    const { db: d, findUnique } = db(row({ role }));
    await expect(assertActiveStaff(d, 's1')).resolves.toEqual({ id: 's1', role, phone: '0901234567' });
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 's1' }, select: { id: true, role: true, isBlocked: true, mergedIntoId: true, phone: true } });
  });
  it.each([
    ['customer', row({ role: 'CUSTOMER' })],
    ['dealer', row({ role: 'DEALER' })],
    ['blocked', row({ isBlocked: true })],
    ['merged', row({ mergedIntoId: 'u9' })],
    ['missing', null],
  ])('%s -> 403 with the default sentence', async (_n, r) => {
    const { db: d } = db(r);
    await expect(assertActiveStaff(d, 's1')).rejects.toThrow(new ForbiddenException(STAFF_MSG));
  });
  it('a caller message replaces the default (LoyaltyService keeps its sentence, registry 8.6)', async () => {
    const { db: d } = db(row({ role: 'CUSTOMER' }));
    await expect(assertActiveStaff(d, 's1', 'Chỉ nhân viên hoặc quản trị viên mới có quyền quét thẻ thành viên.')).rejects.toThrow('Chỉ nhân viên hoặc quản trị viên mới có quyền quét thẻ thành viên.');
  });
  it('a staff member demoted between two calls loses access on the second call', async () => {
    const { db: d } = db(row(), row({ role: 'CUSTOMER' }));
    await expect(assertActiveStaff(d, 's1')).resolves.toMatchObject({ role: 'STAFF' });
    await expect(assertActiveStaff(d, 's1')).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('assertActiveAdmin', () => {
  it('ADMIN passes, STAFF is refused', async () => {
    await expect(assertActiveAdmin(db(row({ role: 'ADMIN' })).db, 's1')).resolves.toMatchObject({ role: 'ADMIN' });
    await expect(assertActiveAdmin(db(row()).db, 's1')).rejects.toThrow(new ForbiddenException('Chỉ quản trị viên mới làm được thao tác này.'));
  });
});
