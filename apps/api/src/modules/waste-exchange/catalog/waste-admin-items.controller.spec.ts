import 'reflect-metadata';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { NOT_NULL_CONSTRAINT } from '../../../common/decorators/optional-not-null.decorator';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';
import { WasteAdminItemsController, WasteItemCreateDto, WasteItemUpdateDto } from './waste-admin-items.controller';

type VErr = { constraints?: Record<string, string>; children?: VErr[] };
const keysOf = (errs: VErr[]): string[] => errs.flatMap((e) => [...Object.keys(e.constraints ?? {}), ...keysOf(e.children ?? [])]);
async function errorKeys<T extends object>(cls: new () => T, plain: Record<string, unknown>): Promise<string[]> {
  return keysOf(await validate(plainToInstance(cls, plain), { whitelist: true, forbidNonWhitelisted: true }));
}

describe('WasteAdminItemsController', () => {
  const proto = WasteAdminItemsController.prototype;

  it('declares the route table', () => {
    expect(Reflect.getMetadata(PATH_METADATA, WasteAdminItemsController)).toBe('admin/waste/items');
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
    for (const h of [proto.list, proto.create, proto.update, proto.reorder]) expect(Reflect.getMetadata(ROLES_KEY, h)).toEqual(['ADMIN']);
  });

  it('declares throttles on writes only', () => {
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', proto.create)).toBe(30);
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', proto.update)).toBe(30);
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', proto.reorder)).toBe(30);
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', proto.list)).toBeUndefined();
  });

  it('validates the create body', async () => {
    expect(await errorKeys(WasteItemCreateDto, { code: 'hop sua', name: 'Vỏ', unitLabel: 'vỏ', unitsPerPoint: 5, pointsPerGroup: 1000 })).toContain('matches');
    expect(await errorKeys(WasteItemCreateDto, { code: 'HOP_SUA', name: 'Vỏ', unitLabel: 'vỏ', unitsPerPoint: 0, pointsPerGroup: 1000 })).not.toEqual([]);
    expect(await errorKeys(WasteItemCreateDto, { code: 'HOP_SUA', name: 'Vỏ', unitLabel: 'vỏ', unitsPerPoint: 5, pointsPerGroup: 1000, monthlyCapQty: null })).toEqual([]);
  });

  it('validates the update body: null is refused on non-nullable columns and allowed to clear the nullable ones', async () => {
    expect(await errorKeys(WasteItemUpdateDto, { unitsPerPoint: null })).toContain(NOT_NULL_CONSTRAINT);
    expect(await errorKeys(WasteItemUpdateDto, { dailyCapQty: null })).toEqual([]);
  });

  it('update forwards the caller, the id and the body', async () => {
    const service = { update: jest.fn().mockResolvedValue({ id: 'i1' }) };
    const ctrl = new WasteAdminItemsController(service as never);
    const body = { unitsPerPoint: 3 };
    await expect(ctrl.update('a1', 'i1', body)).resolves.toEqual({ id: 'i1' });
    expect(service.update).toHaveBeenCalledWith('a1', 'i1', body);
  });

  it('reorder forwards the caller and the body', async () => {
    const service = { reorder: jest.fn().mockResolvedValue([]) };
    const ctrl = new WasteAdminItemsController(service as never);
    await ctrl.reorder('a1', { ids: ['i9', 'i1'] });
    expect(service.reorder).toHaveBeenCalledWith('a1', { ids: ['i9', 'i1'] });
  });
});
