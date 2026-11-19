import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { GameAlbumService } from '../game/album/album.service';
import { readViralRules } from './viral-config';

/** `GET /me/green-card`: thẻ thành tích Sổ tay Xanh kèm mã mời (cùng dạng `GreenCard` ở packages/app-core/src/referral/green-card.ts). */
export interface GreenCard {
  referralCode: string;
  /** Thẻ đã mở / tổng thẻ của Sổ tay Xanh; null khi sổ tắt (game.album_enabled hoặc game.mini.enabled). */
  album: { seen: number; total: number } | null;
  /** Số món (vỏ chai, túi, hũ...) đã đổi qua Đổi rác đã hoàn tất. */
  wasteItems: number;
  /** Thưởng đơn đầu cho mỗi bên; points 0 = Admin tắt thưởng (thẻ vẫn hiện). */
  firstOrderReward: { points: number; minOrderAmount: number };
  /** CTV chỉ hưởng hoa hồng: không nhận Điểm Xanh giới thiệu, thẻ không hứa thưởng cho họ. */
  earnsPoints: boolean;
}

/** Thẻ của chính khách đang đăng nhập. Cờ growth.referral_viral_enabled tắt: 404 như route không có. */
@Injectable()
export class GreenCardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly album: GameAlbumService,
  ) {}

  async card(userId: string): Promise<GreenCard> {
    const rules = await readViralRules(this.config);
    if (!rules.enabled) throw new NotFoundException('Không tìm thấy.');
    const [user, album, waste] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { referralCode: true, role: true } }),
      // Sổ tắt hoặc đọc lỗi: thẻ vẫn hiện số vỏ và link mời, không hiện số thẻ.
      this.album.album(userId, { summary: true }).then(
        (r) => ({ seen: r.seen, total: r.total }),
        () => null,
      ),
      this.prisma.wasteRequestLine.aggregate({ where: { request: { userId, status: 'COMPLETED' } }, _sum: { receivedQty: true } }),
    ]);
    return {
      referralCode: user.referralCode,
      album,
      wasteItems: Math.max(0, waste._sum.receivedQty ?? 0),
      firstOrderReward: { points: rules.points, minOrderAmount: rules.minOrder },
      earnsPoints: user.role !== 'AFFILIATE',
    };
  }
}
