import { ForbiddenException } from '@nestjs/common';
import { REAL_USER_REQUIRED_MSG } from '../../../common/real-user';
import { assertActiveStaff } from '../../../common/staff-access';
import type { PrismaService } from '../../../prisma/prisma.service';
import { WasteAccessService, eligibilityOf } from './waste-access.service';

jest.mock('../../../common/staff-access', () => {
  const actual = jest.requireActual<typeof import('../../../common/staff-access')>('../../../common/staff-access');
  return { ...actual, assertActiveStaff: jest.fn(actual.assertActiveStaff) };
});

const OFF = 'Tính năng Đổi rác lấy quà đang tắt. Liên hệ quản trị viên.';
const PHONE = 'Bạn cần chia sẻ số điện thoại để dùng Đổi rác lấy quà.';
const BLOCKED = 'Tài khoản của bạn tạm không tham gia Đổi rác, liên hệ Tubu Tree.';
const real = { id: 'u1', phone: '0901234567', zaloId: 'z1', isBlocked: false, mergedIntoId: null, wasteFlags: null };
const guest = { ...real, phone: null, zaloId: 'guest_dev1' };
const noPhone = { ...real, phone: null };
const blocked = { ...real, wasteFlags: { blockedAt: new Date('2026-10-01T00:00:00Z'), shipLockedAt: null } };
const shipLocked = { ...real, wasteFlags: { blockedAt: null, shipLockedAt: new Date('2026-10-02T00:00:00Z') } };
const svcFor = (row: unknown) => {
  const findUnique = jest.fn().mockResolvedValue(row);
  return { svc: new WasteAccessService({ user: { findUnique } } as unknown as PrismaService), findUnique };
};

describe('eligibilityOf', () => {
  it('GUEST before NEED_PHONE; a phone makes a guest_ zaloId real (isRealUser)', () => {
    expect(eligibilityOf({ phone: null, zaloId: 'guest_x' })).toBe('GUEST');
    expect(eligibilityOf({ phone: null, zaloId: null })).toBe('GUEST');
    expect(eligibilityOf({ phone: null, zaloId: 'z1' })).toBe('NEED_PHONE');
    expect(eligibilityOf({ phone: '0901234567', zaloId: 'guest_x' })).toBe('OK');
  });
});

describe('customerGate (spec 15.1; registry 4.13 messages)', () => {
  it.each<[string, unknown, boolean, string]>([
    ['FULL off beats guest', guest, false, OFF],
    ['FULL guest', guest, true, REAL_USER_REQUIRED_MSG],
    ['FULL no phone', noPhone, true, PHONE],
    ['FULL blocked', blocked, true, BLOCKED],
    ['FULL off for an eligible customer', real, false, OFF],
    ['FULL missing user', null, true, REAL_USER_REQUIRED_MSG],
  ])('%s -> 403', async (_n, row, enabled, msg) => {
    await expect(svcFor(row).svc.customerGate('u1', 'FULL', enabled)).rejects.toThrow(new ForbiddenException(msg));
  });
  it('FULL ok returns the context, shipLockedAt included', async () => {
    await expect(svcFor(shipLocked).svc.customerGate('u1', 'FULL', true)).resolves.toEqual({ userId: 'u1', phone: '0901234567', blocked: false, shipLockedAt: new Date('2026-10-02T00:00:00Z'), programmeEnabled: true });
  });
  it('OWN ignores the programme flag and blockedAt (tracking, cancel, own reads)', async () => {
    await expect(svcFor(blocked).svc.customerGate('u1', 'OWN', false)).resolves.toMatchObject({ blocked: true, programmeEnabled: false });
  });
  it.each<[string, unknown, string]>([['guest', guest, REAL_USER_REQUIRED_MSG], ['no phone', noPhone, PHONE]])('OWN %s -> 403', async (_n, row, msg) => {
    await expect(svcFor(row).svc.customerGate('u1', 'OWN', true)).rejects.toThrow(new ForbiddenException(msg));
  });
  it('re-reads the user on every call with the flag columns', async () => {
    const { svc, findUnique } = svcFor(real);
    await svc.customerGate('u1', 'OWN', true);
    await svc.customerGate('u1', 'OWN', true);
    expect(findUnique).toHaveBeenCalledTimes(2);
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'u1' }, select: { id: true, phone: true, zaloId: true, isBlocked: true, mergedIntoId: true, wasteFlags: { select: { blockedAt: true, shipLockedAt: true } } } });
  });
});

describe('assertPointAccess at the warehouse uses the shared staff check (spec 15.1 c)', () => {
  const caller = { id: 's1', role: 'STAFF', phone: '0901234567', isBlocked: false, mergedIntoId: null, wasteFlags: null };
  const make = (point: unknown) => {
    const db = { wastePoint: { findUnique: jest.fn().mockResolvedValue(point) }, user: { findUnique: jest.fn().mockResolvedValue(caller) } };
    return { svc: new WasteAccessService(db as unknown as PrismaService), db };
  };
  beforeEach(() => jest.mocked(assertActiveStaff).mockClear());
  it('WAREHOUSE: assertActiveStaff(db, userId) runs once and gives actorRole', async () => {
    const { svc, db } = make({ id: 'wh', kind: 'WAREHOUSE', name: 'Kho Tubu', status: 'ACTIVE', giftHandoverEnabled: false, monthlyQuotaPoints: null });
    await expect(svc.assertPointAccess('s1', 'wh', { programmeEnabled: false })).resolves.toMatchObject({ kind: 'WAREHOUSE', actorRole: 'STAFF', myRole: 'STAFF' });
    expect(assertActiveStaff).toHaveBeenCalledTimes(1);
    expect(assertActiveStaff).toHaveBeenCalledWith(db, 's1');
  });
  it('PARTNER with the programme off: 403 and no staff check', async () => {
    const { svc } = make({ id: 'p1', kind: 'PARTNER', name: 'Tạp hoá Cô Ba', status: 'ACTIVE', giftHandoverEnabled: false, monthlyQuotaPoints: 100_000 });
    await expect(svc.assertPointAccess('s1', 'p1', { programmeEnabled: false })).rejects.toThrow(new ForbiddenException(OFF));
    expect(assertActiveStaff).not.toHaveBeenCalled();
  });
});
