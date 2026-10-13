import { ServiceUnavailableException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { HealthController } from './health.controller';
import type { PrismaService } from '../../prisma/prisma.service';
import { QUEUE_COMMAND_TIMEOUT_MS } from '../../jobs/queue-timeout';

function make(opts: { db?: 'up' | 'down'; redis?: 'up' | 'down' | 'hang' }) {
  const prisma = {
    $queryRaw: jest.fn(() => (opts.db === 'down' ? Promise.reject(new Error('db')) : Promise.resolve([1]))),
  } as unknown as PrismaService;
  const ping = jest.fn(() => {
    if (opts.redis === 'down') return Promise.reject(new Error('ECONNREFUSED'));
    if (opts.redis === 'hang') return new Promise(() => undefined);
    return Promise.resolve('PONG');
  });
  const queue = { client: Promise.resolve({ ping }) } as unknown as Queue;
  return new HealthController(prisma, queue);
}

async function errorBody(p: Promise<unknown>) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ServiceUnavailableException);
  return (err as ServiceUnavailableException).getResponse();
}

describe('HealthController', () => {
  it('DB + Redis đều lên → 200 ok', async () => {
    await expect(make({ db: 'up', redis: 'up' }).check()).resolves.toMatchObject({ status: 'ok', db: 'up', redis: 'up' });
  });

  it('DB down → 503', async () => {
    expect(await errorBody(make({ db: 'down', redis: 'up' }).check())).toMatchObject({ db: 'down', redis: 'up' });
  });

  it('Redis từ chối kết nối → 503 để healthcheck/monitor thấy (đặt hàng, webhook không enqueue được)', async () => {
    expect(await errorBody(make({ db: 'up', redis: 'down' }).check())).toMatchObject({ status: 'error', db: 'up', redis: 'down' });
  });

  it('Redis treo (ioredis đang reconnect, lệnh nằm offline queue) → 503 sau hạn chờ, không treo healthcheck', async () => {
    jest.useFakeTimers();
    try {
      const res = make({ db: 'up', redis: 'hang' }).check();
      const body = errorBody(res);
      await jest.advanceTimersByTimeAsync(QUEUE_COMMAND_TIMEOUT_MS);
      expect(await body).toMatchObject({ redis: 'down' });
    } finally {
      jest.useRealTimers();
    }
  });
});
