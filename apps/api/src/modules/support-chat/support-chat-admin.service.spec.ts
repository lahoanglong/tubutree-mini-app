import { ConflictException, NotFoundException } from '@nestjs/common';
import { SupportChatAdminService } from './support-chat-admin.service';
import { CHAT_ENABLED_KEY, CHAT_GROUP_KEY } from './support-chat.config';

function setup(o: { forwards?: any[]; messages?: any[]; conv?: any | null; send?: any; config?: Record<string, unknown> } = {}) {
  const forwards: any[] = o.forwards ?? [];
  const messages: any[] = o.messages ?? [];
  const conv = o.conv === undefined ? { id: 'c1', userId: 'u1', code: 'K7Q2', blockedAt: null, blockedByUserId: null, user: { id: 'u1', fullName: 'Lan', phone: '0901234234' } } : o.conv;
  const created: any[] = [];
  const prisma: any = {
    supportConversation: {
      findUnique: jest.fn().mockResolvedValue(conv),
      findMany: jest.fn().mockResolvedValue(conv ? [{ ...conv, user: { id: 'u1', fullName: 'Lan', phone: '0901234234' }, messages: [], forwards: [] }] : []),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: conv ? 1 : 0 }),
    },
    supportMessage: {
      create: jest.fn().mockImplementation(({ data }: any) => {
        created.push(data);
        return Promise.resolve({ id: 'm-new', createdAt: new Date('2026-10-23T10:00:00Z'), imageUrl: null, context: null, clientMsgId: null, zaloMsgId: null, staffName: null, recalledAt: null, forwardId: null, ...data });
      }),
      findMany: jest.fn().mockImplementation(({ where }: any) => Promise.resolve(where.forwardId ? messages.filter((m) => m.forwardId === where.forwardId) : messages)),
    },
    supportForward: {
      findUnique: jest.fn().mockImplementation(({ where }: any) => Promise.resolve(forwards.find((f) => f.id === where.id) ?? null)),
      findMany: jest.fn().mockImplementation(({ where }: any) => Promise.resolve(forwards.filter((f) => where.id.in.includes(f.id)))),
      updateMany: jest.fn().mockImplementation(({ where, data }: any) => {
        const f = forwards.find((x) => x.id === where.id);
        const fresh = (x: any) => x.status === 'PENDING' && x.zaloMsgId == null && x.updatedAt < where.OR?.[1]?.updatedAt?.lt;
        const ok = !f ? false : where.OR ? where.OR[0].status.in.includes(f.status) || fresh(f) : typeof where.status === 'string' ? f.status === where.status : where.status.in.includes(f.status);
        if (!ok) return Promise.resolve({ count: 0 });
        Object.assign(f, data);
        return Promise.resolve({ count: 1 });
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    supportBridgeStatus: { findUnique: jest.fn().mockResolvedValue({ id: 'main', state: 'CONNECTED', since: new Date(), lastError: null, zaloUid: 'z', displayName: 'CSKH', avatar: null, checkedAt: new Date() }) },
    supportBridgeAction: { create: jest.fn().mockResolvedValue({}) },
    user: { findUnique: jest.fn().mockResolvedValue({ fullName: 'Lan', phone: '0901234234', tier: null }) },
  };
  const cfg: Record<string, unknown> = { [CHAT_ENABLED_KEY]: true, [CHAT_GROUP_KEY]: 'G1', ...o.config };
  const config: any = { get: jest.fn().mockImplementation((k: string, fb?: unknown) => Promise.resolve(k in cfg ? cfg[k] : fb)), set: jest.fn().mockResolvedValue(undefined) };
  const bridge: any = {
    setGroup: jest.fn().mockResolvedValue({ ok: true, data: { groupId: 'G1' } }),
    send: jest.fn().mockResolvedValue(o.send ?? { ok: true, msgId: 'zm1' }),
    qrStart: jest.fn().mockResolvedValue({ ok: true, data: { status: 'WAITING_SCAN', image: 'data:x' } }),
    logout: jest.fn().mockResolvedValue({ ok: true, data: { ok: true } }),
    reconnect: jest.fn().mockResolvedValue({ ok: true, data: { ok: true } }),
    qrStatus: jest.fn().mockResolvedValue({ ok: true, data: { status: 'IDLE' } }),
    groups: jest.fn().mockResolvedValue({ ok: true, data: { groups: [] } }),
  };
  const notifications: any = { notify: jest.fn().mockResolvedValue(undefined) };
  const svc = new SupportChatAdminService(prisma, config, bridge, notifications);
  return { svc, prisma, config, bridge, notifications, created, forwards };
}

const fwd = (o: Record<string, unknown> = {}) => ({ id: 'f1', conversationId: 'c1', status: 'FAILED', zaloMsgId: null, attempts: 1, lastError: 'x', createdAt: new Date(), updatedAt: new Date(), ...o });
const custMsg = (o: Record<string, unknown> = {}) => ({ id: 'm1', conversationId: 'c1', sender: 'CUSTOMER', source: 'MINIAPP', body: 'xin chào', imageUrl: null, context: null, forwardId: 'f1', createdAt: new Date('2026-10-23T09:00:00Z'), ...o });

describe('SupportChatAdminService', () => {
  it('PUT settings {groupId} lưu cấu hình theo admin rồi báo cầu nối', async () => {
    const { svc, config, bridge } = setup();
    await svc.updateSettings('admin1', { groupId: 'G1' });
    expect(config.set).toHaveBeenCalledWith(CHAT_GROUP_KEY, 'G1', 'admin1');
    expect(bridge.setGroup).toHaveBeenCalledWith('G1');
  });

  it('PUT settings {enabled} chỉ lưu cờ, không đụng cầu nối', async () => {
    const { svc, config, bridge } = setup();
    await svc.updateSettings('admin1', { enabled: false });
    expect(config.set).toHaveBeenCalledWith(CHAT_ENABLED_KEY, false, 'admin1');
    expect(bridge.setGroup).not.toHaveBeenCalled();
  });

  it('groupId rỗng gỡ nhóm ở cầu nối (null)', async () => {
    const { svc, bridge } = setup();
    await svc.updateSettings('admin1', { groupId: '' });
    expect(bridge.setGroup).toHaveBeenCalledWith(null);
  });

  it('reply tạo tin STAFF nguồn ADMIN có adminUserId, báo khách, không gửi vào Zalo', async () => {
    const { svc, created, notifications, bridge } = setup();
    await svc.reply('admin1', 'c1', '  Dạ shop nhận rồi ạ 0912345678  ');
    expect(created).toEqual([{ conversationId: 'c1', sender: 'STAFF', source: 'ADMIN', body: 'Dạ shop nhận rồi ạ 0912345678', adminUserId: 'admin1' }]);
    expect(notifications.notify).toHaveBeenCalledWith(
      'u1',
      'SUPPORT_CHAT_REPLY',
      { preview: 'Dạ shop nhận rồi ạ …', route: '/chat' },
      { dedupeKey: 'support-reply-c1', dedupeWithinMs: 600000 },
    );
    expect(bridge.send).not.toHaveBeenCalled();
  });

  it('reply: khách vừa đọc vài giây trước vẫn được báo chuông', async () => {
    const { svc, created, notifications } = setup({ conv: { id: 'c1', userId: 'u1', code: 'K7Q2', customerReadAt: new Date(Date.now() - 3_000) } });
    await svc.reply('admin1', 'c1', 'Dạ');
    expect(created).toHaveLength(1);
    expect(notifications.notify).toHaveBeenCalledTimes(1);
  });

  it('reply: hội thoại không có thì 404', async () => {
    const { svc } = setup({ conv: null });
    await expect(svc.reply('a', 'zz', 'x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reply: lỗi thông báo không làm mất tin đã lưu', async () => {
    const { svc, notifications } = setup();
    notifications.notify.mockRejectedValue(new Error('boom'));
    await expect(svc.reply('a', 'c1', 'x')).resolves.toMatchObject({ id: 'm-new' });
  });

  describe('resend', () => {
    it.each(['FAILED', 'UNKNOWN'])('%s → gửi với idempotencyKey = forward.id rồi chốt SENT', async (status) => {
      const { svc, bridge, forwards } = setup({ forwards: [fwd({ status })], messages: [custMsg()] });
      const r = await svc.resend('f1');
      expect(bridge.send).toHaveBeenCalledWith('f1', expect.stringContaining('xin chào'));
      expect(forwards[0]).toMatchObject({ status: 'SENT', zaloMsgId: 'zm1' });
      expect(r).toMatchObject({ id: 'f1', status: 'SENT' });
    });

    it.each(['SENT', 'PENDING'])('%s → 409, không gửi', async (status) => {
      const { svc, bridge } = setup({ forwards: [fwd({ status })], messages: [custMsg()] });
      await expect(svc.resend('f1')).rejects.toBeInstanceOf(ConflictException);
      expect(bridge.send).not.toHaveBeenCalled();
    });

    it('chuyển FAILED/UNKNOWN → PENDING bằng một updateMany có điều kiện trạng thái', async () => {
      const { svc, prisma } = setup({ forwards: [fwd()], messages: [custMsg()] });
      await svc.resend('f1');
      expect(prisma.supportForward.updateMany).toHaveBeenNthCalledWith(1, {
        where: { id: 'f1', OR: [{ status: { in: ['FAILED', 'UNKNOWN'] } }, { status: 'PENDING', zaloMsgId: null, updatedAt: { lt: expect.any(Date) } }] },
        data: { status: 'PENDING' },
      });
    });

    it('không rõ kết quả → UNKNOWN; lỗi thử-lại-được cũng chốt FAILED (đường admin không có BullMQ)', async () => {
      const u = setup({ forwards: [fwd()], messages: [custMsg()], send: { ok: false, retry: false, unknown: true, code: 'TIMEOUT', message: 'hết giờ' } });
      expect(await u.svc.resend('f1')).toMatchObject({ status: 'UNKNOWN' });
      const f = setup({ forwards: [fwd()], messages: [custMsg()], send: { ok: false, retry: true, unknown: false, code: 'NETWORK', message: 'mạng' } });
      expect(await f.svc.resend('f1')).toMatchObject({ status: 'FAILED', lastError: 'NETWORK: mạng' });
    });

    it('PENDING bỏ dở quá 10 phút gửi lại được; PENDING mới thì 409', async () => {
      const stale = setup({ forwards: [fwd({ status: 'PENDING', updatedAt: new Date(Date.now() - 11 * 60_000) })], messages: [custMsg()] });
      expect(await stale.svc.resend('f1')).toMatchObject({ status: 'SENT' });
      const fresh = setup({ forwards: [fwd({ status: 'PENDING', updatedAt: new Date(Date.now() - 2 * 60_000) })], messages: [custMsg()] });
      await expect(fresh.svc.resend('f1')).rejects.toBeInstanceOf(ConflictException);
      expect(fresh.bridge.send).not.toHaveBeenCalled();
    });

    it('đường admin ném lỗi sau khi nhận: chốt FAILED kèm lastError rồi ném tiếp', async () => {
      const { svc, bridge, forwards } = setup({ forwards: [fwd()], messages: [custMsg()] });
      bridge.send.mockRejectedValue(new Error('db sập'));
      await expect(svc.resend('f1')).rejects.toThrow('db sập');
      expect(forwards[0]).toMatchObject({ status: 'FAILED', lastError: 'ADMIN_RESEND: db sập' });
    });

    it('forward bị xoá giữa chừng (P2025): 404', async () => {
      const { svc, prisma, forwards } = setup({ forwards: [fwd()], messages: [custMsg()] });
      prisma.supportForward.update.mockRejectedValue(Object.assign(new Error('gone'), { code: 'P2025' }));
      await expect(svc.resend('f1')).rejects.toBeInstanceOf(NotFoundException);
      expect(forwards[0]!.status).toBe('FAILED');
    });

    it('forward không còn: 404', async () => {
      const { svc } = setup();
      await expect(svc.resend('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('block đặt blockedAt và blockedByUserId; unblock xoá', async () => {
    const { svc, prisma } = setup();
    await svc.block('admin1', 'c1');
    expect(prisma.supportConversation.updateMany).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { blockedAt: expect.any(Date), blockedByUserId: 'admin1' } });
    await svc.unblock('c1');
    expect(prisma.supportConversation.updateMany).toHaveBeenLastCalledWith({ where: { id: 'c1' }, data: { blockedAt: null, blockedByUserId: null } });
  });

  it('block: hội thoại không có thì 404', async () => {
    const { svc } = setup({ conv: null });
    await expect(svc.block('a', 'zz')).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('danh sách hội thoại', () => {
    const where = (svc: any, prisma: any) => prisma.supportConversation.findMany.mock.calls[0][0].where;

    it("q='K7Q2' khớp mã (chữ hoa) hoặc SĐT", async () => {
      const { svc, prisma } = setup();
      await svc.list({ q: 'k7q2' });
      const w = where(svc, prisma);
      expect(w.AND[0].OR).toContainEqual({ code: 'K7Q2' });
    });

    it.each(['#K7Q2', '  #k7q2 ', '#k7q2'])("q=%j có dấu # đầu vẫn khớp mã K7Q2", async (q) => {
      const { svc, prisma } = setup();
      await svc.list({ q });
      expect(where(svc, prisma).AND[0].OR).toContainEqual({ code: 'K7Q2' });
    });

    it("q='0901' khớp SĐT người dùng theo cách ô tìm người dùng đang làm, không khớp mã", async () => {
      const { svc, prisma } = setup();
      await svc.list({ q: '0901' });
      const w = where(svc, prisma);
      expect(w.AND[0].OR).toContainEqual({ user: { phone: { contains: '0901' } } });
      expect(w.AND[0].OR).not.toContainEqual({ code: '0901' });
    });

    it('filter=unforwarded dùng điều kiện chung với ops inbox', async () => {
      const { svc, prisma } = setup();
      await svc.list({ filter: 'unforwarded' });
      const w = where(svc, prisma);
      expect(JSON.stringify(w)).toContain('"status":{"in":["FAILED","UNKNOWN"]}');
      expect(JSON.stringify(w)).toContain('"forwardId":null');
    });

    it('trả nextCursor khi còn trang sau và đủ thông tin dòng, có SĐT đầy đủ', async () => {
      const { svc, prisma } = setup();
      const rows = Array.from({ length: 31 }, (_, i) => ({ id: `c${i}`, code: 'AAAA', blockedAt: null, lastMessageAt: new Date(), user: { id: 'u', fullName: 'Lan', phone: '0901234234' }, messages: [{ body: 'hi', sender: 'CUSTOMER', imageUrl: null }], forwards: [] }));
      prisma.supportConversation.findMany.mockResolvedValueOnce(rows).mockResolvedValueOnce([{ id: 'c1' }]);
      const r = await svc.list({});
      const flagQuery = prisma.supportConversation.findMany.mock.calls[1][0];
      expect(flagQuery.where.AND[1].blockedAt).toBeNull();
      expect(JSON.stringify(flagQuery.where.AND[1])).toContain('"status":"PENDING"');
      expect(r.items).toHaveLength(30);
      expect(r.nextCursor).toBe('c29');
      expect(r.items[0]).toMatchObject({ id: 'c0', code: 'AAAA', blocked: false, user: { phone: '0901234234' }, lastMessage: { body: 'hi' }, needsAttention: false });
      expect(r.items[1]).toMatchObject({ id: 'c1', needsAttention: true });
    });
  });

  describe('chi tiết hội thoại', () => {
    it('kèm staffName, adminUserId và trạng thái chuyển; forward đã bị retention xoá thì không có trạng thái, không ném lỗi', async () => {
      const { svc } = setup({
        forwards: [fwd({ id: 'f1', status: 'SENT' })],
        messages: [
          custMsg({ id: 'm1', forwardId: 'f1' }),
          custMsg({ id: 'm2', forwardId: 'f-gone' }),
          { id: 'm3', conversationId: 'c1', sender: 'STAFF', source: 'ADMIN', body: 'ok', staffName: null, adminUserId: 'admin1', forwardId: null, createdAt: new Date('2026-10-23T09:05:00Z') },
          { id: 'm4', conversationId: 'c1', sender: 'STAFF', source: 'ZALO', body: 'dạ', staffName: 'Hoa', adminUserId: null, forwardId: null, createdAt: new Date('2026-10-23T09:06:00Z') },
        ],
      });
      const r = await svc.get('c1');
      const by = (id: string) => r.messages.find((m: any) => m.id === id)!;
      expect(by('m1').forward).toMatchObject({ id: 'f1', status: 'SENT' });
      expect(by('m2').forward).toBeNull();
      expect(by('m3')).toMatchObject({ adminUserId: 'admin1', staffName: null });
      expect(by('m4')).toMatchObject({ staffName: 'Hoa' });
      expect(r.user).toMatchObject({ phone: '0901234234' });
    });

    it('forward.resendable: FAILED/UNKNOWN và PENDING bỏ dở quá 10 phút là true; SENT, PENDING mới, PENDING đã có zaloMsgId là false', async () => {
      const old = new Date(Date.now() - 11 * 60_000);
      const { svc } = setup({
        forwards: [
          fwd({ id: 'fF', status: 'FAILED' }),
          fwd({ id: 'fU', status: 'UNKNOWN' }),
          fwd({ id: 'fS', status: 'SENT', zaloMsgId: 'z1' }),
          fwd({ id: 'fPold', status: 'PENDING', updatedAt: old }),
          fwd({ id: 'fPnew', status: 'PENDING', updatedAt: new Date() }),
          fwd({ id: 'fPid', status: 'PENDING', updatedAt: old, zaloMsgId: 'z2' }),
        ],
        messages: ['fF', 'fU', 'fS', 'fPold', 'fPnew', 'fPid'].map((id) => custMsg({ id: `m-${id}`, forwardId: id })),
      });
      const r = await svc.get('c1');
      const flag = (id: string) => (r.messages.find((m: any) => m.id === `m-${id}`) as any).forward.resendable;
      expect(['fF', 'fU', 'fS', 'fPold', 'fPnew', 'fPid'].map(flag)).toEqual([true, true, false, true, false, false]);
    });

    it('forward.resendable: PENDING đúng 10 phút tuổi vẫn false (so sánh nghiêm ngặt)', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-10-23T12:00:00Z'));
      try {
        const { svc } = setup({
          forwards: [fwd({ id: 'fE', status: 'PENDING', updatedAt: new Date('2026-10-23T11:50:00Z') })],
          messages: [custMsg({ id: 'm-fE', forwardId: 'fE' })],
        });
        const r = await svc.get('c1');
        expect((r.messages[0] as any).forward.resendable).toBe(false);
      } finally {
        jest.useRealTimers();
      }
    });

    it('truncated: true khi hội thoại có hơn 500 tin, chỉ trả 500 tin mới nhất', async () => {
      const many = Array.from({ length: 501 }, (_, i) => custMsg({ id: `m${i}`, forwardId: null, createdAt: new Date(Date.UTC(2026, 9, 23, 0, 0, 0) - i * 1000) }));
      const { svc, prisma } = setup({ messages: many });
      const r = await svc.get('c1');
      expect(prisma.supportMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 501 }));
      expect(r.truncated).toBe(true);
      expect(r.messages).toHaveLength(500);
      expect(r.messages[r.messages.length - 1]!.id).toBe('m0');
    });

    it('truncated: false khi đúng 500 tin', async () => {
      const exact = Array.from({ length: 500 }, (_, i) => custMsg({ id: `m${i}`, forwardId: null }));
      const { svc } = setup({ messages: exact });
      const r = await svc.get('c1');
      expect(r.truncated).toBe(false);
      expect(r.messages).toHaveLength(500);
    });

    it('không có hội thoại: 404', async () => {
      const { svc } = setup({ conv: null });
      await expect(svc.get('zz')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it.each([['qrStart', 'QR_START'], ['logout', 'LOGOUT'], ['reconnect', 'RECONNECT']] as const)('%s ghi sổ có adminUserId rồi gọi cầu nối', async (m, action) => {
    const { svc, prisma, bridge } = setup();
    await (svc as any)[m]('admin1');
    expect(prisma.supportBridgeAction.create).toHaveBeenCalledWith({ data: { action, adminUserId: 'admin1' } });
    expect(bridge[m]).toHaveBeenCalled();
  });

  it('cầu nối lỗi thì trả lỗi có mã, vẫn đã ghi sổ', async () => {
    const { svc, bridge, prisma } = setup();
    bridge.logout.mockResolvedValue({ ok: false, retry: false, unknown: false, code: 'HTTP_500', message: 'hỏng' });
    await expect(svc.logout('admin1')).rejects.toMatchObject({ response: { code: 'HTTP_500' } });
    expect(prisma.supportBridgeAction.create).toHaveBeenCalled();
  });

  it('trạng thái cầu nối kèm groupId và enabled', async () => {
    const { svc } = setup();
    expect(await svc.bridgeStatus()).toMatchObject({ state: 'CONNECTED', groupId: 'G1', enabled: true, displayName: 'CSKH' });
  });

  it('test gửi tin thử qua cầu nối', async () => {
    const { svc, bridge } = setup();
    await svc.test();
    expect(bridge.send).toHaveBeenCalledWith(expect.stringMatching(/^test-/), expect.stringMatching(/^Tin thử từ Tubu Tree lúc \d\d:\d\d\.$/));
  });
});
