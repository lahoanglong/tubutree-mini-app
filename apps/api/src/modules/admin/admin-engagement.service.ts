import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DEFAULT_REWARD_CATALOG } from '../loyalty/loyalty.service';

const REDEEM_REASON_PREFIX = 'LOYALTY_REDEEM_VOUCHER:';
const RECENT_DAYS = 30;

export interface MissionPatch {
  title?: string;
  description?: string;
  rewardPoints?: number;
}

/**
 * Màn admin "Nhiệm vụ & quà đổi điểm" (ENGAGE-22). Nhiệm vụ là dòng bảng missions, nhưng cách tính tiến độ gắn với `code`
 * (GameService.missionRawProgress) và `goal` quyết định chu kỳ nhận lại của nhiệm vụ lặp lại, nên admin chỉ sửa được chữ
 * hiển thị và điểm thưởng. Danh mục quà đổi điểm nằm trong mã (DEFAULT_REWARD_CATALOG) nên chỉ xem, kèm số lượt đổi.
 */
@Injectable()
export class AdminEngagementService {
  constructor(private readonly prisma: PrismaService) {}

  async listMissions() {
    const [missions, claims] = await Promise.all([
      this.prisma.mission.findMany({ orderBy: { code: 'asc' } }),
      this.prisma.missionProgress.groupBy({ by: ['missionId'], _count: { _all: true } }),
    ]);
    const claimed = new Map(claims.map((c) => [c.missionId, c._count._all]));
    return missions.map((m) => ({ ...m, claimedCount: claimed.get(m.id) ?? 0 }));
  }

  async updateMission(id: string, patch: MissionPatch) {
    const found = await this.prisma.mission.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Không tìm thấy nhiệm vụ.');
    const data: MissionPatch = {};
    if (patch.title !== undefined) data.title = patch.title;
    if (patch.description !== undefined) data.description = patch.description;
    if (patch.rewardPoints !== undefined) data.rewardPoints = patch.rewardPoints;
    return this.prisma.mission.update({ where: { id }, data });
  }

  async rewardCatalog(now = new Date()) {
    const since = new Date(now.getTime() - RECENT_DAYS * 24 * 60 * 60 * 1000);
    const where = { refType: 'REWARD', reason: { startsWith: REDEEM_REASON_PREFIX } };
    const [all, recent] = await Promise.all([
      this.prisma.pointsTransaction.groupBy({ by: ['reason'], where, _count: { _all: true } }),
      this.prisma.pointsTransaction.groupBy({ by: ['reason'], where: { ...where, createdAt: { gte: since } }, _count: { _all: true } }),
    ]);
    const count = (rows: { reason: string; _count: { _all: number } }[]) =>
      new Map(rows.map((r) => [r.reason.slice(REDEEM_REASON_PREFIX.length), r._count._all]));
    const allBy = count(all);
    const recentBy = count(recent);
    return DEFAULT_REWARD_CATALOG.map((r) => ({
      ...r,
      redeemedCount: allBy.get(r.id) ?? 0,
      redeemed30d: recentBy.get(r.id) ?? 0,
    }));
  }
}
