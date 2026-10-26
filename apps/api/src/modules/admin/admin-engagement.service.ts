import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { MISSION_GOAL_MAX, missionKindOf, type MissionKind } from '../../common/mission-kinds';

export interface MissionPatch {
  title?: string;
  description?: string;
  rewardPoints?: number;
  disabled?: boolean;
}

export interface NewMission {
  title: string;
  description: string;
  kind: MissionKind;
  goal: number;
  rewardPoints: number;
}

/**
 * Màn admin "Nhiệm vụ & quà đổi điểm" (ENGAGE-22). Cách tính tiến độ gắn với loại nhiệm vụ (GameService.missionRawProgress) và `goal`
 * quyết định chu kỳ nhận lại của nhiệm vụ lặp lại, nên nhiệm vụ có sẵn chỉ sửa được chữ hiển thị, điểm thưởng và bật/tắt. Nhiệm vụ mới
 * chỉ chọn trong các loại hệ thống đã biết chấm, mục tiêu đặt một lần lúc tạo.
 */
@Injectable()
export class AdminEngagementService {
  private readonly logger = new Logger(AdminEngagementService.name);

  constructor(private readonly prisma: PrismaService) {}

  async listMissions() {
    const [missions, claims] = await Promise.all([
      this.prisma.mission.findMany({ orderBy: { code: 'asc' } }),
      this.prisma.missionProgress.groupBy({ by: ['missionId'], _count: { _all: true } }),
    ]);
    const claimed = new Map(claims.map((c) => [c.missionId, c._count._all]));
    return missions.map((m) => ({
      ...m,
      kind: missionKindOf(m),
      disabled: Boolean(m.disabledAt),
      claimedCount: claimed.get(m.id) ?? 0,
    }));
  }

  async createMission(adminId: string, input: NewMission) {
    const max = MISSION_GOAL_MAX[input.kind];
    if (!Number.isInteger(input.goal) || input.goal < 1 || input.goal > max) {
      throw new BadRequestException(`Mục tiêu phải là số nguyên từ 1 đến ${max}.`);
    }
    const created = await this.prisma.mission.create({
      data: {
        id: randomUUID(),
        code: `CUSTOM_${randomBytes(4).toString('hex').toUpperCase()}`,
        title: input.title,
        description: input.description,
        kind: input.kind,
        goal: input.goal,
        rewardPoints: input.rewardPoints,
        isRepeatable: false,
      },
    });
    this.logger.warn(`Admin ${adminId} thêm nhiệm vụ ${created.code} (${input.kind}, mục tiêu ${input.goal}, thưởng ${input.rewardPoints} điểm).`);
    return created;
  }

  async updateMission(id: string, patch: MissionPatch) {
    const found = await this.prisma.mission.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Không tìm thấy nhiệm vụ.');
    const data: { title?: string; description?: string; rewardPoints?: number; disabledAt?: Date | null } = {};
    if (patch.title !== undefined) data.title = patch.title;
    if (patch.description !== undefined) data.description = patch.description;
    if (patch.rewardPoints !== undefined) data.rewardPoints = patch.rewardPoints;
    if (patch.disabled !== undefined) data.disabledAt = patch.disabled ? (found.disabledAt ?? new Date()) : null;
    return this.prisma.mission.update({ where: { id }, data });
  }
}
