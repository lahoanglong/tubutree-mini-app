import 'reflect-metadata';
import { BadRequestException, RequestMethod } from '@nestjs/common';
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { NOT_NULL_CONSTRAINT } from '../../../common/decorators/optional-not-null.decorator';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';
import { STAFF_PERMISSIONS_KEY } from '../../../common/staff-permissions';
import { createValidationPipe } from '../../../common/validation-pipe';
import { deviceMetaOf } from '../core/waste-events';
import {
  AdminWasteRequestQueryDto,
  WasteAdminRequestsController,
  WasteBulkActionDto,
  WasteCloseLostDto,
  WasteCostDto,
  WasteFeeBankConfirmDto,
  WasteLookupQueryDto,
  WasteReceiveDto,
  WasteReopenDto,
  WasteReverseDto,
  WasteUnmatchedCreateDto,
  WasteUnmatchedResolveDto,
  WasteUserFlagsDto,
} from './waste-admin-requests.controller';
import { WasteConfirmDto, WasteRejectDto } from './waste-receiving.dto';

const proto = WasteAdminRequestsController.prototype;
const THROTTLE_KEY = 'THROTTLER:LIMITdefault';
const SA = ['STAFF', 'ADMIN'];
const A = ['ADMIN'];

const table: [string, string, string, string[], number | undefined][] = [
  ['queue', 'GET', 'requests', SA, undefined],
  ['lookup', 'GET', 'requests/lookup', SA, 30],
  ['bulkAction', 'POST', 'requests/bulk-action', SA, 30],
  ['detail', 'GET', 'requests/:id', SA, undefined],
  ['receive', 'POST', 'requests/:id/receive', SA, 30],
  ['confirm', 'POST', 'requests/:id/confirm', SA, 30],
  ['reject', 'POST', 'requests/:id/reject', SA, 30],
  ['reverse', 'POST', 'requests/:id/reverse', A, 10],
  ['setCost', 'PATCH', 'requests/:id/cost', A, 30],
  ['closeLost', 'POST', 'requests/:id/close-lost', A, 10],
  ['reopen', 'POST', 'requests/:id/reopen', A, 10],
  ['confirmFeePaid', 'POST', 'requests/:id/confirm-fee-paid', A, 20],
  ['listUnmatched', 'GET', 'unmatched', SA, undefined],
  ['createUnmatched', 'POST', 'unmatched', SA, 30],
  ['resolveUnmatched', 'POST', 'unmatched/:id/resolve', SA, 30],
  ['getFlags', 'GET', 'users/:userId/flags', A, undefined],
  ['setFlags', 'PUT', 'users/:userId/flags', A, 10],
];

const rows = Object.getOwnPropertyNames(proto)
  .filter((k) => Reflect.getMetadata(METHOD_METADATA, (proto as never)[k]) !== undefined)
  .map((k) => [
    RequestMethod[Reflect.getMetadata(METHOD_METADATA, (proto as never)[k])],
    Reflect.getMetadata(PATH_METADATA, WasteAdminRequestsController) + '/' + Reflect.getMetadata(PATH_METADATA, (proto as never)[k]),
  ]);

describe('WasteAdminRequestsController routes', () => {
  it('exposes the seventeen admin routes (registry 5 + W178 confirm-fee-paid + w17-03 bulk-action)', () => {
    expect(Reflect.getMetadata(PATH_METADATA, WasteAdminRequestsController)).toBe('admin/waste');
    expect(rows).toHaveLength(17);
    expect(rows).toEqual(expect.arrayContaining(table.map(([, method, path]) => [method, 'admin/waste/' + path])));
  });

  it.each(table)('%s: method, path, roles and throttle', (handler, method, path, roles, limit) => {
    const fn = (proto as never)[handler];
    expect(RequestMethod[Reflect.getMetadata(METHOD_METADATA, fn)]).toBe(method);
    expect(Reflect.getMetadata(PATH_METADATA, fn)).toBe(path);
    expect(Reflect.getMetadata(ROLES_KEY, fn)).toEqual(roles);
    expect(Reflect.getMetadata(THROTTLE_KEY, fn)).toBe(limit);
  });

  it('carries no class-level @Roles and no @AllowStaff', () => {
    expect(Reflect.getMetadata(ROLES_KEY, WasteAdminRequestsController)).toBeUndefined();
    for (const [handler] of table) expect(Reflect.getMetadata(STAFF_PERMISSIONS_KEY, (proto as never)[handler])).toBeUndefined();
  });

  it('answers receive, confirmFeePaid and bulkAction with 200 and no other handler overrides the status', () => {
    const ok200 = ['receive', 'confirmFeePaid', 'bulkAction'];
    for (const h of ok200) expect(Reflect.getMetadata(HTTP_CODE_METADATA, (proto as never)[h])).toBe(200);
    for (const [handler] of table.filter(([h]) => !ok200.includes(h))) {
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, (proto as never)[handler])).toBeUndefined();
    }
  });

  it('declares lookup before detail so requests/lookup is not read as an id', () => {
    const names = Object.getOwnPropertyNames(WasteAdminRequestsController.prototype);
    expect(names.indexOf('lookup')).toBeGreaterThanOrEqual(0);
    expect(names.indexOf('lookup')).toBeLessThan(names.indexOf('detail'));
    expect(names.indexOf('bulkAction')).toBeGreaterThanOrEqual(0);
    expect(names.indexOf('bulkAction')).toBeLessThan(names.indexOf('detail'));
  });
});

describe('WasteAdminRequestsController handlers', () => {
  const req = { ip: '1.2.3.4', headers: { 'user-agent': 'jest' } };
  const device = deviceMetaOf(req);
  const admin = {
    queue: jest.fn().mockResolvedValue('queue'),
    lookup: jest.fn().mockResolvedValue('lookup'),
    detail: jest.fn().mockResolvedValue('detail'),
    setCost: jest.fn().mockResolvedValue('cost'),
    reopen: jest.fn().mockResolvedValue('reopen'),
    getFlags: jest.fn().mockResolvedValue('getFlags'),
    setFlags: jest.fn().mockResolvedValue('setFlags'),
  };
  const receive = {
    receive: jest.fn().mockResolvedValue('receive'),
    listUnmatched: jest.fn().mockResolvedValue('list'),
    createUnmatched: jest.fn().mockResolvedValue('create'),
    resolveUnmatched: jest.fn().mockResolvedValue('resolve'),
  };
  const confirm = { confirm: jest.fn().mockResolvedValue('c'), reject: jest.fn().mockResolvedValue('r'), closeLost: jest.fn().mockResolvedValue('lost') };
  const reverse = { reverse: jest.fn().mockResolvedValue('rev') };
  const feeBank = { confirmFeeBankPaid: jest.fn().mockResolvedValue('feePaid') };
  const bulk = { run: jest.fn().mockResolvedValue('bulk') };
  const controller = new WasteAdminRequestsController(admin as never, receive as never, confirm as never, reverse as never, bulk as never, feeBank as never);

  beforeEach(() => jest.clearAllMocks());

  it('passes route ADMIN, the caller and the device meta to confirm', async () => {
    const body = { lines: [{ itemId: 'i', declaredQty: 1, receivedQty: 1 }] } as WasteConfirmDto;
    await expect(controller.confirm('u1', 'r1', body, req as never)).resolves.toBe('c');
    expect(confirm.confirm).toHaveBeenCalledWith({ callerUserId: 'u1', requestId: 'r1', route: 'ADMIN', device }, body);
  });

  it('passes route ADMIN, the caller and the device meta to reject', async () => {
    const body = { rejectionReason: 'WET' } as WasteRejectDto;
    await expect(controller.reject('u1', 'r1', body, req as never)).resolves.toBe('r');
    expect(confirm.reject).toHaveBeenCalledWith({ callerUserId: 'u1', requestId: 'r1', route: 'ADMIN', device }, body);
  });

  it('delegates every other handler with the documented arguments', async () => {
    await controller.queue('u1', { limit: 5 });
    await controller.lookup('u1', { code: 'TR-1' });
    await controller.detail('u1', 'r1');
    await controller.receive('u1', 'r1', { receivedWeightGrams: 10 });
    await controller.reverse('u1', 'r1', { reason: 'x' });
    await controller.setCost('u1', 'r1', { carrierCostVnd: 5 });
    await controller.closeLost('u1', 'r1', { reason: 'x' });
    await controller.reopen('u1', 'r1', { reason: 'x', unmatchedId: 'um1' });
    await controller.confirmFeePaid('u1', 'r1', { amount: 17000, bankRef: 'FT1' });
    await controller.listUnmatched('u1', { status: 'OPEN' });
    await controller.createUnmatched('u1', { description: 'd' });
    await controller.resolveUnmatched('u1', 'um1', { action: 'CLOSE', note: 'n' });
    await controller.getFlags('u1', 'u2');
    await controller.setFlags('u1', 'u2', { blocked: true, reason: 'x' });
    await controller.bulkAction('u1', { action: 'MARK_RECEIVED', requestIds: ['r1'], dryRun: true });
    expect(bulk.run).toHaveBeenCalledWith('u1', { action: 'MARK_RECEIVED', requestIds: ['r1'], dryRun: true });
    expect(admin.queue).toHaveBeenCalledWith('u1', { limit: 5 });
    expect(admin.lookup).toHaveBeenCalledWith('u1', 'TR-1');
    expect(admin.detail).toHaveBeenCalledWith('u1', 'r1');
    expect(receive.receive).toHaveBeenCalledWith('u1', 'r1', { receivedWeightGrams: 10 });
    expect(reverse.reverse).toHaveBeenCalledWith('u1', 'r1', { reason: 'x' });
    expect(admin.setCost).toHaveBeenCalledWith('u1', 'r1', { carrierCostVnd: 5 });
    expect(confirm.closeLost).toHaveBeenCalledWith('u1', 'r1', { reason: 'x' });
    expect(admin.reopen).toHaveBeenCalledWith('u1', 'r1', { reason: 'x', unmatchedId: 'um1' });
    expect(feeBank.confirmFeeBankPaid).toHaveBeenCalledWith('r1', { amount: 17000, bankRef: 'FT1', actorId: 'u1' });
    expect(receive.listUnmatched).toHaveBeenCalledWith('u1', { status: 'OPEN' });
    expect(receive.createUnmatched).toHaveBeenCalledWith('u1', { description: 'd' });
    expect(receive.resolveUnmatched).toHaveBeenCalledWith('u1', 'um1', { action: 'CLOSE', note: 'n' });
    expect(admin.getFlags).toHaveBeenCalledWith('u1', 'u2');
    expect(admin.setFlags).toHaveBeenCalledWith('u1', 'u2', { blocked: true, reason: 'x' });
  });
});

describe('WasteAdminRequestsController validation', () => {
  const pipe = createValidationPipe();
  const bad = async (type: 'body' | 'query', metatype: new () => object, value: Record<string, unknown>): Promise<boolean> => {
    try {
      await pipe.transform(value, { type, metatype, data: undefined });
      return false;
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      return true;
    }
  };

  it.each([
    ['cost carrierCostVnd null', WasteCostDto, { carrierCostVnd: null }],
    ['cost receivedWeightGrams null', WasteCostDto, { receivedWeightGrams: null }],
    ['flags blocked null', WasteUserFlagsDto, { blocked: null, reason: 'x' }],
    ['flags without reason', WasteUserFlagsDto, { blocked: true }],
    ['flags blank reason', WasteUserFlagsDto, { shipLocked: true, reason: '  ' }],
    ['reverse empty', WasteReverseDto, {}],
    ['reverse blank reason', WasteReverseDto, { reason: '   ' }],
    ['close-lost blank reason', WasteCloseLostDto, { reason: '  ' }],
    ['reopen without reason', WasteReopenDto, { unmatchedId: 'um1' }],
    ['resolve CLOSE blank note', WasteUnmatchedResolveDto, { action: 'CLOSE', note: ' ' }],
    ['resolve MATCH without requestId', WasteUnmatchedResolveDto, { action: 'MATCH', note: 'x' }],
    ['unmatched description of 201 characters', WasteUnmatchedCreateDto, { description: 'a'.repeat(201) }],
    ['receive weight 0', WasteReceiveDto, { receivedWeightGrams: 0 }],
    ['receive weight 100001', WasteReceiveDto, { receivedWeightGrams: 100001 }],
    ['receive match parcelCode not a string', WasteReceiveDto, { match: { parcelCode: 5 } }],
    ['confirm-fee amount 0', WasteFeeBankConfirmDto, { amount: 0, bankRef: 'FT1' }],
    ['confirm-fee blank bankRef', WasteFeeBankConfirmDto, { amount: 1000, bankRef: '   ' }],
    ['bulk unknown action', WasteBulkActionDto, { action: 'CONFIRM', requestIds: ['r1'] }],
    ['bulk empty list', WasteBulkActionDto, { action: 'MARK_RECEIVED', requestIds: [] }],
    ['bulk 51 requests', WasteBulkActionDto, { action: 'MARK_RECEIVED', requestIds: Array.from({ length: 51 }, (_, i) => `r${i}`) }],
    ['bulk id of 65 characters', WasteBulkActionDto, { action: 'MARK_RECEIVED', requestIds: ['a'.repeat(65)] }],
    ['bulk reason of 501 characters', WasteBulkActionDto, { action: 'CLOSE_LOST', requestIds: ['r1'], reason: 'a'.repeat(501) }],
    ['resolve MATCH unknown suggestion', WasteUnmatchedResolveDto, { action: 'MATCH', requestId: 'r1', note: 'x', suggestion: 'GUESS' }],
  ])('rejects %s with 400', async (_name, cls, body) => {
    await expect(bad('body', cls, body)).resolves.toBe(true);
  });

  it('accepts the well-formed bodies', async () => {
    await expect(bad('body', WasteCostDto, { carrierCostVnd: 0 })).resolves.toBe(false);
    await expect(bad('body', WasteUserFlagsDto, { blocked: false, reason: 'x' })).resolves.toBe(false);
    await expect(bad('body', WasteUnmatchedResolveDto, { action: 'MATCH', requestId: 'r1', note: 'x' })).resolves.toBe(false);
    await expect(bad('body', WasteUnmatchedResolveDto, { action: 'MATCH', requestId: 'r1', note: 'x', suggestion: 'PHONE' })).resolves.toBe(false);
    await expect(bad('body', WasteBulkActionDto, { action: 'MARK_RECEIVED', requestIds: ['r1', 'TR-ABCDE'], dryRun: false, phoneMatchConfirmed: true })).resolves.toBe(false);
    await expect(bad('body', WasteBulkActionDto, { action: 'CLOSE_LOST', requestIds: Array.from({ length: 50 }, (_, i) => `r${i}`), reason: 'mất' })).resolves.toBe(false);
    await expect(bad('body', WasteUnmatchedResolveDto, { action: 'CLOSE', note: 'x' })).resolves.toBe(false);
    await expect(bad('body', WasteReceiveDto, { match: { parcelCode: 'TR-1' }, receivedWeightGrams: 100000 })).resolves.toBe(false);
    await expect(bad('body', WasteFeeBankConfirmDto, { amount: 17000, bankRef: ' FT123 ' })).resolves.toBe(false);
  });

  it('validates the query DTOs', async () => {
    await expect(bad('query', AdminWasteRequestQueryDto, { limit: '101' })).resolves.toBe(true);
    await expect(bad('query', AdminWasteRequestQueryDto, { limit: '100', status: 'OPEN', filter: 'TO_COUNT', method: 'PICKUP' })).resolves.toBe(false);
    await expect(bad('query', AdminWasteRequestQueryDto, { status: 'NOPE' })).resolves.toBe(true);
    await expect(bad('query', WasteLookupQueryDto, {})).resolves.toBe(true);
    await expect(bad('query', WasteLookupQueryDto, { code: 'TR-1' })).resolves.toBe(false);
  });

  it('fails the null cases on the not-null rule, not on a type rule', () => {
    const cost = validateSync(plainToInstance(WasteCostDto, { carrierCostVnd: null }))[0];
    const flags = validateSync(plainToInstance(WasteUserFlagsDto, { reason: 'x', shipLocked: null }))[0];
    expect(Object.keys(cost?.constraints ?? {})).toContain(NOT_NULL_CONSTRAINT);
    expect(Object.keys(flags?.constraints ?? {})).toContain(NOT_NULL_CONSTRAINT);
  });
});

describe('single credit path', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return walk(full);
      return full.endsWith('.ts') && !full.endsWith('.spec.ts') ? [full] : [];
    });

  it('single credit path (spec 10.1): only waste-confirm.service.ts writes a RECYCLE ledger row', () => {
    const root = join(__dirname, '../../..');
    const pattern = /\.grant\([^;]*?'RECYCLE'\s*,|(?:applyPointsDelta|pointsTransaction\.(?:create|createMany|upsert))\([^;]*?refType:\s*'RECYCLE'\s*[,}]/s;
    const hits = walk(root).filter((f) => pattern.test(readFileSync(f, 'utf8')));
    expect(hits.map((f) => relative(root, f))).toEqual(['modules/waste-exchange/receiving/waste-confirm.service.ts']);
  });
});
