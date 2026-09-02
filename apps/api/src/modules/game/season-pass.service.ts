import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';

/** Phần thưởng 1 bậc: 💧 (SEEDS) hoặc TubuXu (XU). */
export interface SeasonPassReward {
  type: 'SEEDS' | 'XU';
  amount: number;
}
interface SeasonPassTierConfig {
  xp: number;
  free: SeasonPassReward;
  premium: SeasonPassReward;
}
type Track = 'free' | 'premium';

/**
 * Vườn Xanh — Season Pass (chặng mùa). Ladder bậc tích XP theo điểm danh mỗi ngày, gắn với
 * mùa (Season) đang diễn ra. Mỗi bậc có phần thưởng free + premium; premium mở khi user có gói
 * đăng ký định kỳ ACTIVE. Nhận thưởng idempotent/atomic (guard nhận-trùng trong $transaction).
 * KHÔNG phụ thuộc GameEconomyService (tránh circular DI) — addXp là side-effect an toàn.
 */
@Injectable()
export class SeasonPassService {
  private readonly logger = new Logger(SeasonPassService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
  ) {}

  /** Mùa đang diễn ra theo cửa sổ thời gian (khớp GameSeasonService.getActiveSeason). */
  private activeSeason() {
    const now = new Date();
    return this.prisma.season.findFirst({
      where: { startAt: { lte: now }, endAt: { gte: now } },
      orderBy: { startAt: 'desc' },
    });
  }

  private tiers() {
    return this.config.get<SeasonPassTierConfig[]>('seasonpass.tiers', []);
  }

  /** Cộng XP chặng mùa (hook điểm danh). Không có mùa → no-op. Non-throwing (side-effect an toàn). */
  async addXp(userId: string, amount: number): Promise<void> {
    if (!amount || amount <= 0) return;
    try {
      const season = await this.activeSeason();
      if (!season) return;
      await this.prisma.userSeasonPass.upsert({
        where: { userId_seasonId: { userId, seasonId: season.id } },
        create: { userId, seasonId: season.id, xp: amount },
        update: { xp: { increment: amount } },
      });
    } catch (err) {
      this.logger.warn(`addXp bỏ qua lỗi user=${userId}: ${(err as Error)?.message}`);
    }
  }

  /** Trạng thái chặng mùa cho FE: XP + ladder bậc (unlocked/claimed) + đủ điều kiện premium. */
  async getState(userId: string) {
    const season = await this.activeSeason();
    if (!season) return { active: false as const };

    const tiers = await this.tiers();
    const pass = await this.prisma.userSeasonPass.findUnique({
      where: { userId_seasonId: { userId, seasonId: season.id } },
    });
    const xp = pass?.xp ?? 0;
    const claimedFree = pass?.claimedFree ?? [];
    const claimedPremium = pass?.claimedPremium ?? [];
    const premiumEligible = (await this.prisma.subscription.count({ where: { userId, status: 'ACTIVE' } })) > 0;

    return {
      active: true as const,
      seasonTitle: season.name,
      xp,
      premiumEligible,
      tiers: tiers.map((t, i) => ({
        tier: i,
        xpRequired: t.xp,
        free: t.free,
        premium: t.premium,
        unlocked: xp >= t.xp,
        claimedFree: claimedFree.includes(i),
        claimedPremium: claimedPremium.includes(i),
      })),
    };
  }

  /** Nhận thưởng 1 bậc trên 1 nhánh (free/premium). Idempotent + atomic. */
  async claim(userId: string, tier: number, track: Track) {
    const season = await this.activeSeason();
    if (!season) throw new BadRequestException('Chưa có mùa nào đang diễn ra.');

    const tiers = await this.tiers();
    if (!Number.isInteger(tier) || tier < 0 || tier >= tiers.length) {
      throw new BadRequestException('Bậc không hợp lệ.');
    }
    const tierCfg = tiers[tier];
    if (!tierCfg) throw new BadRequestException('Bậc không hợp lệ.');
    const reward = track === 'free' ? tierCfg.free : tierCfg.premium;
    const arrField = track === 'free' ? 'claimedFree' : 'claimedPremium';

    const pass = await this.prisma.userSeasonPass.findUnique({
      where: { userId_seasonId: { userId, seasonId: season.id } },
    });
    const xp = pass?.xp ?? 0;
    if (xp < tierCfg.xp) throw new BadRequestException('Chưa đủ XP.');
    const claimedArr = (track === 'free' ? pass?.claimedFree : pass?.claimedPremium) ?? [];
    if (claimedArr.includes(tier)) throw new BadRequestException('Đã nhận rồi.');

    if (track === 'premium') {
      const premiumEligible = (await this.prisma.subscription.count({ where: { userId, status: 'ACTIVE' } })) > 0;
      if (!premiumEligible) throw new BadRequestException('Cần đăng ký định kỳ để mở Premium.');
    }

    await this.prisma.$transaction(async (tx) => {
      // Guard double-claim ATOMIC bằng updateMany + filter mảng "chưa có tier" (Postgres list
      // filter `has`) — thay cho đọc-rồi-kiểm-tra-rồi-push cũ: 2 request claim() song song đều
      // có thể đọc mảng CHƯA có tier trước khi request đầu commit → array_append áp dụng trên
      // giá trị committed mới nhất ở mỗi statement (READ COMMITTED) nên cả 2 vẫn cùng push được
      // → double reward dù pre-check trong tx tưởng đã chặn.
      const guard = await tx.userSeasonPass.updateMany({
        where: { userId, seasonId: season.id, NOT: { [arrField]: { has: tier } } },
        data: { [arrField]: { push: tier } },
      });
      if (guard.count === 0) throw new BadRequestException('Đã nhận rồi.');

      if (reward.type === 'SEEDS') {
        const cap = await this.config.get<number>('game.tank_capacity', 500);
        // Cộng totalSeeds ATOMIC (increment) + clamp cap guarded trong CÙNG tx — chống
        // lost-update khi user vừa claim vừa spin/checkin/quiz/gift khác đổi totalSeeds cùng lúc.
        const gp = await tx.gameProfile.upsert({
          where: { userId },
          update: { totalSeeds: { increment: reward.amount } },
          create: { userId, totalSeeds: Math.min(cap, reward.amount) },
        });
        if (gp.totalSeeds > cap) {
          await tx.gameProfile.updateMany({
            where: { userId, totalSeeds: { gt: cap } },
            data: { totalSeeds: cap },
          });
        }
      } else {
        // XU thưởng: ghi TRỰC TIẾP trên tx (atomic với việc đánh dấu đã nhận) thay vì
        // coins.grantCoins (mở $transaction riêng ở root client → không rollback cùng claim).
        await tx.coinTransaction.create({
          data: {
            userId,
            delta: reward.amount,
            reason: `SEASONPASS:${season.id}:${tier}:${track}`,
            refType: 'SEASONPASS',
            refId: season.id,
          },
        });
        await tx.user.update({
          where: { id: userId },
          data: { coinsBalance: { increment: reward.amount } },
        });
      }
    });

    return { claimed: true, reward };
  }
}
