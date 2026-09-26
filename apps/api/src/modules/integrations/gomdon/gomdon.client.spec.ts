import { ServiceUnavailableException } from '@nestjs/common';
import axios from 'axios';
import { GomdonClient } from './gomdon.client';
import { GomdonAmbiguousError, GomdonRejectedError } from './gomdon.errors';
import type { SystemConfigService } from '../../system-config/system-config.service';
import type { GomdonCreateOrderBody } from './gomdon.types';

jest.mock('axios');

const ENV_KEYS = ['GOMDON_BASE_URL', 'GOMDON_PHONE', 'GOMDON_PASSWORD'] as const;

function axiosErr(opts: { status?: number; code?: string; data?: unknown }) {
  return {
    isAxiosError: true,
    code: opts.code,
    message: opts.code ?? `HTTP ${opts.status}`,
    response: opts.status !== undefined ? { status: opts.status, data: opts.data ?? {} } : undefined,
  };
}

const LOGIN_OK = { data: { result: true, data: { access_token: 'tok-1', expires_in: 3600 } } };
const body = { order_customer_id: 'TUBU1' } as unknown as GomdonCreateOrderBody;

describe('GomdonClient', () => {
  let mockHttp: { post: jest.Mock };
  let systemConfig: { get: jest.Mock };
  const saved: Record<string, string | undefined> = {};

  function makeClient() {
    return new GomdonClient(systemConfig as unknown as SystemConfigService);
  }

  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    process.env.GOMDON_BASE_URL = 'https://gomdon.test';
    delete process.env.GOMDON_PHONE;
    delete process.env.GOMDON_PASSWORD;
    mockHttp = { post: jest.fn() };
    (axios.create as jest.Mock).mockReturnValue(mockHttp);
    (axios.isAxiosError as unknown as jest.Mock) = jest.fn((e) => Boolean(e && (e as { isAxiosError?: boolean }).isAxiosError));
    systemConfig = {
      get: jest.fn().mockResolvedValue({ phone: '0987654321', password: 'secretpassword' }),
    };
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    jest.clearAllMocks();
  });

  describe('isConfigured / base URL', () => {
    it('đủ base URL + tài khoản → true', async () => {
      expect(await makeClient().isConfigured()).toBe(true);
      expect(axios.create).toHaveBeenCalledWith(expect.objectContaining({ baseURL: 'https://gomdon.test' }));
    });

    it('dev/test KHÔNG đặt GOMDON_BASE_URL → false dù có tài khoản (không bao giờ tự đặt bưu tá thật)', async () => {
      delete process.env.GOMDON_BASE_URL;
      expect(await makeClient().isConfigured()).toBe(false);
    });

    it('thiếu phone/password → false', async () => {
      systemConfig.get.mockResolvedValue({ phone: '', password: '' });
      expect(await makeClient().isConfigured()).toBe(false);
    });

    it('tài khoản từ ENV được ưu tiên', async () => {
      process.env.GOMDON_PHONE = 'env-phone';
      process.env.GOMDON_PASSWORD = 'env-pass';
      systemConfig.get.mockResolvedValue({});
      const c = makeClient();
      mockHttp.post.mockResolvedValueOnce(LOGIN_OK);
      await c.login();
      const form = mockHttp.post.mock.calls[0][1] as FormData;
      expect(form.get('phone')).toBe('env-phone');
    });
  });

  describe('login', () => {
    it('chưa cấu hình → ServiceUnavailableException', async () => {
      systemConfig.get.mockResolvedValue({});
      await expect(makeClient().login()).rejects.toThrow(ServiceUnavailableException);
    });

    it('thành công → token được cache (lần 2 không gọi login)', async () => {
      const c = makeClient();
      mockHttp.post.mockResolvedValueOnce(LOGIN_OK);
      expect(await c.getValidToken()).toBe('tok-1');
      expect(await c.getValidToken()).toBe('tok-1');
      expect(mockHttp.post).toHaveBeenCalledTimes(1);
      expect(mockHttp.post).toHaveBeenCalledWith('/api/v2/auth/login', expect.any(FormData));
    });

    it('single-flight: 2 lời gọi đồng thời chỉ đăng nhập 1 lần', async () => {
      const c = makeClient();
      mockHttp.post.mockResolvedValueOnce(LOGIN_OK);
      const [a, b] = await Promise.all([c.login(), c.login()]);
      expect(a).toBe('tok-1');
      expect(b).toBe('tok-1');
      expect(mockHttp.post).toHaveBeenCalledTimes(1);
    });

    it('result:false → lỗi kèm thông điệp', async () => {
      mockHttp.post.mockResolvedValueOnce({ data: { result: false, message: 'Sai mật khẩu' } });
      await expect(makeClient().login()).rejects.toThrow('Đăng nhập Gomdon thất bại: Sai mật khẩu');
    });
  });

  describe('createOrder — phân loại lỗi chống tạo trùng vận đơn', () => {
    it('thành công → trả data', async () => {
      const c = makeClient();
      mockHttp.post
        .mockResolvedValueOnce(LOGIN_OK)
        .mockResolvedValueOnce({ data: { result: true, data: { id: 9, partner_code: 'BE9' } } });
      const res = await c.createOrder(body);
      expect(res.data?.partner_code).toBe('BE9');
      expect(mockHttp.post).toHaveBeenLastCalledWith('/api/v2/order/create', expect.any(FormData), {
        headers: { Authorization: 'Bearer tok-1' },
      });
    });

    it('401 → đăng nhập lại và gửi lại đúng 1 lần', async () => {
      const c = makeClient();
      mockHttp.post
        .mockResolvedValueOnce(LOGIN_OK)
        .mockRejectedValueOnce(axiosErr({ status: 401 }))
        .mockResolvedValueOnce({ data: { result: true, data: { access_token: 'tok-2' } } })
        .mockResolvedValueOnce({ data: { result: true, data: { id: 1, partner_code: 'BE1' } } });
      const res = await c.createOrder(body);
      expect(res.data?.partner_code).toBe('BE1');
      expect(mockHttp.post).toHaveBeenLastCalledWith('/api/v2/order/create', expect.any(FormData), {
        headers: { Authorization: 'Bearer tok-2' },
      });
    });

    it('200 + result:false kiểu "token hết hạn" → đăng nhập lại và thử lại', async () => {
      const c = makeClient();
      mockHttp.post
        .mockResolvedValueOnce(LOGIN_OK)
        .mockResolvedValueOnce({ data: { result: false, message: 'Token hết hạn' } })
        .mockResolvedValueOnce({ data: { result: true, data: { access_token: 'tok-2' } } })
        .mockResolvedValueOnce({ data: { result: true, data: { id: 2, partner_code: 'BE2' } } });
      expect((await c.createOrder(body)).data?.partner_code).toBe('BE2');
    });

    it('result:false (Gomdon từ chối) → GomdonRejectedError (retry an toàn)', async () => {
      const c = makeClient();
      mockHttp.post.mockResolvedValueOnce(LOGIN_OK).mockResolvedValueOnce({ data: { result: false, message: 'Sai địa chỉ' } });
      await expect(c.createOrder(body)).rejects.toBeInstanceOf(GomdonRejectedError);
    });

    it('HTTP 4xx → Rejected; 503 → Rejected', async () => {
      for (const status of [400, 422, 429, 503]) {
        const c = makeClient();
        mockHttp.post.mockReset();
        mockHttp.post.mockResolvedValueOnce(LOGIN_OK).mockRejectedValueOnce(axiosErr({ status }));
        await expect(c.createOrder(body)).rejects.toBeInstanceOf(GomdonRejectedError);
      }
    });

    it('timeout / ECONNRESET / 500 / 504 → GomdonAmbiguousError (có thể đã tạo — KHÔNG retry)', async () => {
      const cases = [axiosErr({ code: 'ECONNABORTED' }), axiosErr({ code: 'ECONNRESET' }), axiosErr({ status: 500 }), axiosErr({ status: 504 })];
      for (const e of cases) {
        const c = makeClient();
        mockHttp.post.mockReset();
        mockHttp.post.mockResolvedValueOnce(LOGIN_OK).mockRejectedValueOnce(e);
        await expect(c.createOrder(body)).rejects.toBeInstanceOf(GomdonAmbiguousError);
      }
    });

    it('ECONNREFUSED (request chưa tới server) → Rejected', async () => {
      const c = makeClient();
      mockHttp.post.mockResolvedValueOnce(LOGIN_OK).mockRejectedValueOnce(axiosErr({ code: 'ECONNREFUSED' }));
      await expect(c.createOrder(body)).rejects.toBeInstanceOf(GomdonRejectedError);
    });

    it('result:true nhưng thiếu data → Ambiguous', async () => {
      const c = makeClient();
      mockHttp.post.mockResolvedValueOnce(LOGIN_OK).mockResolvedValueOnce({ data: { result: true } });
      await expect(c.createOrder(body)).rejects.toBeInstanceOf(GomdonAmbiguousError);
    });

    it('đăng nhập lỗi (chưa gửi tạo đơn) → Rejected', async () => {
      const c = makeClient();
      mockHttp.post.mockResolvedValueOnce({ data: { result: false, message: 'Sai mật khẩu' } });
      await expect(c.createOrder(body)).rejects.toBeInstanceOf(GomdonRejectedError);
      expect(mockHttp.post).toHaveBeenCalledTimes(1);
    });
  });

  describe('cancelOrder', () => {
    it('result:true → ok', async () => {
      const c = makeClient();
      mockHttp.post.mockResolvedValueOnce(LOGIN_OK).mockResolvedValueOnce({ data: { result: true } });
      expect(await c.cancelOrder('55')).toEqual({ ok: true, message: undefined });
      expect(mockHttp.post).toHaveBeenLastCalledWith('/api/v2/order/cancel/55', expect.any(FormData), {
        headers: { Authorization: 'Bearer tok-1' },
      });
    });

    it('401 → đăng nhập lại rồi huỷ lại', async () => {
      const c = makeClient();
      mockHttp.post
        .mockResolvedValueOnce(LOGIN_OK)
        .mockRejectedValueOnce(axiosErr({ status: 401 }))
        .mockResolvedValueOnce({ data: { result: true, data: { access_token: 'tok-2' } } })
        .mockResolvedValueOnce({ data: { result: true } });
      expect((await c.cancelOrder('55')).ok).toBe(true);
    });

    it('result:false / không có result → ok=false (caller retry rồi báo CSKH)', async () => {
      const c = makeClient();
      mockHttp.post.mockResolvedValueOnce(LOGIN_OK).mockResolvedValueOnce({ data: { result: false, message: 'Đã lấy hàng' } });
      expect(await c.cancelOrder('55')).toEqual({ ok: false, message: 'Đã lấy hàng' });
      mockHttp.post.mockResolvedValueOnce({ data: {} });
      expect((await c.cancelOrder('55')).ok).toBe(false);
    });
  });
});
