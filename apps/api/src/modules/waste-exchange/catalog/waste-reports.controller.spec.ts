import 'reflect-metadata';
import { HEADERS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';
import { assertActiveAdmin } from '../../../common/staff-access';
import { WasteMonthQueryDto, WasteReportsController } from './waste-reports.controller';

jest.mock('../../../common/staff-access');

type VErr = { constraints?: Record<string, string>; children?: VErr[] };
const keysOf = (errs: VErr[]): string[] => errs.flatMap((e) => [...Object.keys(e.constraints ?? {}), ...keysOf(e.children ?? [])]);
async function errorKeys<T extends object>(cls: new () => T, plain: Record<string, unknown>): Promise<string[]> {
  return keysOf(await validate(plainToInstance(cls, plain), { whitelist: true, forbidNonWhitelisted: true }));
}

describe('WasteReportsController', () => {
  const proto = WasteReportsController.prototype;
  const reports = { overview: jest.fn(), csv: jest.fn(), adminPointReport: jest.fn(), pointReport: jest.fn() };
  const prisma = {};
  const controller = new WasteReportsController(reports as never, prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it('declares paths and methods', () => {
    const route = (h: unknown) => [Reflect.getMetadata(METHOD_METADATA, h as never), Reflect.getMetadata(PATH_METADATA, h as never)];
    expect(route(proto.overview)).toEqual([RequestMethod.GET, 'admin/waste/overview']);
    expect(route(proto.monthlyCsv)).toEqual([RequestMethod.GET, 'admin/waste/reports/monthly']);
    expect(route(proto.adminPointReport)).toEqual([RequestMethod.GET, 'admin/waste/points/:id/report']);
    expect(route(proto.deskPointReport)).toEqual([RequestMethod.GET, 'waste/desk/points/:pointId/report']);
  });

  it('restricts the three admin handlers to ADMIN and leaves the desk report open to point staff', () => {
    for (const h of [proto.overview, proto.monthlyCsv, proto.adminPointReport]) expect(Reflect.getMetadata(ROLES_KEY, h)).toEqual(['ADMIN']);
    expect(Reflect.getMetadata(ROLES_KEY, proto.deskPointReport)).toBeUndefined();
  });

  it('serves the monthly report as CSV', () => {
    expect(Reflect.getMetadata(HEADERS_METADATA, proto.monthlyCsv)).toContainEqual({ name: 'Content-Type', value: 'text/csv; charset=utf-8' });
  });

  it('validates the month query', async () => {
    expect((await errorKeys(WasteMonthQueryDto, { month: '2026-1' })).length).toBeGreaterThanOrEqual(1);
    expect(await errorKeys(WasteMonthQueryDto, {})).toEqual([]);
  });

  it('overview defaults the month to the current Vietnam month after the admin check', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-31T17:30:00Z'));
    reports.overview.mockResolvedValue({ ok: true });

    const result = await controller.overview('a1', {});

    expect(assertActiveAdmin).toHaveBeenCalledWith(prisma, 'a1');
    expect(reports.overview).toHaveBeenCalledWith('2026-11');
    expect((assertActiveAdmin as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(reports.overview.mock.invocationCallOrder[0]!);
    expect(result).toEqual({ ok: true });

    (assertActiveAdmin as jest.Mock).mockClear();
    await controller.adminPointReport('a1', 'P1', { month: '2026-10' });
    expect(assertActiveAdmin).toHaveBeenCalledWith(prisma, 'a1');
    expect(reports.adminPointReport).toHaveBeenCalledWith('P1', '2026-10');
    await controller.deskPointReport('u1', 'P1', { month: '2026-10' });
    expect(reports.pointReport).toHaveBeenCalledWith('u1', 'P1', '2026-10');
  });

  it('monthlyCsv names the file after the month and returns the text', async () => {
    reports.csv.mockResolvedValue('csv-text');
    const res = { setHeader: jest.fn() };

    const result = await controller.monthlyCsv('a1', { month: '2026-10' }, res as never);

    expect(assertActiveAdmin).toHaveBeenCalledWith(prisma, 'a1');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="doi-rac-2026-10.csv"');
    expect(result).toBe('csv-text');
  });
});
