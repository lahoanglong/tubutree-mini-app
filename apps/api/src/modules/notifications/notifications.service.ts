import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ZnsClient } from '../integrations/zns/zns.client';

/** Nội dung dùng khi template chưa được seed — tuyệt đối không in mã code ra cho khách. */
const MISSING_TEMPLATE_BODY = 'Tubu Tree có cập nhật mới cho bạn. Mở mục liên quan trong app để xem chi tiết nhé 🌿';

/**
 * Gửi thông báo theo template code (Build Spec §4.10, §11).
 * Tra NotificationTemplate → gửi qua kênh tương ứng (ZNS/INAPP) → ghi NotificationLog.
 * Luôn ghi INAPP để user xem trong app dù ZNS chưa cấu hình.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly zns: ZnsClient,
  ) {}

  async notify(
    userId: string,
    templateCode: string,
    data: Record<string, string>,
  ): Promise<void> {
    const tpl = await this.prisma.notificationTemplate.findUnique({ where: { code: templateCode } });
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    // In-app luôn lưu để hiển thị danh sách thông báo.
    // Thiếu template KHÔNG được in mã code ra cho khách (họ nhận thông báo nội dung là
    // "SUBSCRIPTION_ORDER_FAILED"). Hiện câu trung tính, còn mã vẫn nằm ở cột templateCode để
    // dò, kèm log warn để template thiếu được phát hiện thay vì âm thầm.
    if (!tpl) {
      this.logger.warn(`Thiếu NotificationTemplate "${templateCode}" — đã gửi nội dung mặc định.`);
    }
    const body = tpl ? this.render(tpl.bodyTemplate, data) : MISSING_TEMPLATE_BODY;
    await this.prisma.notificationLog.create({
      data: { userId, templateCode, channel: 'INAPP', payload: { body, data }, status: 'SENT' },
    });

    // ZNS nếu template là kênh ZNS + user có phone.
    if (tpl?.channel === 'ZNS' && user?.phone && tpl.zaloTemplateId) {
      const ok = await this.zns.sendTemplate(user.phone, tpl.zaloTemplateId, data);
      await this.prisma.notificationLog.create({
        data: {
          userId,
          templateCode,
          channel: 'ZNS',
          payload: { data },
          status: ok ? 'SENT' : 'FAILED',
        },
      });
    }
  }

  listForUser(userId: string) {
    return this.prisma.notificationLog.findMany({
      where: { userId, channel: 'INAPP' },
      orderBy: { sentAt: 'desc' },
      take: 50,
    });
  }

  async markRead(userId: string, id: string): Promise<{ ok: boolean }> {
    await this.prisma.notificationLog.updateMany({
      where: { id, userId },
      data: { status: 'READ' },
    });
    return { ok: true };
  }

  private render(template: string, data: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => data[k] ?? '');
  }
}
