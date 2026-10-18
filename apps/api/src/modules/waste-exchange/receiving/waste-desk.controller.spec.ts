import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';
import { deviceMetaOf } from '../core/waste-events';
import { createValidationPipe } from '../../../common/validation-pipe';
import { WasteDeskController, WasteDeskLookupDto, WastePerkDto } from './waste-desk.controller';
import { WasteConfirmDto, WasteRejectDto } from './waste-receiving.dto';

const proto = WasteDeskController.prototype;
const handlers = ['points', 'lookup', 'confirm', 'reject', 'submitPerk'] as const;
const THROTTLE_KEY = 'THROTTLER:LIMITdefault';

const rows = Object.getOwnPropertyNames(proto)
  .filter((k) => Reflect.getMetadata(METHOD_METADATA, (proto as never)[k]) !== undefined)
  .map((k) => [
    RequestMethod[Reflect.getMetadata(METHOD_METADATA, (proto as never)[k])],
    Reflect.getMetadata(PATH_METADATA, WasteDeskController) + '/' + Reflect.getMetadata(PATH_METADATA, (proto as never)[k]),
  ]);

describe('WasteDeskController routes', () => {
  it('exposes exactly the five desk routes', () => {
    expect(rows).toHaveLength(5);
    expect(rows).toEqual(
      expect.arrayContaining([
        ['GET', 'waste/desk/points'],
        ['POST', 'waste/desk/lookup'],
        ['POST', 'waste/desk/requests/:id/confirm'],
        ['POST', 'waste/desk/requests/:id/reject'],
        ['PUT', 'waste/desk/points/:pointId/perk'],
      ]),
    );
  });

  it('throttles lookup, confirm and reject at 30 per minute, the perk at 10, and leaves points alone', () => {
    expect(Reflect.getMetadata(THROTTLE_KEY, proto.lookup)).toBe(30);
    expect(Reflect.getMetadata(THROTTLE_KEY, proto.confirm)).toBe(30);
    expect(Reflect.getMetadata(THROTTLE_KEY, proto.reject)).toBe(30);
    expect(Reflect.getMetadata(THROTTLE_KEY, proto.submitPerk)).toBe(10);
    expect(Reflect.getMetadata(THROTTLE_KEY, proto.points)).toBeUndefined();
  });

  it('carries no @Roles on the class or any handler', () => {
    expect(Reflect.getMetadata(ROLES_KEY, WasteDeskController)).toBeUndefined();
    for (const h of handlers) expect(Reflect.getMetadata(ROLES_KEY, proto[h])).toBeUndefined();
  });
});

describe('WasteDeskController handlers', () => {
  const req = { ip: '1.2.3.4', headers: { 'user-agent': 'jest' } };
  const device = deviceMetaOf(req);
  const desk = { points: jest.fn().mockResolvedValue(['p']), lookup: jest.fn().mockResolvedValue('l'), submitPerk: jest.fn().mockResolvedValue('perk') };
  const confirmService = { confirm: jest.fn().mockResolvedValue('c'), reject: jest.fn().mockResolvedValue('r') };
  const controller = new WasteDeskController(desk as never, confirmService as never);

  beforeEach(() => jest.clearAllMocks());

  it('forwards the caller, the DESK route and the device meta to confirm', async () => {
    const body = { lines: [{ itemId: 'i', declaredQty: 1, receivedQty: 1 }] } as WasteConfirmDto;
    await expect(controller.confirm('u1', 'r1', body, req as never)).resolves.toBe('c');
    expect(confirmService.confirm).toHaveBeenCalledWith({ callerUserId: 'u1', requestId: 'r1', route: 'DESK', device }, body);
  });

  it('forwards the caller, the DESK route and the device meta to reject', async () => {
    const body = { rejectionReason: 'WET' } as WasteRejectDto;
    await expect(controller.reject('u1', 'r1', body, req as never)).resolves.toBe('r');
    expect(confirmService.reject).toHaveBeenCalledWith({ callerUserId: 'u1', requestId: 'r1', route: 'DESK', device }, body);
  });

  it('delegates points, lookup and perk to the desk service', async () => {
    await controller.points('u1');
    await controller.lookup('u1', { code: 'ABC' });
    await controller.submitPerk('u1', 'pt', { perkText: 'x' });
    expect(desk.points).toHaveBeenCalledWith('u1');
    expect(desk.lookup).toHaveBeenCalledWith('u1', 'ABC');
    expect(desk.submitPerk).toHaveBeenCalledWith('u1', 'pt', { perkText: 'x' });
  });
});

describe('desk body validation', () => {
  const pipe = createValidationPipe();
  const run = (metatype: new () => object, value: unknown) => pipe.transform(value, { type: 'body', metatype });
  const line = { itemId: 'i', declaredQty: 2, receivedQty: 2 };

  it('accepts a valid confirm body', async () => {
    const out = (await run(WasteConfirmDto, { lines: [line], receivedWeightGrams: 100000, match: { parcelTracking: 'x'.repeat(64) } })) as WasteConfirmDto;
    expect(out).toBeInstanceOf(WasteConfirmDto);
    expect(out.match?.parcelTracking).toHaveLength(64);
  });

  it.each([
    ['receivedQty -1', WasteConfirmDto, { lines: [{ ...line, receivedQty: -1 }] }],
    ['receivedWeightGrams 100001', WasteConfirmDto, { lines: [line], receivedWeightGrams: 100001 }],
    ['empty lines', WasteConfirmDto, { lines: [] }],
    ['parcelTracking of 65 characters', WasteConfirmDto, { lines: [line], match: { parcelTracking: 'x'.repeat(65) } }],
    ['rejectionReason BAD', WasteRejectDto, { rejectionReason: 'BAD' }],
    ['perkText null', WastePerkDto, { perkText: null }],
    ['lookup code of 65 characters', WasteDeskLookupDto, { code: 'x'.repeat(65) }],
  ])('rejects %s with 400', async (_name, metatype, value) => {
    await expect(run(metatype as new () => object, plainToInstance(metatype as never, value) as never)).rejects.toMatchObject({ status: 400 });
  });
});
