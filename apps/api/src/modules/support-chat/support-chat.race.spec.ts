import { HttpException, Logger } from '@nestjs/common';
import { RaceDb, tick } from '../../../test/fakes/race-db.fake';
import { vnDateKey } from '../../common/vn-time';
import { MAX_MESSAGES_PER_DAY, SupportChatService } from './support-chat.service';
import { CHAT_ENABLED_KEY, CHAT_HOURS_KEY, DEFAULT_OFF_HOURS_TEXT } from './support-chat.config';

/**
 * Chat hỗ trợ bị gửi/mở song song (xem test/fakes/race-db.fake.ts), dùng SupportChatService THẬT:
 *  - cùng clientMsgId (khách bấm Gửi lại, mạng chập chờn): một tin, mọi bên cùng id, hàng đợi chuyển tiếp đặt lịch một lần;
 *  - nhiều tin khác nhau chạm trần ngày: khoá advisory `support-chat-send:<hội thoại>` làm việc đếm + ghi nối tiếp nhau;
 *  - lần đầu mở chat (chưa có hội thoại): một hội thoại cho mỗi khách, mã `code` không trùng;
 *  - ngoài giờ làm việc: một lời nhắn SYSTEM mỗi ngày dù nhiều tin tới cùng lúc.
 * Unique (conversationId, clientMsgId), (userId), (code) và khoá advisory được khai/giả lập trong DB giả; SystemConfigService, hàng đợi BullMQ là stub.
 */
const delay = async (n: number) => {
  for (let i = 0; i < n; i++) await tick();
};
const is = (label: string, actual: unknown, expected: unknown) => expect({ label, actual }).toEqual({ label, actual: expected });
const fulfilled = (rs: PromiseSettledResult<unknown>[]) => rs.filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled');
const rejected = (rs: PromiseSettledResult<unknown>[]) => rs.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
const codeOf = (r: PromiseRejectedResult) => (r.reason instanceof HttpException ? (r.reason.getResponse() as { code?: string }).code : undefined);
const statusOf = (r: PromiseRejectedResult) => (r.reason instanceof HttpException ? r.reason.getStatus() : undefined);

const NOON = new Date('2026-10-23T12:00:00+07:00');
const NIGHT = new Date('2026-10-23T22:30:00+07:00');
const DAY = 864e5;
const CONV = 'c1';

interface Options {
  at?: Date;
  user?: { phone: string | null; zaloId: string | null };
  conversation?: boolean | Record<string, unknown>;
  enabled?: boolean;
  /** Khoá advisory không phục vụ (giả lập hai tin lọt qua cùng lúc): chỉ unique còn chặn. */
  noAdvisoryLock?: boolean;
  /** Số tin CUSTOMER đã gửi hôm nay trong hội thoại c1. */
  sentToday?: number;
}

function setup(opts: Options = {}) {
  const at = opts.at ?? NOON;
  jest.setSystemTime(at);
  const db = new RaceDb({
    user: {},
    supportConversation: {
      unique: [{ fields: ['userId'] }, { fields: ['code'] }],
      defaults: { blockedAt: null, lastOffHoursNoticeOn: null, lastMessageAt: null, customerReadAt: null, createdAt: at },
    },
    supportMessage: {
      unique: [{ fields: ['conversationId', 'clientMsgId'] }],
      defaults: { createdAt: at, recalledAt: null, seenAt: null, imageUrl: null, context: null, clientMsgId: null },
    },
    supportRetiredCode: {},
    supportBridgeStatus: {},
  });
  db.seed('user', [
    { id: 'u1', fullName: 'An', ...(opts.user ?? { phone: null, zaloId: 'zalo-real-1' }) },
    { id: 'u2', fullName: 'Bình', phone: null, zaloId: 'zalo-real-2' },
  ]);
  if (opts.conversation !== false && opts.conversation !== undefined) {
    db.seed('supportConversation', [
      { id: CONV, userId: 'u1', code: 'K7Q3', blockedAt: null, lastOffHoursNoticeOn: null, lastMessageAt: null, customerReadAt: null, createdAt: at, ...(opts.conversation === true ? {} : opts.conversation) },
    ]);
  }
  if (opts.sentToday) {
    // Thêm tin không tính vào trần ngày để chứng minh bộ đếm lọc đúng: tin hôm qua, tin nhân viên, tin hệ thống.
    db.seed('supportMessage', [
      ...Array.from({ length: opts.sentToday }, (_, i) => ({ conversationId: CONV, sender: 'CUSTOMER', source: 'MINIAPP', body: 'x', clientMsgId: `seed-${i}`, createdAt: new Date(at.getTime() - 60_000) })),
      ...Array.from({ length: 30 }, (_, i) => ({ conversationId: CONV, sender: 'CUSTOMER', source: 'MINIAPP', body: 'cũ', clientMsgId: `old-${i}`, createdAt: new Date(at.getTime() - DAY) })),
      ...Array.from({ length: 10 }, () => ({ conversationId: CONV, sender: 'STAFF', source: 'ZALO', body: 'đã trả lời', createdAt: new Date(at.getTime() - 30_000) })),
    ]);
  }
  db.handlers.push({
    match: /pg_advisory_xact_lock/,
    run: async (c) => {
      if (!opts.noAdvisoryLock) await c.lockKey(String(c.params[0]));
      return 1;
    },
  });
  const config = {
    get: jest.fn(async (key: string, fallback: unknown) => (key === CHAT_ENABLED_KEY ? (opts.enabled ?? true) : fallback)),
  };
  const queue = { getJob: jest.fn(async () => null), add: jest.fn(async () => ({})) };
  const svc = new SupportChatService(db.client as never, config as never, queue as never);

  const customerMessages = () => db.rows('supportMessage').filter((m) => m.sender === 'CUSTOMER');
  const systemMessages = () => db.rows('supportMessage').filter((m) => m.sender === 'SYSTEM');
  const send = (userId: string, clientMsgId: string, body = 'Xin chào Tubu') => svc.send(userId, { clientMsgId, body }, 'MINIAPP');
  return { db, svc, config, queue, send, customerMessages, systemMessages, conversations: () => db.rows('supportConversation') };
}

beforeEach(() => {
  // Chỉ đóng băng Date: DB giả dựa vào setImmediate, còn hạn chờ hàng đợi dùng setTimeout thật.
  jest.useFakeTimers({
    now: NOON,
    doNotFake: ['setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'nextTick', 'queueMicrotask', 'hrtime', 'performance'],
  });
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('SupportChatService.send — cùng clientMsgId song song', () => {
  it('5 lần gửi cùng clientMsgId: đúng MỘT tin, mọi bên cùng id, hàng đợi chuyển tiếp đặt lịch một lần', async () => {
    const h = setup({ conversation: true });
    const settled = await Promise.allSettled(Array.from({ length: 5 }, () => h.send('u1', 'abcdefgh-1')));
    expect(fulfilled(settled)).toHaveLength(5);
    expect(new Set(fulfilled(settled).map((r) => r.value.id)).size).toBe(1);
    expect(h.customerMessages()).toHaveLength(1);
    expect(fulfilled(settled)[0]!.value.id).toBe(h.customerMessages()[0]!.id);
    expect(h.queue.add).toHaveBeenCalledTimes(1);
    expect(h.db.stats.lockWaits).toBeGreaterThan(0);
  });

  it('khi đã có MAX−1 tin hôm nay: các lần gửi trùng clientMsgId vẫn trả tin đã lưu, không bên nào nhận 429 CHAT_DAILY_LIMIT', async () => {
    const h = setup({ conversation: true, sentToday: MAX_MESSAGES_PER_DAY - 1 });
    const settled = await Promise.allSettled(Array.from({ length: 5 }, () => h.send('u1', 'abcdefgh-1')));
    expect(rejected(settled).map(codeOf)).toEqual([]);
    expect(new Set(fulfilled(settled).map((r) => r.value.id)).size).toBe(1);
    expect(h.customerMessages().filter((m) => m.clientMsgId === 'abcdefgh-1')).toHaveLength(1);
    expect(h.customerMessages()).toHaveLength(MAX_MESSAGES_PER_DAY + 30);
    expect(h.queue.add).toHaveBeenCalledTimes(1);
    expect(h.db.stats.lockWaits).toBeGreaterThan(0);
  });

  it('khoá advisory không phục vụ (hai tin lọt qua cùng lúc): unique (conversationId, clientMsgId) vẫn giữ một tin, bên thua đọc lại tin của bên thắng sau P2002', async () => {
    const h = setup({ conversation: true, noAdvisoryLock: true });
    const settled = await Promise.allSettled(Array.from({ length: 5 }, () => h.send('u1', 'abcdefgh-1')));
    expect(fulfilled(settled)).toHaveLength(5);
    expect(new Set(fulfilled(settled).map((r) => r.value.id)).size).toBe(1);
    expect(h.customerMessages()).toHaveLength(1);
    expect(h.queue.add).toHaveBeenCalledTimes(1);
    expect(h.db.stats.rollbacks).toBeGreaterThan(0);
  });

  it('quét độ lệch giữa hai lần gửi cùng clientMsgId: lần nào cũng một tin, hai bên cùng id, một lần đặt lịch', async () => {
    let waits = 0;
    for (let skew = -25; skew <= 25; skew++) {
      const h = setup({ conversation: true });
      const go = (wait: number) => async () => (await delay(wait), h.send('u1', 'abcdefgh-1'));
      const settled = await Promise.allSettled([go(Math.max(skew, 0))(), go(Math.max(-skew, 0))()]);
      const label = `skew ${skew}`;
      is(label, fulfilled(settled).length, 2);
      is(label, h.customerMessages().length, 1);
      is(label, new Set(fulfilled(settled).map((r) => r.value.id)).size, 1);
      is(label, h.queue.add.mock.calls.length, 1);
      waits += h.db.stats.lockWaits;
    }
    expect(waits).toBeGreaterThan(0);
  });
});

describe('SupportChatService.send — trần tin mỗi ngày', () => {
  it('5 tin khác clientMsgId song song khi đã có MAX−1 tin hôm nay: đúng một tin được lưu, 4 tin còn lại nhận 429 CHAT_DAILY_LIMIT', async () => {
    const h = setup({ conversation: true, sentToday: MAX_MESSAGES_PER_DAY - 1 });
    const settled = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => h.send('u1', `new-msg-${i}`)));
    expect(fulfilled(settled)).toHaveLength(1);
    expect(rejected(settled)).toHaveLength(4);
    for (const r of rejected(settled)) expect([statusOf(r), codeOf(r)]).toEqual([429, 'CHAT_DAILY_LIMIT']);
    // Tin hôm qua, tin nhân viên không tính vào trần: sau tin vừa lưu hôm nay đúng bằng MAX.
    const todayStart = new Date('2026-10-23T00:00:00+07:00').getTime();
    expect(h.customerMessages().filter((m) => m.createdAt.getTime() >= todayStart)).toHaveLength(MAX_MESSAGES_PER_DAY);
    expect(h.queue.add).toHaveBeenCalledTimes(1);
    expect(h.db.stats.lockWaits).toBeGreaterThan(0);
  });

  it('đã đủ MAX tin: tin mới bị 429 và không có dòng nào thêm', async () => {
    const h = setup({ conversation: true, sentToday: MAX_MESSAGES_PER_DAY });
    const before = h.db.rows('supportMessage').length;
    const settled = await Promise.allSettled([h.send('u1', 'new-msg-0')]);
    expect(rejected(settled).map((r) => [statusOf(r), codeOf(r)])).toEqual([[429, 'CHAT_DAILY_LIMIT']]);
    expect(h.db.rows('supportMessage')).toHaveLength(before);
  });

  it('quét độ lệch giữa hai tin khác nhau tại MAX−1: lần nào cũng đúng một tin lưu và một 429', async () => {
    let waits = 0;
    for (let skew = -25; skew <= 25; skew++) {
      const h = setup({ conversation: true, sentToday: MAX_MESSAGES_PER_DAY - 1 });
      const go = (id: string, wait: number) => async () => (await delay(wait), h.send('u1', id));
      const settled = await Promise.allSettled([go('new-msg-a', Math.max(skew, 0))(), go('new-msg-b', Math.max(-skew, 0))()]);
      const label = `skew ${skew}`;
      is(label, fulfilled(settled).length, 1);
      is(label, rejected(settled).map((r) => [statusOf(r), codeOf(r)]), [[429, 'CHAT_DAILY_LIMIT']]);
      is(label, h.customerMessages().filter((m) => String(m.clientMsgId).startsWith('new-msg-')).length, 1);
      waits += h.db.stats.lockWaits;
    }
    expect(waits).toBeGreaterThan(0);
  });
});

describe('SupportChatService — hội thoại đầu tiên của khách', () => {
  it('getThread và send đầu tiên chạy song song (chưa có hội thoại): đúng MỘT supportConversation, mọi bên cùng conv.id và code', async () => {
    const h = setup();
    const settled = await Promise.allSettled([h.svc.getThread('u1'), h.send('u1', 'first-msg-1'), h.send('u1', 'first-msg-2'), h.svc.getThread('u1'), h.send('u1', 'first-msg-1')]);
    expect(rejected(settled).map((r) => String(r.reason))).toEqual([]);
    expect(h.conversations()).toHaveLength(1);
    const conv = h.conversations()[0]!;
    expect(conv).toMatchObject({ userId: 'u1' });
    expect(conv.code).toMatch(/^[A-HJ-NP-Z2-9]{4}$/);
    for (const r of fulfilled(settled).filter((x) => 'code' in x.value)) expect(r.value.code).toBe(conv.code);
    expect(h.db.rows('supportMessage').every((m) => m.conversationId === conv.id)).toBe(true);
    expect(h.customerMessages().map((m) => m.clientMsgId).sort()).toEqual(['first-msg-1', 'first-msg-2']);
    expect(h.db.stats.lockWaits).toBeGreaterThan(0);
  });

  it('hai khách khác nhau cùng được cấp một mã lần đầu: một khách nhận P2002 trên code rồi lấy mã khác, hai hội thoại mã khác nhau', async () => {
    const h = setup();
    const real = Math.random;
    let calls = 0;
    // Tám lần đầu (bốn ký tự cho mỗi khách) cho cùng mã 'DDDD'; sau đó trả số ngẫu nhiên thật để khách thua tìm được mã mới.
    jest.spyOn(Math, 'random').mockImplementation(() => (calls++ < 8 ? 0.1 : real()));
    const settled = await Promise.allSettled([h.svc.getThread('u1'), h.svc.getThread('u2')]);
    expect(rejected(settled).map((r) => String(r.reason))).toEqual([]);
    const convs = h.conversations();
    expect(convs.map((c) => c.userId).sort()).toEqual(['u1', 'u2']);
    expect(new Set(convs.map((c) => c.code)).size).toBe(2);
    expect(convs.map((c) => c.code)).toContain('DDDD');
    // Câu INSERT của khách thua bị Postgres từ chối (P2002 trên code) và rollback: không có P2002 thì hai mã đã không phải chọn lại.
    expect(h.db.stats.rollbacks).toBeGreaterThan(0);
  });

  it('khách vãng lai (zaloId guest_*, không SĐT): mọi lần mở/gửi song song bị 403 CHAT_LOGIN_REQUIRED và không tạo hội thoại', async () => {
    const h = setup({ user: { phone: null, zaloId: 'guest_device-1' } });
    const settled = await Promise.allSettled([h.svc.getThread('u1'), h.send('u1', 'guest-msg-1'), h.send('u1', 'guest-msg-2')]);
    expect(fulfilled(settled)).toHaveLength(0);
    for (const r of rejected(settled)) expect([statusOf(r), codeOf(r)]).toEqual([403, 'CHAT_LOGIN_REQUIRED']);
    expect(h.conversations()).toHaveLength(0);
    expect(h.db.rows('supportMessage')).toHaveLength(0);
  });
});

describe('SupportChatService.send — lời nhắn ngoài giờ', () => {
  it('3 tin song song ngoài giờ cùng ngày: đúng MỘT tin SYSTEM "ngoài giờ", mốc lastOffHoursNoticeOn là hôm nay', async () => {
    const h = setup({ at: NIGHT, conversation: true });
    const settled = await Promise.allSettled([h.send('u1', 'night-msg-1'), h.send('u1', 'night-msg-2'), h.send('u1', 'night-msg-3')]);
    expect(fulfilled(settled)).toHaveLength(3);
    expect(h.customerMessages()).toHaveLength(3);
    expect(h.systemMessages()).toHaveLength(1);
    expect(h.systemMessages()[0]).toMatchObject({ body: DEFAULT_OFF_HOURS_TEXT, source: 'SYSTEM' });
    expect(h.conversations()[0]!.lastOffHoursNoticeOn).toBe(vnDateKey(NIGHT));
  });

  it('quét độ lệch giữa hai tin ngoài giờ: lần nào cũng đúng một lời nhắn', async () => {
    for (let skew = -25; skew <= 25; skew++) {
      const h = setup({ at: NIGHT, conversation: true });
      const go = (id: string, wait: number) => async () => (await delay(wait), h.send('u1', id));
      await Promise.all([go('night-msg-a', Math.max(skew, 0))(), go('night-msg-b', Math.max(-skew, 0))()]);
      is(`skew ${skew}`, h.systemMessages().length, 1);
    }
  });

  it('đã nhắn hôm nay thì không nhắn lại; sang ngày hôm sau nhắn một lần nữa; trong giờ làm việc không nhắn', async () => {
    const h = setup({ at: NIGHT, conversation: true });
    await h.send('u1', 'night-msg-1');
    await h.send('u1', 'night-msg-2');
    expect(h.systemMessages()).toHaveLength(1);
    jest.setSystemTime(new Date(NIGHT.getTime() + DAY));
    await Promise.all([h.send('u1', 'night-msg-3'), h.send('u1', 'night-msg-4')]);
    expect(h.systemMessages()).toHaveLength(2);

    const inHours = setup({ at: NOON, conversation: true });
    await Promise.all([inHours.send('u1', 'day-msg-1'), inHours.send('u1', 'day-msg-2')]);
    expect(inHours.systemMessages()).toHaveLength(0);
    expect(inHours.conversations()[0]!.lastOffHoursNoticeOn).toBeNull();
  });

  it('giờ làm việc lấy từ cấu hình chat.hours (13:00–14:00, đang 12:00 là ngoài giờ): vẫn đúng một lời nhắn', async () => {
    const h = setup({ at: NOON, conversation: true });
    h.config.get.mockImplementation(async (key: string, fallback: unknown) => (key === CHAT_ENABLED_KEY ? true : key === CHAT_HOURS_KEY ? { start: '13:00', end: '14:00' } : fallback));
    await Promise.all([h.send('u1', 'cfg-msg-1'), h.send('u1', 'cfg-msg-2'), h.send('u1', 'cfg-msg-3')]);
    expect(h.systemMessages()).toHaveLength(1);
  });
});

describe('SupportChatService.send — thử lại khi chat bị tắt hoặc khách bị chặn', () => {
  const seedStored = (h: ReturnType<typeof setup>) =>
    h.db.seed('supportMessage', [{ id: 'stored-1', conversationId: CONV, sender: 'CUSTOMER', source: 'MINIAPP', body: 'đã lưu', clientMsgId: 'retry-0001', createdAt: new Date(NOON.getTime() - 60_000), recalledAt: null, seenAt: null, imageUrl: null, context: null }]);

  it('chat vừa tắt: thử lại cùng clientMsgId (song song cũng vậy) trả tin đã lưu, không 409; tin mới nhận 409 CHAT_DISABLED', async () => {
    const h = setup({ conversation: true, enabled: false });
    seedStored(h);
    const retries = await Promise.allSettled([h.send('u1', 'retry-0001'), h.send('u1', 'retry-0001'), h.send('u1', 'retry-0001')]);
    expect(fulfilled(retries).map((r) => r.value.id)).toEqual(['stored-1', 'stored-1', 'stored-1']);
    const fresh = await Promise.allSettled([h.send('u1', 'retry-0002')]);
    expect(rejected(fresh).map((r) => [statusOf(r), codeOf(r)])).toEqual([[409, 'CHAT_DISABLED']]);
    expect(h.customerMessages()).toHaveLength(1);
  });

  it('khách vừa bị chặn: thử lại cùng clientMsgId trả tin đã lưu, không 403; tin mới nhận 403 CHAT_BLOCKED', async () => {
    const h = setup({ conversation: { blockedAt: NOON } });
    seedStored(h);
    const retries = await Promise.allSettled([h.send('u1', 'retry-0001'), h.send('u1', 'retry-0001')]);
    expect(fulfilled(retries).map((r) => r.value.id)).toEqual(['stored-1', 'stored-1']);
    const fresh = await Promise.allSettled([h.send('u1', 'retry-0002')]);
    expect(rejected(fresh).map((r) => [statusOf(r), codeOf(r)])).toEqual([[403, 'CHAT_BLOCKED']]);
    expect(h.customerMessages()).toHaveLength(1);
  });
});
