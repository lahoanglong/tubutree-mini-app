import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CRON_TZ } from '../../common/cron-tz';
import { notifyAdmins } from '../../common/notify-admins';
import { formatVnDateTime } from '../../common/vn-time';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SystemConfigService } from '../system-config/system-config.service';
import type { ZaloBridgeHealth } from '@tubutree/shared-types';
import { BridgeClient } from './bridge-client';
import { buildForwardText, sendAndSettle } from './forward-delivery';
import { STALE_AFTER_MS, resumableFailedForwardWhere, resumablePendingForwardWhere } from './support-chat-health';
import { SupportChatService } from './support-chat.service';
import { CHAT_ENABLED_KEY, CHAT_GROUP_KEY } from './support-chat.config';
import { markCronSkipped, TrackCron } from '../../common/cron-run/track-cron';

const ALERT_EVERY_MS = 60 * 60_000;
/** Cầu nối bật selfListen nên mỗi tin nó gửi đều dội lại thành một sự kiện; gửi đã quá ngần này mà chưa có sự kiện nào sau đó là listener đã điếc. */
export const DEAF_AFTER_SEND_MS = 5 * 60_000;
/** Tin khách chưa chuyển quá ngần này mới quét: tin mới còn trong cửa sổ gộp 15 giây của job thường. */
const SWEEP_AFTER_MS = 2 * 60_000;
const SWEEP_BATCH = 100;
/** Mỗi phút gửi lại tối đa ngần này forward FAILED: sau sự cố dài không dồn một cục vào hàng đợi 300 tin/giờ của cầu nối. */
const RESUME_FAILED_BATCH = 20;

/**
 * Mỗi phút: ghi trạng thái cầu nối, đồng bộ nhóm, báo admin khi mất kết nối lâu, và nhặt lại tin khách chưa được chuyển
 * (job BullMQ mất do Redis khởi động lại, hoặc đặt lịch lỗi lúc khách gửi). Mỗi bước tự bắt lỗi để không kéo các bước sau chết.
 */
@Injectable()
export class BridgeHealthCron {
  private readonly logger = new Logger(BridgeHealthCron.name);
  private running = false;
  private canResumeFailed = false;
  /** Chống báo lặp các cảnh báo vận hành (điếc, outbox bỏ tin); mất khi API khởi động lại thì báo lại một lần, chấp nhận được. */
  private readonly alerted = new Map<string, { at: number; count: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly bridge: BridgeClient,
    private readonly config: SystemConfigService,
    private readonly chat: SupportChatService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron('0 * * * * *', { timeZone: CRON_TZ })
  @TrackCron()
  async everyMinute(): Promise<void> {
    // Chưa cấu hình cầu nối (môi trường chưa dùng chat): không có gì để kiểm, báo hay quét.
    if (this.running || !this.bridge.isConfigured()) { markCronSkipped('RUNNING'); return; }
    this.running = true;
    this.canResumeFailed = false;
    try {
      await this.step('kiểm tra sức khoẻ cầu nối', () => this.checkHealth());
      await this.step('quét tin chưa chuyển', () => this.sweep());
      await this.step('gửi lại forward lỗi tạm', () => this.resumeFailedForwards());
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
    const deaf = h ? isDeaf(h, now) : false;
    const fields = {
      state,
      deaf,
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

    if (h) {
      const groupSet = await this.healGroup(h.groupId);
      this.canResumeFailed = state === 'CONNECTED' && groupSet;
    }
    // Chat đang tắt thì vẫn kiểm, đồng bộ nhóm và quét (tin nhận lúc chat bật vẫn phải đi), chỉ không làm phiền admin.
    const chatOn = await this.config.get<boolean>(CHAT_ENABLED_KEY, false);
    if (state !== 'CONNECTED' && chatOn) await this.alertIfDown(state, since, prev?.downAlertedAt ?? null, now);
    // Hết điếc thì lần điếc sau phải báo ngay, như downAlertedAt được xoá khi nối lại.
    if (h && !deaf) this.alerted.delete('deaf');
    const dropped = h?.outboxDropped ?? 0;
    // Số thấp hơn lần đã báo nghĩa là cầu nối khởi động lại và đếm lại từ 0.
    if (h && h.outboxDropped !== undefined && dropped < (this.alerted.get('outbox')?.count ?? 0)) this.alerted.delete('outbox');
    if (chatOn && deaf) {
      await this.alertOps('deaf', now, 0, 'Cầu nối Zalo báo đang kết nối nhưng không nhận được tin nào từ nhóm sau lần gửi gần nhất (hơn 5 phút): tin nhân viên trả lời có thể đang bị mất. Vào tab Chat CSKH bấm Kết nối lại.');
    }
    if (chatOn && dropped > 0) {
      await this.alertOps('outbox', now, dropped, `Cầu nối Zalo đã bỏ ${dropped} sự kiện chưa báo được lên hệ thống quá 24 giờ (tin nhân viên trả lời có thể đã mất). Kiểm tra khoá ZALO_BRIDGE_SECRET và log cầu nối rồi báo kỹ thuật.`);
    }
  }

  /** Báo lại sau 1 giờ; riêng cảnh báo có `count` (số tin bị bỏ) chỉ báo lại khi số đó tăng. */
  private async alertOps(kind: string, now: Date, count: number, message: string): Promise<void> {
    const last = this.alerted.get(kind);
    if (last) {
      if (count > 0 ? count <= last.count : now.getTime() - last.at <= ALERT_EVERY_MS) return;
    }
    this.alerted.set(kind, { at: now.getTime(), count });
    await notifyAdmins(
      { prisma: this.prisma, notifications: this.notifications, logger: this.logger },
      { template: 'OPS_ZALO_BRIDGE_ALERT', subject: 'cầu nối Zalo gặp sự cố', data: () => ({ message }) },
    );
  }

  /** Admin sửa `chat.zalo_group_id` ở tab Cấu hình chung thì cầu nối không biết; cron kéo nó về đúng giá trị cấu hình. Trả true khi sau lượt này cầu nối đang ở đúng nhóm cấu hình (và có nhóm). */
  private async healGroup(bridgeGroupId: string | null): Promise<boolean> {
    const wanted = await this.config.get<string>(CHAT_GROUP_KEY, '');
    if (wanted !== (bridgeGroupId ?? '')) {
      // Cấu hình rỗng là "không nhóm nào": cầu nối còn nhóm cũ thì vẫn nghe và chuyển tin vào nhóm đó.
      const r = await this.bridge.setGroup(wanted === '' ? null : wanted);
      if (!r.ok) {
        this.logger.warn(`Không đồng bộ được nhóm cho cầu nối: ${r.code}`);
        return false;
      }
    }
    return wanted !== '';
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

  /** Forward FAILED vì cầu nối chưa nhận gửi (mất kết nối, chưa chọn nhóm...) tự gửi lại khi cầu nối đã CONNECTED và có nhóm. */
  private async resumeFailedForwards(): Promise<void> {
    if (!this.canResumeFailed) return;
    const now = new Date();
    // Sắp theo updatedAt tăng dần: forward vừa thử lại (và hỏng lại) xuống cuối, không chặn các forward sau.
    const failed = await this.prisma.supportForward.findMany({
      where: resumableFailedForwardWhere(now),
      orderBy: { updatedAt: 'asc' },
      take: RESUME_FAILED_BATCH,
    });
    for (const forward of failed) {
      try {
        await this.resumeOne(forward, now);
      } catch (err) {
        this.logger.warn(`Gửi lại forward ${forward.id} lỗi: ${(err as Error).message}`);
        const lastError = `RESUME: ${(err as Error).message}`.slice(0, 500);
        await this.prisma.supportForward
          .updateMany({ where: { id: forward.id, status: 'PENDING' }, data: { status: 'FAILED', lastError } })
          .catch(() => undefined);
      }
    }
  }

  private async resumeOne(forward: { id: string; conversationId: string }, now: Date): Promise<void> {
    const messages = await this.prisma.supportMessage.findMany({
      where: { conversationId: forward.conversationId, forwardId: forward.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const conv = await this.prisma.supportConversation.findUnique({ where: { id: forward.conversationId } });
    if (messages.length === 0 || !conv) return;
    // Chốt nguyên tử và lặp lại đủ điều kiện chọn: hai lượt quét song song thì chỉ một bên gửi, và forward admin vừa gửi lại thành SEND_FAILED (có thể đã đăng) thì không gửi nữa.
    const claimed = await this.prisma.supportForward.updateMany({
      where: { id: forward.id, ...resumableFailedForwardWhere(now) },
      data: { status: 'PENDING' },
    });
    if (claimed.count === 0) return;
    const text = await buildForwardText(this.prisma, conv, messages);
    await sendAndSettle(this.prisma, this.bridge, forward, text, false);
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

/** Cầu nối bản cũ chưa báo lastSentAt/lastEventAt thì không bao giờ bị coi là điếc. */
function isDeaf(h: ZaloBridgeHealth, now: Date): boolean {
  if (h.state !== 'CONNECTED' || !h.lastSentAt) return false;
  const sent = Date.parse(h.lastSentAt);
  if (!Number.isFinite(sent) || now.getTime() - sent <= DEAF_AFTER_SEND_MS) return false;
  const event = h.lastEventAt ? Date.parse(h.lastEventAt) : NaN;
  return !Number.isFinite(event) || sent > event;
}
