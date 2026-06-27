import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CoinsService } from '../wallet/coins.service';

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
  rewardXu: number;
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
    rewardXu: 2000,
    measure: (s) => (s.profileComplete ? 1 : 0),
  },
  {
    code: 'add_5_products',
    title: 'Thêm 5 sản phẩm',
    hint: 'Chọn 5 món bạn tâm đắc từ catalog.',
    goal: 5,
    rewardXu: 2000,
    measure: (s) => Math.min(s.itemsTotal, 5),
  },
  {
    code: 'notes_3',
    title: 'Viết lý do cho 3 sản phẩm',
    hint: '“Vì sao mình giới thiệu” giúp khách tin hơn.',
    goal: 3,
    rewardXu: 1500,
    measure: (s) => Math.min(s.itemsWithNote, 3),
  },
  {
    code: 'publish',
    title: 'Đăng gian hàng',
    hint: 'Bấm Lưu & Đăng để khách xem được.',
    goal: 1,
    rewardXu: 1000,
    measure: (s) => (s.isPublished ? 1 : 0),
  },
  {
    code: 'first_order',
    title: 'Đơn hàng đầu tiên',
    hint: 'Chia sẻ link — khi có đơn từ gian hàng bạn nhận thưởng!',
    goal: 1,
    rewardXu: 5000,
    measure: (s) => (s.firstOrder ? 1 : 0),
  },
];

@Injectable()
export class StorefrontQuestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coins: CoinsService,
  ) {}

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
    const claimedTxns = await this.prisma.coinTransaction.findMany({
      where: { userId, refType: 'QUEST' },
      select: { reason: true },
    });
    const claimedSet = new Set(claimedTxns.map((t) => t.reason));
    let totalEarnedXu = 0;
    const quests = QUESTS.map((q) => {
      const progress = q.measure(stats);
      const done = progress >= q.goal;
      const claimed = claimedSet.has(`STOREFRONT_QUEST:${q.code}`);
      if (claimed) totalEarnedXu += q.rewardXu;
      return { code: q.code, title: q.title, hint: q.hint, goal: q.goal, rewardXu: q.rewardXu, progress, done, claimed };
    });
    const level = quests.filter((q) => q.claimed).length;
    return { quests, totalEarnedXu, level, levelMax: QUESTS.length };
  }

  async claimQuest(userId: string, code: string) {
    const def = QUESTS.find((q) => q.code === code);
    if (!def) throw new BadRequestException('Nhiệm vụ không tồn tại.');
    const { sfId, stats } = await this.stats(userId);
    if (def.measure(stats) < def.goal) throw new BadRequestException('Bạn chưa hoàn thành nhiệm vụ này.');
    // grantCoins idempotent qua partial unique index (userId, reason) WHERE refType='QUEST'.
    await this.coins.grantCoins(userId, def.rewardXu, `STOREFRONT_QUEST:${code}`, 'QUEST', sfId);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { coinsBalance: true } });
    return { claimed: true, code, rewardXu: def.rewardXu, coinsBalance: user.coinsBalance };
  }
}
