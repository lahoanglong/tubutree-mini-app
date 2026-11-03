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
      const form = { headers: { 'content-type': 'application/x-www-form-urlencoded' } };
      for (const req of [undefined, {}, { rawBody: Buffer.alloc(0) }, form]) {
        await expect(ctrl.handle(signed, undefined, sign(), req)).rejects.toBeInstanceOf(UnauthorizedException);
      }
      // Người ngoài gửi form có timestamp (route không giới hạn tần suất): 401 im lặng, không làm tràn log lỗi.
      expect(error).not.toHaveBeenCalled();
      await expect(ctrl.handle(signed, undefined, sign(), { headers: { 'content-type': 'application/json; charset=utf-8' } })).rejects.toBeInstanceOf(UnauthorizedException);
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
