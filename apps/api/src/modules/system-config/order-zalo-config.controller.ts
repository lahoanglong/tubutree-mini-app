import { Controller, Get, Optional } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { MssOrderEventRecorder } from '../integrations/mss/mss-order-event.recorder';
import { SystemConfigService } from './system-config.service';
import {
  MSS_ORDER_CONSENT_PRECHECKED_KEY,
  ORDER_ZALO_FRIEND_KNOWN_DAYS,
  TUBU_ZALO_PHONE_DEFAULT,
  TUBU_ZALO_PHONE_KEY,
  orderZaloGateOpen,
  orderZaloStatus,
  type OrderZaloStatus,
} from './order-zalo-config';

/**
 * Trạng thái ô "Nhận hành trình đơn hàng qua Zalo" của khách đang đăng nhập (wave tubu-mss-consent-ui). Tách khỏi `/config/public`
 * vì phụ thuộc người gọi (tỉ lệ rollout theo khách, số đã xác minh) mà `/config/public` được cache công khai.
 */
@Controller('config')
export class OrderZaloConfigController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    @Optional() private readonly mssEvents?: MssOrderEventRecorder,
  ) {}

  @Get('order-zalo')
  async orderZalo(@CurrentUser('sub') userId: string): Promise<OrderZaloStatus> {
    const [user, prechecked, phone] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { id: true, phone: true, phoneVerifiedAt: true, notifyOrderZalo: true, notifyOrderZaloAt: true },
      }),
      this.config.get<unknown>(MSS_ORDER_CONSENT_PRECHECKED_KEY, false),
      this.config.get<unknown>(TUBU_ZALO_PHONE_KEY, TUBU_ZALO_PHONE_DEFAULT),
    ]);
    const gate = this.mssEvents?.gate();
    return orderZaloStatus(gate, user, prechecked, phone, orderZaloGateOpen(gate) && (await this.friendKnown(userId)));
  }

  /** Tin đơn MSS gần nhất tới được chính khách qua bạn bè/hội thoại mở (không phải tin người lạ `stranger`): một truy vấn, không gọi MSS. */
  private async friendKnown(userId: string): Promise<boolean> {
    const row = await this.prisma.mssOrderEventOutbox.findFirst({
      where: {
        order: { userId },
        recipientRole: 'buyer',
        status: 'RESULT_SENT',
        resultReason: null,
        resultAt: { gte: new Date(Date.now() - ORDER_ZALO_FRIEND_KNOWN_DAYS * 86_400_000) },
      },
      select: { id: true },
    });
    return row !== null;
  }
}
