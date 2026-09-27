import { UnauthorizedException } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import type { ConfigService } from '@nestjs/config';
import { GomdonWebhookController } from './gomdon-webhook.controller';
import type { GomdonWebhookService } from './gomdon-webhook.service';
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
    expect(webhook.receive).toHaveBeenCalledWith(body);
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
