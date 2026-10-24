import { BridgeEventsService, replyPreview } from './bridge-events.service';

type Ev = Parameters<BridgeEventsService['handle']>[0];

const msg = (o: Record<string, unknown> = {}): Ev =>
  ({ type: 'message', groupId: 'g1', msgId: 'z100', cliMsgId: 'c100', uidFrom: 'u9', dName: 'Hoa CSKH', isSelf: false, ts: 1, text: 'Dạ vâng', imageUrl: null, quote: null, ...o }) as Ev;

function setup(opts: { staffMsgs?: any[]; forwards?: any[]; convs?: any[]; createError?: unknown; blocked?: boolean; bridge?: any } = {}) {
  const convs = opts.convs ?? [{ id: 'c1', userId: 'u1', code: 'K7Q2', blockedAt: opts.blocked ? new Date() : null }];
  const forwards = opts.forwards ?? [];
  const created: any[] = [];
  const prisma: any = {
    supportForward: {
      findUnique: jest.fn().mockImplementation(({ where }: any) => Promise.resolve(forwards.find((f) => f.zaloMsgId === where.zaloMsgId) ?? null)),
      findFirst: jest.fn().mockImplementation(({ where }: any) =>
        Promise.resolve(forwards.find((f) => f.status === where.status && f.zaloMsgId === null && f.createdAt >= where.createdAt.gte) ?? null)),
    },
    supportConversation: {
      findUnique: jest.fn().mockImplementation(({ where }: any) => Promise.resolve(convs.find((c) => (where.id ? c.id === where.id : c.code === where.code)) ?? null)),
      update: jest.fn().mockResolvedValue({}),
    },
    supportMessage: {
      create: jest.fn().mockImplementation(({ data }: any) => {
        if (opts.createError) return Promise.reject(opts.createError);
        created.push(data);
        return Promise.resolve({ id: `m${created.length}`, createdAt: new Date(), ...data });
      }),
      findUnique: jest.fn().mockImplementation(({ where }: any) =>
        Promise.resolve((opts.staffMsgs ?? []).find((m) => m.zaloMsgId === where.zaloMsgId && (!where.sender || (m.sender ?? 'STAFF') === where.sender)) ?? null)),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    supportBridgeStatus: { findUnique: jest.fn().mockResolvedValue(opts.bridge ?? null), upsert: jest.fn().mockResolvedValue({}) },
  };
  const notifications: any = { notify: jest.fn().mockResolvedValue(undefined) };
  const svc = new BridgeEventsService(prisma, notifications);
  return { svc, prisma, notifications, created };
}

const fwd = (o: Record<string, unknown> = {}) => ({ id: 'f1', conversationId: 'c1', status: 'SENT', zaloMsgId: 'zf1', createdAt: new Date(), ...o });
const quoteF1 = { globalMsgId: 'zf1', cliMsgId: '1', text: null };

describe('BridgeEventsService.handle message', () => {
  it('msgId trùng zaloMsgId của forward thì bỏ', async () => {
    const { svc, created } = setup({ forwards: [fwd({ zaloMsgId: 'z100' })] });
    expect(await svc.handle(msg({ quote: quoteF1 }))).toEqual({ status: 200, body: { ok: true } });
    expect(created).toHaveLength(0);
  });

  it('isSelf mà đầu tin chuyển thì bỏ', async () => {
    const { svc, created } = setup({ forwards: [fwd()] });
    await svc.handle(msg({ isSelf: true, text: '#K7Q2 · Lan · 09••••234\n—\nhi', quote: quoteF1 }));
    expect(created).toHaveLength(0);
  });

  it('isSelf, nội dung thường, có trích tin chuyển: thành tin STAFF', async () => {
    const { svc, created } = setup({ forwards: [fwd()] });
    await svc.handle(msg({ isSelf: true, text: 'Dạ em kiểm tra ạ', quote: quoteF1 }));
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ conversationId: 'c1', sender: 'STAFF', source: 'ZALO', body: 'Dạ em kiểm tra ạ', zaloMsgId: 'z100', staffName: 'Hoa CSKH' });
  });

  const HEADER = '#K7Q2 · Lan · 09••••234\n—\nxin chào';

  it('trích forward UNKNOWN (chưa có zaloMsgId) mà tin trích có đầu tin chuyển: STAFF đúng hội thoại, không 503', async () => {
    const { svc, created } = setup({ forwards: [fwd({ status: 'UNKNOWN', zaloMsgId: null })] });
    const r = await svc.handle(msg({ text: 'Dạ em kiểm tra', quote: { globalMsgId: 'moi-ve', cliMsgId: '1', text: HEADER } }));
    expect(r).toEqual({ status: 200, body: { ok: true } });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ conversationId: 'c1', body: 'Dạ em kiểm tra' });
  });

  it('trích câu trả lời STAFF cũ: cùng hội thoại', async () => {
    const { svc, created } = setup({ staffMsgs: [{ zaloMsgId: 'zstaff', conversationId: 'c1' }] });
    await svc.handle(msg({ text: 'Thêm nữa ạ', quote: { globalMsgId: 'zstaff', cliMsgId: '1', text: 'Dạ vâng' } }));
    expect(created[0]).toMatchObject({ conversationId: 'c1', body: 'Thêm nữa ạ' });
  });

  it('tin trích không phải đầu tin chuyển và không có mã: giữ hành vi cũ (bỏ, hoặc 503 khi còn PENDING)', async () => {
    const quote = { globalMsgId: 'chua-co', cliMsgId: '1', text: 'một câu bình thường' };
    const a = setup();
    expect(await a.svc.handle(msg({ quote }))).toEqual({ status: 200, body: { ok: true } });
    expect(a.created).toHaveLength(0);
    const b = setup({ forwards: [fwd({ status: 'PENDING', zaloMsgId: null })] });
    expect((await b.svc.handle(msg({ quote }))).status).toBe(503);
  });

  it('forward khớp nhưng hội thoại đã xoá: 200 bỏ, không 503 dù còn forward PENDING khác', async () => {
    const { svc, created } = setup({
      convs: [],
      forwards: [fwd({ conversationId: 'gone' }), fwd({ id: 'f2', status: 'PENDING', zaloMsgId: null })],
    });
    expect(await svc.handle(msg({ quote: quoteF1 }))).toEqual({ status: 200, body: { ok: true } });
    expect(created).toHaveLength(0);
  });

  it('trích tin chuyển hôm trước khớp đúng hội thoại', async () => {
    const { svc, created } = setup({
      convs: [{ id: 'c1', userId: 'u1', code: 'AAAA', blockedAt: null }, { id: 'c2', userId: 'u2', code: 'BBBB', blockedAt: null }],
      forwards: [fwd({ conversationId: 'c2', zaloMsgId: 'zold', createdAt: new Date(Date.now() - 86_400_000) })],
    });
    await svc.handle(msg({ quote: { globalMsgId: 'zold', cliMsgId: '1', text: null } }));
    expect(created[0].conversationId).toBe('c2');
  });

  it('mã đầu câu không phân biệt hoa thường, bỏ mã khỏi nội dung', async () => {
    const { svc, created } = setup();
    await svc.handle(msg({ text: '#k7q2 Dạ đơn giao chiều nay' }));
    expect(created[0]).toMatchObject({ conversationId: 'c1', body: 'Dạ đơn giao chiều nay' });
  });

  describe('trích tin một khách nhưng ghi mã khách khác', () => {
    const two = {
      convs: [{ id: 'c1', userId: 'u1', code: 'AAAA', blockedAt: null }, { id: 'c2', userId: 'u2', code: 'BBBB', blockedAt: null }],
      forwards: [fwd({ conversationId: 'c1', zaloMsgId: 'zA' })],
    };
    const quoteA = { globalMsgId: 'zA', cliMsgId: '1', text: null };

    it('mã khác hội thoại được trích (dù mã đó có thật): không gửi cho ai, trả conflict', async () => {
      const { svc, created, notifications } = setup(two);
      expect(await svc.handle(msg({ text: '#BBBB Dạ đơn giao chiều nay', quote: quoteA }))).toEqual({
        status: 200,
        body: { ok: true, conflict: { routed: 'AAAA', typed: 'BBBB' } },
      });
      expect(created).toHaveLength(0);
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('mã khác và không tồn tại cũng là conflict, không rơi về unknownCode', async () => {
      const { svc, created } = setup(two);
      expect(await svc.handle(msg({ text: '#zzzz hi', quote: quoteA }))).toEqual({
        status: 200,
        body: { ok: true, conflict: { routed: 'AAAA', typed: 'ZZZZ' } },
      });
      expect(created).toHaveLength(0);
    });

    it('mã trùng hội thoại được trích (khác hoa thường): gửi cho khách đó, bỏ mã khỏi nội dung', async () => {
      const { svc, created } = setup(two);
      expect(await svc.handle(msg({ text: '#aaaa Dạ ạ', quote: quoteA }))).toEqual({ status: 200, body: { ok: true } });
      expect(created[0]).toMatchObject({ conversationId: 'c1', body: 'Dạ ạ' });
    });

    it('trích câu trả lời STAFF cũ của khách này mà ghi mã khách kia: conflict', async () => {
      const { svc, created } = setup({ ...two, forwards: [], staffMsgs: [{ zaloMsgId: 'zs', conversationId: 'c1', sender: 'STAFF' }] });
      const r = await svc.handle(msg({ text: '#BBBB hi', quote: { globalMsgId: 'zs', cliMsgId: '1', text: 'x' } }));
      expect(r.body).toEqual({ ok: true, conflict: { routed: 'AAAA', typed: 'BBBB' } });
      expect(created).toHaveLength(0);
    });
  });

  it('tìm tin được trích chỉ trong tin STAFF, bỏ qua hàng của khách', async () => {
    const { svc, created, prisma } = setup({ staffMsgs: [{ zaloMsgId: 'zcust', conversationId: 'c1', sender: 'CUSTOMER' }] });
    expect(await svc.handle(msg({ text: 'Dạ', quote: { globalMsgId: 'zcust', cliMsgId: '1', text: 'x' } }))).toEqual({ status: 200, body: { ok: true } });
    expect(created).toHaveLength(0);
    expect(prisma.supportMessage.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { zaloMsgId: 'zcust', sender: 'STAFF' } }));
  });

  it('khách vừa đọc vài giây trước vẫn được báo chuông', async () => {
    const { svc, created, notifications } = setup({ convs: [{ id: 'c1', userId: 'u1', code: 'K7Q2', blockedAt: null, customerReadAt: new Date(Date.now() - 3_000) }] });
    await svc.handle(msg({ text: '#K7Q2 hi' }));
    expect(created).toHaveLength(1);
    expect(notifications.notify).toHaveBeenCalledTimes(1);
  });

  it('mã không tồn tại: 200 kèm unknownCode, không tạo tin', async () => {
    const { svc, created } = setup();
    expect(await svc.handle(msg({ text: '#K7Q3 alo' }))).toEqual({ status: 200, body: { ok: true, unknownCode: 'K7Q3' } });
    expect(created).toHaveLength(0);
  });

  it('câu thường, không trích, không mã: bỏ', async () => {
    const { svc, created } = setup();
    expect(await svc.handle(msg())).toEqual({ status: 200, body: { ok: true } });
    expect(created).toHaveLength(0);
  });

  it('trích chưa khớp mà còn forward PENDING chưa có zaloMsgId trong 5 phút: 503', async () => {
    const { svc, created } = setup({ forwards: [fwd({ status: 'PENDING', zaloMsgId: null, createdAt: new Date(Date.now() - 60_000) })] });
    expect(await svc.handle(msg({ quote: { globalMsgId: 'chua-co', cliMsgId: '1', text: null } }))).toEqual({ status: 503, body: { retry: true } });
    expect(created).toHaveLength(0);
  });

  it('forward PENDING quá 5 phút: bỏ, 200', async () => {
    const { svc } = setup({ forwards: [fwd({ status: 'PENDING', zaloMsgId: null, createdAt: new Date(Date.now() - 6 * 60_000) })] });
    expect(await svc.handle(msg({ quote: { globalMsgId: 'chua-co', cliMsgId: '1', text: null } }))).toEqual({ status: 200, body: { ok: true } });
  });

  it('không có trích thì không 503 dù còn forward PENDING', async () => {
    const { svc } = setup({ forwards: [fwd({ status: 'PENDING', zaloMsgId: null })] });
    expect((await svc.handle(msg())).status).toBe(200);
  });

  it('trùng msgId (P2002) bỏ êm: 200, không báo chuông', async () => {
    const { svc, notifications } = setup({ forwards: [fwd()], createError: { code: 'P2002' } });
    expect(await svc.handle(msg({ quote: quoteF1 }))).toEqual({ status: 200, body: { ok: true } });
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('lỗi DB khác thì ném để cầu nối gửi lại', async () => {
    const { svc } = setup({ forwards: [fwd()], createError: new Error('db down') });
    await expect(svc.handle(msg({ quote: quoteF1 }))).rejects.toThrow('db down');
  });

  it('hội thoại bị chặn vẫn nhận tin STAFF', async () => {
    const { svc, created } = setup({ blocked: true, forwards: [fwd()] });
    await svc.handle(msg({ quote: quoteF1 }));
    expect(created).toHaveLength(1);
  });

  it('hội thoại đã mất (khách xoá): bỏ êm 200', async () => {
    const { svc, created } = setup({ convs: [], forwards: [fwd()] });
    expect(await svc.handle(msg({ quote: quoteF1 }))).toEqual({ status: 200, body: { ok: true } });
    expect(created).toHaveLength(0);
  });

  it('ảnh kèm chú thích: một tin STAFF giữ cả hai', async () => {
    const { svc, created } = setup();
    await svc.handle(msg({ text: '#K7Q2 Đây ạ', imageUrl: 'https://cdn.zalo/x.jpg' }));
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ body: 'Đây ạ', imageUrl: 'https://cdn.zalo/x.jpg' });
  });

  it('chỉ có mã, không chữ không ảnh: không tạo tin', async () => {
    const { svc, created } = setup();
    await svc.handle(msg({ text: '#K7Q2' }));
    expect(created).toHaveLength(0);
  });

  it('createdAt do DB đặt, không lấy ts của Zalo', async () => {
    const { svc, created } = setup();
    await svc.handle(msg({ text: '#K7Q2 hi', ts: 12345 }));
    expect(created[0]).not.toHaveProperty('createdAt');
  });

  it('tin STAFF mới báo chuông gộp 10 phút, preview <= 60 ký tự', async () => {
    const { svc, notifications } = setup();
    await svc.handle(msg({ text: `#K7Q2 ${'a'.repeat(200)}` }));
    const [userId, code, data, opts] = notifications.notify.mock.calls[0];
    expect([userId, code, opts]).toEqual(['u1', 'SUPPORT_CHAT_REPLY', { dedupeKey: 'support-reply-c1', dedupeWithinMs: 600000 }]);
    expect(data.route).toBe('/chat');
    expect(data.preview.length).toBeLessThanOrEqual(60);
  });

  it('lỗi báo chuông không làm hỏng tin đã lưu', async () => {
    const { svc, notifications } = setup();
    notifications.notify.mockRejectedValue(new Error('x'));
    expect((await svc.handle(msg({ text: '#K7Q2 hi' }))).status).toBe(200);
  });
});

describe('replyPreview', () => {
  it('ảnh không chữ: câu trung tính', () => {
    expect(replyPreview('', 'https://x/y.jpg')).toBe('Ảnh từ Tubu Tree');
  });
  it('cắt theo ký tự: emoji ở ranh giới không bị chẻ đôi', () => {
    const p = replyPreview(`${'a'.repeat(58)}😀😀😀`, null);
    expect(Array.from(p)).toHaveLength(60);
    expect(p).toBe(`${'a'.repeat(58)}😀…`);
    expect(p).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
  it('không lộ số điện thoại, gộp khoảng trắng, cắt 60', () => {
    expect(replyPreview('Gọi 0901 234 567 nhé', null)).not.toMatch(/\d{4}/);
    expect(replyPreview('x '.repeat(100), null).length).toBeLessThanOrEqual(60);
  });
});

describe('BridgeEventsService.handle undo và state', () => {
  it('undo đặt recalledAt cho tin STAFF có zaloMsgId', async () => {
    const { svc, prisma } = setup();
    expect(await svc.handle({ type: 'undo', groupId: 'g1', msgId: 'z100' })).toEqual({ status: 200, body: { ok: true } });
    expect(prisma.supportMessage.updateMany).toHaveBeenCalledWith({
      where: { zaloMsgId: 'z100', sender: 'STAFF', recalledAt: null },
      data: { recalledAt: expect.any(Date) },
    });
  });

  const state = (s: string, since = '2026-10-23T01:00:00.000Z') =>
    ({ type: 'state', state: s, since, lastError: null, zaloUid: '1', displayName: 'Bot' }) as Ev;

  it('state lần đầu: tạo dòng main với since của sự kiện', async () => {
    const { svc, prisma } = setup();
    await svc.handle(state('CONNECTED'));
    const arg = prisma.supportBridgeStatus.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'main' });
    expect(arg.create).toMatchObject({ id: 'main', state: 'CONNECTED', since: new Date('2026-10-23T01:00:00.000Z') });
  });

  it('state không đổi: giữ since cũ', async () => {
    const old = new Date('2026-10-22T00:00:00.000Z');
    const { svc, prisma } = setup({ bridge: { id: 'main', state: 'CONNECTED', since: old } });
    await svc.handle(state('CONNECTED'));
    expect(prisma.supportBridgeStatus.upsert.mock.calls[0][0].update.since).toEqual(old);
  });

  it('state đổi: since lấy từ sự kiện', async () => {
    const { svc, prisma } = setup({ bridge: { id: 'main', state: 'CONNECTED', since: new Date('2026-10-22T00:00:00.000Z') } });
    await svc.handle(state('NEED_QR'));
    expect(prisma.supportBridgeStatus.upsert.mock.calls[0][0].update.since).toEqual(new Date('2026-10-23T01:00:00.000Z'));
  });
});
