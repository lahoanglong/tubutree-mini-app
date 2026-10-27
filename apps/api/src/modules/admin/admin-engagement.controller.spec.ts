import 'reflect-metadata';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { AdminEngagementController, CreateMissionDto, UpdateMissionDto } from './admin-engagement.controller';
import { AdminEngagementService } from './admin-engagement.service';

const mission = (over: Record<string, unknown> = {}) => ({
  id: 'm1',
  code: 'FIRST_ORDER',
  title: 'Đơn đầu tiên',
  description: 'Hoàn tất đơn đầu tiên',
  rewardPoints: 30,
  rewardCoupon: null,
  goal: 1,
  isRepeatable: false,
  ...over,
});

describe('AdminEngagementController — nhiệm vụ & quà đổi điểm (ENGAGE-22)', () => {
  it('chỉ ADMIN', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdminEngagementController)).toEqual(['ADMIN']);
  });

  it.each([
    ['tiêu đề rỗng', { title: '  ' }],
    ['tiêu đề quá dài', { title: 'x'.repeat(81) }],
    ['mô tả quá dài', { description: 'x'.repeat(301) }],
    ['điểm âm', { rewardPoints: -1 }],
    ['điểm lẻ', { rewardPoints: 1.5 }],
    ['điểm quá lớn', { rewardPoints: 500_001 }],
    ['đổi mục tiêu (goal quyết định chu kỳ nhận lại, không cho sửa)', { goal: 3 }],
  ])('UpdateMissionDto từ chối: %s', (_label, body) => {
    expect(validateSync(plainToInstance(UpdateMissionDto, body), { whitelist: true, forbidNonWhitelisted: true }).length).toBeGreaterThan(0);
  });

  it('UpdateMissionDto nhận sửa tiêu đề/mô tả/điểm thưởng', () => {
    const dto = plainToInstance(UpdateMissionDto, { title: ' Mua đơn đầu ', description: 'Mô tả', rewardPoints: 40_000 });
    expect(validateSync(dto, { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
    expect(dto.title).toBe('Mua đơn đầu');
  });
});

describe('AdminEngagementService', () => {
  const make = (prisma: Record<string, unknown>) =>
    new AdminEngagementService({ ...prisma, mission: { findMany: jest.fn().mockResolvedValue([]), ...(prisma.mission as object) } } as never);

  it('danh sách nhiệm vụ kèm số lượt đã nhận thưởng', async () => {
    const prisma = {
      mission: { findMany: jest.fn().mockResolvedValue([mission(), mission({ id: 'm2', code: 'REVIEW_3' })]) },
      missionProgress: { groupBy: jest.fn().mockResolvedValue([{ missionId: 'm1', _count: { _all: 7 } }]) },
    };
    const rows = await make(prisma).listMissions();
    expect(rows.map((r) => [r.code, r.claimedCount])).toEqual([
      ['FIRST_ORDER', 7],
      ['REVIEW_3', 0],
    ]);
  });

  it('sửa nhiệm vụ chỉ ghi các trường được phép; nhiệm vụ không tồn tại → 404', async () => {
    const update = jest.fn().mockResolvedValue(mission({ rewardPoints: 40 }));
    const prisma = {
      mission: { findUnique: jest.fn().mockResolvedValueOnce(mission()).mockResolvedValueOnce(null), update },
    };
    const svc = make(prisma);
    await svc.updateMission('m1', { rewardPoints: 40 });
    expect(update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { rewardPoints: 40 } });
    await expect(svc.updateMission('nope', { title: 'X' })).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('CreateMissionDto — nhiệm vụ mới', () => {
  const ok = { title: ' Mời bạn ', description: 'Mời 2 bạn mua hàng', kind: 'INVITE_COUNT', goal: 2, rewardPoints: 30_000 };
  const bad = (body: object) => validateSync(plainToInstance(CreateMissionDto, { ...ok, ...body }), { whitelist: true, forbidNonWhitelisted: true }).length;

  it('nhận nhiệm vụ hợp lệ và cắt khoảng trắng đầu cuối', () => {
    const dto = plainToInstance(CreateMissionDto, ok);
    expect(validateSync(dto, { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
    expect(dto.title).toBe('Mời bạn');
  });

  it.each([
    ['loại lạ', { kind: 'WIN_LOTTERY' }],
    ['mục tiêu 0', { goal: 0 }],
    ['mục tiêu âm', { goal: -3 }],
    ['mục tiêu lẻ', { goal: 1.5 }],
    ['mục tiêu quá lớn', { goal: 366 }],
    ['điểm âm', { rewardPoints: -1 }],
    ['điểm lẻ', { rewardPoints: 10.5 }],
    ['điểm vượt trần', { rewardPoints: 500_001 }],
    ['thiếu tiêu đề', { title: ' ' }],
    ['tự đặt mã (mã do hệ thống sinh)', { code: 'FIRST_ORDER' }],
    ['tự đặt lặp lại', { isRepeatable: true }],
  ])('từ chối: %s', (_l, body) => {
    expect(bad(body)).toBeGreaterThan(0);
  });

  it('điểm 0 và đúng trần đều nhận', () => {
    expect(bad({ rewardPoints: 0 })).toBe(0);
    expect(bad({ rewardPoints: 500_000 })).toBe(0);
  });
});

describe('AdminEngagementService — thêm và tạm dừng nhiệm vụ', () => {
  const make = (prisma: Record<string, unknown>) =>
    new AdminEngagementService({ ...prisma, mission: { findMany: jest.fn().mockResolvedValue([]), ...(prisma.mission as object) } } as never);
  const input = { title: 'Mời bạn', description: 'Mời 2 bạn', kind: 'INVITE_COUNT', goal: 2, rewardPoints: 30_000 } as const;

  it('tạo nhiệm vụ: mã do hệ thống sinh, không lặp lại, mục tiêu và điểm đúng như nhập', async () => {
    const create = jest.fn().mockImplementation(({ data }) => Promise.resolve(data));
    const created = await make({ mission: { create } }).createMission('admin1', input);
    expect(created.code).toMatch(/^CUSTOM_[0-9A-F]{8}$/);
    expect(create.mock.calls[0][0].data).toMatchObject({ kind: 'INVITE_COUNT', goal: 2, rewardPoints: 30_000, isRepeatable: false });
  });

  it('trần mục tiêu theo loại: 366 ngày điểm danh và 101 đơn đều bị từ chối, không ghi gì', async () => {
    const create = jest.fn();
    const svc = make({ mission: { create } });
    await expect(svc.createMission('admin1', { ...input, kind: 'ORDER_COUNT', goal: 101 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.createMission('admin1', { ...input, kind: 'CHECKIN_STREAK', goal: 0 })).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
    create.mockResolvedValue({ code: 'CUSTOM_X' });
    await svc.createMission('admin1', { ...input, kind: 'CHECKIN_STREAK', goal: 365 });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('tạm dừng ghi giờ, bật lại xoá giờ; tạm dừng lần hai giữ giờ cũ', async () => {
    const before = new Date('2026-10-01T00:00:00Z');
    const update = jest.fn().mockResolvedValue({});
    const findUnique = jest.fn().mockResolvedValueOnce(mission()).mockResolvedValueOnce(mission({ disabledAt: before })).mockResolvedValueOnce(mission({ disabledAt: before }));
    const svc = make({ mission: { findUnique, update } });
    await svc.updateMission('m1', { disabled: true });
    expect(update.mock.calls[0][0].data.disabledAt).toBeInstanceOf(Date);
    await svc.updateMission('m1', { disabled: true });
    expect(update.mock.calls[1][0].data.disabledAt).toBe(before);
    await svc.updateMission('m1', { disabled: false });
    expect(update.mock.calls[2][0].data).toEqual({ disabledAt: null });
  });

  it('danh sách trả loại nhiệm vụ (suy từ mã cho nhiệm vụ cũ) và cờ tạm dừng', async () => {
    const prisma = {
      mission: { findMany: jest.fn().mockResolvedValue([mission(), mission({ id: 'm5', code: 'CUSTOM_1', kind: 'REVIEW_COUNT', disabledAt: new Date() })]) },
      missionProgress: { groupBy: jest.fn().mockResolvedValue([]) },
    };
    const rows = await make(prisma).listMissions();
    expect(rows.map((r) => [r.kind, r.disabled])).toEqual([['ORDER_COUNT', false], ['REVIEW_COUNT', true]]);
  });
});

describe('AdminEngagementService — chặn nhiệm vụ trùng và mốc bắt đầu', () => {
  const make = (active: unknown[], create = jest.fn().mockImplementation(({ data }) => Promise.resolve(data))) => ({
    svc: new AdminEngagementService({ mission: { findMany: jest.fn().mockResolvedValue(active), create } } as never),
    create,
  });
  const input = { title: 'Mua 1 đơn', description: '', kind: 'ORDER_COUNT', goal: 1, rewardPoints: 10_000 } as const;

  it('trùng (loại, mục tiêu) với nhiệm vụ seed đang bật (FIRST_ORDER) → 409, không ghi', async () => {
    const { svc, create } = make([{ code: 'FIRST_ORDER', kind: null, goal: 1, title: 'Đơn hàng đầu tiên' }]);
    await expect(svc.createMission('a', input)).rejects.toBeInstanceOf(ConflictException);
    expect(create).not.toHaveBeenCalled();
  });

  it('cùng loại nhưng khác mục tiêu, hoặc nhiệm vụ trùng đang tạm dừng (không nằm trong danh sách đang bật) → tạo được', async () => {
    const { svc, create } = make([{ code: 'FIRST_ORDER', kind: null, goal: 1, title: 'x' }]);
    await svc.createMission('a', { ...input, goal: 2 });
    expect(create).toHaveBeenCalledTimes(1);
    const none = make([]);
    await none.svc.createMission('a', input);
    expect(none.create).toHaveBeenCalledTimes(1);
  });

  it('nhiệm vụ mới có startsAt = lúc tạo', async () => {
    const { svc, create } = make([]);
    const before = Date.now();
    await svc.createMission('a', input);
    const at = create.mock.calls[0][0].data.startsAt as Date;
    expect(at.getTime()).toBeGreaterThanOrEqual(before);
  });
});
