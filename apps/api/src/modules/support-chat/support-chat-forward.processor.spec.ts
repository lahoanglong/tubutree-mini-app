import { SupportChatForwardProcessor } from './support-chat-forward.processor';

type Msg = { id: string; conversationId: string; sender: string; body: string; imageUrl: string | null; context: any; forwardId: string | null; createdAt: Date };

function setup(opts: {
  msgs?: Partial<Msg>[];
  blocked?: boolean;
  forwards?: any[];
  send?: any;
  groupId?: string;
  user?: any;
  scheduleReject?: boolean;
} = {}) {
  let t = 0;
  const messages: Msg[] = (opts.msgs ?? [{ body: 'a' }]).map((m, i) => ({
    id: `m${i + 1}`, conversationId: 'c1', sender: 'CUSTOMER', body: 'x', imageUrl: null, context: null, forwardId: null,
    createdAt: new Date(2026, 9, 23, 10, 0, t++), ...m,
  }));
  const forwards: any[] = (opts.forwards ?? []).map((f) => ({ conversationId: 'c1', attempts: 0, zaloMsgId: null, lastError: null, sentAt: null, createdAt: new Date(2026, 9, 23, 9), ...f }));
  const conv = { id: 'c1', userId: 'u1', code: 'K7Q2', blockedAt: opts.blocked ? new Date() : null };
  const prisma: any = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    supportConversation: { findUnique: jest.fn().mockResolvedValue(conv) },
    user: { findUnique: jest.fn().mockResolvedValue(opts.user ?? { fullName: 'Lan', phone: '0901234234', tier: { name: 'Vàng' } }) },
    supportMessage: {
      findMany: jest.fn().mockImplementation(({ where }: any) =>
        Promise.resolve(messages.filter((m) => m.conversationId === where.conversationId && (where.forwardId === undefined || m.forwardId === where.forwardId) && (!where.sender || m.sender === where.sender)))),
      updateMany: jest.fn().mockImplementation(({ where, data }: any) => {
        let count = 0;
        for (const m of messages) if (where.id.in.includes(m.id) && m.forwardId === where.forwardId) { m.forwardId = data.forwardId; count++; }
        return Promise.resolve({ count });
      }),
      count: jest.fn().mockImplementation(({ where }: any) =>
        Promise.resolve(messages.filter((m) => m.sender === 'CUSTOMER' && m.forwardId === where.forwardId).length)),
    },
    supportForward: {
      findFirst: jest.fn().mockImplementation(() => Promise.resolve(forwards.find((f) => f.status === 'PENDING' && f.zaloMsgId === null) ?? null)),
      create: jest.fn().mockImplementation(({ data }: any) => {
        const f = { id: `f${forwards.length + 1}`, attempts: 0, zaloMsgId: null, lastError: null, sentAt: null, createdAt: new Date(), status: 'PENDING', ...data };
        forwards.push(f);
        return Promise.resolve(f);
      }),
      updateMany: jest.fn().mockImplementation(({ where, data }: any) => {
        const f = forwards.find((x) => x.id === where.id && (!where.status || x.status === where.status));
        if (f) Object.assign(f, data);
        return Promise.resolve({ count: f ? 1 : 0 });
      }),
      update: jest.fn().mockImplementation(({ where, data }: any) => {
        const f = forwards.find((x) => x.id === where.id)!;
        for (const [k, v] of Object.entries(data)) f[k] = (v as any)?.increment ? f[k] + (v as any).increment : v;
        return Promise.resolve(f);
      }),
    },
  };
  prisma.$transaction = jest.fn().mockImplementation((fn: any) => fn(prisma));
  const config: any = { get: jest.fn().mockResolvedValue(opts.groupId ?? 'g1') };
  const bridge: any = { send: opts.send ?? jest.fn().mockResolvedValue({ ok: true, msgId: 'z1' }) };
  const service: any = { scheduleForward: opts.scheduleReject ? jest.fn().mockRejectedValue(new Error('redis')) : jest.fn().mockResolvedValue(undefined) };
  const proc = new SupportChatForwardProcessor(prisma, config, bridge, service);
  const job = (o: { attemptsMade?: number; attempts?: number } = {}): any => ({ data: { conversationId: 'c1' }, attemptsMade: o.attemptsMade ?? 0, opts: { attempts: o.attempts ?? 5 } });
  return { proc, prisma, bridge, service, messages, forwards, job };
}

describe('SupportChatForwardProcessor', () => {
  it('gom mọi tin CUSTOMER chưa chuyển thành một forward và gán forwardId', async () => {
    const { proc, bridge, forwards, messages, job } = setup({ msgs: [{ body: 'một' }, { body: 'hai' }, { body: 'ba', sender: 'STAFF' }] });
    await proc.process(job());
    expect(forwards).toHaveLength(1);
    expect(messages.filter((m) => m.sender === 'CUSTOMER').every((m) => m.forwardId === forwards[0]!.id)).toBe(true);
    expect(messages[2]!.forwardId).toBeNull();
    const [key, text] = bridge.send.mock.calls[0];
    expect(key).toBe(forwards[0]!.id);
    expect(text).toContain('một');
    expect(text).toContain('hai');
    expect(text).not.toContain('ba');
    expect(text.split('\n')[0]).toBe('#K7Q2 · Lan · 09•••••234 · Hạng Vàng');
  });

  it('lấy khoá nhóm theo hội thoại trong giao dịch', async () => {
    const { proc, prisma, job } = setup();
    await proc.process(job());
    expect(prisma.$executeRaw).toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('quá 3.000 ký tự thì phần dư để lại và đặt lịch lần sau', async () => {
    const big = 'x'.repeat(900);
    const { proc, service, messages, forwards, job } = setup({ msgs: [{ body: big }, { body: big }, { body: big }, { body: big }] });
    await proc.process(job());
    expect(messages.filter((m) => m.forwardId === forwards[0]!.id)).toHaveLength(3);
    expect(messages[3]!.forwardId).toBeNull();
    expect(service.scheduleForward).toHaveBeenCalledWith('c1');
  });

  it('luôn lấy ít nhất tin đầu dù một mình vượt hạn mức', async () => {
    const { proc, messages, job } = setup({ msgs: [{ body: 'x'.repeat(3500) }, { body: 'y' }] });
    await proc.process(job());
    expect(messages[0]!.forwardId).not.toBeNull();
    expect(messages[1]!.forwardId).toBeNull();
  });

  it('send ok thì SENT kèm zaloMsgId và sentAt, không đặt lịch lại', async () => {
    const { proc, forwards, service, job } = setup();
    await proc.process(job());
    expect(forwards[0]).toMatchObject({ status: 'SENT', zaloMsgId: 'z1', attempts: 1 });
    expect(forwards[0].sentAt).toBeInstanceOf(Date);
    expect(service.scheduleForward).not.toHaveBeenCalled();
  });

  it('retry:true thì ném lỗi và giữ PENDING', async () => {
    const send = jest.fn().mockResolvedValue({ ok: false, retry: true, unknown: false, code: 'NOT_CONNECTED', message: 'm' });
    const { proc, forwards, job } = setup({ send });
    await expect(proc.process(job())).rejects.toThrow();
    expect(forwards[0]).toMatchObject({ status: 'PENDING', attempts: 1 });
  });

  it('unknown:true thì UNKNOWN, không ném', async () => {
    const send = jest.fn().mockResolvedValue({ ok: false, retry: false, unknown: true, code: 'TIMEOUT', message: 'hết giờ' });
    const { proc, forwards, job } = setup({ send });
    await expect(proc.process(job())).resolves.toBeUndefined();
    expect(forwards[0].status).toBe('UNKNOWN');
  });

  it('lỗi khác thì FAILED kèm lastError', async () => {
    const send = jest.fn().mockResolvedValue({ ok: false, retry: false, unknown: false, code: 'NO_GROUP', message: 'chưa chọn nhóm' });
    const { proc, forwards, job } = setup({ send });
    await proc.process(job());
    expect(forwards[0].status).toBe('FAILED');
    expect(forwards[0].lastError).toContain('NO_GROUP');
  });

  it('chat đã tắt sau khi khách gửi vẫn chuyển, nhóm rỗng vẫn gửi', async () => {
    const { proc, bridge, forwards, job } = setup({ groupId: '' });
    await proc.process(job());
    expect(bridge.send).toHaveBeenCalled();
    expect(forwards[0].groupId).toBe('');
  });

  it('hội thoại bị chặn thì không chuyển, tin giữ forwardId = null', async () => {
    const { proc, bridge, messages, forwards, job } = setup({ blocked: true });
    await proc.process(job());
    expect(bridge.send).not.toHaveBeenCalled();
    expect(forwards).toHaveLength(0);
    expect(messages[0]!.forwardId).toBeNull();
  });

  it('có forward PENDING chưa zaloMsgId thì gửi lại chính nó, không lấy tin mới', async () => {
    const { proc, bridge, forwards, messages, service, job } = setup({
      msgs: [{ body: 'cũ', forwardId: 'f0' }, { body: 'mới' }],
      forwards: [{ id: 'f0', status: 'PENDING', groupId: 'g1', attempts: 1 }],
    });
    await proc.process(job());
    expect(forwards).toHaveLength(1);
    const [key, text] = bridge.send.mock.calls[0];
    expect(key).toBe('f0');
    expect(text).toContain('cũ');
    expect(text).not.toContain('mới');
    expect(forwards[0]).toMatchObject({ status: 'SENT', attempts: 2 });
    expect(messages[1]!.forwardId).toBeNull();
    expect(service.scheduleForward).toHaveBeenCalledWith('c1');
  });

  it('lần thử cuối với retry:true thì FAILED, không ném', async () => {
    const send = jest.fn().mockResolvedValue({ ok: false, retry: true, unknown: false, code: 'NOT_CONNECTED', message: 'm' });
    const { proc, forwards, job } = setup({ send });
    await expect(proc.process(job({ attemptsMade: 4, attempts: 5 }))).resolves.toBeUndefined();
    expect(forwards[0].status).toBe('FAILED');
    expect(forwards[0].lastError).toContain('NOT_CONNECTED');
  });

  it('tin đến giữa chừng thì đặt lịch lại, kể cả trước khi ném để thử lại', async () => {
    const send = jest.fn().mockImplementation(async () => {
      messages.push({ id: 'late', conversationId: 'c1', sender: 'CUSTOMER', body: 'trễ', imageUrl: null, context: null, forwardId: null, createdAt: new Date() });
      return { ok: false, retry: true, unknown: false, code: 'NOT_CONNECTED', message: 'm' };
    });
    const { proc, service, messages, job } = setup({ send });
    await expect(proc.process(job())).rejects.toThrow();
    expect(service.scheduleForward).toHaveBeenCalledWith('c1');
  });

  it('lỗi đặt lịch lại không làm hỏng kết quả đã ghi', async () => {
    const { proc, forwards, job } = setup({ msgs: [{ body: 'x'.repeat(1000) }, { body: 'x'.repeat(1000) }, { body: 'x'.repeat(1000) }, { body: 'x' }], scheduleReject: true });
    await expect(proc.process(job())).resolves.toBeUndefined();
    expect(forwards[0].status).toBe('SENT');
  });

  it('kết quả muộn không ghi đè forward đã SENT', async () => {
    const { proc, forwards, prisma, job } = setup({
      send: jest.fn().mockImplementation(async () => {
        prisma.supportForward.updateMany.mockClear();
        forwards[0]!.status = 'SENT';
        return { ok: false, retry: false, unknown: true, code: 'TIMEOUT', message: 'hết giờ' };
      }),
    });
    await proc.process(job());
    expect(forwards[0]!.status).toBe('SENT');
  });

  it('ghi DB lỗi vẫn đặt lịch lại và lỗi vẫn ném ra', async () => {
    const { proc, prisma, service, job } = setup();
    prisma.supportForward.update.mockRejectedValue(new Error('db'));
    await expect(proc.process(job())).rejects.toThrow('db');
    expect(prisma.supportMessage.count).toHaveBeenCalled();
    expect(service.scheduleForward).not.toHaveBeenCalled();
  });
});
