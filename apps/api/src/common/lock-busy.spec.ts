import { Prisma } from '@prisma/client';
import { isLockBusy, isSerializationFailure } from './lock-busy';

const known = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('x', { code, clientVersion: 'x', meta });

describe('isSerializationFailure', () => {
  it('nhận P2034 và P2010 mang meta.code 40001', () => {
    expect(isSerializationFailure(known('P2034'))).toBe(true);
    expect(isSerializationFailure(known('P2010', { code: '40001', message: 'could not serialize access' }))).toBe(true);
  });

  it('fallback theo message chứa 40001 / could not serialize access', () => {
    expect(isSerializationFailure(new Error('Raw query failed. Code: `40001`'))).toBe(true);
    expect(isSerializationFailure(new Error('could not serialize access due to concurrent update'))).toBe(true);
  });

  it('không nhận lỗi khác', () => {
    expect(isSerializationFailure(known('P2010', { code: '42703' }))).toBe(false);
    expect(isSerializationFailure(known('P2002'))).toBe(false);
    expect(isSerializationFailure(null)).toBe(false);
    expect(isSerializationFailure('40001')).toBe(false);
  });

  it('isLockBusy cũng coi 40001 qua câu raw là bận', () => {
    expect(isLockBusy(known('P2010', { code: '40001' }))).toBe(true);
    expect(isLockBusy(known('P2028'))).toBe(true);
  });
});
