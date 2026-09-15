import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { ZnsClient } from '../integrations/zns/zns.client';
import { QUEUE_NOTIFICATIONS } from '../../jobs/queues';

/** Nội dung dùng khi template chưa được seed — tuyệt đối không in mã code ra cho khách. */
const MISSING_TEMPLATE_BODY = 'Tubu Tree có cập nhật mới cho bạn. Mở mục liên quan trong app để xem chi tiết nhé 🌿';

/** Job data cho retry gửi ZNS qua BullMQ khi lần gửi đồng bộ trong notify() thất bại
 * (xem notifications.processor.ts). */
export interface ZnsRetryJobData {
  notificationLogId: string;
  phone: string;
  templateId: string;
  templateData: Record<string, string>;
}

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
    // Optional: giữ tương thích test/call site cũ khởi tạo trực tiếp `new NotificationsService(prisma, zns)`
    // (không qua DI, không truyền queue) — notify() vẫn chạy đúng, chỉ bỏ qua bước enqueue retry.
    @InjectQueue(QUEUE_NOTIFICATIONS) private readonly notificationsQueue?: Queue,
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
      const log = await this.prisma.notificationLog.create({
        data: {
          userId,
          templateCode,
          channel: 'ZNS',
          payload: { data },
          status: ok ? 'SENT' : 'FAILED',
        },
      });
      // Trước đây gửi ZNS lỗi mạng 1 lần là mất thông báo vĩnh viễn (chỉ ghi FAILED rồi thôi,
      // không ai gửi lại). Enqueue job retry qua BullMQ (5 lần, backoff exponential — xem
      // defaultJobOptions trong jobs/queue.module.ts); processor notifications.processor.ts sẽ
      // gọi lại zns.sendTemplate() và lật log này sang SENT nếu thành công.
      if (!ok) {
        await this.notificationsQueue?.add('zns-retry', {
          notificationLogId: log.id,
          phone: user.phone,
          templateId: tpl.zaloTemplateId,
          templateData: data,
        } satisfies ZnsRetryJobData);
      }
    }
  }

  /** Gọi bởi NotificationsProcessor để retry gửi ZNS cho 1 NotificationLog đã FAILED.
   * Trả về true/false thay vì throw — processor tự quyết định khi nào rethrow cho BullMQ đếm attempt. */
  async retryZnsSend(job: ZnsRetryJobData): Promise<boolean> {
    const ok = await this.zns.sendTemplate(job.phone, job.templateId, job.templateData);
    if (ok) {
      await this.prisma.notificationLog.update({
        where: { id: job.notificationLogId },
        data: { status: 'SENT' },
      });
    }
    return ok;
  }

  listForUser(userId: string) {
    return this.prisma.notificationLog.findMany({
      where: { userId, channel: 'INAPP' },
      orderBy: { sentAt: 'desc' },
      take: 50,
    });
  }

  async markRead(userId: string, id: string): Promise<{ ok: boolean }> {
    // updateMany match 0 dòng (id không tồn tại, hoặc thuộc user khác) trước đây vẫn trả
    // {ok:true} — dùng count thật của updateMany để phản ánh đúng có match hay không.
    const result = await this.prisma.notificationLog.updateMany({
      where: { id, userId },
      data: { status: 'READ' },
    });
    return { ok: result.count > 0 };
  }

  private render(template: string, data: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => data[k] ?? '');
  }
}
