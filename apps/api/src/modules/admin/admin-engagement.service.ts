import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface MissionPatch {
  title?: string;
  description?: string;
  rewardPoints?: number;
}

/**
 * Màn admin "Nhiệm vụ & quà đổi điểm" (ENGAGE-22). Nhiệm vụ là dòng bảng missions, nhưng cách tính tiến độ gắn với `code`
 * (GameService.missionRawProgress) và `goal` quyết định chu kỳ nhận lại của nhiệm vụ lặp lại, nên admin chỉ sửa được chữ
 * hiển thị và điểm thưởng.
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
}
