import 'reflect-metadata';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { NOT_NULL_CONSTRAINT } from '../../../common/decorators/optional-not-null.decorator';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';
import {
  AdminWastePointQueryDto, WastePointCreateDto, WastePerkReviewDto, WastePointStaffAddDto, WastePointUpdateDto, WasteAdminPointsController,
} from './waste-admin-points.controller';

type VErr = { constraints?: Record<string, string>; children?: VErr[] };
const keysOf = (errs: VErr[]): string[] => errs.flatMap((e) => [...Object.keys(e.constraints ?? {}), ...keysOf(e.children ?? [])]);
async function errorKeys<T extends object>(cls: new () => T, plain: Record<string, unknown>): Promise<string[]> {
  return keysOf(await validate(plainToInstance(cls, plain), { whitelist: true, forbidNonWhitelisted: true }));
}

describe('WasteAdminPointsController', () => {
  const proto = WasteAdminPointsController.prototype;
  const handlers = [proto.list, proto.create, proto.update, proto.reorder];

  it('is mounted at admin/waste/points', () => {
    expect(Reflect.getMetadata(PATH_METADATA, WasteAdminPointsController)).toBe('admin/waste/points');
  });

  it('declares the route table', () => {
    expect(Reflect.getMetadata(PATH_METADATA, proto.list)).toBe('/');
    expect(Reflect.getMetadata(METHOD_METADATA, proto.list)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(PATH_METADATA, proto.create)).toBe('/');
    expect(Reflect.getMetadata(METHOD_METADATA, proto.create)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(PATH_METADATA, proto.update)).toBe(':id');
    expect(Reflect.getMetadata(METHOD_METADATA, proto.update)).toBe(RequestMethod.PATCH);
    expect(Reflect.getMetadata(PATH_METADATA, proto.reorder)).toBe('order');
    expect(Reflect.getMetadata(METHOD_METADATA, proto.reorder)).toBe(RequestMethod.PUT);
  });

  it('declares ADMIN roles on every handler', () => {
    for (const h of handlers) expect(Reflect.getMetadata(ROLES_KEY, h)).toEqual(['ADMIN']);
  });

  it('declares throttles on writes only', () => {
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', proto.create)).toBe(30);
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', proto.update)).toBe(30);
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', proto.reorder)).toBe(30);
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', proto.list)).toBeUndefined();
  });

  it('parses the list query: perkPending "true" becomes a boolean and an unknown status is refused', async () => {
    expect(plainToInstance(AdminWastePointQueryDto, { perkPending: 'true' }).perkPending).toBe(true);
    expect(plainToInstance(AdminWastePointQueryDto, { perkPending: 'false' }).perkPending).toBe(false);
    expect(await errorKeys(AdminWastePointQueryDto, { status: 'GONE' })).not.toEqual([]);
  });

  it('validates the update body: null is refused on non-nullable fields, allowed for quota and coordinates', async () => {
    expect(await errorKeys(WastePointUpdateDto, { name: null })).toContain(NOT_NULL_CONSTRAINT);
    expect(await errorKeys(WastePointUpdateDto, { monthlyQuotaPoints: null })).toEqual([]);
    expect(await errorKeys(WastePointUpdateDto, { lat: null })).toEqual([]);
  });

  it('refuses a create body with a zero quota', async () => {
    const body = { kind: 'PARTNER', name: 'A', addressLine: 'B', provinceCode: '79', provinceName: 'TP.HCM', communeCode: '1', communeName: 'P1' };

    expect(await errorKeys(WastePointCreateDto, { ...body, monthlyQuotaPoints: 0 })).not.toEqual([]);
    expect(await errorKeys(WastePointCreateDto, { ...body, monthlyQuotaPoints: 100_000 })).toEqual([]);
  });

  it('declares the staff and perk routes: ADMIN only, 30 per minute, and no other handler (points are never hard-deleted)', () => {
    const routes = [
      [proto.addStaff, ':id/staff', RequestMethod.POST],
      [proto.removeStaff, ':id/staff/:userId', RequestMethod.DELETE],
      [proto.approvePerk, ':id/perk/approve', RequestMethod.POST],
      [proto.rejectPerk, ':id/perk/reject', RequestMethod.POST],
    ] as const;
    for (const [h, path, method] of routes) {
      expect(Reflect.getMetadata(PATH_METADATA, h)).toBe(path);
      expect(Reflect.getMetadata(METHOD_METADATA, h)).toBe(method);
      expect(Reflect.getMetadata(ROLES_KEY, h)).toEqual(['ADMIN']);
      expect(Reflect.getMetadata('THROTTLER:LIMITdefault', h)).toBe(30);
    }
    const p = WasteAdminPointsController.prototype;
    expect(Object.getOwnPropertyNames(p).filter((k) => Reflect.getMetadata(METHOD_METADATA, (p as never)[k]) !== undefined).sort()).toEqual([
      'addStaff', 'approvePerk', 'create', 'list', 'rejectPerk', 'removeStaff', 'reorder', 'update',
    ]);
  });

  it('requires the reviewed perk text on approve and reject and forwards it', async () => {
    expect(await errorKeys(WastePerkReviewDto, {})).not.toEqual([]);
    expect(await errorKeys(WastePerkReviewDto, { expectedPendingText: 'x'.repeat(301) })).not.toEqual([]);
    expect(await errorKeys(WastePerkReviewDto, { expectedPendingText: 'Giảm 10%' })).toEqual([]);

    const svc = { approvePerk: jest.fn().mockResolvedValue('ok'), rejectPerk: jest.fn().mockResolvedValue('ok') };
    const ctrl = new WasteAdminPointsController(svc as never);
    await ctrl.approvePerk('a1', 'p1', { expectedPendingText: 'Giảm 10%' });
    await ctrl.rejectPerk('a1', 'p1', { expectedPendingText: 'Giảm 10%' });
    expect(svc.approvePerk).toHaveBeenCalledWith('a1', 'p1', 'Giảm 10%');
    expect(svc.rejectPerk).toHaveBeenCalledWith('a1', 'p1', 'Giảm 10%');
  });

  it('validates the staff add body: only OWNER and STAFF roles', async () => {
    expect(await errorKeys(WastePointStaffAddDto, { userId: 'u1', role: 'MANAGER' })).not.toEqual([]);
    expect(await errorKeys(WastePointStaffAddDto, { userId: 'u1', role: 'OWNER' })).toEqual([]);
  });
});
