import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Body, Controller, Get, HttpCode, Logger, Post, Req, UnauthorizedException, type ExecutionContext, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { bodyParserErrorHandler, createBodyParsers, requestInputGuard } from '../../../common/body-limits';
import { readMssEnv, type MssEnv } from './mss-config';
import { MSS_ENV_READER } from './mss-flags';
import { MSS_UNAUTHORIZED_BODY, MssInboundGuard, MssSignedRoute } from './mss-inbound.guard';
import { computeMssSignature } from './mss-signer';

const FIXTURES = join(__dirname, '../../../../test/fixtures/mss');
const vectors = JSON.parse(readFileSync(join(FIXTURES, 'signature-vectors.json'), 'utf8')) as {
  secret: string;
  previousSecret: string;
  keyId: string;
  timestamp: number;
  cases: { bodyFile: string | null; signature: string }[];
};
const ORDER_EVENT = readFileSync(join(FIXTURES, 'order-event.json'));
const TS = vectors.timestamp;
const SIG_POST = vectors.cases[0]!.signature;
const SIG_POST_PREV = vectors.cases[1]!.signature;
const SIG_EMPTY = vectors.cases.find((c) => c.bodyFile === null)!.signature;

const fullEnv = (over: Record<string, string | undefined> = {}): MssEnv =>
  readMssEnv({
    NODE_ENV: 'test',
    MSS_BASE_URL: 'https://mss.example.test',
    MSS_KEY_ID: 'tubu-test',
    MSS_OUTBOUND_SECRET: 'outbound-secret-not-for-prod-0123456789',
    MSS_INBOUND_SECRET: vectors.secret,
    MSS_INBOUND_SECRET_PREV: vectors.previousSecret,
    ...over,
  });

function ctxOf(req: { method?: string; headers: Record<string, string | undefined>; rawBody?: Buffer }): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

function signedReq(over: { body?: Buffer | undefined; sig?: string; ts?: number; keyId?: string | undefined; headers?: Record<string, string | undefined> } = {}) {
  const body = 'body' in over ? over.body : ORDER_EVENT;
  return {
    method: 'POST',
    headers: {
      'x-mss-key-id': 'keyId' in over ? over.keyId : vectors.keyId,
      'x-mss-timestamp': String(over.ts ?? TS),
      'x-mss-signature': over.sig ?? SIG_POST,
      ...(body && body.length > 0 ? { 'content-length': String(body.length) } : {}),
      ...over.headers,
    },
    rawBody: body,
  };
}

function expect401(fn: () => unknown): void {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(UnauthorizedException);
  expect((caught as UnauthorizedException).getResponse()).toEqual(MSS_UNAUTHORIZED_BODY);
}

describe('MssInboundGuard (đơn vị)', () => {
  let nowSpy: jest.SpyInstance;
  let warn: jest.SpyInstance;
  beforeEach(() => {
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(TS * 1000);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  const guard = (env: MssEnv = fullEnv()) => new MssInboundGuard(() => env);

  it('chữ ký đúng (vector openssl): cho qua', () => {
    expect(guard().canActivate(ctxOf(signedReq()))).toBe(true);
  });

  it('lệch 301 giây: 401 với thân chung, không nói lý do', () => {
    nowSpy.mockReturnValue((TS + 301) * 1000);
    expect401(() => guard().canActivate(ctxOf(signedReq())));
    nowSpy.mockReturnValue((TS - 301) * 1000);
    expect401(() => guard().canActivate(ctxOf(signedReq())));
  });

  it('đổi 1 byte thân: 401', () => {
    const tampered = Buffer.from(ORDER_EVENT);
    tampered[tampered.length - 3] ^= 0x01;
    expect401(() => guard().canActivate(ctxOf(signedReq({ body: tampered }))));
  });

  it('ký bằng MSS_INBOUND_SECRET_PREV: nhận và cảnh báo để gỡ khoá cũ', () => {
    expect(guard().canActivate(ctxOf(signedReq({ sig: SIG_POST_PREV })))).toBe(true);
    expect(warn.mock.calls.some(([m]) => String(m).includes('MSS_INBOUND_SECRET_PREV'))).toBe(true);
  });

  it('gỡ khoá trước khỏi env: chữ ký bằng khoá cũ bị 401', () => {
    expect401(() => guard(fullEnv({ MSS_INBOUND_SECRET_PREV: undefined })).canActivate(ctxOf(signedReq({ sig: SIG_POST_PREV }))));
  });

  it('thiếu MSS_INBOUND_SECRET: 401 mọi yêu cầu, kể cả chữ ký đúng theo khoá trước', () => {
    expect401(() => guard(fullEnv({ MSS_INBOUND_SECRET: undefined })).canActivate(ctxOf(signedReq())));
    expect401(() => guard(fullEnv({ MSS_INBOUND_SECRET: undefined })).canActivate(ctxOf(signedReq({ sig: SIG_POST_PREV }))));
    expect401(() => guard(readMssEnv({})).canActivate(ctxOf(signedReq())));
  });

  it('bí mật ngắn hơn 32 ký tự coi như thiếu: 401', () => {
    expect401(() => guard(fullEnv({ MSS_INBOUND_SECRET: 'short' })).canActivate(ctxOf(signedReq())));
  });

  it('thân rỗng (GET): ký "<ts>." thì qua; chữ ký của thân khác thì 401', () => {
    expect(guard().canActivate(ctxOf({ ...signedReq({ body: undefined, sig: SIG_EMPTY }), method: 'GET' }))).toBe(true);
    expect(guard().canActivate(ctxOf(signedReq({ body: Buffer.alloc(0), sig: SIG_EMPTY })))).toBe(true);
    expect401(() => guard().canActivate(ctxOf(signedReq({ body: undefined, sig: SIG_POST }))));
  });

  it('có thân mà không có req.rawBody (route lệch nhóm parser): 401 và log lỗi cấu hình', () => {
    const req = { ...signedReq(), rawBody: undefined };
    expect401(() => guard().canActivate(ctxOf(req)));
    expect401(() => guard().canActivate(ctxOf({ ...signedReq({ body: undefined, headers: { 'transfer-encoding': 'chunked' } }), rawBody: undefined })));
  });

  it('thiếu hoặc sai dạng key id, thiếu chữ ký, header lặp: 401', () => {
    expect401(() => guard().canActivate(ctxOf(signedReq({ keyId: undefined }))));
    expect401(() => guard().canActivate(ctxOf(signedReq({ keyId: 'bad key/../' }))));
    expect401(() => guard().canActivate(ctxOf(signedReq({ headers: { 'x-mss-signature': undefined } }))));
    const dup = signedReq();
    (dup.headers as Record<string, unknown>)['x-mss-signature'] = [SIG_POST, SIG_POST];
    expect401(() => guard().canActivate(ctxOf(dup)));
  });

  it('log từ chối không chứa thân hay chữ ký', () => {
    nowSpy.mockReturnValue((TS + 999) * 1000);
    expect401(() => guard().canActivate(ctxOf(signedReq())));
    const logged = warn.mock.calls.map(([m]) => String(m)).join('\n');
    expect(logged).toContain('stale_timestamp');
    expect(logged).not.toContain('0901234567');
    expect(logged).not.toContain(SIG_POST.slice(3, 20));
  });
});

@Controller('integrations/mss/test')
@MssSignedRoute()
class MssProbeController {
  @Post('echo')
  @HttpCode(200)
  echo(@Body() body: { event_id?: string }, @Req() req: { rawBody?: Buffer }) {
    return { eventId: body?.event_id ?? null, rawLength: req.rawBody?.length ?? null };
  }

  @Get('ping')
  ping() {
    return { ok: true };
  }
}

@Controller('other')
class OtherController {
  @Post('echo')
  @HttpCode(200)
  echo(@Req() req: { rawBody?: Buffer }) {
    return { hasRaw: req.rawBody !== undefined };
  }
}

describe('MssSignedRoute qua HTTP thật: parser giữ thân thô cho /api/integrations/mss/*', () => {
  let app: INestApplication;
  let base: string;
  let env: MssEnv = fullEnv();

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const mod = await Test.createTestingModule({
      controllers: [MssProbeController, OtherController],
      providers: [{ provide: MSS_ENV_READER, useValue: () => env }],
    }).compile();
    app = mod.createNestApplication({ bodyParser: false, logger: false });
    app.use(...createBodyParsers('access-secret-not-for-prod-0123456789abc', 30), bodyParserErrorHandler, requestInputGuard);
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  });
  afterAll(async () => {
    await app?.close();
    jest.restoreAllMocks();
  });
  beforeEach(() => {
    env = fullEnv();
  });

  const post = (path: string, body: Buffer, headers: Record<string, string>) =>
    fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });

  const sign = (body: Buffer | string, ts = Math.floor(Date.now() / 1000), secret = vectors.secret) => ({
    'x-mss-key-id': vectors.keyId,
    'x-mss-timestamp': String(ts),
    'x-mss-signature': computeMssSignature(secret, ts, body),
  });

  it('thân sự kiện có \\/ và tiếng Việt: chữ ký trên byte gốc qua, handler vẫn nhận body đã parse', async () => {
    const res = await post('/api/integrations/mss/test/echo', ORDER_EVENT, sign(ORDER_EVENT));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ eventId: '01JCX9Z7Q4M8T2K5V6W3Y0ABCD', rawLength: ORDER_EVENT.length });
  });

  it('đổi 1 byte sau khi ký: 401 thân {error, message} chung', async () => {
    const headers = sign(ORDER_EVENT);
    const tampered = Buffer.from(ORDER_EVENT);
    tampered[tampered.indexOf('385000')] = '4'.charCodeAt(0);
    const res = await post('/api/integrations/mss/test/echo', tampered, headers);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(MSS_UNAUTHORIZED_BODY);
  });

  it('timestamp lệch 301 giây: 401', async () => {
    const res = await post('/api/integrations/mss/test/echo', ORDER_EVENT, sign(ORDER_EVENT, Math.floor(Date.now() / 1000) - 301));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(MSS_UNAUTHORIZED_BODY);
  });

  it('khoá trước còn trong env: qua; thiếu MSS_INBOUND_SECRET: 401', async () => {
    expect((await post('/api/integrations/mss/test/echo', ORDER_EVENT, sign(ORDER_EVENT, undefined, vectors.previousSecret))).status).toBe(200);
    env = fullEnv({ MSS_INBOUND_SECRET: undefined });
    const res = await post('/api/integrations/mss/test/echo', ORDER_EVENT, sign(ORDER_EVENT));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(MSS_UNAUTHORIZED_BODY);
  });

  it('GET thân rỗng ký "<ts>.": qua; không ký: 401', async () => {
    const ok = await fetch(`${base}/api/integrations/mss/test/ping`, { headers: sign('') });
    expect(ok.status).toBe(200);
    expect((await fetch(`${base}/api/integrations/mss/test/ping`)).status).toBe(401);
  });

  it('route ngoài nhóm MSS không giữ thân thô (nhóm parser không bị nới rộng)', async () => {
    const res = await post('/api/other/echo', Buffer.from('{"a":1}'), {});
    expect(await res.json()).toEqual({ hasRaw: false });
  });
});
