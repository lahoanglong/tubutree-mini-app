import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { AdminEngagementController, UpdateMissionDto } from './admin-engagement.controller';
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
  const make = (prisma: Record<string, unknown>) => new AdminEngagementService(prisma as never);

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
