import type { NextFunction, Request, RequestHandler, Response } from 'express';
import {
  PANCAKE_TOKEN_INVALID_MESSAGE,
  PANCAKE_TOKEN_MISSING_SECRET_MESSAGE,
  createPancakeWebhookTokenGuard,
  pancakeWebhookTokenGuard,
} from './body-limits';

const SECRET = 'pancake-guard-secret-0123456789abcdef';
const ROUTE = '/api/webhooks/pancake';

const SHELL_SECRET = process.env.PANCAKE_WEBHOOK_SECRET;
const SHELL_NODE_ENV = process.env.NODE_ENV;
afterEach(() => {
  if (SHELL_SECRET === undefined) delete process.env.PANCAKE_WEBHOOK_SECRET;
  else process.env.PANCAKE_WEBHOOK_SECRET = SHELL_SECRET;
  (process.env as Record<string, string | undefined>).NODE_ENV = SHELL_NODE_ENV;
});

interface Call {
  method?: string;
  path?: string;
  token?: string;
}

function run(guard: RequestHandler, { method = 'POST', path = ROUTE, token }: Call = {}) {
  const req = { method, path, headers: token === undefined ? {} : { 'x-webhook-token': token } } as unknown as Request;
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const next = jest.fn() as unknown as NextFunction & jest.Mock;
  guard(req, { status } as unknown as Response, next);
  return { status, json, next };
}

describe('createPancakeWebhookTokenGuard — đếm 401 của webhook Pancake ở lớp chặn trước controller', () => {
  it('POST sai token: 401 và đếm đúng một lần', () => {
    process.env.PANCAKE_WEBHOOK_SECRET = SECRET;
    const onReject = jest.fn();
    const out = run(createPancakeWebhookTokenGuard(onReject), { token: 'sai-token' });
    expect(out.status).toHaveBeenCalledWith(401);
    expect(out.json).toHaveBeenCalledWith({ statusCode: 401, message: PANCAKE_TOKEN_INVALID_MESSAGE, error: 'Unauthorized' });
    expect(out.next).not.toHaveBeenCalled();
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it('POST không có token: 401 và đếm một lần', () => {
    process.env.PANCAKE_WEBHOOK_SECRET = SECRET;
    const onReject = jest.fn();
    const out = run(createPancakeWebhookTokenGuard(onReject));
    expect(out.status).toHaveBeenCalledWith(401);
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it('production chưa có secret: 401 với câu riêng và vẫn đếm', () => {
    delete process.env.PANCAKE_WEBHOOK_SECRET;
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    const onReject = jest.fn();
    const out = run(createPancakeWebhookTokenGuard(onReject), { token: 'bat-ky' });
    expect(out.json).toHaveBeenCalledWith({ statusCode: 401, message: PANCAKE_TOKEN_MISSING_SECRET_MESSAGE, error: 'Unauthorized' });
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it('đúng token: cho qua, không đếm', () => {
    process.env.PANCAKE_WEBHOOK_SECRET = SECRET;
    const onReject = jest.fn();
    const out = run(createPancakeWebhookTokenGuard(onReject), { token: SECRET });
    expect(out.next).toHaveBeenCalledTimes(1);
    expect(out.status).not.toHaveBeenCalled();
    expect(onReject).not.toHaveBeenCalled();
  });

  it('dev/test chưa có secret: cho qua, không đếm', () => {
    delete process.env.PANCAKE_WEBHOOK_SECRET;
    (process.env as Record<string, string | undefined>).NODE_ENV = 'test';
    const onReject = jest.fn();
    const out = run(createPancakeWebhookTokenGuard(onReject));
    expect(out.next).toHaveBeenCalledTimes(1);
    expect(onReject).not.toHaveBeenCalled();
  });

  it('đường dẫn khác: cho qua, không đếm dù POST không token', () => {
    process.env.PANCAKE_WEBHOOK_SECRET = SECRET;
    const onReject = jest.fn();
    const out = run(createPancakeWebhookTokenGuard(onReject), { path: '/api/webhooks/gomdon' });
    expect(out.next).toHaveBeenCalledTimes(1);
    expect(onReject).not.toHaveBeenCalled();
  });

  it.each(['/api/webhooks/PANCAKE', '/api/webhooks/pancake/'])('POST %s (hoa thường/dấu / cuối vẫn là route controller): đếm một lần', (path) => {
    process.env.PANCAKE_WEBHOOK_SECRET = SECRET;
    const onReject = jest.fn();
    run(createPancakeWebhookTokenGuard(onReject), { path });
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it('POST vào đường dẫn con của webhook: vẫn 401 nhưng không đếm (không có controller ở đó)', () => {
    process.env.PANCAKE_WEBHOOK_SECRET = SECRET;
    const onReject = jest.fn();
    const out = run(createPancakeWebhookTokenGuard(onReject), { path: '/api/webhooks/pancake/bat-ky' });
    expect(out.status).toHaveBeenCalledWith(401);
    expect(onReject).not.toHaveBeenCalled();
  });

  it.each(['GET', 'PUT', 'PATCH', 'DELETE'])('%s không token: vẫn 401 nhưng không đếm (chỉ POST là cách Pancake gọi)', (method) => {
    process.env.PANCAKE_WEBHOOK_SECRET = SECRET;
    const onReject = jest.fn();
    const out = run(createPancakeWebhookTokenGuard(onReject), { method });
    expect(out.status).toHaveBeenCalledWith(401);
    expect(onReject).not.toHaveBeenCalled();
  });

  it('bộ đếm ném lỗi: phản hồi 401 vẫn nguyên', () => {
    process.env.PANCAKE_WEBHOOK_SECRET = SECRET;
    const onReject = jest.fn(() => {
      throw new Error('bộ đếm hỏng');
    });
    const out = run(createPancakeWebhookTokenGuard(onReject), { token: 'sai-token' });
    expect(out.status).toHaveBeenCalledWith(401);
    expect(out.json).toHaveBeenCalledWith({ statusCode: 401, message: PANCAKE_TOKEN_INVALID_MESSAGE, error: 'Unauthorized' });
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it('bản dựng sẵn không callback vẫn trả 401', () => {
    process.env.PANCAKE_WEBHOOK_SECRET = SECRET;
    const out = run(pancakeWebhookTokenGuard, { token: 'sai-token' });
    expect(out.status).toHaveBeenCalledWith(401);
  });
});
