import type { AddressInfo } from 'node:net';
import { Module, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { bootstrap } from './bootstrap';
import { CRON_LEADER_OPTIONS, CronLeaderService } from './common/cron-leader/cron-leader.service';
import { PrismaService } from './prisma/prisma.service';
import { QUEUE_ZALO_OA_EVENTS } from './jobs/queues';
import { ZaloOaWebhookController, zaloOaEventSignature } from './modules/integrations/zalo-oa/zalo-oa-webhook.controller';

describe('bootstrap: thân thô cho webhook Zalo OA', () => {
  let app: INestApplication | undefined;
  afterEach(async () => {
    await app?.close().catch(() => undefined);
    app = undefined;
  });

  it('chữ ký tính trên thân thô có \\/ và \\uXXXX qua app thật vẫn 200 (không rơi về JSON.stringify)', async () => {
    const create = jest.fn(async () => ({ id: 'evt-1' }));
    const add = jest.fn(async () => undefined);
    const config = { get: (k: string) => ({ ZALO_OA_WEBHOOK_SECRET: '', ZALO_OA_SECRET_KEY: 'oa-secret', ZALO_APP_ID: 'app-1' })[k] };
    @Module({
      imports: [ScheduleModule.forRoot()],
      controllers: [ZaloOaWebhookController],
      providers: [
        CronLeaderService,
        { provide: PrismaService, useValue: { $executeRaw: jest.fn(async () => 1), oaInboundMessage: { create } } },
        { provide: ConfigService, useValue: config },
        { provide: getQueueToken(QUEUE_ZALO_OA_EVENTS), useValue: { add } },
        { provide: CRON_LEADER_OPTIONS, useValue: { leaseName: 'cron', ttlMs: 90_000, renewMs: 60_000 } },
      ],
    })
    class Root {}
    app = await bootstrap(Root, { port: 0, exit: jest.fn(), logger: ['error'] });
    const port = (app!.getHttpServer().address() as AddressInfo).port;

    const ts = String(Date.now());
    const raw = `{"event_name":"user_send_text", "sender":{"id":"u1"}, "message":{"text":"Xin ch\\u00e0o","msg_id":"m1","url":"https:\\/\\/a.vn\\/x"}, "timestamp":"${ts}"}`;
    expect(JSON.stringify(JSON.parse(raw))).not.toBe(raw);
    const sig = zaloOaEventSignature('app-1', raw, ts, 'oa-secret');
    const res = await fetch(`http://127.0.0.1:${port}/api/webhooks/zalo-oa`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-zevent-signature': `mac=${sig}` },
      body: raw,
    });
    expect(res.status).toBe(200);
    expect(create).toHaveBeenCalledTimes(1);
  });
});
