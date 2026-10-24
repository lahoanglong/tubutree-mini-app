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
  let notify: jest.Mock;
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
    notify = jest.fn().mockResolvedValue(undefined);
    events = new BridgeEventsService(prisma, { notify } as never);
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
    return { type: 'message', groupId: 'g-it', msgId: `zm-${randCode(10)}`, cliMsgId: randCode(6), uidFrom: 'staff', dName: 'Hoa', isSelf: false, ts: 1, text: 'Dạ vâng', imageUrl: null, quote: null, ...o } as ZaloBridgeEvent;
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
    expect(notify).toHaveBeenCalledTimes(1);
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
});
