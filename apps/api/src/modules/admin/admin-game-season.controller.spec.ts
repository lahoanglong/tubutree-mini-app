import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { AdminGameSeasonController, CreateSeasonDto, UpdateSeasonDto } from './admin-game-season.controller';
import { AdminGameSeasonService } from './admin-game-season.service';

const opts = { whitelist: true, forbidNonWhitelisted: true };
const day = (iso: string) => new Date(iso);

function make(rows: Array<Record<string, unknown>> = []) {
  const prisma = {
    season: {
      findMany: jest.fn().mockResolvedValue(rows),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id) ?? null),
      findFirst: jest.fn(async ({ where }: { where: { startAt: { lte: Date }; endAt: { gte: Date }; id?: { not: string } } }) =>
        rows.find((r) => (r.startAt as Date) <= where.startAt.lte && (r.endAt as Date) >= where.endAt.gte && r.id !== where.id?.not) ?? null,
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => data),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({ ...rows.find((r) => r.id === where.id), ...data })),
      delete: jest.fn().mockResolvedValue({}),
    },
  };
  return { prisma, svc: new AdminGameSeasonService(prisma as never) };
}

describe('Mùa Vườn Xanh (admin)', () => {
  it('chỉ ADMIN', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdminGameSeasonController)).toEqual(['ADMIN']);
  });

  it('CreateSeasonDto: cần tên và hai ngày; chữ thừa bị từ chối', () => {
    const ok = plainToInstance(CreateSeasonDto, { name: ' Mùa Thu ', startAt: '2026-11-01T00:00:00+07:00', endAt: '2026-11-30T23:59:59+07:00' });
    expect(validateSync(ok, opts)).toEqual([]);
    expect(ok.name).toBe('Mùa Thu');
    for (const bad of [{ name: '', startAt: '2026-11-01', endAt: '2026-11-30' }, { name: 'x', startAt: 'abc', endAt: '2026-11-30' }, { name: 'x', startAt: '2026-11-01', endAt: '2026-11-30', id: 'hack' }]) {
      expect(validateSync(plainToInstance(CreateSeasonDto, bad), opts).length).toBeGreaterThan(0);
    }
  });

  it('UpdateSeasonDto: null cho tên/ngày bị chặn, null cho theme/region là xoá', () => {
    expect(validateSync(plainToInstance(UpdateSeasonDto, { name: null }), opts).length).toBeGreaterThan(0);
    expect(validateSync(plainToInstance(UpdateSeasonDto, { startAt: null }), opts).length).toBeGreaterThan(0);
    expect(validateSync(plainToInstance(UpdateSeasonDto, { theme: null, region: '' }), opts)).toEqual([]);
  });

  it('tạo mùa mới: sinh id, trạng thái UPCOMING khi chưa tới ngày', async () => {
    const { svc, prisma } = make();
    const r = await svc.create({ name: 'Mùa Thu', startAt: day('2099-01-01'), endAt: day('2099-02-01') });
    expect(r.status).toBe('UPCOMING');
    expect((prisma.season.create.mock.calls[0]![0] as { data: { id: string } }).data.id).toBeTruthy();
  });

  it('ngày kết thúc không sau ngày bắt đầu → 400', async () => {
    const { svc } = make();
    await expect(svc.create({ name: 'x', startAt: day('2026-11-02'), endAt: day('2026-11-01') })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('chồng thời gian với mùa khác → 400 nêu tên mùa; sửa chính nó không tính là chồng', async () => {
    const existing = { id: 's1', name: 'Mùa Hè', theme: null, region: null, featuredSpeciesIds: [], startAt: day('2026-06-01'), endAt: day('2026-08-31') };
    const { svc } = make([existing]);
    await expect(svc.create({ name: 'Mùa Thu', startAt: day('2026-08-15'), endAt: day('2026-10-01') })).rejects.toThrow(/Mùa Hè/);
    await expect(svc.update('s1', { name: 'Mùa Hè 2' })).resolves.toMatchObject({ id: 's1' });
  });

  it('mùa đã hết hạn báo ENDED trong danh sách; sửa/xoá mùa không có → 404', async () => {
    const past = { id: 's1', name: 'Cũ', theme: null, region: null, featuredSpeciesIds: [], startAt: day('2026-01-01'), endAt: day('2026-02-01') };
    const { svc } = make([past]);
    await expect(svc.list()).resolves.toMatchObject([{ id: 's1', status: 'ENDED' }]);
    await expect(svc.update('nope', { name: 'x' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.remove('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('sửa ngày: mùa đã kết thúc khoá hẳn, đang chạy chỉ kéo dài, sắp tới sửa tự do', async () => {
    const now = Date.now();
    const mk = (id: string, from: number, to: number) => ({ id, name: id, theme: null, region: null, featuredSpeciesIds: [], startAt: new Date(now + from * 86_400_000), endAt: new Date(now + to * 86_400_000) });
    const { svc } = make([mk('past', -20, -10), mk('live', -1, 5), mk('next', 10, 20)]);
    const at = (d: number) => new Date(now + d * 86_400_000);
    await expect(svc.update('past', { startAt: at(400), endAt: at(401) })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.update('past', { endAt: at(-5) })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.update('past', { name: 'Đổi tên' })).resolves.toMatchObject({ id: 'past' });
    await expect(svc.update('live', { startAt: at(30), endAt: at(40) })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.update('live', { endAt: at(2) })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.update('live', { endAt: at(8) })).resolves.toMatchObject({ id: 'live' });
    await expect(svc.update('next', { startAt: at(12), endAt: at(22) })).resolves.toMatchObject({ id: 'next' });
  });

  it('chỉ xoá được mùa sắp tới; mùa đang chạy hoặc đã hết hạn bị chặn', async () => {
    const now = Date.now();
    const mk = (id: string, from: number, to: number) => ({ id, name: id, theme: null, region: null, featuredSpeciesIds: [], startAt: new Date(now + from * 86_400_000), endAt: new Date(now + to * 86_400_000) });
    const { prisma, svc } = make([mk('past', -20, -10), mk('live', -1, 5), mk('next', 10, 20)]);
    await expect(svc.remove('past')).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.remove('live')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.season.delete).not.toHaveBeenCalled();
    await expect(svc.remove('next')).resolves.toEqual({ deleted: true });
  });
});
