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
  // Giao dịch có đối tượng riêng: ghi qua `tx` mới đúng, ghi qua prisma ngoài giao dịch là sai (khoá hàng mốc không còn bảo vệ).
  const tx = {
    communityGoal: { update: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    communityContribution: { upsert: jest.fn().mockResolvedValue({}) },
    // Hàng mốc bị khoá (FOR UPDATE) trả về đúng số liệu của mốc đang ACTIVE; rỗng nghĩa là mốc đã đóng giữa chừng.
    $queryRaw: jest.fn().mockResolvedValue(goal ? [{ currentDrops: goal.currentDrops, targetDrops: goal.targetDrops }] : []),
  };
  const prisma = { communityGoal, communityContribution, $transaction: (fn: (t: unknown) => unknown) => fn(tx) } as unknown as PrismaService;
  return { svc: new GameCommunityService(prisma), communityGoal, communityContribution, tx };
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

  it('góp hợp lệ chưa đủ mốc → tăng hồ + upsert đóng góp trong giao dịch, KHÔNG fulfil', async () => {
    const { svc, communityGoal, communityContribution, tx } = setup({ ...ACTIVE, currentDrops: 200 }); // 200 + 100 < 1000
    const r = await svc.contribute('u1', 100);
    expect(r).toEqual({ goalId: 'g1', contributed: 100 });
    expect(tx.communityGoal.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'g1' }, data: { currentDrops: { increment: 100 } } }),
    );
    expect(tx.communityContribution.upsert).toHaveBeenCalled();
    expect(tx.communityGoal.updateMany).not.toHaveBeenCalled(); // chưa fulfil
    expect(communityGoal.update).not.toHaveBeenCalled(); // không ghi ngoài giao dịch
    expect(communityContribution.upsert).not.toHaveBeenCalled();
  });

  it('góp làm đủ mốc → fulfil (status-guard) bằng đúng đối tượng giao dịch, không qua prisma ngoài giao dịch', async () => {
    const { svc, communityGoal, tx } = setup({ ...ACTIVE, currentDrops: 200 }); // 200 + 900 >= 1000
    await svc.contribute('u1', 900);
    expect(tx.communityGoal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'g1', status: 'ACTIVE' } }),
    );
    expect(communityGoal.updateMany).not.toHaveBeenCalled();
    expect(communityGoal.update).not.toHaveBeenCalled();
  });

  it('góp đúng bằng target (900 + 100 = 1000) → chốt mốc ngay, không chờ lượt sau', async () => {
    const { svc, tx } = setup({ ...ACTIVE, currentDrops: 900 });
    await svc.contribute('u1', 100);
    expect(tx.communityGoal.updateMany).toHaveBeenCalledTimes(1);
  });

  it('mốc đã đóng giữa lúc đọc và lúc khoá (khoá không thấy hàng ACTIVE) → không ghi vào mốc đó, sang mốc ACTIVE kế', async () => {
    const G2 = { ...ACTIVE, id: 'g2', currentDrops: 0 };
    const { svc, communityGoal, tx } = setup(ACTIVE);
    communityGoal.findFirst.mockResolvedValueOnce(ACTIVE).mockResolvedValueOnce(G2);
    tx.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ currentDrops: 0, targetDrops: 1000 }]);
    const r = await svc.contribute('u1', 100);
    expect(r).toEqual({ goalId: 'g2', contributed: 100 });
    expect(tx.communityGoal.update).toHaveBeenCalledTimes(1);
    expect(tx.communityGoal.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'g2' } }));
    expect(tx.communityContribution.upsert).toHaveBeenCalledTimes(1);
  });

  it('mốc nào cũng đóng giữa chừng (ba lần thử) → null, không ghi gì', async () => {
    const { svc, tx } = setup(ACTIVE);
    tx.$queryRaw.mockResolvedValue([]);
    expect(await svc.contribute('u1', 100)).toBeNull();
    expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
    expect(tx.communityGoal.update).not.toHaveBeenCalled();
    expect(tx.communityContribution.upsert).not.toHaveBeenCalled();
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
