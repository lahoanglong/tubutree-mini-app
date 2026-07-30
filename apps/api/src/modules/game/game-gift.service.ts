import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Vườn Xanh 2.0 (social) — tặng nước cho bạn bè trong mạng giới thiệu.
 * "Bạn bè" = người mình mời (referredById = mình) + người đã mời mình.
 * Trừ tank người gửi nguyên tử (updateMany gte), cộng tank người nhận (cap).
 * Chống tặng 2 lần/ngày/người bằng WaterGift unique [sender, recipient, dayKey].
 */
@Injectable()
export class GameGiftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  private dayKey(d: Date): string {
    return new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  }

  private maskName(name: string | null): string {
    if (!name) return 'Bạn Tubu';
    const parts = name.trim().split(' ');
    return `${parts[parts.length - 1] ?? 'Tubu'}***`;
  }

  private async friendIds(userId: string): Promise<Set<string>> {
    const me = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { referredById: true },
    });
    const referees = await this.prisma.user.findMany({
      where: { referredById: userId },
      select: { id: true },
    });
    const set = new Set<string>(referees.map((r) => r.id));
    if (me?.referredById) set.add(me.referredById);
    return set;
  }

  async getFriends(userId: string) {
    const me = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { referredById: true },
    });
    const referees = await this.prisma.user.findMany({
      where: { referredById: userId },
      select: { id: true, fullName: true },
    });
    const list: { id: string; fullName: string | null }[] = [...referees];
    if (me?.referredById) {
      const referrer = await this.prisma.user.findUnique({
        where: { id: me.referredById },
        select: { id: true, fullName: true },
      });
      if (referrer?.id) list.push(referrer);
    }
    const dayKey = this.dayKey(new Date());
    const giftsToday = await this.prisma.waterGift.findMany({
      where: { senderId: userId, dayKey },
      select: { recipientId: true },
    });
    const gifted = new Set(giftsToday.map((g) => g.recipientId));
    return list.map((u) => ({
      id: u.id,
      nickname: this.maskName(u.fullName),
      giftedToday: gifted.has(u.id),
    }));
  }

  async giftWater(senderId: string, recipientId: string) {
    if (senderId === recipientId) {
      throw new BadRequestException('Không thể tự tặng nước cho mình 🌿');
    }
    const friends = await this.friendIds(senderId);
    if (!friends.has(recipientId)) {
      throw new BadRequestException('Chỉ tặng nước cho bạn bè (người bạn mời hoặc người mời bạn).');
    }
    const amount = await this.config.get<number>('game.gift_water_amount', 10);
    const dayKey = this.dayKey(new Date());

    // Chống tặng 2 lần/ngày/người: tạo bản ghi unique trước.
    try {
      await this.prisma.waterGift.create({ data: { senderId, recipientId, amount, dayKey } });
    } catch {
      throw new BadRequestException('Hôm nay bạn đã tặng nước cho người này rồi 🌿');
    }

    // Trừ tank người gửi nguyên tử; không đủ → rollback bản ghi gift.
    const dec = await this.prisma.gameProfile.updateMany({
      where: { userId: senderId, totalSeeds: { gte: amount } },
      data: { totalSeeds: { decrement: amount } },
    });
    if (dec.count === 0) {
      await this.prisma.waterGift.deleteMany({ where: { senderId, recipientId, dayKey } });
      throw new BadRequestException(`Cần ${amount}💧 để tặng nước.`);
    }

    // Cộng tank người nhận (cap tank_capacity).
    const cap = await this.config.get<number>('game.tank_capacity', 500);
    const rp = await this.prisma.gameProfile.findUnique({ where: { userId: recipientId } });
    const newTotal = Math.min(cap, (rp?.totalSeeds ?? 0) + amount);
    await this.prisma.gameProfile.upsert({
      where: { userId: recipientId },
      create: { userId: recipientId, totalSeeds: amount },
      update: { totalSeeds: newTotal },
    });

    await this.notifications
      .notify(recipientId, 'GAME_WATER_GIFT', { amount: String(amount) })
      .catch(() => undefined);

    return { amount, recipientId };
  }
}
