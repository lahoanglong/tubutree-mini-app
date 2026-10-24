import type { ErrorEvent } from '@sentry/node';
import { HttpException, HttpStatus } from '@nestjs/common';
import { captureServerError, initSentry, isSentryOn, resetSentryForTest, scrubEvent, type SentrySdk } from './sentry';

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
    expect(opts).toMatchObject({ dsn: 'https://k@o.example.com/1', sendDefaultPii: false, tracesSampleRate: 0, environment: 'production' });
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
