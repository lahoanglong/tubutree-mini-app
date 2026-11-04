import type { AddressInfo } from 'node:net';
import { Logger, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { bodyParserErrorHandler, cspReportBodyParsers } from '../../common/body-limits';
import { CspReportController } from './csp-report.controller';

/** Cùng thứ tự với bootstrap.ts: parser csp-report → bộ bắt lỗi parser → prefix api. */
async function startApp(): Promise<{ app: INestApplication; base: string }> {
  const moduleRef = await Test.createTestingModule({
    imports: [ThrottlerModule.forRoot({ throttlers: [{ name: 'default', ttl: 60_000, limit: 1000 }] })],
    controllers: [CspReportController],
    providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  app.use('/api/csp-report', ...cspReportBodyParsers());
  app.use(bodyParserErrorHandler);
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  return { app, base: `http://127.0.0.1:${((app.getHttpServer().address()) as AddressInfo).port}` };
}

const legacy = (blocked: string) => ({
  'csp-report': { 'document-uri': 'https://tubutree.vn/p?x=1', 'effective-directive': 'script-src', 'blocked-uri': blocked },
});

describe('POST /api/csp-report', () => {
  let app: INestApplication;
  let base: string;
  let warn: jest.SpyInstance;

  beforeEach(async () => {
    // Spy đặt SAU khi dựng app: lúc máy tải, Nest ghi warn "module ... is taking Xms to serialize" trong compile().
    ({ app, base } = await startApp());
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(async () => {
    await app.close();
    warn.mockRestore();
  });

  const post = (body: string, type: string) => fetch(`${base}/api/csp-report`, { method: 'POST', headers: { 'content-type': type }, body });

  it('application/csp-report → 204, một dòng warn gọn không có query', async () => {
    const res = await post(JSON.stringify(legacy('https://evil.example.com/a.js?s=secret')), 'application/csp-report');
    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]![0]);
    expect(line).toContain('script-src');
    expect(line).toContain('https://evil.example.com/a.js');
    expect(line).toContain('/p');
    expect(line).not.toContain('secret');
    expect(line).not.toContain('x=1');
  });

  it('application/reports+json (kèm charset) → 204 và ghi log', async () => {
    const body = [{ type: 'csp-violation', body: { effectiveDirective: 'img-src', blockedURL: 'https://cdn.example.com/i.png?z=1', documentURL: 'https://tubutree.vn/a?b=2' } }];
    const res = await post(JSON.stringify(body), 'application/reports+json; charset=utf-8');
    expect(res.status).toBe(204);
    expect(String(warn.mock.calls[0]![0])).toContain('img-src');
  });

  it('cùng vi phạm gửi lặp trong một phút chỉ ghi một dòng', async () => {
    for (let i = 0; i < 5; i++) expect((await post(JSON.stringify(legacy('https://dup.example.com/x.js')), 'application/csp-report')).status).toBe(204);
    // Spy bắt mọi Logger.warn trong tiến trình; chỉ đếm dòng của báo cáo CSP để warn lạ không làm đỏ, và in đủ dòng khi đỏ.
    const cspLines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('CSP chặn') || l.startsWith('Lược'));
    expect(cspLines).toEqual([expect.stringContaining('https://dup.example.com/x.js')]);
  });

  it('thân sai dạng vẫn 204, không ghi log', async () => {
    expect((await post(JSON.stringify({ hello: 'world' }), 'application/csp-report')).status).toBe(204);
    expect(warn).not.toHaveBeenCalled();
  });

  it('thân quá 32kb → 413', async () => {
    const big = JSON.stringify({ 'csp-report': { 'blocked-uri': 'x'.repeat(40_000), 'effective-directive': 'script-src' } });
    const res = await post(big, 'application/csp-report');
    expect(res.status).toBe(413);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(['application/json', 'text/plain', 'application/x-www-form-urlencoded'])('content-type lạ %s → 415', async (type) => {
    const res = await post(JSON.stringify(legacy('https://evil.example.com/a.js')), type);
    expect(res.status).toBe(415);
    expect(warn).not.toHaveBeenCalled();
  });

  it('JSON hỏng → 400 (parser)', async () => {
    expect((await post('{not json', 'application/csp-report')).status).toBe(400);
  });
});

describe('POST /api/csp-report: throttle riêng 60/phút', () => {
  it('request thứ 61 trong một phút bị 429', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { app, base } = await startApp();
    try {
      const send = () =>
        fetch(`${base}/api/csp-report`, { method: 'POST', headers: { 'content-type': 'application/csp-report' }, body: JSON.stringify(legacy('inline')) });
      const statuses: number[] = [];
      for (let i = 0; i < 61; i++) statuses.push((await send()).status);
      expect(statuses.slice(0, 60).every((s) => s === 204)).toBe(true);
      expect(statuses[60]).toBe(429);
    } finally {
      await app.close();
      warn.mockRestore();
    }
  });
});
