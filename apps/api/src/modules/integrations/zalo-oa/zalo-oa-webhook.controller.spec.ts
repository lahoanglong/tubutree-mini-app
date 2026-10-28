import { Prisma } from '@prisma/client';
import { UnauthorizedException } from '@nestjs/common';
import { ZaloOaWebhookController } from './zalo-oa-webhook.controller';
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
  const config = { get: () => secret } as never;
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
