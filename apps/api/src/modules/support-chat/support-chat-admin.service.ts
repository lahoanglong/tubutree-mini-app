import { BadGatewayException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma, SupportForward, SupportMessage } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { VN_OFFSET_MS } from '../../common/vn-time';
import { searchPhone, userPhoneClauses } from '../admin/admin-order-filter';
import { BridgeClient, type BridgeFailure } from './bridge-client';
import { ReplyNotifier } from './reply-notifier';
import { buildForwardText, sendAndSettle } from './forward-delivery';
import { isStalePendingForward, stalePendingForwardWhere, unforwardedWhere } from './support-chat-health';
import { CHAT_ENABLED_KEY, CHAT_GROUP_KEY } from './support-chat.config';

const PAGE = 30;
const THREAD_MAX = 500;
const LAST_MESSAGE_CHARS = 80;
const CODE_QUERY = /^[A-HJ-NP-Z2-9]{4}$/;

type BridgeAction = 'QR_START' | 'LOGOUT' | 'RECONNECT';

@Injectable()
export class SupportChatAdminService {
  private readonly logger = new Logger(SupportChatAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly bridge: BridgeClient,
    private readonly notifier: ReplyNotifier,
  ) {}

  async bridgeStatus() {
    const [row, groupId, enabled] = await Promise.all([
      this.prisma.supportBridgeStatus.findUnique({ where: { id: 'main' } }),
      this.config.get<string>(CHAT_GROUP_KEY, ''),
      this.config.get<boolean>(CHAT_ENABLED_KEY, false),
    ]);
    return {
      state: row?.state ?? 'UNREACHABLE',
      since: row?.since ?? null,
      lastError: row?.lastError ?? null,
      zaloUid: row?.zaloUid ?? null,
      displayName: row?.displayName ?? null,
      avatar: row?.avatar ?? null,
      checkedAt: row?.checkedAt ?? null,
      groupId,
      enabled,
    };
  }

  async qrStart(adminId: string) {
    await this.record('QR_START', adminId);
    return this.unwrap(await this.bridge.qrStart());
  }

  async qrStatus() {
    return this.unwrap(await this.bridge.qrStatus());
  }

  async logout(adminId: string) {
    await this.record('LOGOUT', adminId);
    return this.unwrap(await this.bridge.logout());
  }

  async reconnect(adminId: string) {
    await this.record('RECONNECT', adminId);
    return this.unwrap(await this.bridge.reconnect());
  }

  async groups() {
    return this.unwrap(await this.bridge.groups());
  }

  async test() {
    const hhmm = new Date(Date.now() + VN_OFFSET_MS).toISOString().slice(11, 16);
    const r = await this.bridge.send(`test-${Date.now()}`, `Tin thử từ Tubu Tree lúc ${hhmm}.`);
    if (!r.ok) this.fail(r);
    return { ok: true };
  }

  async updateSettings(adminId: string, input: { enabled?: boolean; groupId?: string }) {
    if (input.enabled !== undefined) await this.config.set(CHAT_ENABLED_KEY, input.enabled, adminId);
    let bridgeSynced = true;
    if (input.groupId !== undefined) {
      await this.config.set(CHAT_GROUP_KEY, input.groupId, adminId);
      const r = await this.bridge.setGroup(input.groupId || null);
      if (!r.ok) {
        // Cấu hình đã lưu; cron sức khoẻ sẽ đồng bộ lại cho cầu nối ở phút sau.
        bridgeSynced = false;
        this.logger.warn(`Không báo được nhóm mới cho cầu nối: ${r.code}`);
      }
    }
    return { enabled: await this.config.get<boolean>(CHAT_ENABLED_KEY, false), groupId: await this.config.get<string>(CHAT_GROUP_KEY, ''), bridgeSynced };
  }

  async list(q: { q?: string; filter?: 'unforwarded'; cursor?: string }) {
    const and: Prisma.SupportConversationWhereInput[] = [];
    const term = q.q?.trim().replace(/^#+/, '').trim();
    if (term) {
      const or: Prisma.SupportConversationWhereInput[] = [];
      if (CODE_QUERY.test(term.toUpperCase())) or.push({ code: term.toUpperCase() });
      // Chuỗi toàn số/ký tự SĐT mới tìm theo SĐT, cùng cách ô tìm người dùng và ô tìm đơn.
      if (!/[A-Za-z]/.test(term) || searchPhone(term)) or.push(...userPhoneClauses(term, false).map((c) => ({ user: c })));
      and.push({ OR: or.length ? or : [{ code: term.toUpperCase() }] });
    }
    if (q.filter === 'unforwarded') and.push(unforwardedWhere(new Date()));

    const rows = await this.prisma.supportConversation.findMany({
      where: and.length ? { AND: and } : {},
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      take: PAGE + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      include: {
        user: { select: { id: true, fullName: true, phone: true } },
        messages: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1, select: { body: true, sender: true, imageUrl: true } },
      },
    });
    const page = rows.slice(0, PAGE);
    const attention = new Set(
      page.length === 0
        ? []
        : (await this.prisma.supportConversation.findMany({ where: { AND: [{ id: { in: page.map((c) => c.id) } }, unforwardedWhere(new Date())] }, select: { id: true } })).map((c) => c.id),
    );
    return {
      items: page.map((c) => {
        const last = c.messages[0];
        return {
          id: c.id,
          code: c.code,
          blocked: c.blockedAt !== null,
          lastMessageAt: c.lastMessageAt,
          user: c.user,
          lastMessage: last ? { sender: last.sender, body: Array.from(last.body).slice(0, LAST_MESSAGE_CHARS).join(''), hasImage: !!last.imageUrl } : null,
          needsAttention: attention.has(c.id),
        };
      }),
      nextCursor: rows.length > PAGE ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  async get(id: string) {
    const conv = await this.prisma.supportConversation.findUnique({
      where: { id },
      include: { user: { select: { id: true, fullName: true, phone: true } } },
    });
    if (!conv) throw new NotFoundException('Không tìm thấy hội thoại.');
    const rows = await this.prisma.supportMessage.findMany({
      where: { conversationId: id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: THREAD_MAX + 1,
    });
    const truncated = rows.length > THREAD_MAX;
    if (truncated) rows.length = THREAD_MAX;
    rows.reverse();
    const ids = [...new Set(rows.map((m) => m.forwardId).filter((x): x is string => !!x))];
    const forwards = ids.length ? await this.prisma.supportForward.findMany({ where: { id: { in: ids } } }) : [];
    const byId = new Map(forwards.map((f) => [f.id, f]));
    const now = new Date();
    return {
      id: conv.id,
      code: conv.code,
      blocked: conv.blockedAt !== null,
      blockedAt: conv.blockedAt,
      blockedByUserId: conv.blockedByUserId,
      user: conv.user,
      truncated,
      // forwardId có thể trỏ forward đã bị chính sách lưu trữ xoá: coi như không có trạng thái.
      messages: rows.map((m) => toAdminMessage(m, m.forwardId ? (byId.get(m.forwardId) ?? null) : null, now)),
    };
  }

  async reply(adminId: string, conversationId: string, body: string) {
    const conv = await this.prisma.supportConversation.findUnique({ where: { id: conversationId } });
    if (!conv) throw new NotFoundException('Không tìm thấy hội thoại.');
    const text = body.trim();
    const created = await this.prisma.supportMessage.create({
      data: { conversationId, sender: 'STAFF', source: 'ADMIN', body: text, adminUserId: adminId },
    });
    try {
      await this.prisma.supportConversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } });
      await this.notifier.scheduleReplyBell(conv, created);
    } catch (err) {
      this.logger.warn(`Bước phụ sau trả lời của admin ${created.id} lỗi: ${(err as Error).message}`);
    }
    return toAdminMessage(created, null, new Date());
  }

  async block(adminId: string, id: string) {
    await this.setBlocked(id, { blockedAt: new Date(), blockedByUserId: adminId });
    return { ok: true };
  }

  async unblock(id: string) {
    await this.setBlocked(id, { blockedAt: null, blockedByUserId: null });
    return { ok: true };
  }

  async resend(forwardId: string) {
    const forward = await this.prisma.supportForward.findUnique({ where: { id: forwardId } });
    if (!forward) throw new NotFoundException('Không tìm thấy lần chuyển.');
    const messages = await this.prisma.supportMessage.findMany({
      where: { conversationId: forward.conversationId, forwardId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (messages.length === 0) throw new ConflictException('Tin của lần chuyển này đã bị xoá theo chính sách lưu trữ, không gửi lại được.');
    const conv = await this.prisma.supportConversation.findUnique({ where: { id: forward.conversationId } });
    if (!conv) throw new NotFoundException('Không tìm thấy hội thoại.');

    // Chuyển trạng thái nguyên tử: hai admin bấm cùng lúc thì chỉ một bên gửi, bên kia nhận 409.
    // PENDING chỉ gửi lại được khi đã bỏ dở quá hạn; PENDING mới là một lượt gửi đang chạy.
    const claimed = await this.prisma.supportForward.updateMany({
      where: { id: forwardId, OR: [{ status: { in: ['FAILED', 'UNKNOWN'] } }, stalePendingForwardWhere(new Date())] },
      data: { status: 'PENDING' },
    });
    if (claimed.count === 0) throw new ConflictException('Chỉ gửi lại được lần chuyển đang FAILED, UNKNOWN hoặc PENDING bị bỏ dở.');

    try {
      const text = await buildForwardText(this.prisma, conv, messages);
      await sendAndSettle(this.prisma, this.bridge, forward, text, false);
    } catch (err) {
      // Không để lần chuyển kẹt PENDING vì đường admin: chốt FAILED (nếu còn PENDING) rồi ném tiếp.
      const lastError = `ADMIN_RESEND: ${(err as Error).message}`.slice(0, 500);
      await this.prisma.supportForward
        .updateMany({ where: { id: forwardId, status: 'PENDING' }, data: { status: 'FAILED', lastError } })
        .catch((e: unknown) => this.logger.warn(`Không chốt được FAILED cho lần chuyển ${forwardId}: ${(e as Error).message}`));
      if ((err as { code?: string }).code === 'P2025') throw new NotFoundException('Lần chuyển đã bị xoá.');
      throw err;
    }
    const after = await this.prisma.supportForward.findUnique({ where: { id: forwardId } });
    if (!after) throw new NotFoundException('Lần chuyển đã bị xoá.');
    return { id: forwardId, status: after.status, lastError: after.lastError, attempts: after.attempts };
  }

  private async setBlocked(id: string, data: { blockedAt: Date | null; blockedByUserId: string | null }) {
    const r = await this.prisma.supportConversation.updateMany({ where: { id }, data });
    if (r.count === 0) throw new NotFoundException('Không tìm thấy hội thoại.');
  }

  private record(action: BridgeAction, adminUserId: string) {
    return this.prisma.supportBridgeAction.create({ data: { action, adminUserId } });
  }

  private unwrap<T>(r: { ok: true; data: T } | BridgeFailure): T {
    if (!r.ok) this.fail(r);
    return (r as { ok: true; data: T }).data;
  }

  private fail(r: BridgeFailure): never {
    const body = { code: r.code, message: r.message };
    if (r.code === 'NOT_CONNECTED' || r.code === 'NO_GROUP') throw new ConflictException({ statusCode: 409, error: 'Conflict', ...body });
    if (r.code === 'QR_CANCELLED') {
      throw new ConflictException({ statusCode: 409, error: 'Conflict', code: r.code, message: 'Lượt QR đã bị huỷ do đăng xuất.' });
    }
    if (r.code === 'LOGOUT_CLEAR_FAILED') {
      // Cầu nối đã đăng xuất trong bộ nhớ nhưng tệp phiên còn trên đĩa: khởi động lại sẽ đăng nhập lại tài khoản này.
      const message = `Không xoá được tệp phiên đăng nhập của cầu nối (${r.message}). Bấm Đăng xuất lại; vẫn lỗi thì làm theo mục 7 của docs/2026-10-23-q5/bat-chat-zalo.md.`;
      throw new BadGatewayException({ statusCode: 502, error: 'Bad Gateway', code: r.code, message });
    }
    throw new BadGatewayException({ statusCode: 502, error: 'Bad Gateway', ...body });
  }
}

type AdminMessageRow = Pick<SupportMessage, 'id' | 'sender' | 'source' | 'body' | 'imageUrl' | 'context' | 'staffName' | 'adminUserId' | 'recalledAt' | 'createdAt'>;

function toAdminMessage(m: AdminMessageRow, forward: Pick<SupportForward, 'id' | 'status' | 'lastError' | 'attempts' | 'zaloMsgId' | 'updatedAt'> | null, now: Date) {
  return {
    id: m.id,
    sender: m.sender,
    source: m.source,
    body: m.body,
    imageUrl: m.imageUrl,
    context: m.context,
    staffName: m.staffName,
    adminUserId: m.adminUserId,
    recalledAt: m.recalledAt,
    createdAt: m.createdAt,
    forward: forward
      ? {
          id: forward.id,
          status: forward.status,
          lastError: forward.lastError,
          attempts: forward.attempts,
          resendable: forward.status === 'FAILED' || forward.status === 'UNKNOWN' || isStalePendingForward(forward, now),
        }
      : null,
  };
}
