import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { json } from 'express';
import { ZaloConsentWebhookController, zaloEventSignature } from './zalo-consent-webhook.controller';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { createValidationPipe } from '../../common/validation-pipe';

const KEY = 'k-test-123456789012345678901234';

describe('POST /api/webhooks/zalo-miniapp (HTTP, guard + pipe + prefix toàn cục)', () => {
  let app: INestApplication;
  let port: number;
  const service = jest.fn().mockResolvedValue({ userId: 'u1', alreadyRequested: false });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [ZaloConsentWebhookController],
      providers: [
        { provide: UsersService, useValue: { requestAccountDeletionByZaloId: service } },
        { provide: ConfigService, useValue: { get: (k: string) => (k === 'ZALO_OPEN_API_KEY' ? KEY : '') } },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
      ],
    }).compile();
    app = mod.createNestApplication({ bodyParser: false, logger: false });
    app.use(json({ limit: '10mb' }));
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createValidationPipe());
    await app.listen(0);
    port = (app.getHttpServer().address() as { port: number }).port;
  });
  afterAll(() => app.close());
  beforeEach(() => service.mockClear());

  const post = async (body: unknown, sig: string) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/webhooks/zalo-miniapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-ZEvent-Signature': sig },
      body: JSON.stringify(body),
    });
    return r.status;
  };
  const good = { event: 'user.revoke.consent', appId: '2646373759294038927', userId: '4047671499938107249', timestamp: Date.now() };

  it('route @Public, chữ ký đúng → 200 và gọi service một lần', async () => {
    expect(await post(good, zaloEventSignature(good, KEY))).toBe(200);
    expect(service).toHaveBeenCalledTimes(1);
  });

  it('chữ ký sai → 401, không gọi service', async () => {
    expect(await post(good, 'x')).toBe(401);
    expect(service).not.toHaveBeenCalled();
  });

  it('body cắt lại ranh giới trường với chữ ký của body gốc → 200 no-op, không gọi service', async () => {
    const sig = zaloEventSignature(good, KEY);
    const t = String(good.timestamp);
    const forged = { appId: good.appId, event: good.event, timestamp: t + good.userId.slice(0, 4), userId: good.userId.slice(4) };
    expect(await post(forged, sig)).toBe(200);
    expect(service).not.toHaveBeenCalled();
  });
});
