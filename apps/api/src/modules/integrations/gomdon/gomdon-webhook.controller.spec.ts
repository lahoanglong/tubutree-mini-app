import { type INestApplication, UnauthorizedException } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { GomdonWebhookController } from './gomdon-webhook.controller';
import { GomdonWebhookService } from './gomdon-webhook.service';
import type { Env } from '../../../config/env.validation';

const SECRET = 'gomdon-secret-123';
const body = { order_id: 55, order_code: 'BE55', order_customer_id: 'TUBU1', status: 7 };

function make(secret: string) {
  const webhook = { receive: jest.fn().mockResolvedValue({ result: true }) };
  const config = { get: jest.fn().mockReturnValue(secret) } as unknown as ConfigService<Env, true>;
  const controller = new GomdonWebhookController(webhook as unknown as GomdonWebhookService, config);
  return { controller, webhook };
}

describe('GomdonWebhookController — xác thực token chia sẻ', () => {
  const savedEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = savedEnv;
  });

  it('token đúng qua header → lưu event (gọi receive)', async () => {
    const { controller, webhook } = make(SECRET);
    await expect(controller.handle(body, SECRET, undefined)).resolves.toEqual({ result: true });
    expect(webhook.receive).toHaveBeenCalledWith(body, expect.anything());
  });

  it('token đúng qua ?token= hoặc path /webhooks/gomdon/<secret> → chấp nhận', async () => {
    const { controller, webhook } = make(SECRET);
    await controller.handle(body, undefined, SECRET);
    await controller.handleWithPathToken(SECRET, body, undefined);
    expect(webhook.receive).toHaveBeenCalledTimes(2);
  });

  it('thiếu token → 401, KHÔNG chạm DB/queue', async () => {
    const { controller, webhook } = make(SECRET);
    await expect(controller.handle(body, undefined, undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(webhook.receive).not.toHaveBeenCalled();
  });

  it('token sai (cùng/khác độ dài) → 401', async () => {
    const { controller, webhook } = make(SECRET);
    await expect(controller.handle(body, 'gomdon-secret-124', undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.handle(body, 'x', undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.handleWithPathToken('wrong', body, undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(webhook.receive).not.toHaveBeenCalled();
  });

  it('production chưa đặt GOMDON_WEBHOOK_SECRET → fail-closed 401 mọi request', async () => {
    process.env.NODE_ENV = 'production';
    const { controller, webhook } = make('');
    await expect(controller.handle(body, 'anything', undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.handleWithPathToken('anything', body, undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(webhook.receive).not.toHaveBeenCalled();
  });

  it('tài liệu: Gomdon chỉ coi HTTP 200 là nhận thành công (khác 200 → gửi lại sau 30 giây, tối đa 3 lần) → cả 2 route trả 200', () => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, GomdonWebhookController.prototype.handle)).toBe(200);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, GomdonWebhookController.prototype.handleWithPathToken)).toBe(200);
  });

  it('dev/test chưa đặt secret → cho qua (có cảnh báo) để thử nghiệm', async () => {
    process.env.NODE_ENV = 'test';
    const { controller, webhook } = make('');
    await controller.handle(body, undefined, undefined);
    expect(webhook.receive).toHaveBeenCalled();
  });
});

describe('UAT GOMDON-5: webhook hợp lệ không bị giới hạn 120 request/phút/IP', () => {
  it('controller bỏ throttle chung (như webhook Pancake) — chỉ token chia sẻ quyết định nhận hay không', () => {
    expect(Reflect.getMetadata('THROTTLER:SKIPdefault', GomdonWebhookController)).toBe(true);
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', GomdonWebhookController)).toBeUndefined();
  });
});

describe('UAT GOMDON-6: webhook gửi multipart/form-data (kiểu mọi API Gomdon) được đọc đúng', () => {
  let app: INestApplication;
  const webhook = { receive: jest.fn().mockResolvedValue({ result: true }) };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [GomdonWebhookController],
      providers: [
        { provide: GomdonWebhookService, useValue: webhook },
        { provide: ConfigService, useValue: { get: () => SECRET } },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => webhook.receive.mockClear());

  it('form-data → body có đủ trường, kèm Content-Type để chẩn đoán', async () => {
    const fd = new FormData();
    fd.append('status', '3');
    fd.append('order_id', '9029');
    fd.append('order_code', '84850000009029');
    fd.append('order_customer_id', 'TUBU2026101379083');
    const res = await fetch(`${await app.getUrl()}/webhooks/gomdon/${SECRET}`, { method: 'POST', body: fd });
    expect(res.status).toBe(200);
    expect(webhook.receive).toHaveBeenCalledWith(
      { status: '3', order_id: '9029', order_code: '84850000009029', order_customer_id: 'TUBU2026101379083' },
      { contentType: expect.stringContaining('multipart/form-data') },
    );
  });

  it('JSON vẫn đọc như cũ', async () => {
    const res = await fetch(`${await app.getUrl()}/webhooks/gomdon`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-webhook-token': SECRET },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);
    expect(webhook.receive).toHaveBeenCalledWith(body, { contentType: 'application/json' });
  });

  it('form-data kèm FILE → từ chối (không nhận file trên route webhook)', async () => {
    const fd = new FormData();
    fd.append('status', '3');
    fd.append('f', new Blob(['x']), 'x.txt');
    const res = await fetch(`${await app.getUrl()}/webhooks/gomdon/${SECRET}`, { method: 'POST', body: fd });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(webhook.receive).not.toHaveBeenCalled();
  });
});
