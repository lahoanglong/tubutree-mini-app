import type { AddressInfo } from 'node:net';
import { Module, type INestApplication } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { bootstrap } from './bootstrap';
import { CRON_LEADER_OPTIONS, CronLeaderService } from './common/cron-leader/cron-leader.service';
import { WebhookRejectCounterService } from './modules/analytics/webhook-reject-counter.service';
import { PrismaService } from './prisma/prisma.service';

/**
 * Webhook Pancake sai token bị chặn ở middleware TRƯỚC controller (pancakeWebhookTokenGuard), nên PancakeWebhookController.record không bao
 * giờ chạy cho ca đó. Ca này khoá việc bootstrap nối middleware với bộ đếm thật: thiếu nối thì tab Theo dõi 72h không bao giờ thấy 401 của Pancake.
 */
describe('bootstrap — bộ đếm 401 webhook Pancake', () => {
  const SHELL_JWT_SECRET = process.env.JWT_ACCESS_SECRET;
  const SHELL_PANCAKE_SECRET = process.env.PANCAKE_WEBHOOK_SECRET;
  const opened: INestApplication[] = [];

  beforeAll(() => {
    process.env.JWT_ACCESS_SECRET = 'bootstrap-spec-access-secret-0123456789';
    process.env.PANCAKE_WEBHOOK_SECRET = 'pancake-bootstrap-secret-0123456789';
  });
  afterAll(() => {
    if (SHELL_JWT_SECRET === undefined) delete process.env.JWT_ACCESS_SECRET;
    else process.env.JWT_ACCESS_SECRET = SHELL_JWT_SECRET;
    if (SHELL_PANCAKE_SECRET === undefined) delete process.env.PANCAKE_WEBHOOK_SECRET;
    else process.env.PANCAKE_WEBHOOK_SECRET = SHELL_PANCAKE_SECRET;
  });
  afterEach(async () => {
    await Promise.all(opened.splice(0).map((a) => a.close().catch(() => undefined)));
  });

  async function open(record: jest.Mock): Promise<string> {
    @Module({
      imports: [ScheduleModule.forRoot()],
      providers: [
        CronLeaderService,
        { provide: PrismaService, useValue: { $executeRaw: jest.fn(async () => 1) } },
        { provide: CRON_LEADER_OPTIONS, useValue: { leaseName: 'cron', ttlMs: 90_000, renewMs: 60_000 } },
        { provide: WebhookRejectCounterService, useValue: { record } },
      ],
    })
    class Root {}
    const app = await bootstrap(Root, { port: 0, exit: jest.fn(), logger: false });
    expect(app).toBeDefined();
    opened.push(app!);
    return `http://127.0.0.1:${(app!.getHttpServer().address() as AddressInfo).port}`;
  }

  const post = (base: string, headers: Record<string, string> = {}) =>
    fetch(`${base}/api/webhooks/pancake`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{}' });

  it('POST không token và sai token: 401 và mỗi lần đếm một lần cho nguồn pancake', async () => {
    const record = jest.fn();
    const base = await open(record);
    expect((await post(base)).status).toBe(401);
    expect((await post(base, { 'x-webhook-token': 'sai-token' })).status).toBe(401);
    expect(record).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenNthCalledWith(1, 'pancake');
    expect(record).toHaveBeenNthCalledWith(2, 'pancake');
  });

  it('GET quét dò vào đường dẫn webhook: 401 nhưng không đếm', async () => {
    const record = jest.fn();
    const base = await open(record);
    const res = await fetch(`${base}/api/webhooks/pancake`);
    expect(res.status).toBe(401);
    expect(record).not.toHaveBeenCalled();
  });
});
