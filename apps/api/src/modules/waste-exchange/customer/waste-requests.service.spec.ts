import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../../prisma/prisma.service';
import { WasteRequestsService } from './waste-requests.service';
import * as mapper from './waste-request.mapper';
import { WASTE_REQUEST_FULL_INCLUDE, WASTE_REQUEST_SUMMARY_INCLUDE } from './waste-request.mapper';

const make = (found: unknown) => {
  const findFirst = jest.fn().mockResolvedValue(found);
  const findMany = jest.fn().mockResolvedValue([]);
  const access = { availablePointIds: jest.fn().mockResolvedValue(new Set(['wh'])) };
  const prisma = { wasteRequest: { findFirst, findMany } } as unknown as PrismaService;
  return { svc: new WasteRequestsService(prisma, access as never, {} as never, {} as never), findFirst, findMany, access };
};

describe('WasteRequestsService reads (ownership, spec 15.1)', () => {
  it('detail looks up by id AND userId; another user\'s id is the same 404 as a missing id', async () => {
    const { svc, findFirst } = make(null);
    await expect(svc.detail('uB', 'rA')).rejects.toThrow(new NotFoundException('Không tìm thấy yêu cầu'));
    expect(findFirst).toHaveBeenCalledWith({ where: { id: 'rA', userId: 'uB' }, include: WASTE_REQUEST_FULL_INCLUDE });
  });
  it('byOrder looks up by orderId AND userId', async () => {
    const { svc, findFirst } = make(null);
    await expect(svc.byOrder('uB', 'oA')).rejects.toBeInstanceOf(NotFoundException);
    expect(findFirst).toHaveBeenCalledWith({ where: { orderId: 'oA', userId: 'uB' }, include: WASTE_REQUEST_FULL_INCLUDE });
  });
  it('list: own rows, newest first, at most 100', async () => {
    const { svc, findMany } = make(null);
    await expect(svc.list('u1')).resolves.toEqual([]);
    expect(findMany).toHaveBeenCalledWith({ where: { userId: 'u1' }, include: WASTE_REQUEST_SUMMARY_INCLUDE, orderBy: { createdAt: 'desc' }, take: 100 });
  });
  it('detail passes pointAvailable = availablePointIds([row.pointId]).has(row.pointId) to the mapper', async () => {
    const row = { id: 'r1', pointId: 'p9' };
    const { svc, access } = make(row);
    const spy = jest.spyOn(mapper, 'toRequestDetail').mockReturnValue({ id: 'r1' } as never);
    await expect(svc.detail('u1', 'r1')).resolves.toEqual({ id: 'r1' });
    expect(access.availablePointIds).toHaveBeenCalledWith(expect.anything(), ['p9']);
    expect(spy).toHaveBeenCalledWith(row, false);
    spy.mockRestore();
  });
});
