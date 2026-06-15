import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { GameCommunityService } from './game-community.service';
import { GameCollectionService } from './game-collection.service';

interface SpinPrize {
  id: string;
  name: string;
  weight: number;
  rewardType: 'POINTS' | 'COUPON' | 'SEEDS' | 'NONE';
  value: number;
}

interface EcoImpact {
  progress: number;
  target: number;
  treeType: string;
  treesPlanted: number;
}

/** Vườn Xanh Tubu (Build Spec §6.7). Tham số đọc từ SystemConfig. */
@Injectable()
export class GameService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    // Optional: hồ cộng đồng Phase 2. Tests dựng GameService 2 tham số → bỏ qua góp hồ.
    @Optional() private readonly community?: GameCommunityService,
    // Optional: sổ tay loài Phase 3. Thu hoạch → sưu tập 1 loài.
    @Optional() private readonly collection?: GameCollectionService,
  ) {}

  // ── Profile ────────────────────────────────────────
  async ensureProfile(userId: string) {
    const target = await this.config.get<number>('game.tree_default_target', 600);
    const existing = await this.prisma.gameProfile.findUnique({ where: { userId } });
    if (existing) return existing;
    return this.prisma.gameProfile.create({
      data: {
        userId,
        ecoImpact: { progress: 0, target, treeType: 'Cây Dứa Fuwa3e', treesPlanted: 0 } as object,
      },
    });
  }

  async getProfile(userId: string) {
    const profile = await this.ensureProfile(userId);
    const wiltDays = await this.config.get<number>('game.wilt_days', 3);
    const deathDays = await this.config.get<number>('game.death_days', 7);
    return { ...profile, treeHealth: this.treeHealth(profile, wiltDays, deathDays) };
  }

  /** §6.7.3: trạng thái cây theo số ngày không tưới (chỉ tính khi đã có tiến trình). */
  private treeHealth(
    profile: { lastWateredAt: Date | null; ecoImpact: unknown },
    wiltDays: number,
    deathDays: number,
  ): 'HEALTHY' | 'WILTED' | 'DEAD' {
    if (!profile.lastWateredAt || this.eco(profile.ecoImpact).progress <= 0) return 'HEALTHY';
    const days = (Date.now() - new Date(profile.lastWateredAt).getTime()) / 864e5;
    if (days >= deathDays) return 'DEAD';
    if (days >= wiltDays) return 'WILTED';
    return 'HEALTHY';
  }

  // ── Spin wheel ─────────────────────────────────────
  async spin(userId: string) {
    const cost = await this.config.get<number>('game.spin_buy_cost_points', 10);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.pointsBalance < cost) {
      throw new BadRequestException(`Cần ${cost} điểm Xanh để quay.`);
    }
    const prizes = await this.config.get<SpinPrize[]>('game.spin_prizes', []);
    if (prizes.length === 0) throw new BadRequestException('Vòng quay chưa cấu hình.');

    // Trừ điểm ATOMIC (gte) — chống quay đồng thời làm âm điểm (TOCTOU).
    const dec = await this.prisma.user.updateMany({
      where: { id: userId, pointsBalance: { gte: cost } },
      data: { pointsBalance: { decrement: cost } },
    });
    if (dec.count === 0) throw new BadRequestException(`Cần ${cost} điểm Xanh để quay.`);
    await this.prisma.pointsTransaction.create({
      data: { userId, delta: -cost, reason: 'GAME_SPIN_COST', refType: 'GAME' },
    });
    const prize = this.pickWeighted(prizes);

    let rewardRefId: string | null = null;
    if (prize.rewardType === 'POINTS') {
      await this.creditPoints(userId, prize.value, `GAME_SPIN_WIN:${prize.id}`);
    } else if (prize.rewardType === 'SEEDS') {
      const tankCap = await this.config.get<number>('game.tank_capacity', 200);
      const p = await this.ensureProfile(userId);
      await this.prisma.gameProfile.update({
        where: { userId },
        data: { totalSeeds: Math.min(tankCap, p.totalSeeds + prize.value) },
      });
    } else if (prize.rewardType === 'COUPON') {
      rewardRefId = await this.grantCoupon(userId, prize.value);
    }

    await this.prisma.gameSpin.create({
      data: {
        userId,
        prizeId: prize.id,
        prizeName: prize.name,
        prizeValue: prize.value,
        rewardType: prize.rewardType,
        rewardRefId,
      },
    });
    return { prize: { id: prize.id, name: prize.name, rewardType: prize.rewardType, value: prize.value } };
  }

  // ── Tree water + harvest ───────────────────────────
  async waterTree(userId: string, drops: number) {
    if (drops <= 0) throw new BadRequestException('Số giọt nước không hợp lệ.');
    const profile = await this.ensureProfile(userId);
    if (profile.totalSeeds < drops) throw new BadRequestException('Không đủ giọt nước.');

    const eco = this.eco(profile.ecoImpact);

    // §6.7.3: cây CHẾT (≥ death_days không tưới) → mất tiến trình, trồng lại từ đầu.
    const deathDays = await this.config.get<number>('game.death_days', 7);
    let revivedFromDead = false;
    if (
      profile.lastWateredAt &&
      eco.progress > 0 &&
      (Date.now() - new Date(profile.lastWateredAt).getTime()) / 864e5 >= deathDays
    ) {
      eco.progress = 0;
      revivedFromDead = true;
    }
    eco.progress += drops;

    // Thu hoạch khi đủ target; phần dư được CARRY-OVER sang cây mới (không mất nước).
    // Dùng vòng lặp phòng trường hợp target cấu hình nhỏ → một lần tưới đủ nhiều cây.
    const harvestAmount = await this.config.get<number>('game.harvest_coupon_amount', 30000);
    let harvestCount = 0;
    let couponCode: string | undefined;
    let certificateCode: string | undefined;
    while (eco.progress >= eco.target) {
      eco.progress -= eco.target;
      eco.treesPlanted += 1;
      harvestCount += 1;
      couponCode = await this.grantCoupon(userId, harvestAmount);
      // Cam kết 1 cây thật + chứng nhận (§6.7.7). PanNature push thật để sau (gate).
      certificateCode = await this.plantTree(userId, eco.treeType);
    }
    const harvested = harvestCount > 0;

    // Phase 3: thu hoạch → sưu tập 1 loài (weighted theo rarity). Lấy loài cuối để hiện.
    let species: { name: string; emoji: string; rarity: string; ecoFact: string | null } | undefined;
    if (harvested && this.collection) {
      const got = await this.collection.collectOnHarvest(userId).catch(() => null);
      if (got) species = { name: got.name, emoji: got.emoji, rarity: got.rarity, ecoFact: got.ecoFact };
    }

    const reward: {
      coupon?: string;
      certificate?: string;
      species?: { name: string; emoji: string; rarity: string; ecoFact: string | null };
    } = {
      ...(couponCode ? { coupon: couponCode } : {}),
      ...(certificateCode ? { certificate: certificateCode } : {}),
      ...(species ? { species } : {}),
    };

    // Giai đoạn cây theo tiến độ hiện tại (sau carry-over). progress=0 → mầm mới (stage 1).
    const stage = Math.min(4, Math.max(1, Math.ceil((eco.progress / eco.target) * 4)));
    await this.prisma.gameProfile.update({
      where: { userId },
      data: {
        totalSeeds: profile.totalSeeds - drops,
        treeStage: stage,
        ecoImpact: eco as object,
        lastWateredAt: new Date(),
      },
    });

    // Phase 2: thu hoạch → 💧 đã nuôi cây góp vào hồ cộng đồng (Ant Forest gom batch).
    // Lỗi góp hồ không được chặn thu hoạch của user.
    if (harvested && this.community) {
      await this.community.contribute(userId, harvestCount * eco.target).catch(() => undefined);
    }
    return {
      progress: eco.progress,
      target: eco.target,
      harvested,
      treesPlanted: eco.treesPlanted,
      revivedFromDead,
      reward,
    };
  }

  /** Tạo bản ghi cây thật đã cam kết + mã chứng nhận. Trả mã. */
  private async plantTree(userId: string, treeType: string): Promise<string> {
    const certificateCode = `TUBU-${randomUUID().slice(0, 8).toUpperCase()}`;
    await this.prisma.plantedTree.create({ data: { userId, treeType, certificateCode } });
    return certificateCode;
  }

  /** "Khu rừng của tôi" — danh sách cây thật đã cam kết + chứng nhận (§6.7.7). */
  async getForest(userId: string) {
    const trees = await this.prisma.plantedTree.findMany({
      where: { userId },
      orderBy: { pledgedAt: 'desc' },
      take: 200,
    });
    return {
      count: trees.length,
      plantedCount: trees.filter((t) => t.status === 'PLANTED').length,
      trees: trees.map((t) => ({
        certificateCode: t.certificateCode,
        treeType: t.treeType,
        status: t.status,
        region: t.region,
        pledgedAt: t.pledgedAt,
        plantedAt: t.plantedAt,
      })),
    };
  }

  // ── Missions & leaderboard ─────────────────────────
  async getMissions(userId: string) {
    const missions = await this.prisma.mission.findMany();
    const progress = await this.prisma.missionProgress.findMany({ where: { userId } });
    const byMission = new Map(progress.map((p) => [p.missionId, p]));
    return missions.map((m) => {
      const p = byMission.get(m.id);
      return {
        code: m.code,
        title: m.title,
        description: m.description,
        rewardPoints: m.rewardPoints,
        progress: p?.progress ?? 0,
        goal: p?.goal ?? 1,
        completed: !!p?.completedAt,
      };
    });
  }

  async getLeaderboard() {
    const top = await this.prisma.gameProfile.findMany({
      orderBy: [{ longestStreak: 'desc' }, { totalSeeds: 'desc' }],
      take: 10,
      include: { user: { select: { fullName: true } } },
    });
    return top.map((p, i) => ({
      rank: i + 1,
      nickname: this.maskName(p.user.fullName),
      streak: p.longestStreak,
      treesPlanted: this.eco(p.ecoImpact).treesPlanted,
    }));
  }

  // ── Helpers ────────────────────────────────────────
  private async creditPoints(userId: string, delta: number, reason: string) {
    await this.prisma.$transaction([
      this.prisma.pointsTransaction.create({ data: { userId, delta, reason, refType: 'GAME' } }),
      this.prisma.user.update({ where: { id: userId }, data: { pointsBalance: { increment: delta } } }),
    ]);
  }

  /** Tạo coupon cá nhân AMOUNT cho user (thưởng game). Trả về code. */
  private async grantCoupon(userId: string, amount: number): Promise<string> {
    const code = `GAME${amount}-${userId.slice(-5)}-${Math.floor(Math.random() * 9000 + 1000)}`.toUpperCase();
    const end = new Date();
    end.setDate(end.getDate() + 30);
    await this.prisma.coupon.create({
      data: {
        code,
        type: 'AMOUNT',
        value: amount,
        startAt: new Date(),
        endAt: end,
        perUserLimit: 1,
        scope: 'USER_GROUP',
        scopeMeta: { userId } as object,
      },
    });
    return code;
  }

  private pickWeighted(prizes: SpinPrize[]): SpinPrize {
    const total = prizes.reduce((s, p) => s + p.weight, 0);
    let r = Math.random() * total;
    for (const p of prizes) {
      r -= p.weight;
      if (r <= 0) return p;
    }
    return prizes[prizes.length - 1]!;
  }

  private eco(json: unknown): EcoImpact {
    const e = (json ?? {}) as Partial<EcoImpact>;
    return {
      progress: e.progress ?? 0,
      target: e.target ?? 600,
      treeType: e.treeType ?? 'Cây Dứa Fuwa3e',
      treesPlanted: e.treesPlanted ?? 0,
    };
  }

  private maskName(name: string | null): string {
    if (!name) return 'Bạn Tubu';
    const parts = name.trim().split(' ');
    const last = parts[parts.length - 1] ?? 'Tubu';
    return `${last}***`;
  }

  private dayKey(d: Date): string {
    const utc7 = new Date(d.getTime() + 7 * 3600 * 1000);
    return utc7.toISOString().slice(0, 10);
  }
  private startOfDay(d: Date): Date {
    const utc7 = new Date(d.getTime() + 7 * 3600 * 1000);
    utc7.setUTCHours(0, 0, 0, 0);
    return new Date(utc7.getTime() - 7 * 3600 * 1000);
  }
}
