import { HttpException } from '@nestjs/common';
import { SupportChatService } from './support-chat.service';
import { CHAT_ENABLED_KEY, DEFAULT_OFF_HOURS_TEXT } from './support-chat.config';

const NOON = new Date('2026-10-23T12:00:00+07:00');
const NIGHT = new Date('2026-10-23T22:30:00+07:00');

function setup(opts: { enabled?: boolean; conv?: any; existing?: any; dayCount?: number; bridge?: any; orders?: { code: string; userId: string }[] } = {}) {
  const conv = { id: 'c1', userId: 'u1', code: 'K7Q3', customerReadAt: null, lastOffHoursNoticeOn: null, blockedAt: null, ...opts.conv };
  const created: any[] = [];
  const prisma: any = {
    supportConversation: {
      findUnique: jest.fn().mockResolvedValue(conv),
      create: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    supportMessage: {
      findFirst: jest.fn().mockResolvedValue(opts.existing ?? null),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(opts.dayCount ?? 0),
      create: jest.fn().mockImplementation(({ data }: any) => {
        const row = { id: `m${created.length + 1}`, recalledAt: null, createdAt: new Date(), context: null, imageUrl: null, ...data };
        created.push(row);
        return Promise.resolve(row);
      }),
    },
    supportBridgeStatus: { findUnique: jest.fn().mockResolvedValue(opts.bridge ?? null) },
    order: {
      findFirst: jest.fn().mockImplementation(({ where }: any) =>
        Promise.resolve((opts.orders ?? []).find((o) => o.code === where.code && o.userId === where.userId) ?? null)),
    },
  };
  const config: any = {
    get: jest.fn().mockImplementation((key: string, fb: unknown) =>
      Promise.resolve(key === CHAT_ENABLED_KEY ? (opts.enabled ?? true) : fb)),
  };
  const queue: any = {
    getJob: jest.fn().mockResolvedValue(null),
    add: jest.fn().mockResolvedValue({}),
    name: 'support-chat-forward',
  };
  const svc = new SupportChatService(prisma, config, queue);
  return { svc, prisma, config, queue, created, conv };
}

const input = { clientMsgId: 'abcdefgh-1' };

describe('getThread', () => {
  beforeEach(() => jest.useFakeTimers({ now: NOON }));
  afterEach(() => jest.useRealTimers());

  it('tạo hội thoại với code đúng bảng chữ', async () => {
    const { svc, prisma } = setup();
    prisma.supportConversation.findUnique.mockResolvedValue(null);
    prisma.supportConversation.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'c1', blockedAt: null, ...data }));
    const t = await svc.getThread('u1');
    expect(t.code).toMatch(/^[A-HJ-NP-Z2-9]{4}$/);
    expect(t.enabled).toBe(true);
    expect(t.slow).toBe(false);
  });

  it('trùng code (P2002) thì thử mã khác', async () => {
    const { svc, prisma } = setup();
    prisma.supportConversation.findUnique.mockResolvedValue(null);
    prisma.supportConversation.create
      .mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }))
      .mockImplementation(({ data }: any) => Promise.resolve({ id: 'c1', blockedAt: null, ...data }));
    await svc.getThread('u1');
    expect(prisma.supportConversation.create).toHaveBeenCalledTimes(2);
    const [a, b] = prisma.supportConversation.create.mock.calls.map((c: any) => c[0].data.code);
    expect(a).not.toBe(b);
  });

  it('loại tin STAFF đã thu hồi khỏi truy vấn, DTO không lộ staffName/adminUserId/zaloMsgId/forwardId', async () => {
    const { svc, prisma } = setup();
    prisma.supportMessage.findMany.mockResolvedValue([
      { id: 'm2', sender: 'STAFF', body: 'ok', imageUrl: null, context: null, clientMsgId: null, createdAt: new Date(2), staffName: 'An', adminUserId: 'a', zaloMsgId: 'z', forwardId: 'f' },
      { id: 'm1', sender: 'CUSTOMER', body: 'hi', imageUrl: null, context: { orderCode: 'T1' }, clientMsgId: 'x', createdAt: new Date(1), staffName: null },
    ]);
    const t = await svc.getThread('u1');
    const where = prisma.supportMessage.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ sender: { not: 'STAFF' } }, { recalledAt: null }]);
    expect(t.messages.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(Object.keys(t.messages[1]!).sort()).toEqual(['body', 'clientMsgId', 'context', 'createdAt', 'id', 'imageUrl', 'sender']);
    expect(t.hasMore).toBe(false);
  });

  it('hasMore khi có hơn 50 tin; chỉ trả 50', async () => {
    const { svc, prisma } = setup();
    prisma.supportMessage.findMany.mockResolvedValue(
      Array.from({ length: 51 }, (_, i) => ({ id: `m${51 - i}`, sender: 'CUSTOMER', body: 'x', createdAt: new Date(51 - i) })));
    const t = await svc.getThread('u1');
    expect(t.messages).toHaveLength(50);
    expect(t.hasMore).toBe(true);
    expect(t.messages[49]!.id).toBe('m51');
  });

  it('slow: true khi cầu nối không CONNECTED quá 10 phút, false khi mới mất hoặc chưa có dòng', async () => {
    const old = new Date(NOON.getTime() - 11 * 60_000);
    const recent = new Date(NOON.getTime() - 5 * 60_000);
    expect((await setup({ bridge: { state: 'ERROR', since: old } }).svc.getThread('u1')).slow).toBe(true);
    expect((await setup({ bridge: { state: 'ERROR', since: recent } }).svc.getThread('u1')).slow).toBe(false);
    expect((await setup({ bridge: { state: 'CONNECTED', since: old } }).svc.getThread('u1')).slow).toBe(false);
    expect((await setup().svc.getThread('u1')).slow).toBe(false);
  });
});

describe('page', () => {
  it('after: so cặp (createdAt, id) của tin mốc, tăng dần', async () => {
    const { svc, prisma } = setup();
    const at = new Date(5);
    prisma.supportMessage.findFirst.mockResolvedValue({ id: 'm5', createdAt: at });
    await svc.page('u1', { after: 'm5' });
    const args = prisma.supportMessage.findMany.mock.calls[0][0];
    expect(args.where.AND[0].OR).toEqual([{ createdAt: { gt: at } }, { createdAt: at, id: { gt: 'm5' } }]);
    expect(args.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
    expect(args.where.AND[1].OR).toEqual([{ sender: { not: 'STAFF' } }, { recalledAt: null }]);
  });

  it('before: giảm dần rồi đảo lại cũ → mới, hasMore', async () => {
    const { svc, prisma } = setup();
    prisma.supportMessage.findFirst.mockResolvedValue({ id: 'm60', createdAt: new Date(60) });
    prisma.supportMessage.findMany.mockResolvedValue(
      Array.from({ length: 51 }, (_, i) => ({ id: `m${59 - i}`, sender: 'CUSTOMER', body: 'x', createdAt: new Date(59 - i) })));
    const p = await svc.page('u1', { before: 'm60' });
    expect(prisma.supportMessage.findMany.mock.calls[0][0].orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(p.messages).toHaveLength(50);
    expect(p.hasMore).toBe(true);
    expect(p.messages[0]!.id).toBe('m10');
  });

  it('tin mốc không thuộc hội thoại → trang rỗng', async () => {
    const { svc, prisma } = setup();
    prisma.supportMessage.findFirst.mockResolvedValue(null);
    expect(await svc.page('u1', { after: 'zzz' })).toEqual({ messages: [], hasMore: false });
    expect(prisma.supportMessage.findMany).not.toHaveBeenCalled();
  });
});

describe('send', () => {
  beforeEach(() => jest.useFakeTimers({ now: NOON }));
  afterEach(() => jest.useRealTimers());

  it('tạo tin, đặt lịch chuyển đúng một lần (jobId conv-<id>, trễ 15s)', async () => {
    const { svc, queue, created } = setup();
    const dto = await svc.send('u1', { ...input, body: ' xin chào ' }, 'MINIAPP');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ conversationId: 'c1', sender: 'CUSTOMER', source: 'MINIAPP', body: 'xin chào' });
    expect(dto.sender).toBe('CUSTOMER');
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith('forward', { conversationId: 'c1' }, expect.objectContaining({ jobId: 'conv-c1', delay: 15_000 }));
  });

  it('cùng clientMsgId hai lần → một create, lần hai trả tin cũ, scheduleForward một lần', async () => {
    const { svc, prisma, queue, created } = setup();
    const first = await svc.send('u1', { ...input, body: 'a' }, 'WEB');
    prisma.supportMessage.findFirst.mockResolvedValue(created[0]);
    const second = await svc.send('u1', { ...input, body: 'a' }, 'WEB');
    expect(created).toHaveLength(1);
    expect(second.id).toBe(first.id);
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('hai request cùng clientMsgId đua nhau: P2002 ở create → trả tin cũ, không đặt lịch', async () => {
    const { svc, prisma, queue } = setup();
    const winner = { id: 'w', sender: 'CUSTOMER', body: 'a', imageUrl: null, context: null, clientMsgId: input.clientMsgId, createdAt: new Date() };
    prisma.supportMessage.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
    prisma.supportMessage.create.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }));
    const dto = await svc.send('u1', { ...input, body: 'a' }, 'MINIAPP');
    expect(dto.id).toBe('w');
    expect(queue.add).not.toHaveBeenCalled();
  });

  describe('mã đơn trong ngữ cảnh', () => {
    const orders = [{ code: 'TUBU1', userId: 'u1' }, { code: 'TUBU2', userId: 'u2' }];

    it('đơn của chính người gửi thì giữ', async () => {
      const { svc, created } = setup({ orders });
      await svc.send('u1', { ...input, body: 'a', context: { orderCode: 'TUBU1', productSlug: 'sua-bo' } }, 'WEB');
      expect(created[0].context).toEqual({ orderCode: 'TUBU1', productSlug: 'sua-bo' });
    });

    it('đơn của khách khác thì bỏ mã đơn, tin vẫn lưu, giữ phần còn lại của ngữ cảnh', async () => {
      const { svc, created } = setup({ orders });
      await svc.send('u1', { ...input, body: 'a', context: { orderCode: 'TUBU2', productSlug: 'sua-bo' } }, 'WEB');
      expect(created).toHaveLength(1);
      expect(created[0].context).toEqual({ productSlug: 'sua-bo' });
    });

    it('mã không có thật thì bỏ, ngữ cảnh rỗng thì không ghi ngữ cảnh', async () => {
      const { svc, created } = setup({ orders });
      await svc.send('u1', { ...input, body: 'a', context: { orderCode: 'NOPE' } }, 'MINIAPP');
      expect(created).toHaveLength(1);
      expect(created[0].context).toBeUndefined();
    });
  });

  it('chat tắt → 409 CHAT_DISABLED', async () => {
    const { svc } = setup({ enabled: false });
    await expect(svc.send('u1', { ...input, body: 'a' }, 'MINIAPP')).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({ code: 'CHAT_DISABLED', message: 'Chat với Tubu Tree đang tạm đóng. Cần hỗ trợ, gọi hotline.' }),
    });
  });

  it('bị chặn → 403 CHAT_BLOCKED', async () => {
    const { svc } = setup({ conv: { blockedAt: new Date() } });
    await expect(svc.send('u1', { ...input, body: 'a' }, 'MINIAPP')).rejects.toMatchObject({
      status: 403,
      response: expect.objectContaining({ code: 'CHAT_BLOCKED', message: 'Bạn tạm thời không gửi được tin. Cần hỗ trợ, gọi hotline.' }),
    });
  });

  it('thiếu cả body lẫn imageUrl → 400', async () => {
    const { svc } = setup();
    await expect(svc.send('u1', { ...input }, 'MINIAPP')).rejects.toMatchObject({ status: 400 });
    await expect(svc.send('u1', { ...input, body: '   ' }, 'MINIAPP')).rejects.toMatchObject({ status: 400 });
  });

  it('tin thứ 201 trong ngày (giờ VN) → 429; đếm từ 00:00 giờ VN', async () => {
    const { svc, prisma } = setup({ dayCount: 200 });
    await expect(svc.send('u1', { ...input, body: 'a' }, 'MINIAPP')).rejects.toBeInstanceOf(HttpException);
    await expect(svc.send('u1', { ...input, body: 'a' }, 'MINIAPP')).rejects.toMatchObject({ status: 429 });
    const where = prisma.supportMessage.count.mock.calls[0][0].where;
    expect(where.createdAt.gte).toEqual(new Date('2026-10-22T17:00:00.000Z'));
    expect(where.sender).toBe('CUSTOMER');
  });

  it('tin thứ 200 vẫn qua', async () => {
    const { svc } = setup({ dayCount: 199 });
    await expect(svc.send('u1', { ...input, body: 'a' }, 'MINIAPP')).resolves.toBeDefined();
  });
});

describe('send ngoài giờ', () => {
  beforeEach(() => jest.useFakeTimers({ now: NIGHT }));
  afterEach(() => jest.useRealTimers());

  it('tin đầu trong ngày thêm tin SYSTEM sau tin khách và đặt lastOffHoursNoticeOn (ngày VN)', async () => {
    const { svc, prisma, created } = setup();
    await svc.send('u1', { ...input, body: 'a' }, 'MINIAPP');
    expect(created.map((m) => m.sender)).toEqual(['CUSTOMER', 'SYSTEM']);
    expect(created[1]).toMatchObject({ body: DEFAULT_OFF_HOURS_TEXT, source: 'SYSTEM' });
    const claim = prisma.supportConversation.updateMany.mock.calls[0][0];
    expect(claim.data.lastOffHoursNoticeOn).toBe('2026-10-23');
  });

  it('đã nhắn hôm nay (updateMany không khớp) thì không thêm', async () => {
    const { svc, prisma, created } = setup({ conv: { lastOffHoursNoticeOn: '2026-10-23' } });
    prisma.supportConversation.updateMany.mockResolvedValue({ count: 0 });
    await svc.send('u1', { ...input, body: 'a' }, 'MINIAPP');
    expect(created.map((m) => m.sender)).toEqual(['CUSTOMER']);
  });

  it('không gọi updateMany khi conv đã có dấu hôm nay', async () => {
    const { svc, prisma } = setup({ conv: { lastOffHoursNoticeOn: '2026-10-23' } });
    await svc.send('u1', { ...input, body: 'a' }, 'MINIAPP');
    expect(prisma.supportConversation.updateMany).not.toHaveBeenCalled();
  });

  it('trong giờ không nhắn', async () => {
    jest.setSystemTime(NOON);
    const { svc, created } = setup();
    await svc.send('u1', { ...input, body: 'a' }, 'MINIAPP');
    expect(created.map((m) => m.sender)).toEqual(['CUSTOMER']);
  });
});

describe('unreadCount / markRead', () => {
  it('đếm STAFF/SYSTEM chưa thu hồi sau customerReadAt', async () => {
    const readAt = new Date(1000);
    const { svc, prisma } = setup({ conv: { customerReadAt: readAt } });
    prisma.supportMessage.count.mockResolvedValue(3);
    expect(await svc.unreadCount('u1')).toBe(3);
    expect(prisma.supportMessage.count).toHaveBeenCalledWith({
      where: { conversationId: 'c1', sender: { in: ['STAFF', 'SYSTEM'] }, recalledAt: null, createdAt: { gt: readAt } },
    });
  });

  it('chưa đọc lần nào thì đếm tất cả; chưa có hội thoại thì 0 và không tạo', async () => {
    const a = setup();
    a.prisma.supportMessage.count.mockResolvedValue(2);
    await a.svc.unreadCount('u1');
    expect(a.prisma.supportMessage.count.mock.calls[0][0].where.createdAt).toBeUndefined();
    const b = setup();
    b.prisma.supportConversation.findUnique.mockResolvedValue(null);
    expect(await b.svc.unreadCount('u1')).toBe(0);
    expect(b.prisma.supportConversation.create).not.toHaveBeenCalled();
  });

  it('markRead đặt customerReadAt', async () => {
    const { svc, prisma } = setup();
    expect(await svc.markRead('u1')).toEqual({ ok: true });
    expect(prisma.supportConversation.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1' }, data: { customerReadAt: expect.any(Date) },
    });
  });
});

describe('scheduleForward', () => {
  const jobs = (states: Record<string, string>) => {
    const removes: Record<string, jest.Mock> = {};
    const getJob = jest.fn().mockImplementation(async (id: string) => {
      if (!(id in states)) return undefined;
      removes[id] = removes[id] ?? jest.fn();
      return { getState: async () => states[id], remove: removes[id] };
    });
    return { getJob, removes };
  };
  const added = (queue: any) => queue.add.mock.calls.map((c: any) => [c[2].jobId, c[2].delay]);

  it('chưa có job → add conv-<id> trễ 15s', async () => {
    const { svc, queue } = setup();
    await svc.scheduleForward('c9');
    expect(added(queue)).toEqual([['conv-c9', 15_000]]);
  });
  it('job đã completed/failed → gỡ rồi add lại', async () => {
    for (const st of ['completed', 'failed']) {
      const { svc, queue } = setup();
      const j = jobs({ 'conv-c9': st });
      queue.getJob = j.getJob;
      await svc.scheduleForward('c9');
      expect(j.removes['conv-c9']).toHaveBeenCalled();
      expect(added(queue)).toEqual([['conv-c9', 15_000]]);
    }
  });
  it('job waiting/delayed → không làm gì', async () => {
    for (const st of ['waiting', 'delayed']) {
      const { svc, queue } = setup();
      queue.getJob = jobs({ 'conv-c9': st }).getJob;
      await svc.scheduleForward('c9');
      expect(queue.add).not.toHaveBeenCalled();
    }
  });
  it('job active → add conv-<id>-next trễ 15s', async () => {
    const { svc, queue } = setup();
    queue.getJob = jobs({ 'conv-c9': 'active' }).getJob;
    await svc.scheduleForward('c9');
    expect(added(queue)).toEqual([['conv-c9-next', 15_000]]);
  });
  it('active + -next đã completed → gỡ -next rồi add lại', async () => {
    const { svc, queue } = setup();
    const j = jobs({ 'conv-c9': 'active', 'conv-c9-next': 'completed' });
    queue.getJob = j.getJob;
    await svc.scheduleForward('c9');
    expect(j.removes['conv-c9-next']).toHaveBeenCalled();
    expect(added(queue)).toEqual([['conv-c9-next', 15_000]]);
  });
  it('active + -next đang waiting/delayed → không làm gì', async () => {
    for (const st of ['waiting', 'delayed']) {
      const { svc, queue } = setup();
      queue.getJob = jobs({ 'conv-c9': 'active', 'conv-c9-next': st }).getJob;
      await svc.scheduleForward('c9');
      expect(queue.add).not.toHaveBeenCalled();
    }
  });
});

describe('send: độ bền và thứ tự kiểm tra', () => {
  beforeEach(() => jest.useFakeTimers({ now: NIGHT }));
  afterEach(() => jest.useRealTimers());

  it('tạo tin SYSTEM ngoài giờ lỗi vẫn trả tin khách và đã đặt lịch', async () => {
    const { svc, prisma, queue } = setup();
    prisma.supportMessage.create
      .mockImplementationOnce(({ data }: any) => Promise.resolve({ id: 'm1', createdAt: new Date(), context: null, imageUrl: null, ...data }))
      .mockRejectedValueOnce(new Error('db'));
    const dto = await svc.send('u1', { ...input, body: 'a' }, 'MINIAPP');
    expect(dto.id).toBe('m1');
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('thử lại tin đã lưu sau khi bị chặn hoặc chat tắt vẫn trả tin cũ', async () => {
    const saved = { id: 'old', sender: 'CUSTOMER', body: 'a', imageUrl: null, context: null, clientMsgId: input.clientMsgId, createdAt: new Date() };
    for (const o of [{ conv: { blockedAt: new Date() } }, { enabled: false }]) {
      const { svc, prisma, queue } = setup({ ...o, existing: saved });
      const dto = await svc.send('u1', { ...input, body: 'a' }, 'MINIAPP');
      expect(dto.id).toBe('old');
      expect(prisma.supportMessage.create).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    }
  });
});

describe('page: tham số rỗng', () => {
  it('after rỗng + before=m5 → trang trước m5', async () => {
    const { svc, prisma } = setup();
    prisma.supportMessage.findFirst.mockResolvedValue({ id: 'm5', createdAt: new Date(5) });
    await svc.page('u1', { after: '', before: 'm5' });
    expect(prisma.supportMessage.findMany.mock.calls[0][0].orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });
});
