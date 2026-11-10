import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Vườn Xanh 2.0 Phase 2 — hồ giọt nước cộng đồng (mô hình Ant Forest gom batch).
 * Khi user thu hoạch cây ảo, 💧 đã tưới góp vào mốc ACTIVE; đủ targetDrops → fulfil
 * (ghi nhận treesToPlant cây vào quỹ trồng cây của vùng có tên; việc trồng thật để sau — gate).
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
    // Mốc vừa được lượt khác chốt giữa lúc đọc và lúc khoá thì sang mốc ACTIVE kế tiếp; không cộng thêm vào mốc đã đóng.
    for (let attempt = 0; attempt < 3; attempt++) {
      const goal = await this.prisma.communityGoal.findFirst({
        where: { status: 'ACTIVE' },
        orderBy: { startAt: 'asc' },
      });
      if (!goal) return null;

      const contributed = await this.prisma.$transaction(async (tx) => {
        // Khoá dòng mốc tới hết tx: lượt góp sau chờ lượt trước, nên thấy mốc đã DONE (không còn khớp status) thay vì cộng vào mốc
        // đã đóng. Tăng hồ, ghi đóng góp và chốt mốc cùng một tx nên không còn cảnh hồ tăng mà dòng đóng góp không có.
        const locked = await tx.$queryRaw<{ currentDrops: number; targetDrops: number }[]>`
          SELECT "currentDrops", "targetDrops" FROM "community_goals" WHERE "id" = ${goal.id} AND "status" = 'ACTIVE' FOR UPDATE`;
        const row = locked[0];
        if (!row) return false;
        await tx.communityGoal.update({
          where: { id: goal.id },
          data: { currentDrops: { increment: drops } },
        });
        await tx.communityContribution.upsert({
          where: { userId_goalId: { userId, goalId: goal.id } },
          create: { userId, goalId: goal.id, drops },
          update: { drops: { increment: drops } },
        });
        if (row.currentDrops + drops >= row.targetDrops) await this.fulfil(goal.id, tx);
        return true;
      });
      if (contributed) return { goalId: goal.id, contributed: drops };
    }
    return null;
  }

  /**
   * Chốt mốc: ACTIVE → FULFILLING (count-guard chống double) → DONE.
   * Việc trồng batch thật để sau (gate). Trả true nếu chính lần này chốt.
   */
  async fulfil(goalId: string, db: Prisma.TransactionClient | PrismaService = this.prisma): Promise<boolean> {
    const guard = await db.communityGoal.updateMany({
      where: { id: goalId, status: 'ACTIVE' },
      data: { status: 'FULFILLING', fulfilledAt: new Date() },
    });
    if (guard.count === 0) return false; // tiến trình khác đã chốt
    await db.communityGoal.update({
      where: { id: goalId },
      data: { status: 'DONE' },
    });
    return true;
  }
}
