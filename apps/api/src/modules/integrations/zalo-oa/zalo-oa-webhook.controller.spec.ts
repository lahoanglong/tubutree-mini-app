import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { Logger, UnauthorizedException } from '@nestjs/common';
import { ZaloOaWebhookController, zaloOaEventSignature } from './zalo-oa-webhook.controller';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { Queue } from 'bullmq';
import { QUEUE_COMMAND_TIMEOUT_MS } from '../../../jobs/queue-timeout';

const SECRET = 'zalo-oa-webhook-secret';
const body = { event_name: 'user_send_text', sender: { id: 'zalo-u1' }, message: { text: 'Ship bao lâu?', msg_id: 'm1' } };
const DUP_ERR = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' });

function makeController(secret: string, createImpl?: jest.Mock) {
  const create = createImpl ?? jest.fn().mockResolvedValue({ id: 'evt1' });
  const add = jest.fn().mockResolvedValue(undefined);
  const prisma = { oaInboundMessage: { create } } as unknown as PrismaService;
  const queue = { add } as unknown as Queue;
  const config = { get: (k: string) => (k === 'ZALO_OA_WEBHOOK_SECRET' ? secret : '') } as never;
  return { ctrl: new ZaloOaWebhookController(prisma, config, queue), create, add };
}

describe('ZaloOaWebhookController.handle (verify token tĩnh)', () => {
  it('secret cấu hình + token đúng → lưu event RECEIVED + enqueue', async () => {
    const { ctrl, create, add } = makeController(SECRET);
    const r = await ctrl.handle(body, SECRET);
    expect(r).toEqual({ received: true });
    expect(create.mock.calls[0][0].data).toMatchObject({ zaloUserId: 'zalo-u1', msgId: 'm1', messageText: 'Ship bao lâu?' });
    expect(add).toHaveBeenCalledWith('process', { eventId: 'evt1' }, { jobId: 'evt1' });
  });

  it('Redis mất kết nối (add treo) → vẫn trả 200 sau hạn chờ thay vì treo webhook', async () => {
    jest.useFakeTimers();
    try {
      const { ctrl, add } = makeController(SECRET);
      add.mockReturnValueOnce(new Promise(() => undefined));
      const res = ctrl.handle(body, SECRET);
      await jest.advanceTimersByTimeAsync(QUEUE_COMMAND_TIMEOUT_MS);
      await expect(res).resolves.toEqual({ received: true });
    } finally {
      jest.useRealTimers();
    }
  });

  it('msg_id trùng (Zalo gửi lại/retry) → P2002 → trả received:true, KHÔNG enqueue lại', async () => {
    const create = jest.fn().mockRejectedValue(DUP_ERR);
    const { ctrl, add } = makeController(SECRET, create);
    const r = await ctrl.handle(body, SECRET);
    expect(r).toEqual({ received: true });
    expect(add).not.toHaveBeenCalled();
  });

  it('create lỗi KHÁC P2002 → ném lỗi ra ngoài (không nuốt lỗi hạ tầng thật)', async () => {
    const create = jest.fn().mockRejectedValue(new Error('DB down'));
    const { ctrl } = makeController(SECRET, create);
    await expect(ctrl.handle(body, SECRET)).rejects.toThrow('DB down');
  });

  it('secret cấu hình + token SAI → 401, không lưu/enqueue', async () => {
    const { ctrl, create, add } = makeController(SECRET);
    await expect(ctrl.handle(body, 'sai-token')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(create).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it('secret cấu hình + thiếu token → 401', async () => {
    const { ctrl, create } = makeController(SECRET);
    await expect(ctrl.handle(body, undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(create).not.toHaveBeenCalled();
  });

  it('chưa cấu hình secret (dev) → bỏ qua verify, vẫn xử lý', async () => {
    const { ctrl, create } = makeController('');
    await ctrl.handle(body, undefined);
    expect(create).toHaveBeenCalled();
  });

  it('sự kiện OA tự gửi (oa_send_text, sender là chính OA) → 200, không lưu, không enqueue', async () => {
    const { ctrl, create, add } = makeController(SECRET);
    const r = await ctrl.handle({ ...body, event_name: 'oa_send_text', sender: { id: 'oa-id' } }, SECRET);
    expect(r).toEqual({ received: true });
    expect(create).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it('thiếu event_name hoặc không phải tin khách gửi (follow, user_submit_info) → 200, không lưu', async () => {
    const { ctrl, create, add } = makeController(SECRET);
    for (const ev of [undefined, '', 'follow', 'user_submit_info', 'oa_send_image']) {
      await expect(ctrl.handle({ ...body, event_name: ev }, SECRET)).resolves.toEqual({ received: true });
    }
    expect(create).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it('mọi loại tin khách gửi (user_send_image, user_send_sticker...) vẫn được lưu', async () => {
    const { ctrl, create } = makeController(SECRET);
    for (const ev of ['user_send_text', 'user_send_image', 'user_send_sticker']) await ctrl.handle({ ...body, event_name: ev, message: { msg_id: ev } }, SECRET);
    expect(create).toHaveBeenCalledTimes(3);
  });

  it('sự kiện lạ vẫn bị 401 nếu token sai (lọc sau khi xác thực)', async () => {
    const { ctrl } = makeController(SECRET);
    await expect(ctrl.handle({ ...body, event_name: 'oa_send_text' }, 'sai-token')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('tin khách gửi nhưng thiếu sender.id → bỏ qua êm, không lưu/enqueue', async () => {
    const { ctrl, create, add } = makeController(SECRET);
    const r = await ctrl.handle({ event_name: 'user_send_text' }, SECRET);
    expect(r).toEqual({ received: true });
    expect(create).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });
});

describe('ZaloOaWebhookController.handle (kiểu trường không đúng)', () => {
  const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  beforeEach(() => warn.mockClear());
  afterAll(() => warn.mockRestore());

  it('sender.id là số → đổi thành chuỗi, lưu bình thường (không 500)', async () => {
    const { ctrl, create, add } = makeController(SECRET);
    const payload = { event_name: 'user_send_text', sender: { id: 123 }, timestamp: Date.now() } as never;
    await expect(ctrl.handle(payload, SECRET)).resolves.toEqual({ received: true });
    expect(create.mock.calls[0][0].data).toMatchObject({ zaloUserId: '123', messageText: null });
    expect(add).toHaveBeenCalledTimes(1);
  });

  it('msg_id và text là số → thành chuỗi', async () => {
    const { ctrl, create } = makeController(SECRET);
    await ctrl.handle({ ...body, message: { msg_id: 456, text: 789 } } as never, SECRET);
    expect(create.mock.calls[0][0].data).toMatchObject({ msgId: '456', messageText: '789' });
  });

  it('sender.id và msg_id đúng ngưỡng số nguyên an toàn (2^53 - 1) vẫn được nhận nguyên vẹn', async () => {
    const { ctrl, create } = makeController(SECRET);
    await ctrl.handle({ ...body, sender: { id: Number.MAX_SAFE_INTEGER }, message: { msg_id: Number.MAX_SAFE_INTEGER } } as never, SECRET);
    expect(create.mock.calls[0][0].data).toMatchObject({ zaloUserId: '9007199254740991', msgId: '9007199254740991' });
  });

  it.each([
    ['sender.id là object', { ...body, sender: { id: { a: 1 } } }],
    ['sender.id là mảng', { ...body, sender: { id: ['x'] } }],
    ['sender.id là boolean', { ...body, sender: { id: true } }],
    ['msg_id là object', { ...body, message: { ...body.message, msg_id: { a: 1 } } }],
    ['msg_id là mảng', { ...body, message: { ...body.message, msg_id: [1] } }],
    ['msg_id là boolean', { ...body, message: { ...body.message, msg_id: false } }],
    ['text là object', { ...body, message: { ...body.message, text: { a: 1 } } }],
    ['text là mảng', { ...body, message: { ...body.message, text: ['a'] } }],
    ['text là boolean', { ...body, message: { ...body.message, text: true } }],
    // JSON.parse làm tròn số nguyên vượt 2^53 (246845883529197922 → 246845883529197920): lưu chuỗi đó là lưu một id khác.
    ['sender.id là số nguyên vượt 2^53', { ...body, sender: JSON.parse('{"id":246845883529197922}') }],
    ['msg_id là số nguyên vượt 2^53', { ...body, message: { ...body.message, msg_id: JSON.parse('246845883529197922') } }],
    ['sender.id là số thập phân', { ...body, sender: { id: 1.5 } }],
    ['msg_id là số thập phân', { ...body, message: { ...body.message, msg_id: 1.5 } }],
    ['timestamp là object', { ...body, timestamp: { a: 1 } }],
    ['timestamp là mảng', { ...body, timestamp: [1] }],
    ['timestamp là boolean', { ...body, timestamp: true }],
  ])('%s → bỏ qua sự kiện, trả 200, ghi cảnh báo, không lưu/enqueue', async (_name, payload) => {
    const { ctrl, create, add } = makeController(SECRET);
    await expect(ctrl.handle(payload as never, SECRET)).resolves.toEqual({ received: true });
    expect(create).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('tin thiếu msg_id: khoá chống trùng là sha256 ổn định của sender.id + timestamp + text', async () => {
    const { ctrl, create } = makeController(SECRET);
    const payload = { event_name: 'user_send_text', sender: { id: 'zalo-u1' }, message: { text: 'Chào' }, timestamp: '1700000000000' };
    await ctrl.handle(payload, SECRET);
    await ctrl.handle({ ...payload }, SECRET);
    const [first, second] = create.mock.calls.map((c) => c[0].data.msgId);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toBe(first);
    await ctrl.handle({ ...payload, message: { text: 'Khác' } }, SECRET);
    await ctrl.handle({ ...payload, timestamp: '1700000000001' }, SECRET);
    await ctrl.handle({ ...payload, sender: { id: 'zalo-u2' } }, SECRET);
    const keys = new Set(create.mock.calls.map((c) => c[0].data.msgId));
    expect(keys.size).toBe(4);
  });

  it('tin thiếu cả msg_id lẫn timestamp: không có khoá băm (msgId null), hai tin cùng người cùng chữ ở hai lúc khác nhau đều được xử lý', async () => {
    const seen = new Set<string>();
    const create = jest.fn().mockImplementation(async ({ data }: { data: { msgId: string | null } }) => {
      if (data.msgId && seen.has(data.msgId)) throw DUP_ERR;
      if (data.msgId) seen.add(data.msgId);
      return { id: 'evt1' };
    });
    const { ctrl, add } = makeController(SECRET, create);
    const payload = { event_name: 'user_send_text', sender: { id: 'zalo-u1' }, message: { text: 'giá' } };
    await ctrl.handle(payload, SECRET);
    await ctrl.handle({ ...payload }, SECRET);
    expect(create.mock.calls.map((c) => c[0].data.msgId)).toEqual([null, null]);
    expect(add).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['timestamp rỗng', ''],
    ['timestamp toàn khoảng trắng', '  '],
    ['timestamp không phải số', 'không-phải-số'],
  ])('%s → coi như thiếu timestamp: msgId null, không băm chữ gốc làm khoá', async (_name, timestamp) => {
    const { ctrl, create } = makeController(SECRET);
    await ctrl.handle({ event_name: 'user_send_text', sender: { id: 'zalo-u1' }, message: { text: 'giá', msg_id: '' }, timestamp } as never, SECRET);
    expect(create.mock.calls[0][0].data.msgId).toBeNull();
  });

  it('msg_id rỗng nhưng có timestamp hợp lệ → vẫn dùng khoá băm', async () => {
    const { ctrl, create } = makeController(SECRET);
    await ctrl.handle({ event_name: 'user_send_text', sender: { id: 'zalo-u1' }, message: { text: 'giá', msg_id: '' }, timestamp: '1700000000000' }, SECRET);
    expect(create.mock.calls[0][0].data.msgId).toMatch(/^[0-9a-f]{64}$/);
  });

  it('gửi trùng tin không msg_id hai lần → lần hai đụng P2002, enqueue đúng một lần', async () => {
    const seen = new Set<string>();
    const create = jest.fn().mockImplementation(async ({ data }: { data: { msgId: string | null } }) => {
      if (data.msgId && seen.has(data.msgId)) throw DUP_ERR;
      if (data.msgId) seen.add(data.msgId);
      return { id: 'evt1' };
    });
    const { ctrl, add } = makeController(SECRET, create);
    const payload = { event_name: 'user_send_text', sender: { id: 123 }, timestamp: 1700000000000 } as never;
    await expect(ctrl.handle(payload, SECRET)).resolves.toEqual({ received: true });
    await expect(ctrl.handle(payload, SECRET)).resolves.toEqual({ received: true });
    expect(create).toHaveBeenCalledTimes(2);
    expect(add).toHaveBeenCalledTimes(1);
  });
});

describe('ZaloOaWebhookController.handle (X-ZEvent-Signature, BAOMAT-06)', () => {
  const APP_ID = '1234567890';
  const OA_KEY = 'oa-secret-key';
  const signed = { ...body, app_id: APP_ID, timestamp: String(Date.now()) };
  const sign = (b: object = signed, key = OA_KEY) => zaloOaEventSignature(APP_ID, JSON.stringify(b), String((b as { timestamp: string }).timestamp), key);
  /** Thân thô như parser webhook giữ ở req.rawBody. */
  const raw = (b: object = signed) => ({ rawBody: Buffer.from(JSON.stringify(b), 'utf8') });
  function build(env: Record<string, string>) {
    const create = jest.fn().mockResolvedValue({ id: 'evt1' });
    const add = jest.fn().mockResolvedValue(undefined);
    const config = { get: (k: string) => env[k] ?? '' } as never;
    const ctrl = new ZaloOaWebhookController({ oaInboundMessage: { create } } as unknown as PrismaService, config, { add } as unknown as Queue);
    return { ctrl, create };
  }
  const both = { ZALO_OA_SECRET_KEY: OA_KEY, ZALO_APP_ID: APP_ID, ZALO_OA_WEBHOOK_SECRET: SECRET };

  it('chữ ký đúng (không có token) → lưu', async () => {
    const { ctrl, create } = build(both);
    await expect(ctrl.handle(signed, undefined, sign(), raw())).resolves.toEqual({ received: true });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('chữ ký tính trên thân thô có ký tự thoát (\\/, \\u) → khớp nhờ rawBody; không có rawBody → 401', async () => {
    const { ctrl, create } = build(both);
    const ts = String(Date.now());
    const raw = `{"app_id":"${APP_ID}","event_name":"user_send_image","sender":{"id":"zalo-user-1"},"message":{"msg_id":"m1","url":"https:\\/\\/a.vn\\/x?a=1\\u0026b=2"},"timestamp":"${ts}"}`;
    const parsed = JSON.parse(raw);
    const sig = zaloOaEventSignature(APP_ID, raw, ts, OA_KEY);
    await expect(ctrl.handle(parsed, undefined, sig)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(ctrl.handle(parsed, undefined, sig, { rawBody: Buffer.from(raw, 'utf8') })).resolves.toEqual({ received: true });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('không có thân thô (hoặc rỗng) → 401 dù chữ ký khớp JSON đã parse, không lưu; chỉ ghi lỗi khi thân là JSON', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      const { ctrl, create } = build(both);
      const form = (ct: string) => ({ headers: { 'content-type': ct } });
      const forms = ['application/x-www-form-urlencoded', 'application/x-www-form-urlencoded; x=json', 'text/plain; charset=utf-8; boundary=json', 'application/vnd.api+json'].map(form);
      for (const req of [undefined, {}, { rawBody: Buffer.alloc(0) }, ...forms]) {
        await expect(ctrl.handle(signed, undefined, sign(), req)).rejects.toBeInstanceOf(UnauthorizedException);
      }
      // Người ngoài gửi form có timestamp (route không giới hạn tần suất): 401 im lặng, không làm tràn log lỗi.
      expect(error).not.toHaveBeenCalled();
      await expect(ctrl.handle(signed, undefined, sign(), form('Application/JSON; charset=utf-8'))).rejects.toBeInstanceOf(UnauthorizedException);
      expect(error).toHaveBeenCalledWith(expect.stringContaining('thân thô'));
      expect(create).not.toHaveBeenCalled();
      error.mockClear();
      await expect(ctrl.handle(signed, undefined, 'sai', { ...raw(), headers: { 'content-type': 'application/json' } })).rejects.toBeInstanceOf(UnauthorizedException);
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });

  it('chữ ký băm trên byte: thân thô có byte UTF-8 lỗi vẫn khớp (không mã hoá lại thành EF BF BD)', async () => {
    const { ctrl, create } = build(both);
    const ts = String(Date.now());
    const rawBody = Buffer.concat([
      Buffer.from(`{"app_id":"${APP_ID}","event_name":"user_send_text","sender":{"id":"zalo-user-1"},"message":{"msg_id":"m9","text":"a`),
      Buffer.from([0xc3, 0x28]),
      Buffer.from(`"},"timestamp":"${ts}"}`),
    ]);
    const parsed = JSON.parse(rawBody.toString('utf8'));
    // Tính độc lập với hàm của module: sha256 trên đúng byte Zalo gửi.
    const sig = createHash('sha256').update(Buffer.concat([Buffer.from(APP_ID), rawBody, Buffer.from(ts + OA_KEY)])).digest('hex');
    await expect(ctrl.handle(parsed, undefined, sig, { rawBody })).resolves.toEqual({ received: true });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('sender.id vượt 2^53 trong thân thô: chữ ký (tính trên byte gốc) vẫn khớp nhưng sự kiện bị bỏ, không lưu id đã bị làm tròn', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const { ctrl, create } = build(both);
      const ts = String(Date.now());
      const rawText = `{"app_id":"${APP_ID}","event_name":"user_send_text","sender":{"id":246845883529197922},"message":{"msg_id":"m1","text":"Giá"},"timestamp":"${ts}"}`;
      const sig = zaloOaEventSignature(APP_ID, rawText, ts, OA_KEY);
      const parsed = JSON.parse(rawText);
      expect(String(parsed.sender.id)).toBe('246845883529197920');
      await expect(ctrl.handle(parsed, undefined, sig, { rawBody: Buffer.from(rawText, 'utf8') })).resolves.toEqual({ received: true });
      expect(create).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('thân thô khác thân đã parse (thân giả, chữ ký của thân thật) → 401', async () => {
    const { ctrl, create } = build(both);
    const forged = { ...signed, sender: { id: 'ke-gia' } };
    await expect(ctrl.handle(forged, undefined, sign(forged), raw())).rejects.toBeInstanceOf(UnauthorizedException);
    expect(create).not.toHaveBeenCalled();
  });

  it('header mang tiền tố mac= vẫn khớp', async () => {
    const { ctrl } = build(both);
    await expect(ctrl.handle(signed, undefined, `mac=${sign()}`, raw())).resolves.toEqual({ received: true });
  });

  it('chữ ký in hoa vẫn khớp; chữ ký sai/khác thân/khác khoá → 401, không lưu', async () => {
    const { ctrl, create } = build(both);
    await expect(ctrl.handle(signed, undefined, sign().toUpperCase(), raw())).resolves.toEqual({ received: true });
    create.mockClear();
    for (const sig of [sign(signed, 'khoa-khac'), sign({ ...signed, message: { text: 'giả' } }), 'abc', '']) {
      await expect(ctrl.handle(signed, undefined, sig, raw())).rejects.toBeInstanceOf(UnauthorizedException);
    }
    expect(create).not.toHaveBeenCalled();
  });

  it('thân thiếu timestamp hoặc chưa có ZALO_APP_ID → chữ ký không qua được', async () => {
    const { ctrl } = build(both);
    const { timestamp: _t, ...noTs } = signed;
    await expect(ctrl.handle(noTs, undefined, sign(), raw(noTs))).rejects.toBeInstanceOf(UnauthorizedException);
    const noApp = build({ ZALO_OA_SECRET_KEY: OA_KEY });
    await expect(noApp.ctrl.handle(signed, undefined, sign(), raw())).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('đã có khoá ký: token tĩnh (dù đúng/lộ) không thay được chữ ký; chỉ chữ ký đúng mới qua', async () => {
    const { ctrl, create } = build(both);
    await expect(ctrl.handle(signed, SECRET, undefined, raw())).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(ctrl.handle(signed, SECRET, 'sai', raw())).rejects.toBeInstanceOf(UnauthorizedException);
    expect(create).not.toHaveBeenCalled();
    await expect(ctrl.handle(signed, undefined, sign(), raw())).resolves.toEqual({ received: true });
  });

  it('chưa đủ khoá ký (thiếu ZALO_APP_ID) mà có token tĩnh: token là cửa duy nhất', async () => {
    const { ctrl } = build({ ZALO_OA_SECRET_KEY: OA_KEY, ZALO_OA_WEBHOOK_SECRET: SECRET });
    await expect(ctrl.handle(signed, SECRET, undefined)).resolves.toEqual({ received: true });
    await expect(ctrl.handle(signed, 'sai', undefined)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('chữ ký đúng nhưng timestamp quá hạn hoặc ở tương lai xa (gửi lại tin cũ) → 401, không lưu', async () => {
    const { ctrl, create } = build(both);
    for (const ts of [String(Date.now() - 3 * 3600_000), String(Date.now() + 3 * 3600_000), 'không-phải-số']) {
      const b = { ...signed, timestamp: ts };
      await expect(ctrl.handle(b, undefined, sign(b), raw(b))).rejects.toBeInstanceOf(UnauthorizedException);
    }
    expect(create).not.toHaveBeenCalled();
  });

  it('chỉ có khoá ký (không đặt token tĩnh): thiếu chữ ký → 401; token rỗng không bao giờ khớp', async () => {
    const { ctrl } = build({ ZALO_OA_SECRET_KEY: OA_KEY, ZALO_APP_ID: APP_ID });
    await expect(ctrl.handle(signed, undefined, undefined, raw())).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(ctrl.handle(signed, '', undefined, raw())).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('production mà thiếu cả hai khoá → 401 (fail-closed)', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const { ctrl, create } = build({});
      await expect(ctrl.handle(signed, 'x', sign(), raw())).rejects.toBeInstanceOf(UnauthorizedException);
      expect(create).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
