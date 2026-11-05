import { UnauthorizedException } from '@nestjs/common';
import { PancakeWebhookController } from './pancake-webhook.controller';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { Queue } from 'bullmq';
import { QUEUE_COMMAND_TIMEOUT_MS } from '../../../jobs/queue-timeout';

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

  it('trùng khoá với sự kiện đã IGNORED (đơn lạ / tồn kho cũ) → coi như trùng, không enqueue lại', async () => {
    const { ctrl, create, add, findUnique } = makeController(SECRET);
    create.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }));
    findUnique.mockResolvedValueOnce({ id: 'evt0', status: 'IGNORED' });
    await expect(ctrl.handle(body, SECRET)).resolves.toEqual({ received: true, duplicate: true });
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

  it('Redis mất kết nối (lệnh queue treo, không reject) → vẫn trả 200 sau hạn chờ, không treo request', async () => {
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

  it('chưa cấu hình secret (dev) → bỏ qua verify, vẫn xử lý', async () => {
    const { ctrl, create } = makeController('');
    await ctrl.handle(body, undefined);
    expect(create).toHaveBeenCalled();
  });
});

describe('PancakeWebhookController.handle — event/type không phải chuỗi (W11)', () => {
  it.each([
    [{ event: 123, data: { id: 'p1' } }, 'order'],
    [{ event: { a: 1 }, data: { id: 'p1' } }, 'order'],
    [{ event: ['x'], type: 'orders', id: 'p1' }, 'orders'],
    [{ event: '   ', type: 'orders', id: 'p1' }, 'orders'],
    [{ type: 5, id: 'p1' }, 'order'],
    [{ event: null, type: null, id: 'p1' }, 'order'],
    [{ id: 'p1' }, 'order'],
  ])('body %j: không ném (Pancake không bị trả 500), loại sự kiện lưu là %j', async (payload, expected) => {
    const { ctrl, create, add } = makeController(SECRET);
    await expect(ctrl.handle(payload as never, SECRET)).resolves.toEqual({ received: true });
    expect(create.mock.calls[0][0].data.eventType).toBe(expected);
    expect(create.mock.calls[0][0].data.dedupeKey).toMatch(new RegExp(`^${expected}\\|[0-9a-f]{64}$`));
    expect(add).toHaveBeenCalledTimes(1);
  });

  it('loại sự kiện có khoảng trắng đầu cuối được cắt', async () => {
    const { ctrl, create } = makeController(SECRET);
    await ctrl.handle({ event: '  order.updated ', data: { id: 'p1' } }, SECRET);
    expect(create.mock.calls[0][0].data.eventType).toBe('order.updated');
  });
});

describe('PancakeWebhookController.handle — cùng sự kiện bắn trùng liên tiếp và song song (W11)', () => {
  /** Bảng sự kiện giả có ràng buộc duy nhất theo dedupeKey, kiểm-và-ghi nguyên tử như Postgres. */
  function stateful(addImpl?: () => Promise<unknown>) {
    const rows = new Map<string, { id: string; status: string }>();
    let seq = 0;
    const create = jest.fn(async ({ data }: { data: { dedupeKey: string; status: string } }) => {
      await Promise.resolve();
      if (rows.has(data.dedupeKey)) throw Object.assign(new Error('dup'), { code: 'P2002' });
      const row = { id: `evt${++seq}`, status: data.status };
      rows.set(data.dedupeKey, row);
      return row;
    });
    const findUnique = jest.fn(async ({ where }: { where: { dedupeKey: string } }) => rows.get(where.dedupeKey) ?? null);
    const add = jest.fn(addImpl ?? (async () => undefined));
    const prisma = { pancakeWebhookEvent: { create, findUnique } } as unknown as PrismaService;
    const queue = { add, getJob: jest.fn().mockResolvedValue(null) } as unknown as Queue;
    const ctrl = new PancakeWebhookController(prisma, { get: () => SECRET } as never, queue);
    return { ctrl, rows, add };
  }
  const fire = (ctrl: PancakeWebhookController, n: number, payload: object = body) => Promise.all(Array.from({ length: n }, () => ctrl.handle(payload as never, SECRET)));
  const jobIds = (add: jest.Mock) => new Set(add.mock.calls.map((c) => (c[2] as { jobId: string }).jobId));

  it('5 lần bắn song song: một dòng sự kiện, mọi lần enqueue cùng một jobId (BullMQ gộp thành một job)', async () => {
    const { ctrl, rows, add } = stateful();
    const results = await fire(ctrl, 5);
    expect(rows.size).toBe(1);
    expect(results).toEqual(Array.from({ length: 5 }, () => ({ received: true })));
    expect(jobIds(add)).toEqual(new Set(['evt1']));
  });

  it('bắn lại sau khi sự kiện đã xử lý xong (PROCESSED/IGNORED): mọi lần là duplicate, không enqueue', async () => {
    for (const done of ['PROCESSED', 'IGNORED']) {
      const { ctrl, rows, add } = stateful();
      await ctrl.handle(body, SECRET);
      [...rows.values()][0]!.status = done;
      add.mockClear();
      const results = await fire(ctrl, 5);
      expect(results).toEqual(Array.from({ length: 5 }, () => ({ received: true, duplicate: true })));
      expect(add).not.toHaveBeenCalled();
      expect(rows.size).toBe(1);
    }
  });

  it('thứ tự khoá trong payload khác nhau vẫn là cùng một sự kiện', async () => {
    const { ctrl, rows } = stateful();
    await Promise.all([
      ctrl.handle({ event: 'order.status_updated', data: { id: 'p1', status: 'delivered' } }, SECRET),
      ctrl.handle({ data: { status: 'delivered', id: 'p1' }, event: 'order.status_updated' }, SECRET),
    ]);
    expect(rows.size).toBe(1);
  });

  it('hai lần sửa đơn khác nhau (trạng thái khác) KHÔNG bị gộp: mất một cập nhật còn tệ hơn xử lý hai lần', async () => {
    const { ctrl, rows } = stateful();
    await Promise.all([
      ctrl.handle({ type: 'orders', id: 'p1', status: 1, updated_at: '2026-11-06T01:00:00' }, SECRET),
      ctrl.handle({ type: 'orders', id: 'p1', status: 2, updated_at: '2026-11-06T01:00:05' }, SECRET),
    ]);
    expect(rows.size).toBe(2);
  });

  it('Redis chập (enqueue lỗi) khi bắn trùng song song: mọi lần vẫn 200, vẫn một dòng để cron cứu', async () => {
    const { ctrl, rows } = stateful(async () => {
      throw new Error('redis down');
    });
    const results = await fire(ctrl, 5);
    expect(results).toEqual(Array.from({ length: 5 }, () => ({ received: true })));
    expect(rows.size).toBe(1);
  });
});
