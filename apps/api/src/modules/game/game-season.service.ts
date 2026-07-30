import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Vườn Xanh 2.0 Phase 4 — mùa/sự kiện + BXH mùa.
 * getActiveSeason: mùa đang diễn ra (theo cửa sổ thời gian) + loài nổi bật.
 * getSeasonLeaderboard: top người góp nước cho mốc cộng đồng đang mở (đua mùa).
 */
@Injectable()
export class GameSeasonService {
  constructor(private readonly prisma: PrismaService) {}

  private maskName(name: string | null): string {
    if (!name) return 'Bạn Tubu';
    const parts = name.trim().split(' ');
    const last = parts[parts.length - 1] ?? 'Tubu';
    return `${last}***`;
  }

  async getActiveSeason() {
    const now = new Date();
    const season = await this.prisma.season.findFirst({
      where: { startAt: { lte: now }, endAt: { gte: now } },
      orderBy: { startAt: 'desc' },
    });
    if (!season) return null;

    const featuredSpecies =
      season.featuredSpeciesIds.length > 0
        ? (
            await this.prisma.plantSpecies.findMany({
              where: { id: { in: season.featuredSpeciesIds } },
            })
          ).map((s) => ({ id: s.id, name: s.name, emoji: s.emoji, rarity: s.rarity }))
        : [];

    return {
      id: season.id,
      name: season.name,
      theme: season.theme,
      region: season.region,
      startAt: season.startAt,
      endAt: season.endAt,
      featuredSpecies,
    };
  }

  async getSeasonLeaderboard() {
    const goal = await this.prisma.communityGoal.findFirst({
      where: { status: 'ACTIVE' },
      orderBy: { startAt: 'asc' },
    });
    if (!goal) return [];
    const top = await this.prisma.communityContribution.findMany({
      where: { goalId: goal.id },
      orderBy: { drops: 'desc' },
      take: 10,
      include: { user: { select: { fullName: true } } },
    });
    return top.map((c, i) => ({
      rank: i + 1,
      nickname: this.maskName(c.user.fullName),
      drops: c.drops,
    }));
  }
}
