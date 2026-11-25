import { Controller, Get, Optional } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { MssOrderEventRecorder } from '../integrations/mss/mss-order-event.recorder';
import { friendKnownFor } from '../integrations/mss/order-zalo-friend-card';
import { SystemConfigService } from './system-config.service';
import {
  MSS_ORDER_CONSENT_PRECHECKED_KEY,
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
    return orderZaloStatus(gate, user, prechecked, phone, orderZaloGateOpen(gate) && (await friendKnownFor(this.prisma, userId)));
  }
}
