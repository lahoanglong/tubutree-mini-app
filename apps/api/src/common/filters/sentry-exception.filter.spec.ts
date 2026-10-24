import { HttpException, HttpStatus, type ArgumentsHost } from '@nestjs/common';
import { SentryExceptionFilter } from './sentry-exception.filter';
import * as sentry from '../../config/sentry';

function host() {
  const reply = jest.fn();
  const adapter = { reply, isHeadersSent: () => false, getRequestUrl: () => '/x', getRequestMethod: () => 'GET' };
  const h = { getArgByIndex: (i: number) => [{}, {}][i], getArgs: () => [{}, {}], getType: () => 'http', switchToHttp: () => ({ getResponse: () => ({}), getRequest: () => ({}) }) } as unknown as ArgumentsHost;
  return { reply, filter: new SentryExceptionFilter(adapter as never), h };
}

describe('SentryExceptionFilter', () => {
  afterEach(() => jest.restoreAllMocks());

  it('lỗi không rõ → báo Sentry và vẫn trả 500 như mặc định của Nest', () => {
    const spy = jest.spyOn(sentry, 'captureServerError').mockImplementation();
    const { reply, filter, h } = host();
    const err = new Error('boom');
    filter.catch(err, h);
    expect(spy).toHaveBeenCalledWith(err);
    expect(reply).toHaveBeenCalledWith({}, { statusCode: 500, message: 'Internal server error' }, 500);
  });

  it('HttpException 4xx giữ nguyên phản hồi; không có lệnh gửi nào ra khỏi Sentry khi tắt', () => {
    const sdk = { init: jest.fn(), captureException: jest.fn(), getDefaultIntegrations: jest.fn() };
    const spy = jest.spyOn(sentry, 'captureServerError');
    const { reply, filter, h } = host();
    filter.catch(new HttpException('nope', HttpStatus.NOT_FOUND), h);
    expect(spy).toHaveBeenCalled();
    expect(sdk.captureException).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith({}, { statusCode: 404, message: 'nope' }, 404);
  });
});
