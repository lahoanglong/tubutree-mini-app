import { ServiceUnavailableException } from '@nestjs/common';
import axios from 'axios';
import { GomdonClient } from './gomdon.client';
import { GomdonAmbiguousError, GomdonDuplicateOrderError, GomdonRejectedError } from './gomdon.errors';
import type { SystemConfigService } from '../../system-config/system-config.service';
import type { GomdonCreateOrderBody } from './gomdon.types';
import { gomdonHealth } from './gomdon-health';
import { GOMDON_RECYCLING_TOGGLE_KEY } from './gomdon-config';

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

/**
 * Mẫu theo tài liệu Gomdon (Postman "GOMDON API", docs/integrations/gomdon.md): token ở data.access_token,
 * token_type "Bearer", expires_at = null (token không tự hết hạn). KHÔNG có expires_in. Giá trị token/SĐT
 * ở đây là giả — không chép token/SĐT mẫu của tài liệu.
 */
const loginOk = (token: string, expiresAt: string | null = null) => ({
  data: {
    result: true,
    message: 'Đã đăng nhập thành công',
    data: { access_token: token, token_type: 'Bearer', expires_at: expiresAt, user: { id: 1, type: 'customer' } },
  },
});
const LOGIN_OK = loginOk('tok-1');
const body = { order_customer_id: 'TUBU1' } as unknown as GomdonCreateOrderBody;
/** Mẫu tạo đơn thành công theo tài liệu: id số (dùng để huỷ), code = mã nội bộ Gomdon, partner_code = mã vận đơn. */
const CREATE_OK = {
  data: {
    result: true,
    data: { id: 900001, code: '900001-11-shop_demo', partner_code: '84850000000001', status: 1, created_time: 1758330000 },
  },
};

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
    gomdonHealth.reset();
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

    it('tài liệu: form-data đúng 2 trường phone + password, token lấy ở data.access_token', async () => {
      const c = makeClient();
      mockHttp.post.mockResolvedValueOnce(LOGIN_OK);
      expect(await c.login()).toBe('tok-1');
      const form = mockHttp.post.mock.calls[0][1] as FormData;
      expect([...form.keys()].sort()).toEqual(['password', 'phone']);
      expect(form.get('phone')).toBe('0987654321');
      expect(form.get('password')).toBe('secretpassword');
    });

    it('tài liệu: sai tài khoản → HTTP 401 + {result:false, message, data:null} → lỗi kèm thông điệp Gomdon', async () => {
      mockHttp.post.mockRejectedValueOnce(
        axiosErr({ status: 401, data: { result: false, message: 'Tài khoản hoặc mật khẩu sai', data: null } }),
      );
      await expect(makeClient().login()).rejects.toThrow('Đăng nhập Gomdon thất bại (HTTP 401): Tài khoản hoặc mật khẩu sai');
    });

    describe('thời hạn token (tài liệu: expires_at, KHÔNG có expires_in)', () => {
      const T0 = Date.parse('2026-09-27T00:00:00Z');
      let now = T0;
      beforeEach(() => {
        now = T0;
        jest.spyOn(Date, 'now').mockImplementation(() => now);
      });
      afterEach(() => jest.restoreAllMocks());

      it('expires_at null (token không tự hết hạn) → giữ token tối đa 24 giờ rồi mới đăng nhập lại', async () => {
        const c = makeClient();
        mockHttp.post.mockResolvedValueOnce(loginOk('tok-1', null)).mockResolvedValueOnce(loginOk('tok-2', null));
        expect(await c.getValidToken()).toBe('tok-1');
        now = T0 + 23 * 3600_000;
        expect(await c.getValidToken()).toBe('tok-1');
        now = T0 + 24 * 3600_000 + 1;
        expect(await c.getValidToken()).toBe('tok-2');
        expect(mockHttp.post).toHaveBeenCalledTimes(2);
      });

      it('expires_at là thời điểm cụ thể (ISO kiểu Laravel) → đăng nhập lại trước hạn 5 phút', async () => {
        const c = makeClient();
        mockHttp.post
          .mockResolvedValueOnce(loginOk('tok-1', '2026-09-27T00:10:00.000000Z'))
          .mockResolvedValueOnce(loginOk('tok-2', null));
        expect(await c.getValidToken()).toBe('tok-1');
        now = T0 + 4 * 60_000;
        expect(await c.getValidToken()).toBe('tok-1');
        now = T0 + 6 * 60_000; // đã qua mốc hạn − 5 phút
        expect(await c.getValidToken()).toBe('tok-2');
        expect(mockHttp.post).toHaveBeenCalledTimes(2);
      });

      it('expires_at rất xa → vẫn không giữ quá 24 giờ', async () => {
        const c = makeClient();
        mockHttp.post
          .mockResolvedValueOnce(loginOk('tok-1', '2027-09-27T00:00:00.000000Z'))
          .mockResolvedValueOnce(loginOk('tok-2', null));
        await c.getValidToken();
        now = T0 + 24 * 3600_000 + 1;
        expect(await c.getValidToken()).toBe('tok-2');
      });
    });
  });

  describe('createOrder — phân loại lỗi chống tạo trùng vận đơn', () => {
    it('thành công (mẫu tài liệu) → POST /api/v2/order/create multipart + Bearer, trả nguyên data', async () => {
      const c = makeClient();
      mockHttp.post.mockResolvedValueOnce(LOGIN_OK).mockResolvedValueOnce(CREATE_OK);
      const res = await c.createOrder({ ...body, type: 3, weight: 2400 });
      expect(res.data).toMatchObject({ id: 900001, code: '900001-11-shop_demo', partner_code: '84850000000001', status: 1 });
      expect(mockHttp.post).toHaveBeenLastCalledWith('/api/v2/order/create', expect.any(FormData), {
        headers: { Authorization: 'Bearer tok-1' },
      });
      // Số được gửi dạng chuỗi trong form-data (đúng như mẫu Postman).
      const form = mockHttp.post.mock.calls[1][1] as FormData;
      expect(form.get('type')).toBe('3');
      expect(form.get('weight')).toBe('2400');
      expect(form.get('order_customer_id')).toBe('TUBU1');
    });

    it('tài liệu: HTTP 401 {message:"Mã token không đúng", result:false} → đăng nhập lại và gửi lại đúng 1 lần', async () => {
      const c = makeClient();
      mockHttp.post
        .mockResolvedValueOnce(LOGIN_OK)
        .mockRejectedValueOnce(axiosErr({ status: 401, data: { message: 'Mã token không đúng', result: false } }))
        .mockResolvedValueOnce(loginOk('tok-2'))
        .mockResolvedValueOnce({ data: { result: true, data: { id: 1, partner_code: 'BE1' } } });
      const res = await c.createOrder(body);
      expect(res.data?.partner_code).toBe('BE1');
      expect(mockHttp.post).toHaveBeenLastCalledWith('/api/v2/order/create', expect.any(FormData), {
        headers: { Authorization: 'Bearer tok-2' },
      });
    });

    it('tài liệu: order_customer_id "dùng để check unique" → Gomdon báo trùng mã = ĐÃ CÓ đơn → GomdonDuplicateOrderError (KHÔNG phải Rejected)', async () => {
      for (const message of ['The order customer id has already been taken.', 'Mã đơn hàng đã tồn tại']) {
        const c = makeClient();
        mockHttp.post.mockReset();
        mockHttp.post.mockResolvedValueOnce(LOGIN_OK).mockResolvedValueOnce({ data: { result: false, message } });
        const err = await c.createOrder(body).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(GomdonDuplicateOrderError);
        // Không bao giờ bị hiểu là "chắc chắn chưa tạo" (retry an toàn) — chính là loại lỗi không được retry.
        expect(err).toBeInstanceOf(GomdonAmbiguousError);
        expect(err).not.toBeInstanceOf(GomdonRejectedError);
      }
    });

    it('HTTP 4xx kèm thông điệp trùng mã đơn (422/409) → GomdonDuplicateOrderError', async () => {
      for (const status of [409, 422]) {
        const c = makeClient();
        mockHttp.post.mockReset();
        mockHttp.post
          .mockResolvedValueOnce(LOGIN_OK)
          .mockRejectedValueOnce(axiosErr({ status, data: { result: false, message: 'The order customer id has already been taken.' } }));
        await expect(c.createOrder(body)).rejects.toBeInstanceOf(GomdonDuplicateOrderError);
      }
    });

    it('200 + result:false kiểu "token hết hạn" → đăng nhập lại và thử lại', async () => {
      const c = makeClient();
      mockHttp.post
        .mockResolvedValueOnce(LOGIN_OK)
        .mockResolvedValueOnce({ data: { result: false, message: 'Token hết hạn' } })
        .mockResolvedValueOnce(loginOk('tok-2'))
        .mockResolvedValueOnce({ data: { result: true, data: { id: 2, partner_code: 'BE2' } } });
      expect((await c.createOrder(body)).data?.partner_code).toBe('BE2');
    });

    it('tài liệu: thiếu trường → HTTP 200 + result:false "The source province field is required." → GomdonRejectedError (retry an toàn)', async () => {
      const c = makeClient();
      mockHttp.post
        .mockResolvedValueOnce(LOGIN_OK)
        .mockResolvedValueOnce({ data: { result: false, message: 'The source province field is required.' } });
      const err = await c.createOrder(body).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(GomdonRejectedError);
      expect((err as Error).message).toContain('The source province field is required.');
    });

    it('429/503 → Rejected TẠM; 4xx khác → Rejected dứt khoát', async () => {
      const c = makeClient();
      for (const [status, transient] of [
        [429, true],
        [503, true],
        [400, false],
        [422, false],
      ] as const) {
        mockHttp.post.mockReset();
        mockHttp.post.mockResolvedValueOnce(LOGIN_OK).mockRejectedValueOnce(axiosErr({ status, data: { message: 'x' } }));
        (c as unknown as { cachedToken: null }).cachedToken = null;
        const err = await c.createOrder(body).catch((e) => e);
        expect(err).toBeInstanceOf(GomdonRejectedError);
        expect((err as GomdonRejectedError).transient).toBe(transient);
      }
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

    it('ECONNREFUSED (request chưa tới server) → Rejected TẠM', async () => {
      const c = makeClient();
      mockHttp.post.mockResolvedValueOnce(LOGIN_OK).mockRejectedValueOnce(axiosErr({ code: 'ECONNREFUSED' }));
      const err = await c.createOrder(body).catch((e) => e);
      expect(err).toBeInstanceOf(GomdonRejectedError);
      expect((err as GomdonRejectedError).transient).toBe(true);
    });

    it('validate result:false → Rejected dứt khoát (không thử lại lâu)', async () => {
      const c = makeClient();
      mockHttp.post
        .mockResolvedValueOnce(LOGIN_OK)
        .mockResolvedValueOnce({ data: { result: false, message: 'The source province field is required.' } });
      const err = await c.createOrder(body).catch((e) => e);
      expect((err as GomdonRejectedError).transient).toBe(false);
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
    it('tài liệu: POST /api/v2/order/cancel/{id số Gomdon}, form rỗng; {result:true} → ok', async () => {
      const c = makeClient();
      mockHttp.post
        .mockResolvedValueOnce(LOGIN_OK)
        .mockResolvedValueOnce({ data: { result: true, message: 'Hủy đơn hàng thành công' } });
      expect(await c.cancelOrder('900001')).toEqual({ ok: true, message: 'Hủy đơn hàng thành công' });
      expect(mockHttp.post).toHaveBeenLastCalledWith('/api/v2/order/cancel/900001', expect.any(FormData), {
        headers: { Authorization: 'Bearer tok-1' },
      });
      expect([...(mockHttp.post.mock.calls[1][1] as FormData).keys()]).toEqual([]);
    });

    it('401 → đăng nhập lại rồi huỷ lại', async () => {
      const c = makeClient();
      mockHttp.post
        .mockResolvedValueOnce(LOGIN_OK)
        .mockRejectedValueOnce(axiosErr({ status: 401, data: { message: 'Mã token không đúng', result: false } }))
        .mockResolvedValueOnce(loginOk('tok-2'))
        .mockResolvedValueOnce({ data: { result: true } });
      expect((await c.cancelOrder('55')).ok).toBe(true);
    });

    it('tài liệu: HTTP 200 + {result:false, message:"Không tìm thấy đơn hàng"} / không có result → ok=false (caller retry rồi báo CSKH)', async () => {
      const c = makeClient();
      mockHttp.post
        .mockResolvedValueOnce(LOGIN_OK)
        .mockResolvedValueOnce({ data: { result: false, message: 'Không tìm thấy đơn hàng' } });
      expect(await c.cancelOrder('55')).toEqual({ ok: false, message: 'Không tìm thấy đơn hàng' });
      mockHttp.post.mockResolvedValueOnce({ data: {} });
      expect((await c.cancelOrder('55')).ok).toBe(false);
    });
  });
  describe('sức khoẻ kết nối (UAT GOMDON-1: sai mật khẩu mà checkout vẫn mời thu gom)', () => {
    const LOGIN_REJECTED = axiosErr({ status: 401, data: { result: false, message: 'Tài khoản hoặc mật khẩu không đúng', data: null } });

    it('đăng nhập bị từ chối → lỗi tạo đơn là Rejected TẠM (thử lại lâu, chưa báo tạo tay) + ghi nhận tài khoản bị từ chối', async () => {
      const c = makeClient();
      mockHttp.post.mockRejectedValueOnce(LOGIN_REJECTED);
      const err = await c.createOrder(body).catch((e) => e);
      expect(err).toBeInstanceOf(GomdonRejectedError);
      expect((err as GomdonRejectedError).transient).toBe(true);
      expect(c.getHealth()).toMatchObject({ credentialsRejected: true, lastError: expect.stringContaining('mật khẩu') });
    });

    it('vừa bị từ chối tài khoản → không đăng nhập lại liên tục (chống khoá tài khoản), vẫn Rejected TẠM', async () => {
      const c = makeClient();
      mockHttp.post.mockRejectedValueOnce(LOGIN_REJECTED);
      await c.createOrder(body).catch(() => undefined);
      const err = await c.createOrder(body).catch((e) => e);
      expect(err).toBeInstanceOf(GomdonRejectedError);
      expect((err as GomdonRejectedError).transient).toBe(true);
      expect(mockHttp.post).toHaveBeenCalledTimes(1);
    });

    it('tài khoản bị từ chối → tắt lựa chọn thu gom ở checkout; đăng nhập lại được → bật lại', async () => {
      const c = makeClient();
      process.env.GOMDON_PHONE = 'p';
      process.env.GOMDON_PASSWORD = 'x';
      systemConfig.get.mockImplementation(async (k: string, fb?: unknown) => (k === GOMDON_RECYCLING_TOGGLE_KEY ? true : fb));
      expect(await c.isRecyclingEnabled()).toBe(true);
      mockHttp.post.mockRejectedValueOnce(LOGIN_REJECTED);
      await c.createOrder(body).catch(() => undefined);
      expect(await c.isRecyclingEnabled()).toBe(false);

      mockHttp.post.mockResolvedValueOnce(LOGIN_OK);
      expect(await c.checkConnection()).toMatchObject({ ok: true });
      expect(await c.isRecyclingEnabled()).toBe(true);
    });

    it('lỗi mạng/5xx khi đăng nhập KHÔNG coi là sai tài khoản (không tắt checkout)', async () => {
      const c = makeClient();
      mockHttp.post.mockRejectedValueOnce(axiosErr({ code: 'ECONNREFUSED' }));
      await c.createOrder(body).catch(() => undefined);
      expect(c.getHealth().credentialsRejected).toBe(false);
      expect(c.getHealth().lastError).toBeTruthy();
    });

    it('checkConnection: luôn đăng nhập thật (bỏ token cache) và trả kết quả cho admin', async () => {
      const c = makeClient();
      mockHttp.post.mockResolvedValueOnce(LOGIN_OK);
      await c.getValidToken();
      mockHttp.post.mockRejectedValueOnce(LOGIN_REJECTED);
      const r = await c.checkConnection();
      expect(r.ok).toBe(false);
      expect(r.message).toContain('mật khẩu');
      expect(mockHttp.post).toHaveBeenCalledTimes(2);
    });

    it('tạo đơn thành công → ghi nhận lần gọi tốt gần nhất', async () => {
      const c = makeClient();
      mockHttp.post.mockResolvedValueOnce(LOGIN_OK).mockResolvedValueOnce(CREATE_OK);
      await c.createOrder(body);
      expect(c.getHealth().lastOkAt).not.toBeNull();
    });
  });
});
