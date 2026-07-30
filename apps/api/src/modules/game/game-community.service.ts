import { Injectable } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * Vườn Xanh 2.0 Phase 2 — hồ giọt nước cộng đồng (mô hình Ant Forest gom batch).
 * Khi user thu hoạch cây ảo, 💧 đã tưới góp vào mốc ACTIVE; đủ targetDrops → fulfil
 * (cam kết trồng treesToPlant cây thật ở vùng có tên; PanNature trồng thật để sau — gate).
 * An toàn: tăng hồ + đóng góp cá nhân nguyên tử; fulfil có count-guard chống chốt 2 lần.
 */
@Injectable()
export class GameCommunityService {
  constructor(private readonly prisma: PrismaService) {}

  /** Mốc đang mở + tiến độ + đóng góp của tôi (để FE vẽ CommunityMeter). */
  async getCommunityState(userId: string) {
    const goal = await this.prisma.communityGoal.findFirst({
      where: { status: 'ACTIVE' },
      orderBy: { startAt: 'asc' },
    });
    if (!goal) return { goal: null, myDrops: 0, pct: 0 };
    const mine = await this.prisma.communityContribution.findUnique({
      where: { userId_goalId: { userId, goalId: goal.id } },
    });
    const pct =
      goal.targetDrops > 0 ? Math.min(100, Math.round((goal.currentDrops / goal.targetDrops) * 100)) : 0;
    return {
      goal: {
        id: goal.id,
        title: goal.title,
        region: goal.region,
        targetDrops: goal.targetDrops,
        currentDrops: goal.currentDrops,
        treesToPlant: goal.treesToPlant,
        status: goal.status,
      },
      myDrops: mine?.drops ?? 0,
      pct,
    };
  }

  /**
   * Góp drops vào hồ (gọi khi thu hoạch). Tăng hồ + đóng góp cá nhân nguyên tử.
   * Đủ mốc → tự fulfil. Trả null nếu không có mốc đang mở hoặc drops ≤ 0.
   */
  async contribute(userId: string, drops: number): Promise<{ goalId: string; contributed: number } | null> {
    if (drops <= 0) return null;
    const goal = await this.prisma.communityGoal.findFirst({
      where: { status: 'ACTIVE' },
      orderBy: { startAt: 'asc' },
    });
    if (!goal) return null;

    await this.prisma.communityGoal.update({
      where: { id: goal.id },
      data: { currentDrops: { increment: drops } },
    });
    await this.prisma.communityContribution.upsert({
      where: { userId_goalId: { userId, goalId: goal.id } },
      create: { userId, goalId: goal.id, drops },
      update: { drops: { increment: drops } },
    });

    const fresh = await this.prisma.communityGoal.findUnique({ where: { id: goal.id } });
    if (fresh && fresh.currentDrops >= fresh.targetDrops) {
      await this.fulfil(goal.id);
    }
    return { goalId: goal.id, contributed: drops };
  }

  /**
   * Chốt mốc: ACTIVE → FULFILLING (count-guard chống double) → DONE.
   * PanNature trồng batch thật để sau (gate). Trả true nếu chính lần này chốt.
   */
  async fulfil(goalId: string): Promise<boolean> {
    const guard = await this.prisma.communityGoal.updateMany({
      where: { id: goalId, status: 'ACTIVE' },
      data: { status: 'FULFILLING', fulfilledAt: new Date() },
    });
    if (guard.count === 0) return false; // tiến trình khác đã chốt
    await this.prisma.communityGoal.update({
      where: { id: goalId },
      data: { status: 'DONE' },
    });
    return true;
  }
}
