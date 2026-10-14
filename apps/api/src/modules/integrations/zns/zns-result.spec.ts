jest.mock('axios', () => {
  const actual = jest.requireActual('axios');
  return { ...actual, __esModule: true, default: { ...actual.default, post: jest.fn() } };
});
import axios, { AxiosError } from 'axios';
import { ZnsClient } from './zns.client';
import { interpretZnsBody, interpretZnsException, znsFailureText } from './zns-result';
import type { ZaloOaTokenService } from './zalo-oa-token.service';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.validation';

const post = axios.post as jest.Mock;

function makeClient(token = 'tok') {
  const tokens = { getAccessToken: jest.fn().mockResolvedValue(token) } as unknown as ZaloOaTokenService;
  const config = { get: () => 'https://zns.test' } as unknown as ConfigService<Env, true>;
  return new ZnsClient(config, tokens);
}

function httpError(status: number, data?: unknown): AxiosError {
  const err = new AxiosError('Request failed', 'ERR_BAD_RESPONSE');
  err.response = { status, data, statusText: '', headers: {}, config: {} as never };
  return err;
}

beforeEach(() => post.mockReset());

describe('interpretZnsBody', () => {
  it('chỉ error === 0 mới là thành công', () => {
    expect(interpretZnsBody({ error: 0, message: 'Success', data: { msg_id: 'm1' } })).toEqual({ ok: true });
  });

  it('HTTP 200 kèm error != 0 → thất bại, giữ mã và thông điệp của Zalo', () => {
    const r = interpretZnsBody({ error: -124, message: 'template not approved' });
    expect(r).toMatchObject({ ok: false, code: -124 });
    expect(znsFailureText(r as never)).toContain('-124');
    expect(znsFailureText(r as never)).toContain('template not approved');
  });

  it('error dạng chuỗi "0" vẫn đọc được, chuỗi số khác 0 là lỗi', () => {
    expect(interpretZnsBody({ error: '0' })).toEqual({ ok: true });
    expect(interpretZnsBody({ error: '-118', message: 'user not exist' })).toMatchObject({ ok: false, code: -118 });
  });

  it('body không có trường error (HTML của proxy, rỗng) → thất bại có thể thử lại, không tính là đã gửi', () => {
    for (const body of [undefined, null, '', '<html>502</html>', {}, { message: 'x' }]) {
      expect(interpretZnsBody(body)).toMatchObject({ ok: false, retryable: true, code: null });
    }
  });

  it('lỗi dữ liệu/quyền của người nhận là vĩnh viễn: không xếp thử lại', () => {
    for (const code of [-108, -118, -1121, -1122, -1124, -117, -120]) {
      expect(interpretZnsBody({ error: code, message: 'm' })).toMatchObject({ ok: false, retryable: false });
    }
  });

  it('lỗi hệ thống và access token hết hạn là tạm thời: xếp thử lại', () => {
    for (const code of [-100, -124, -216]) {
      expect(interpretZnsBody({ error: code, message: 'm' })).toMatchObject({ ok: false, retryable: true });
    }
  });

  it('mã lạ chưa biết là vĩnh viễn để admin thấy lý do ngay, không lặp vô ích', () => {
    expect(interpretZnsBody({ error: -99999, message: 'lạ' })).toMatchObject({ ok: false, retryable: false });
  });
});

describe('interpretZnsException', () => {
  it('không có response (timeout, mất mạng) → thử lại', () => {
    expect(interpretZnsException(new AxiosError('timeout of 10000ms exceeded', 'ECONNABORTED'))).toMatchObject({
      ok: false,
      retryable: true,
      code: null,
    });
    expect(interpretZnsException(new Error('boom'))).toMatchObject({ ok: false, retryable: true });
  });

  it('HTTP 5xx/429/408 → thử lại; 4xx khác → vĩnh viễn', () => {
    expect(interpretZnsException(httpError(503))).toMatchObject({ retryable: true });
    expect(interpretZnsException(httpError(429))).toMatchObject({ retryable: true });
    expect(interpretZnsException(httpError(408))).toMatchObject({ retryable: true });
    expect(interpretZnsException(httpError(400))).toMatchObject({ retryable: false });
  });

  it('HTTP lỗi nhưng body có mã Zalo → phân loại theo mã', () => {
    expect(interpretZnsException(httpError(400, { error: -124, message: 'token' }))).toMatchObject({
      retryable: true,
      code: -124,
    });
    expect(interpretZnsException(httpError(400, { error: -108, message: 'phone' }))).toMatchObject({
      retryable: false,
      code: -108,
    });
  });
});

describe('ZnsClient.sendTemplate', () => {
  it('HTTP 200 + {error:-124} KHÔNG phải thành công (R2-ENGAGE-1)', async () => {
    post.mockResolvedValue({ status: 200, data: { error: -124, message: 'template not approved' } });
    const r = await makeClient().sendTemplate('0900000000', 'tpl', { a: '1' });
    expect(r).toMatchObject({ ok: false, code: -124 });
  });

  it('HTTP 200 + {error:0} là thành công', async () => {
    post.mockResolvedValue({ status: 200, data: { error: 0, message: 'Success', data: { msg_id: 'x' } } });
    expect(await makeClient().sendTemplate('0900000000', 'tpl', {})).toEqual({ ok: true });
  });

  it('axios ném lỗi mạng → thất bại có thể thử lại', async () => {
    post.mockRejectedValue(new AxiosError('timeout', 'ECONNABORTED'));
    expect(await makeClient().sendTemplate('0900000000', 'tpl', {})).toMatchObject({ ok: false, retryable: true });
  });

  it('chưa có access token → vĩnh viễn, không gọi Zalo', async () => {
    const r = await makeClient('').sendTemplate('0900000000', 'tpl', {});
    expect(r).toMatchObject({ ok: false, retryable: false, code: null });
    expect(post).not.toHaveBeenCalled();
  });
});
