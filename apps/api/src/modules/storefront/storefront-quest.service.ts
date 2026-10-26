import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RewardPointsService } from '../wallet/reward-points.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { isStorefrontApprovalRequired } from './storefront-config';

interface QuestStats {
  itemsTotal: number;
  itemsWithNote: number;
  isPublished: boolean;
  profileComplete: boolean;
  firstOrder: boolean;
}

export interface QuestDef {
  code: string;
  title: string;
  hint: string;
  goal: number;
  /** Điểm Xanh (PD-3; trước đây 2.000/2.000/1.500/1.000/5.000 xu, quy 1.000:1 làm tròn lên). */
  rewardPoints: number;
  /** Tiến trình hiện tại (0..goal). */
  measure: (s: QuestStats) => number;
}

/** Chuỗi nhiệm vụ "Hành trình gian hàng" (early-win + động lực dựng gian hàng). */
export const QUESTS: QuestDef[] = [
  {
    code: 'profile_complete',
    title: 'Hoàn thiện hồ sơ gian hàng',
    hint: 'Thêm ảnh đại diện, ảnh bìa và lời nhắn cá nhân.',
    goal: 1,
    rewardPoints: 2_000,
    measure: (s) => (s.profileComplete ? 1 : 0),
  },
  {
    code: 'add_5_products',
    title: 'Thêm 5 sản phẩm',
    hint: 'Chọn 5 món bạn tâm đắc từ catalog.',
    goal: 5,
    rewardPoints: 2_000,
    measure: (s) => Math.min(s.itemsTotal, 5),
  },
  {
    code: 'notes_3',
    title: 'Viết lý do cho 3 sản phẩm',
    hint: '“Vì sao mình giới thiệu” giúp khách tin hơn.',
    goal: 3,
    rewardPoints: 2_000,
    measure: (s) => Math.min(s.itemsWithNote, 3),
  },
  {
    code: 'publish',
    title: 'Đăng gian hàng',
    hint: 'Gian hàng mới được Tubu duyệt trong 1 ngày làm việc, sau đó khách mới xem được.',
    goal: 1,
    rewardPoints: 1_000,
    measure: (s) => (s.isPublished ? 1 : 0),
  },
  {
    code: 'first_order',
    title: 'Đơn hàng đầu tiên',
    hint: 'Chia sẻ link — khi có đơn từ gian hàng bạn nhận thưởng!',
    goal: 1,
    rewardPoints: 5_000,
    measure: (s) => (s.firstOrder ? 1 : 0),
  },
];

@Injectable()
export class StorefrontQuestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rewards: RewardPointsService,
    // @Optional: các test dựng service trực tiếp không có config; thiếu thì coi như cờ duyệt theo mặc định.
    @Optional() private readonly config?: SystemConfigService,
  ) {}

  /** Lời hứa duyệt chỉ đúng khi cờ storefront.require_approval bật. */
  private async publishHint(): Promise<string> {
    const required = this.config ? await isStorefrontApprovalRequired(this.config) : true;
    return required ? 'Gian hàng mới được Tubu duyệt trong 1 ngày làm việc, sau đó khách mới xem được.' : 'Đăng gian hàng để khách xem được ngay.';
  }

  private async stats(userId: string): Promise<{ sfId: string; stats: QuestStats }> {
    const sf = await this.prisma.storefront.findFirst({
      where: { ownerUserId: userId, type: 'CTV' },
      include: { collections: { include: { items: { select: { note: true } } } } },
    });
    if (!sf) throw new NotFoundException('Chưa có gian hàng.');
    const items = sf.collections.flatMap((c) => c.items);
    const itemsTotal = items.length;
    const itemsWithNote = items.filter((i) => i.note && i.note.trim().length > 0).length;
    const firstOrderCount = await this.prisma.commission.count({ where: { affiliateUserId: userId } });
    const stats: QuestStats = {
      itemsTotal,
      itemsWithNote,
      isPublished: sf.isPublished,
      profileComplete: Boolean(sf.avatarUrl && sf.headerNote && sf.coverUrl),
      firstOrder: firstOrderCount > 0,
    };
    return { sfId: sf.id, stats };
  }

  async listQuests(userId: string) {
    const { stats } = await this.stats(userId);
    const publishHint = await this.publishHint();
    // Nhiệm vụ đã nhận bằng xu trước PD-3 nằm ở sổ xu cũ; chỉ đọc sổ điểm thì CTV thấy "chưa nhận"
    // và bấm nhận được lần hai.
    const where = { userId, refType: 'QUEST' };
    const [coinClaims, pointsClaims] = await Promise.all([
      this.prisma.coinTransaction.findMany({ where, select: { reason: true } }),
      this.prisma.pointsTransaction.findMany({ where, select: { reason: true } }),
    ]);
    const claimedSet = new Set([...coinClaims, ...pointsClaims].map((t) => t.reason));
    let totalEarnedPoints = 0;
    const quests = QUESTS.map((q) => {
      const progress = q.measure(stats);
      const done = progress >= q.goal;
      const claimed = claimedSet.has(`STOREFRONT_QUEST:${q.code}`);
      if (claimed) totalEarnedPoints += q.rewardPoints;
      return { code: q.code, title: q.title, hint: q.code === 'publish' ? publishHint : q.hint, goal: q.goal, rewardPoints: q.rewardPoints, progress, done, claimed };
    });
    const level = quests.filter((q) => q.claimed).length;
    return { quests, totalEarnedPoints, level, levelMax: QUESTS.length };
  }

  async claimQuest(userId: string, code: string) {
    const def = QUESTS.find((q) => q.code === code);
    if (!def) throw new BadRequestException('Nhiệm vụ không tồn tại.');
    const { sfId, stats } = await this.stats(userId);
    if (def.measure(stats) < def.goal) throw new BadRequestException('Bạn chưa hoàn thành nhiệm vụ này.');
    // grant idempotent qua partial unique index (userId, reason) WHERE refType='QUEST' ở sổ điểm, và
    // kiểm dòng QUEST cùng (userId, reason) ở sổ xu cũ: false = đã nhận trước đó, không cấp thêm.
    const granted = await this.rewards.grant(userId, def.rewardPoints, `STOREFRONT_QUEST:${code}`, 'QUEST', sfId);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { pointsBalance: true } });
    return { claimed: true, alreadyClaimed: !granted, code, rewardPoints: def.rewardPoints, pointsBalance: user.pointsBalance };
  }
}
