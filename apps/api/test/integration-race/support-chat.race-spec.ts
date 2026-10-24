import { randomInt } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import type { ZaloBridgeEvent } from '@tubutree/shared-types';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { SupportChatService } from '../../src/modules/support-chat/support-chat.service';
import { SupportChatForwardProcessor } from '../../src/modules/support-chat/support-chat-forward.processor';
import { BridgeHealthCron } from '../../src/modules/support-chat/bridge-health.cron';
import { BridgeEventsService } from '../../src/modules/support-chat/bridge-events.service';
import { ReplyNotifier } from '../../src/modules/support-chat/reply-notifier';
import { SupportChatNotifyProcessor } from '../../src/modules/support-chat/support-chat-notify.processor';
import { issueConversationCode } from '../../src/modules/support-chat/conversation-code';
import { MAX_MESSAGES_PER_DAY } from '../../src/modules/support-chat/support-chat.service';
import { formatForward } from '../../src/modules/support-chat/forward-format';
import { CHAT_ENABLED_KEY, CHAT_GROUP_KEY, CHAT_HOURS_KEY } from '../../src/modules/support-chat/support-chat.config';
import { createUser, deleteItData, pinConfig, randCode, warmPool } from './helpers';

/**
 * Chat CSKH trên Postgres thật: gom tin khách trong 15 giây thành một lượt chuyển, và nhận trả lời của nhân viên
 * (trùng sự kiện, trả lời tới trước khi forward ghi zaloMsgId, echo của cầu nối) không mất, không trùng.
 */
describe('Chat CSKH: chuyển tin khách và nhận trả lời (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let chat: SupportChatService;
  let processor: SupportChatForwardProcessor;
  let events: BridgeEventsService;
  let scheduleReplyBell: jest.Mock;
  let bridge: any;
  let cfg: SystemConfigService;
  let sends: { key: string; text: string }[];
  const userIds: string[] = [];
  const restores: (() => Promise<void>)[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    restores.push(await pinConfig(prisma, CHAT_ENABLED_KEY, true));
    restores.push(await pinConfig(prisma, CHAT_GROUP_KEY, 'g-it'));
    // Cả ngày là giờ làm việc để không sinh tin SYSTEM ngoài giờ lẫn vào kết quả.
    restores.push(await pinConfig(prisma, CHAT_HOURS_KEY, { start: '00:00', end: '23:59' }));
    const config = new SystemConfigService(prisma);
    cfg = config;
    const queue: any = { getJob: async () => null, add: async () => ({}) };
    chat = new SupportChatService(prisma, config, queue);
    sends = [];
    // Giống cầu nối thật: cùng idempotencyKey thì trả lại msgId cũ, không gửi đôi.
    const byKey = new Map<string, string>();
    bridge = {
      send: async (key: string, text: string) => {
        await new Promise((r) => setTimeout(r, 30));
        if (!byKey.has(key)) {
          byKey.set(key, `zr-${randCode(10)}`);
          sends.push({ key, text });
        }
        return { ok: true, msgId: byKey.get(key) };
      },
    };
    processor = new SupportChatForwardProcessor(prisma, config, bridge, chat);
    scheduleReplyBell = jest.fn().mockResolvedValue(undefined);
    events = new BridgeEventsService(prisma, { scheduleReplyBell } as never);
  });

  afterAll(async () => {
    for (const r of restores.reverse()) await r();
    await deleteItData(prisma, { userIds });
    await moduleRef?.close();
  });

  async function customer() {
    const u = await createUser(prisma, { phone: `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}` });
    userIds.push(u.id);
    return u;
  }
  const job = (conversationId: string): any => ({ data: { conversationId }, attemptsMade: 0, opts: { attempts: 5 } });

  function reply(o: Record<string, unknown> = {}): ZaloBridgeEvent {
    return { type: 'message', groupId: 'g-it', msgId: `zm-${randCode(10)}`, cliMsgId: randCode(6), uidFrom: 'staff', dName: 'Hoa', isSelf: false, ts: Date.now(), text: 'Dạ vâng', imageUrl: null, quote: null, ...o } as ZaloBridgeEvent;
  }

  it('5 lần send song song rồi processor chạy (cả conv-<id> lẫn conv-<id>-next): một SupportForward chứa đủ 5 tin', async () => {
    const u = await customer();
    await Promise.all(Array.from({ length: 5 }, (_, i) => chat.send(u.id, { clientMsgId: `cm-${randCode(8)}-${i}`, body: `tin ${i}` }, 'WEB')));
    const conv = await prisma.supportConversation.findUniqueOrThrow({ where: { userId: u.id } });
    await Promise.all([processor.process(job(conv.id)), processor.process(job(conv.id))]);

    const forwards = await prisma.supportForward.findMany({ where: { conversationId: conv.id } });
    expect(forwards).toHaveLength(1);
    expect(forwards[0]!.status).toBe('SENT');
    expect(forwards[0]!.zaloMsgId).toMatch(/^zr-/);
    const messages = await prisma.supportMessage.findMany({ where: { conversationId: conv.id, sender: 'CUSTOMER' } });
    expect(messages).toHaveLength(5);
    expect(messages.every((m) => m.forwardId === forwards[0]!.id)).toBe(true);
    expect(sends.filter((s) => s.key === forwards[0]!.id)).toHaveLength(1);
  });

  it('hai send song song cùng clientMsgId: một tin', async () => {
    const u = await customer();
    const clientMsgId = `cm-${randCode(10)}`;
    const [a, b] = await Promise.all([
      chat.send(u.id, { clientMsgId, body: 'bấm hai lần' }, 'MINIAPP'),
      chat.send(u.id, { clientMsgId, body: 'bấm hai lần' }, 'MINIAPP'),
    ]);
    expect(a.id).toBe(b.id);
    const conv = await prisma.supportConversation.findUniqueOrThrow({ where: { userId: u.id } });
    expect(await prisma.supportMessage.count({ where: { conversationId: conv.id, sender: 'CUSTOMER' } })).toBe(1);
  });

  it('forward FAILED NOT_CONNECTED: hai lượt quét song song khi cầu nối đã CONNECTED chỉ gửi lại đúng một lần', async () => {
    const u = await customer();
    await chat.getThread(u.id);
    const conv = await prisma.supportConversation.findUniqueOrThrow({ where: { userId: u.id } });
    const f = await prisma.supportForward.create({
      data: { conversationId: conv.id, groupId: 'g-it', status: 'FAILED', lastError: 'NOT_CONNECTED: Cầu nối chưa kết nối', attempts: 5 },
    });
    await prisma.supportMessage.create({ data: { conversationId: conv.id, sender: 'CUSTOMER', source: 'WEB', body: 'tin bị kẹt', forwardId: f.id, clientMsgId: `cm-${randCode(10)}` } });
    const noise = await prisma.supportForward.create({
      data: { conversationId: conv.id, groupId: 'g-it', status: 'FAILED', lastError: 'SEND_FAILED: Zalo từ chối', attempts: 1 },
    });

    const callsFor: string[] = [];
    const cronBridge: any = {
      isConfigured: () => true,
      send: (key: string, text: string) => {
        callsFor.push(key);
        return bridge.send(key, text);
      },
      setGroup: async () => ({ ok: true, data: {} }),
      health: async () => ({ state: 'CONNECTED', zaloUid: 'z', displayName: 'CSKH', avatar: null, since: new Date().toISOString(), lastError: null, queueSize: 0, outboxSize: 0, groupId: 'g-it' }),
    };
    const mk = () => new BridgeHealthCron(prisma, cronBridge, cfg, chat, { notify: jest.fn() } as never);
    await Promise.all([mk().everyMinute(), mk().everyMinute()]);

    const after = await prisma.supportForward.findUniqueOrThrow({ where: { id: f.id } });
    expect(after.status).toBe('SENT');
    expect(after.zaloMsgId).toMatch(/^zr-/);
    expect(callsFor.filter((k) => k === f.id)).toHaveLength(1);
    expect((await prisma.supportForward.findUniqueOrThrow({ where: { id: noise.id } })).status).toBe('FAILED');
    expect(callsFor).not.toContain(noise.id);
    await prisma.supportBridgeStatus.deleteMany({ where: { id: 'main' } });
  });

  it('forward được chọn lúc còn NOT_CONNECTED, admin gửi lại thành SEND_FAILED trước khi quét chốt: quét không gửi', async () => {
    const u = await customer();
    await chat.getThread(u.id);
    const conv = await prisma.supportConversation.findUniqueOrThrow({ where: { userId: u.id } });
    const f = await prisma.supportForward.create({
      data: { conversationId: conv.id, groupId: 'g-it', status: 'FAILED', lastError: 'NOT_CONNECTED: Cầu nối chưa kết nối', attempts: 5 },
    });
    await prisma.supportMessage.create({ data: { conversationId: conv.id, sender: 'CUSTOMER', source: 'WEB', body: 'tin bị kẹt', forwardId: f.id, clientMsgId: `cm-${randCode(10)}` } });
    const selected = await prisma.supportForward.findUniqueOrThrow({ where: { id: f.id } });
    await prisma.supportForward.update({ where: { id: f.id }, data: { lastError: 'SEND_FAILED: Zalo từ chối' } });

    const send = jest.fn(async () => ({ ok: true, msgId: 'zr-x' }));
    const cronBridge: any = {
      isConfigured: () => true,
      send,
      setGroup: async () => ({ ok: true, data: {} }),
      health: async () => ({ state: 'CONNECTED', zaloUid: 'z', displayName: 'CSKH', avatar: null, since: new Date().toISOString(), lastError: null, queueSize: 0, outboxSize: 0, groupId: 'g-it' }),
    };
    const findMany = jest.spyOn(prisma.supportForward, 'findMany').mockResolvedValueOnce([selected] as never);
    try {
      await new BridgeHealthCron(prisma, cronBridge, cfg, chat, { notify: jest.fn() } as never).everyMinute();
    } finally {
      findMany.mockRestore();
    }

    expect(send).not.toHaveBeenCalled();
    const after = await prisma.supportForward.findUniqueOrThrow({ where: { id: f.id } });
    expect(after.status).toBe('FAILED');
    expect(after.lastError).toBe('SEND_FAILED: Zalo từ chối');
    await prisma.supportBridgeStatus.deleteMany({ where: { id: 'main' } });
  });

  async function convWithForward(forward: { status?: 'PENDING' | 'SENT'; zaloMsgId?: string | null } = {}) {
    const u = await customer();
    const c = await chat.getThread(u.id);
    const conv = await prisma.supportConversation.findUniqueOrThrow({ where: { userId: u.id } });
    const f = await prisma.supportForward.create({ data: { conversationId: conv.id, groupId: 'g-it', status: forward.status ?? 'PENDING', zaloMsgId: forward.zaloMsgId ?? null } });
    return { u, conv, f, code: c.code };
  }

  it('cùng một sự kiện tới hai lần song song: một tin STAFF', async () => {
    const { conv, code } = await convWithForward({ status: 'SENT', zaloMsgId: `zf-${randCode(10)}` });
    const e = reply({ text: `#${code} Dạ đơn giao chiều nay` });
    const [r1, r2] = await Promise.all([events.handle(e), events.handle(e)]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    const staff = await prisma.supportMessage.findMany({ where: { conversationId: conv.id, sender: 'STAFF' } });
    expect(staff).toHaveLength(1);
    expect(staff[0]!.body).toBe('Dạ đơn giao chiều nay');
    expect(scheduleReplyBell).toHaveBeenCalledTimes(1);
  });

  it('trả lời tới khi forward còn PENDING: 503, sau khi ghi zaloMsgId gửi lại thì đúng một tin STAFF', async () => {
    const { conv, f } = await convWithForward();
    const zaloMsgId = `zf-${randCode(10)}`;
    const e = reply({ quote: { globalMsgId: zaloMsgId, cliMsgId: '1', text: null } });

    expect(await events.handle(e)).toEqual({ status: 503, body: { retry: true } });
    expect(await prisma.supportMessage.count({ where: { conversationId: conv.id, sender: 'STAFF' } })).toBe(0);

    await prisma.supportForward.update({ where: { id: f.id }, data: { zaloMsgId, status: 'SENT' } });
    expect((await events.handle(e)).status).toBe(200);
    expect((await events.handle(e)).status).toBe(200);
    expect(await prisma.supportMessage.count({ where: { conversationId: conv.id, sender: 'STAFF' } })).toBe(1);
  });

  it('echo (isSelf, đầu tin chuyển) tới trước khi ghi zaloMsgId: không có tin STAFF', async () => {
    const { conv, code } = await convWithForward();
    const text = formatForward({ code, name: 'Lan', phone: '0901234234', tier: null, context: null, items: [{ body: 'xin chào', imageUrl: null }] });
    const r = await events.handle(reply({ isSelf: true, text }));
    expect(r.status).toBe(200);
    expect(await prisma.supportMessage.count({ where: { conversationId: conv.id, sender: 'STAFF' } })).toBe(0);
  });

  it('hạn mức ngày: còn đúng 1 tin, 5 send song song của cùng khách: lưu đúng 1, 4 bên kia nhận CHAT_DAILY_LIMIT 429', async () => {
    const u = await customer();
    await chat.getThread(u.id);
    const conv = await prisma.supportConversation.findUniqueOrThrow({ where: { userId: u.id } });
    await prisma.supportMessage.createMany({
      data: Array.from({ length: MAX_MESSAGES_PER_DAY - 1 }, (_, i) => ({
        conversationId: conv.id, sender: 'CUSTOMER' as const, source: 'WEB' as const, body: `cũ ${i}`, clientMsgId: `old-${i}`, forwardId: 'done',
      })),
    });
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) => chat.send(u.id, { clientMsgId: `cm-${randCode(8)}-${i}`, body: `mới ${i}` }, 'WEB')),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected).toHaveLength(4);
    for (const r of rejected) {
      expect((r.reason as { status?: number }).status).toBe(429);
      expect((r.reason as { getResponse(): { code: string } }).getResponse().code).toBe('CHAT_DAILY_LIMIT');
    }
    expect(await prisma.supportMessage.count({ where: { conversationId: conv.id, sender: 'CUSTOMER' } })).toBe(MAX_MESSAGES_PER_DAY);
  });

  describe('thu hồi và tin: mọi thứ tự đều không để khách thấy tin, không chuông', () => {
    const undo = (msgId: string) => ({ type: 'undo', groupId: 'g-it', msgId }) as ZaloBridgeEvent;
    async function expectHidden(convId: string, userId: string, msgId: string) {
      const rows = await prisma.supportMessage.findMany({ where: { conversationId: convId, zaloMsgId: msgId } });
      expect(rows.every((r) => r.recalledAt !== null)).toBe(true);
      const seen = await chat.getThread(userId);
      expect(seen.messages.filter((m) => m.sender === 'STAFF')).toHaveLength(0);
      expect(scheduleReplyBell).not.toHaveBeenCalled();
    }
    beforeEach(() => scheduleReplyBell.mockClear());

    it('(a) thu hồi chạy xong giữa lần kiểm tombstone đầu và lúc lưu tin', async () => {
      const { conv, code, u } = await convWithForward({ status: 'SENT', zaloMsgId: `zf-${randCode(10)}` });
      const msgId = `zm-${randCode(10)}`;
      let release!: () => void;
      const gate = new Promise<void>((r) => { release = r; });
      let reached!: () => void;
      const atHook = new Promise<void>((r) => { reached = r; });
      const real = prisma.supportRecallTombstone.findUnique.bind(prisma.supportRecallTombstone);
      const spy = jest.spyOn(prisma.supportRecallTombstone, 'findUnique').mockImplementationOnce(((args: never) => {
        const res = real(args);
        return res.then(async (v) => { reached(); await gate; return v; });
      }) as never);
      try {
        const handling = events.handle(reply({ msgId, text: `#${code} Dạ ạ` }));
        await atHook;
        await events.handle(undo(msgId));
        release();
        expect((await handling).status).toBe(200);
      } finally {
        spy.mockRestore();
      }
      await expectHidden(conv.id, u.id, msgId);
    });

    it('(b) thu hồi trước, tin sau: không lưu', async () => {
      const { conv, code, u } = await convWithForward({ status: 'SENT', zaloMsgId: `zf-${randCode(10)}` });
      const msgId = `zm-${randCode(10)}`;
      await events.handle(undo(msgId));
      expect((await events.handle(reply({ msgId, text: `#${code} Dạ ạ` }))).status).toBe(200);
      expect(await prisma.supportMessage.count({ where: { conversationId: conv.id, zaloMsgId: msgId } })).toBe(0);
      await expectHidden(conv.id, u.id, msgId);
    });

    it('(c) tin trước, thu hồi sau: hàng bị đánh dấu thu hồi', async () => {
      const { conv, code, u } = await convWithForward({ status: 'SENT', zaloMsgId: `zf-${randCode(10)}` });
      const msgId = `zm-${randCode(10)}`;
      await events.handle(reply({ msgId, text: `#${code} Dạ ạ` }));
      scheduleReplyBell.mockClear();
      await events.handle(undo(msgId));
      await expectHidden(conv.id, u.id, msgId);
    });

    it('(d) tin bị bỏ rồi cầu nối gửi lại: vẫn bị bỏ (tombstone còn)', async () => {
      const { conv, code, u } = await convWithForward({ status: 'SENT', zaloMsgId: `zf-${randCode(10)}` });
      const msgId = `zm-${randCode(10)}`;
      await events.handle(undo(msgId));
      const e = reply({ msgId, text: `#${code} Dạ ạ` });
      await events.handle(e);
      await events.handle(e);
      expect(await prisma.supportMessage.count({ where: { conversationId: conv.id, zaloMsgId: msgId } })).toBe(0);
      expect(await prisma.supportRecallTombstone.count({ where: { zaloMsgId: msgId } })).toBe(1);
      await expectHidden(conv.id, u.id, msgId);
    });

    it('(e) thu hồi xen giữa, kiểm sau-lưu lỗi, cầu nối gửi lại: hàng đã lưu vẫn bị thu hồi', async () => {
      const { conv, code, u } = await convWithForward({ status: 'SENT', zaloMsgId: `zf-${randCode(10)}` });
      const msgId = `zm-${randCode(10)}`;
      let release!: () => void;
      const gate = new Promise<void>((r) => { release = r; });
      let reached!: () => void;
      const atHook = new Promise<void>((r) => { reached = r; });
      const real = prisma.supportRecallTombstone.findUnique.bind(prisma.supportRecallTombstone);
      const spy = jest.spyOn(prisma.supportRecallTombstone, 'findUnique')
        .mockImplementationOnce(((args: never) => real(args).then(async (v) => { reached(); await gate; return v; })) as never)
        .mockImplementationOnce((() => Promise.reject(new Error('db tạm thời'))) as never);
      const e = reply({ msgId, text: `#${code} Dạ ạ` });
      try {
        const first = events.handle(e);
        await atHook;
        await events.handle(undo(msgId));
        release();
        await expect(first).rejects.toThrow('db tạm thời');
      } finally {
        spy.mockRestore();
      }
      expect(await prisma.supportMessage.count({ where: { conversationId: conv.id, zaloMsgId: msgId, recalledAt: null } })).toBe(1);
      expect((await events.handle(e)).status).toBe(200);
      await expectHidden(conv.id, u.id, msgId);
    });

    it('song song 30 lần: tin hoặc không có, hoặc đã thu hồi', async () => {
      const { conv, code, u } = await convWithForward({ status: 'SENT', zaloMsgId: `zf-${randCode(10)}` });
      for (let i = 0; i < 30; i++) {
        const msgId = `zm-${randCode(10)}`;
        await Promise.all([events.handle(undo(msgId)), events.handle(reply({ msgId, text: `#${code} lần ${i}` }))]);
        const rows = await prisma.supportMessage.findMany({ where: { conversationId: conv.id, zaloMsgId: msgId } });
        expect(rows.every((r) => r.recalledAt !== null)).toBe(true);
      }
      expect((await chat.getThread(u.id)).messages.filter((m) => m.sender === 'STAFF')).toHaveLength(0);
    });
  });

  describe('đã thấy theo từng tin', () => {
    async function twoReplies() {
      const { conv, u } = await convWithForward({ status: 'SENT', zaloMsgId: `zf-${randCode(10)}` });
      const at = new Date();
      const [a, b] = await Promise.all(['một', 'hai'].map((body, i) => prisma.supportMessage.create({
        data: { conversationId: conv.id, sender: 'STAFF', source: 'ZALO', body, zaloMsgId: `zm-${randCode(10)}`, createdAt: at },
      })));
      return { conv, u, a: a!, b: b! };
    }
    const processor = () => {
      const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
      return { notifications, proc: new SupportChatNotifyProcessor(prisma, new ReplyNotifier(notifications as never, {} as never)) };
    };

    it('hai tin cùng createdAt, khách báo đã thấy một: tin kia còn chưa đọc và chuông của nó vẫn bắn', async () => {
      const { u, a, b } = await twoReplies();
      expect(await chat.unreadCount(u.id)).toBe(2);
      await chat.markRead(u.id, { ids: [a.id] });
      expect(await chat.unreadCount(u.id)).toBe(1);
      const { proc, notifications } = processor();
      await proc.process({ data: { messageId: a.id } } as never);
      expect(notifications.notify).not.toHaveBeenCalled();
      await proc.process({ data: { messageId: b.id } } as never);
      expect(notifications.notify).toHaveBeenCalledTimes(1);
    });

    it('ids của hội thoại khác hoặc của tin khách: không đánh dấu gì', async () => {
      const mine = await twoReplies();
      const other = await twoReplies();
      const cust = await prisma.supportMessage.create({ data: { conversationId: mine.conv.id, sender: 'CUSTOMER', source: 'WEB', body: 'hi' } });
      await chat.markRead(mine.u.id, { ids: [other.a.id, cust.id] });
      expect(await prisma.supportMessage.count({ where: { id: { in: [other.a.id, cust.id] }, seenAt: { not: null } } })).toBe(0);
    });

    it('không có ids (Mini App bản cũ): đánh dấu mọi tin tới bây giờ', async () => {
      const { u } = await twoReplies();
      await chat.markRead(u.id);
      expect(await chat.unreadCount(u.id)).toBe(0);
    });
  });

  it('mã đã nghỉ không được cấp lại', async () => {
    const retiredCode = 'BCDF';
    await prisma.supportRetiredCode.upsert({ where: { code: retiredCode }, create: { code: retiredCode }, update: {} });
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const seq = [...retiredCode, ...'GHJK'].map((ch) => (alphabet.indexOf(ch) + 0.5) / alphabet.length);
    let i = 0;
    expect(await issueConversationCode(prisma, () => seq[i++ % seq.length]!)).toBe('GHJK');
    await prisma.supportRetiredCode.delete({ where: { code: retiredCode } });
  });
});
