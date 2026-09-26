import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ArgumentsHost } from '@nestjs/common';
import { PrismaExceptionFilter } from './prisma-exception.filter';

function makeHost(req: { method?: string; originalUrl?: string; url?: string }) {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  const host = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ArgumentsHost;
  return { host, res };
}

describe('PrismaExceptionFilter — log không lộ bí mật webhook trong URL', () => {
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  const logged = () => [...warn.mock.calls, ...error.mock.calls].map((c) => String(c[0])).join('\n');

  it('lỗi mapped (P2002) trên /webhooks/gomdon/<token> → log đã che token, vẫn trả 409', () => {
    const { host, res } = makeHost({ method: 'POST', originalUrl: '/api/webhooks/gomdon/SUPERSECRET' });
    const err = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' });
    new PrismaExceptionFilter().catch(err, host);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(logged()).not.toContain('SUPERSECRET');
    expect(logged()).toContain('POST /api/webhooks/gomdon/[REDACTED]');
  });

  it('lỗi không map (P2010) với ?token= → log đã che', () => {
    const { host } = makeHost({ method: 'POST', originalUrl: '/api/webhooks/gomdon?token=SUPERSECRET' });
    const err = new Prisma.PrismaClientKnownRequestError('raw', { code: 'P2010', clientVersion: 'test' });
    new PrismaExceptionFilter().catch(err, host);
    expect(logged()).not.toContain('SUPERSECRET');
    expect(logged()).toContain('?token=[REDACTED]');
  });

  it('lỗi Init/Validation (không có code) → log đã che, fallback req.url', () => {
    const { host, res } = makeHost({ method: 'POST', url: '/api/webhooks/gomdon/SUPERSECRET?signature=SIG' });
    const err = new Prisma.PrismaClientValidationError('bad', { clientVersion: 'test' });
    new PrismaExceptionFilter().catch(err, host);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(logged()).not.toContain('SUPERSECRET');
    expect(logged()).not.toContain('SIG');
  });
});
