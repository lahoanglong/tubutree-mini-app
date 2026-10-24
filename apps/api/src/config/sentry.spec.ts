import type { ErrorEvent } from '@sentry/node';
import { HttpException, HttpStatus } from '@nestjs/common';
import { captureServerError, capturePrismaError, initSentry, isSentryOn, resetSentryForTest, scrubEvent, type SentrySdk } from './sentry';

function fakeSdk(): jest.Mocked<SentrySdk> {
  return {
    init: jest.fn(),
    captureException: jest.fn(),
    getDefaultIntegrations: jest.fn(() => [{ name: 'Http' }, { name: 'OnUnhandledRejection' }, { name: 'LocalVariablesAsync' }, { name: 'OnUncaughtException' }]),
  } as unknown as jest.Mocked<SentrySdk>;
}

afterEach(() => resetSentryForTest());

describe('initSentry', () => {
  it.each([undefined, '', '   '])('DSN %p: không khởi tạo SDK, không bắt lỗi', (dsn) => {
    const sdk = fakeSdk();
    expect(initSentry({ SENTRY_DSN: dsn }, sdk)).toBe(false);
    captureServerError(new Error('boom'), sdk);
    expect(sdk.init).not.toHaveBeenCalled();
    expect(sdk.captureException).not.toHaveBeenCalled();
    expect(isSentryOn()).toBe(false);
  });

  it('có DSN: init một lần với PII tắt, không tracing, môi trường mặc định theo NODE_ENV', () => {
    const sdk = fakeSdk();
    expect(initSentry({ SENTRY_DSN: 'https://k@o.example.com/1', NODE_ENV: 'production' }, sdk)).toBe(true);
    const opts = sdk.init.mock.calls[0]![0]!;
    expect(opts).toMatchObject({ dsn: 'https://k@o.example.com/1', sendDefaultPii: false, environment: 'production' });
    expect(opts).not.toHaveProperty('tracesSampleRate');
    expect(opts.beforeSend).toBe(scrubEvent);
    expect(opts.release).toBeUndefined();
  });

  it('SENTRY_ENVIRONMENT và SENTRY_RELEASE ghi đè; bỏ integration unhandledRejection và biến cục bộ để main.ts bắt một lần', () => {
    const sdk = fakeSdk();
    initSentry({ SENTRY_DSN: 'https://k@o.example.com/1', SENTRY_ENVIRONMENT: 'staging', SENTRY_RELEASE: 'abc123', NODE_ENV: 'production' }, sdk);
    const opts = sdk.init.mock.calls[0]![0]!;
    expect(opts).toMatchObject({ environment: 'staging', release: 'abc123' });
    const integrations = (opts.integrations as (d: { name: string }[]) => { name: string }[])(sdk.getDefaultIntegrations({}) as { name: string }[]);
    expect(integrations.map((i) => i.name)).toEqual(['Http', 'OnUncaughtException']);
  });

  it('init hai lần chỉ khởi tạo một lần', () => {
    const sdk = fakeSdk();
    initSentry({ SENTRY_DSN: 'https://k@o.example.com/1' }, sdk);
    initSentry({ SENTRY_DSN: 'https://k@o.example.com/1' }, sdk);
    expect(sdk.init).toHaveBeenCalledTimes(1);
  });
});

describe('captureServerError', () => {
  const on = () => {
    const sdk = fakeSdk();
    initSentry({ SENTRY_DSN: 'https://k@o.example.com/1' }, sdk);
    return sdk;
  };

  it('lỗi thường và HttpException 5xx được gửi', () => {
    const sdk = on();
    const err = new Error('boom');
    captureServerError(err, sdk);
    captureServerError(new HttpException('x', HttpStatus.BAD_GATEWAY), sdk);
    expect(sdk.captureException).toHaveBeenCalledTimes(2);
    expect(sdk.captureException).toHaveBeenNthCalledWith(1, err);
  });

  it.each([
    ['PayloadTooLargeError 413', Object.assign(new Error('request entity too large'), { statusCode: 413, status: 413, expose: true })],
    ['request aborted 400', Object.assign(new Error('request aborted'), { status: 400, expose: true })],
    ['unsupported media 415', Object.assign(new Error('x'), { statusCode: 415, expose: true })],
  ])('lỗi http-errors của body-parser không được gửi: %s', (_n, err) => {
    const sdk = on();
    captureServerError(err, sdk);
    expect(sdk.captureException).not.toHaveBeenCalled();
  });

  it('AxiosError 401 từ lời gọi ra ngoài vẫn được gửi (khách thấy 500)', () => {
    const sdk = on();
    captureServerError(Object.assign(new Error('Request failed with status code 401'), { isAxiosError: true, status: 401, expose: true }), sdk);
    captureServerError(Object.assign(new Error('x'), { isAxiosError: true, status: 404 }), sdk);
    expect(sdk.captureException).toHaveBeenCalledTimes(2);
  });

  it('lỗi 502 thường vẫn được gửi', () => {
    const sdk = on();
    captureServerError(Object.assign(new Error('x'), { status: 502 }), sdk);
    captureServerError(Object.assign(new Error('x'), { status: 404 }), sdk);
    expect(sdk.captureException).toHaveBeenCalledTimes(2);
  });

  it('lỗi có statusCode 5xx vẫn được gửi', () => {
    const sdk = on();
    captureServerError(Object.assign(new Error('x'), { statusCode: 502 }), sdk);
    expect(sdk.captureException).toHaveBeenCalledTimes(1);
  });

  it('HttpException 4xx không bao giờ được gửi', () => {
    const sdk = on();
    captureServerError(new HttpException('x', HttpStatus.NOT_FOUND), sdk);
    captureServerError(new HttpException('x', HttpStatus.TOO_MANY_REQUESTS), sdk);
    expect(sdk.captureException).not.toHaveBeenCalled();
  });
});

describe('scrubEvent', () => {
  it('bỏ cookie, Authorization, thân request, query và che token trong URL', () => {
    const event = {
      type: undefined,
      request: {
        url: 'https://api.x.com/api/webhooks/gomdon/SECRET?token=abc&a=1',
        query_string: 'token=abc',
        cookies: { rt: '1' },
        data: { phone: '0901' },
        headers: { Authorization: 'Bearer t', authorization: 'Bearer t', Cookie: 'a=b', 'x-webhook-token': 's', 'User-Agent': 'curl' },
      },
      breadcrumbs: [{ category: 'http', message: 'GET /x?token=1' }],
    } as unknown as ErrorEvent;
    const out = scrubEvent(event)!;
    expect(out.request).not.toHaveProperty('cookies');
    expect(out.request).not.toHaveProperty('data');
    expect(out.request).not.toHaveProperty('query_string');
    expect(out.request!.headers).toEqual({ 'User-Agent': 'curl' });
    expect(out.request!.url).not.toContain('SECRET');
    expect(out.request!.url).not.toContain('abc');
    expect(out.breadcrumbs).toEqual([]);
  });

  it('event không có request vẫn qua', () => {
    expect(scrubEvent({ message: 'm' } as ErrorEvent)).toEqual({ message: 'm' });
  });
});

describe('scrubEvent: transaction, allowlist header, referer', () => {
  it('transaction mang đường dẫn thô được che token webhook', () => {
    const out = scrubEvent({ transaction: 'POST /api/webhooks/gomdon/SUPERSECRET123' } as ErrorEvent)!;
    expect(out.transaction).not.toContain('SUPERSECRET123');
  });

  it('chỉ giữ header vô hại; token lạ như x-accesstrade-token bị bỏ', () => {
    const out = scrubEvent({
      request: {
        headers: {
          'x-accesstrade-token': 'AT-SECRET',
          'x-webhook-token': 's',
          authorization: 'Bearer t',
          cookie: 'a=b',
          'idempotency-key': 'k',
          'user-agent': 'curl',
          'content-type': 'application/json',
          Referer: 'https://app.x.com/cb?code=ZALO&state=S',
        },
      },
    } as unknown as ErrorEvent)!;
    expect(out.request!.headers).toEqual({ 'user-agent': 'curl', 'content-type': 'application/json', Referer: 'https://app.x.com/cb' });
  });
});

describe('capturePrismaError', () => {
  it('gửi thông điệp cố định, không có message gốc hay giá trị meta', () => {
    const { Prisma } = jest.requireActual('@prisma/client');
    const sdk = fakeSdk();
    initSentry({ SENTRY_DSN: 'https://k@o.example.com/1' }, sdk);
    const err = new Prisma.PrismaClientKnownRequestError('Invalid invocation phone: "0901234567"', {
      code: 'P2000',
      clientVersion: 't',
      meta: { modelName: 'User', target: ['0901234567'] },
    });
    capturePrismaError(err, 'POST /api/webhooks/gomdon/SUPERSECRET', sdk);
    const sent = sdk.captureException.mock.calls[0]![0] as Error;
    const blob = `${sent.name} ${sent.message} ${sent.stack}`;
    expect(blob).not.toContain('0901234567');
    expect(blob).not.toContain('SUPERSECRET');
    expect(blob).toContain('PrismaClientKnownRequestError');
    expect(blob).toContain('P2000');
    expect(blob).toContain('User');
  });

  it('route có query không đưa query vào message', () => {
    const { Prisma } = jest.requireActual('@prisma/client');
    const sdk = fakeSdk();
    initSentry({ SENTRY_DSN: 'https://k@o.example.com/1' }, sdk);
    capturePrismaError(new Prisma.PrismaClientValidationError('x', { clientVersion: 't' }), 'GET /api/admin/support-chat?q=0901234567#h', sdk);
    const sent = sdk.captureException.mock.calls[0]![0] as Error;
    expect(`${sent.message} ${sent.stack}`).not.toContain('0901234567');
    expect(sent.message).not.toContain('?');
    expect(sent.message).toContain('/api/admin/support-chat');
  });

  it('PrismaClientValidationError (không code) cũng chỉ gửi tên lớp và route', () => {
    const { Prisma } = jest.requireActual('@prisma/client');
    const sdk = fakeSdk();
    initSentry({ SENTRY_DSN: 'https://k@o.example.com/1' }, sdk);
    capturePrismaError(new Prisma.PrismaClientValidationError('address: "12 Le Loi" 0901234567', { clientVersion: 't' }), 'GET /x', sdk);
    const sent = sdk.captureException.mock.calls[0]![0] as Error;
    expect(`${sent.message} ${sent.stack}`).not.toContain('0901234567');
    expect(sent.message).toContain('GET /x');
  });
});
