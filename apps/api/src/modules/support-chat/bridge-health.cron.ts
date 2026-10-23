import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CRON_TZ } from '../../common/cron-tz';
import { notifyAdmins } from '../../common/notify-admins';
import { formatVnDateTime } from '../../common/vn-time';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { BridgeClient } from './bridge-client';
import { STALE_AFTER_MS, resumablePendingForwardWhere } from './support-chat-health';
import { SupportChatService } from './support-chat.service';
import { CHAT_ENABLED_KEY, CHAT_GROUP_KEY } from './support-chat.config';

const ALERT_EVERY_MS = 60 * 60_000;
/** Tin khách chưa chuyển quá ngần này mới quét: tin mới còn trong cửa sổ gộp 15 giây của job thường. */
const SWEEP_AFTER_MS = 2 * 60_000;
const SWEEP_BATCH = 100;

/**
 * Mỗi phút: ghi trạng thái cầu nối, đồng bộ nhóm, báo admin khi mất kết nối lâu, và nhặt lại tin khách chưa được chuyển
 * (job BullMQ mất do Redis khởi động lại, hoặc đặt lịch lỗi lúc khách gửi). Mỗi bước tự bắt lỗi để không kéo các bước sau chết.
 */
@Injectable()
export class BridgeHealthCron {
  private readonly logger = new Logger(BridgeHealthCron.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bridge: BridgeClient,
    private readonly config: SystemConfigService,
    private readonly chat: SupportChatService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron('0 * * * * *', { timeZone: CRON_TZ })
  async everyMinute(): Promise<void> {
    // Chưa cấu hình cầu nối (môi trường chưa dùng chat): không có gì để kiểm, báo hay quét.
    if (this.running || !this.bridge.isConfigured()) return;
    this.running = true;
    try {
      await this.step('kiểm tra sức khoẻ cầu nối', () => this.checkHealth());
      await this.step('quét tin chưa chuyển', () => this.sweep());
    } finally {
      this.running = false;
    }
  }

  private async step(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.logger.error(`Cron cầu nối Zalo, bước ${name} lỗi: ${err instanceof Error ? err.message : err}`);
    }
  }

  private async checkHealth(): Promise<void> {
    const now = new Date();
    const h = await this.bridge.health();
    const prev = await this.prisma.supportBridgeStatus.findUnique({ where: { id: 'main' } });
    const state = h?.state ?? 'UNREACHABLE';
    // since chỉ nhích khi trạng thái đổi, để "mất kết nối từ lúc nào" không trôi theo từng lần kiểm.
    const since = prev && prev.state === state ? prev.since : h ? new Date(h.since) : now;
    const fields = {
      state,
      since,
      lastError: h ? h.lastError : 'Không gọi được cầu nối',
      zaloUid: h?.zaloUid ?? null,
      displayName: h?.displayName ?? null,
      avatar: h?.avatar ?? null,
      checkedAt: now,
      // Kết nối lại thì lần sự cố sau phải được báo ngay, không chờ hết giờ chống báo lặp của lần trước.
      ...(state === 'CONNECTED' ? { downAlertedAt: null } : {}),
    };
    await this.prisma.supportBridgeStatus.upsert({ where: { id: 'main' }, create: { id: 'main', ...fields }, update: fields });

    if (h) await this.healGroup(h.groupId);
    // Chat đang tắt thì vẫn kiểm, đồng bộ nhóm và quét (tin nhận lúc chat bật vẫn phải đi), chỉ không làm phiền admin.
    if (state !== 'CONNECTED' && (await this.config.get<boolean>(CHAT_ENABLED_KEY, false))) await this.alertIfDown(state, since, prev?.downAlertedAt ?? null, now);
  }

  /** Admin sửa `chat.zalo_group_id` ở tab Cấu hình chung thì cầu nối không biết; cron kéo nó về đúng giá trị cấu hình. */
  private async healGroup(bridgeGroupId: string | null): Promise<void> {
    const wanted = await this.config.get<string>(CHAT_GROUP_KEY, '');
    if (wanted === '' || wanted === (bridgeGroupId ?? '')) return;
    const r = await this.bridge.setGroup(wanted);
    if (!r.ok) this.logger.warn(`Không đồng bộ được nhóm cho cầu nối: ${r.code}`);
  }

  private async alertIfDown(state: string, since: Date, alertedAt: Date | null, now: Date): Promise<void> {
    if (now.getTime() - since.getTime() <= STALE_AFTER_MS) return;
    if (alertedAt && now.getTime() - alertedAt.getTime() <= ALERT_EVERY_MS) return;
    await notifyAdmins(
      { prisma: this.prisma, notifications: this.notifications, logger: this.logger },
      { template: 'OPS_ZALO_BRIDGE_DOWN', subject: 'cầu nối Zalo mất kết nối', data: () => ({ since: formatVnDateTime(since), state }) },
    );
    await this.prisma.supportBridgeStatus.update({ where: { id: 'main' }, data: { downAlertedAt: now } });
  }

  private async sweep(): Promise<void> {
    const now = new Date();
    const cutoff = new Date(now.getTime() - SWEEP_AFTER_MS);
    const where = {
      blockedAt: null,
      OR: [
        { messages: { some: { sender: 'CUSTOMER' as const, forwardId: null, createdAt: { lt: cutoff } } } },
        // Forward bỏ dở: bộ xử lý nhận lại forward PENDING trước, cầu nối chống đăng đôi theo forward.id.
        { forwards: { some: resumablePendingForwardWhere(now) } },
      ],
    };
    const convs = await this.prisma.supportConversation.findMany({ where, select: { id: true }, orderBy: { lastMessageAt: 'asc' }, take: SWEEP_BATCH });
    for (const c of convs) {
      try {
        await this.chat.scheduleForward(c.id);
      } catch (err) {
        this.logger.warn(`Quét: không đặt được lịch chuyển hội thoại ${c.id}: ${(err as Error).message}`);
      }
    }
    if (convs.length === SWEEP_BATCH) {
      const left = (await this.prisma.supportConversation.count({ where })) - convs.length;
      if (left > 0) this.logger.warn(`Quét tin chưa chuyển: còn ${left} hội thoại chờ lượt sau (mỗi phút tối đa ${SWEEP_BATCH}).`);
    }
  }
}
