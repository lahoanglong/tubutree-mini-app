import { UnauthorizedException } from '@nestjs/common';
import { ZaloOaWebhookController } from './zalo-oa-webhook.controller';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { Queue } from 'bullmq';

const SECRET = 'zalo-oa-webhook-secret';
const body = { event_name: 'user_send_text', sender: { id: 'zalo-u1' }, message: { text: 'Ship bao lâu?' } };

function makeController(secret: string) {
  const create = jest.fn().mockResolvedValue({ id: 'evt1' });
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
    expect(create.mock.calls[0][0].data).toMatchObject({ zaloUserId: 'zalo-u1', messageText: 'Ship bao lâu?' });
    expect(add).toHaveBeenCalledWith('process', { eventId: 'evt1' }, { jobId: 'evt1' });
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

  it('event không có sender.id (vd follow/unfollow) → bỏ qua êm, không lưu/enqueue', async () => {
    const { ctrl, create, add } = makeController(SECRET);
    const r = await ctrl.handle({ event_name: 'follow' }, SECRET);
    expect(r).toEqual({ received: true });
    expect(create).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });
});
