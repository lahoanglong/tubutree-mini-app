import { UnauthorizedException } from '@nestjs/common';
import { PancakeWebhookController } from './pancake-webhook.controller';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { Queue } from 'bullmq';

const SECRET = 'pancake-webhook-secret';
const body = { event: 'order.status_updated', data: { id: 'p1', status: 'delivered' } };

function makeController(secret: string) {
  const create = jest.fn().mockResolvedValue({ id: 'evt1' });
  const add = jest.fn().mockResolvedValue(undefined);
  const findUnique = jest.fn().mockResolvedValue(null);
  const prisma = { pancakeWebhookEvent: { create, findUnique } } as unknown as PrismaService;
  const queue = { add, getJob: jest.fn().mockResolvedValue(null) } as unknown as Queue;
  const config = { get: () => secret } as never;
  return { ctrl: new PancakeWebhookController(prisma, config, queue), create, add, findUnique };
}

describe('PancakeWebhookController.handle (verify token tĩnh)', () => {
  it('secret cấu hình + token đúng → lưu event RECEIVED + enqueue', async () => {
    const { ctrl, create, add } = makeController(SECRET);
    const r = await ctrl.handle(body, SECRET);
    expect(r).toEqual({ received: true });
    expect(create.mock.calls[0][0].data.status).toBe('RECEIVED');
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

  it('lưu kèm dedupeKey; trùng khoá (P2002) với sự kiện đã PROCESSED → không enqueue lại', async () => {
    const { ctrl, create, add, findUnique } = makeController(SECRET);
    create.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }));
    findUnique.mockResolvedValueOnce({ id: 'evt0', status: 'PROCESSED' });
    const r = await ctrl.handle(body, SECRET);
    expect(r).toEqual({ received: true, duplicate: true });
    expect(create.mock.calls[0][0].data.dedupeKey).toMatch(/^order\.status_updated\|[0-9a-f]{64}$/);
    expect(add).not.toHaveBeenCalled();
  });

  it('trùng khoá với sự kiện chưa xong (FAILED) → enqueue lại đúng event cũ', async () => {
    const { ctrl, create, add, findUnique } = makeController(SECRET);
    create.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }));
    findUnique.mockResolvedValueOnce({ id: 'evt0', status: 'FAILED' });
    await ctrl.handle(body, SECRET);
    expect(add).toHaveBeenCalledWith('process', { eventId: 'evt0' }, { jobId: 'evt0' });
  });

  it('enqueue lỗi (Redis chập) → vẫn trả 200, sự kiện đã lưu để cron cứu', async () => {
    const { ctrl, add } = makeController(SECRET);
    add.mockRejectedValueOnce(new Error('redis down'));
    await expect(ctrl.handle(body, SECRET)).resolves.toEqual({ received: true });
  });

  it('chưa cấu hình secret (dev) → bỏ qua verify, vẫn xử lý', async () => {
    const { ctrl, create } = makeController('');
    await ctrl.handle(body, undefined);
    expect(create).toHaveBeenCalled();
  });
});
