import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { clampTankKeepingOverflow, initialEcoImpact } from './game-profile';
import { NotificationsService } from '../notifications/notifications.service';
import { vnDateKey } from '../../common/vn-time';
import { maskName } from '../../common/mask-name';

/**
 * Vườn Xanh 2.0 (social) — tặng nước cho bạn bè trong mạng giới thiệu.
 * "Bạn bè" = người mình mời (referredById = mình) + người đã mời mình.
 * Trừ tank người gửi nguyên tử (updateMany gte), cộng tank người nhận (cap) — cùng một transaction với bản ghi gift.
 * Chống tặng 2 lần/ngày/người bằng WaterGift unique [sender, recipient, dayKey].
 */
@Injectable()
export class GameGiftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly notifications: NotificationsService,
  ) {}

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
    // Trần 200: đây là DANH SÁCH để hiển thị. Một CTV lâu năm có thể có hàng nghìn người được
    // giới thiệu — tải hết về rồi render hết là tốn băng thông và treo màn hình cho đúng một
    // tính năng tặng nước. (friendIds() bên trên KHÔNG đặt trần vì nó dùng để kiểm tra quyền —
    // cắt bớt ở đó sẽ loại nhầm bạn bè thật.)
    const referees = await this.prisma.user.findMany({
      where: { referredById: userId },
      select: { id: true, fullName: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const list: { id: string; fullName: string | null }[] = [...referees];
    if (me?.referredById) {
      const referrer = await this.prisma.user.findUnique({
        where: { id: me.referredById },
        select: { id: true, fullName: true },
      });
      if (referrer?.id) list.push(referrer);
    }
    const dayKey = vnDateKey();
    const giftsToday = await this.prisma.waterGift.findMany({
      where: { senderId: userId, dayKey },
      select: { recipientId: true },
    });
    const gifted = new Set(giftsToday.map((g) => g.recipientId));
    return list.map((u) => ({
      id: u.id,
      nickname: maskName(u.fullName),
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
    const dayKey = vnDateKey();

    // Đọc cấu hình trước khi mở tx để tx chỉ giữ khoá qua các câu ghi.
    const cap = await this.config.get<number>('game.tank_capacity', 500);
    const ecoImpact = await initialEcoImpact(this.config);

    // Bản ghi gift (unique chống tặng 2 lần/ngày/người), trừ nước người gửi và cộng nước người nhận nằm trong MỘT
    // transaction: sập giữa chừng thì cả ba cùng huỷ, không còn cảnh người gửi mất nước mà người nhận không được gì.
    // Chỉ unique của chính bản ghi gift mới là "đã tặng hôm nay"; lỗi khác (DB, mạng, P2002 ở bước sau) ném nguyên văn.
    let giftRowInserted = false;
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.waterGift.create({ data: { senderId, recipientId, amount, dayKey } });
        giftRowInserted = true;

        // Trừ tank người gửi nguyên tử (updateMany gte); không đủ → ném để tx huỷ luôn bản ghi gift (và phần đã cộng).
        const debitSender = async () => {
          const dec = await tx.gameProfile.updateMany({
            where: { userId: senderId, totalSeeds: { gte: amount } },
            data: { totalSeeds: { decrement: amount } },
          });
          if (dec.count === 0) {
            throw new BadRequestException(`Cần ${amount}💧 để tặng nước.`);
          }
        };

        // Cộng tank người nhận ATOMIC (upsert increment) + clamp cap guarded — chống lost-update khi
        // 2 người tặng cùng lúc / người nhận đồng thời tự cộng nước qua spin/checkin/quiz (pattern cũ
        // đọc-rồi-ghi-tuyệt-đối sẽ đè mất phần cộng của thao tác kia dù bên gửi đã bị trừ nước thật).
        const creditRecipient = async () => {
          const upserted = await tx.gameProfile.upsert({
            where: { userId: recipientId },
            create: { userId: recipientId, totalSeeds: Math.min(cap, amount), ecoImpact },
            update: { totalSeeds: { increment: amount } },
          });
          if (upserted.totalSeeds > cap) {
            await clampTankKeepingOverflow(tx, recipientId, cap, amount);
          }
        };

        // Hai dòng hồ sơ bị khoá tới hết tx nên luôn ghi theo thứ tự userId: A tặng B cùng lúc B tặng A mà mỗi bên khoá
        // dòng của mình trước thì chờ chéo nhau (deadlock, Postgres huỷ một bên với 40P01).
        if (senderId < recipientId) {
          await debitSender();
          await creditRecipient();
        } else {
          await creditRecipient();
          await debitSender();
        }
      });
    } catch (err) {
      // Bắt NGOÀI $transaction: unique lỗi làm Postgres huỷ tx đang mở nên không thể bắt-rồi-làm-tiếp bên trong.
      if (!giftRowInserted && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException('Hôm nay bạn đã tặng nước cho người này rồi 🌿');
      }
      throw err;
    }

    await this.notifications.notifySafe(recipientId, 'GAME_WATER_GIFT', { amount: String(amount) });

    return { amount, recipientId };
  }
}
