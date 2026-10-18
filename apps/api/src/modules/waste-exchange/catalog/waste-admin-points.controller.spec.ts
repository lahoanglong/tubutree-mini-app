import 'reflect-metadata';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { NOT_NULL_CONSTRAINT } from '../../../common/decorators/optional-not-null.decorator';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';
import { AdminWastePointQueryDto, WastePointCreateDto, WastePointUpdateDto, WasteAdminPointsController } from './waste-admin-points.controller';

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
});
