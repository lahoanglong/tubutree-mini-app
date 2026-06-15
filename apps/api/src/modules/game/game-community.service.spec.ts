import { GameCommunityService } from './game-community.service';
import type { PrismaService } from '../../prisma/prisma.service';

const ACTIVE = {
  id: 'g1',
  title: 'Rừng phòng hộ Cần Giờ',
  region: 'Cần Giờ, TP.HCM',
  targetDrops: 1000,
  currentDrops: 200,
  treesToPlant: 50,
  status: 'ACTIVE',
};

function setup(goal: Record<string, unknown> | null = ACTIVE, mine: Record<string, unknown> | null = null) {
  const communityGoal = {
    findFirst: jest.fn().mockResolvedValue(goal),
    findUnique: jest.fn().mockResolvedValue(goal),
    update: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const communityContribution = {
    findUnique: jest.fn().mockResolvedValue(mine),
    upsert: jest.fn().mockResolvedValue({}),
  };
  const prisma = { communityGoal, communityContribution } as unknown as PrismaService;
  return { svc: new GameCommunityService(prisma), communityGoal, communityContribution };
}

describe('GameCommunityService.getCommunityState', () => {
  it('không có mốc đang mở → goal null, 0%', async () => {
    const { svc } = setup(null);
    const r = await svc.getCommunityState('u1');
    expect(r.goal).toBeNull();
    expect(r.myDrops).toBe(0);
    expect(r.pct).toBe(0);
  });

  it('có mốc + đóng góp của tôi → trả % và myDrops', async () => {
    const { svc } = setup(ACTIVE, { drops: 80 });
    const r = await svc.getCommunityState('u1');
    expect(r.goal?.id).toBe('g1');
    expect(r.goal?.region).toBe('Cần Giờ, TP.HCM');
    expect(r.myDrops).toBe(80);
    expect(r.pct).toBe(20); // 200/1000
  });
});

describe('GameCommunityService.contribute', () => {
  it('không có mốc đang mở → null, không ghi', async () => {
    const { svc, communityGoal, communityContribution } = setup(null);
    const r = await svc.contribute('u1', 100);
    expect(r).toBeNull();
    expect(communityGoal.update).not.toHaveBeenCalled();
    expect(communityContribution.upsert).not.toHaveBeenCalled();
  });

  it('drops ≤ 0 → null', async () => {
    const { svc, communityGoal } = setup(ACTIVE);
    expect(await svc.contribute('u1', 0)).toBeNull();
    expect(communityGoal.update).not.toHaveBeenCalled();
  });

  it('góp hợp lệ chưa đủ mốc → tăng hồ + upsert đóng góp, KHÔNG fulfil', async () => {
    const { svc, communityGoal, communityContribution } = setup(ACTIVE);
    communityGoal.findUnique.mockResolvedValue({ ...ACTIVE, currentDrops: 300 }); // < target
    const r = await svc.contribute('u1', 100);
    expect(r).toEqual({ goalId: 'g1', contributed: 100 });
    expect(communityGoal.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'g1' }, data: { currentDrops: { increment: 100 } } }),
    );
    expect(communityContribution.upsert).toHaveBeenCalled();
    expect(communityGoal.updateMany).not.toHaveBeenCalled(); // chưa fulfil
  });

  it('góp làm đủ mốc → tự fulfil (status-guard)', async () => {
    const { svc, communityGoal } = setup(ACTIVE);
    communityGoal.findUnique.mockResolvedValue({ ...ACTIVE, currentDrops: 1000 }); // >= target
    await svc.contribute('u1', 900);
    expect(communityGoal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'g1', status: 'ACTIVE' } }),
    );
  });
});

describe('GameCommunityService.fulfil', () => {
  it('guard count 1 → chuyển DONE, trả true', async () => {
    const { svc, communityGoal } = setup(ACTIVE);
    communityGoal.updateMany.mockResolvedValue({ count: 1 });
    const ok = await svc.fulfil('g1');
    expect(ok).toBe(true);
    expect(communityGoal.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'g1' }, data: { status: 'DONE' } }),
    );
  });

  it('guard count 0 (đã có tiến trình khác chốt) → false, không DONE 2 lần', async () => {
    const { svc, communityGoal } = setup(ACTIVE);
    communityGoal.updateMany.mockResolvedValue({ count: 0 });
    const ok = await svc.fulfil('g1');
    expect(ok).toBe(false);
    expect(communityGoal.update).not.toHaveBeenCalled();
  });
});
