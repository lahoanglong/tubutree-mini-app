import { type INestApplication, UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { GomdonWebhookController } from './gomdon-webhook.controller';
import { GomdonWebhookService } from './gomdon-webhook.service';
import { WebhookRejectCounterService } from '../../analytics/webhook-reject-counter.service';
import type { Env } from '../../../config/env.validation';
import { bodyParserErrorHandler, createBodyParsers, requestInputGuard } from '../../../common/body-limits';

const SECRET = 'gomdon-secret-123';
const body = { order_id: 55, order_code: 'BE55', order_customer_id: 'TUBU1', status: 7 };

function make(secret: string, hmacSecret?: string) {
  const webhook = { receive: jest.fn().mockResolvedValue({ result: true }) };
  const config = {
    get: jest.fn().mockImplementation((key: string) => {
      if (key === 'GOMDON_WEBHOOK_HMAC_SECRET') return hmacSecret ?? '';
      return secret;
    }),
  } as unknown as ConfigService<Env, true>;
  const record = jest.fn();
  const controller = new GomdonWebhookController(webhook as unknown as GomdonWebhookService, config, { record } as unknown as WebhookRejectCounterService);
  return { controller, webhook, record };
}

/** HMAC-SHA256-hex của "<timestamp>.<thân thô>" — đúng công thức tài liệu Gomdon mục 4. */
const sign = (ts: string | number, raw: string, key: string) => createHmac('sha256', key).update(`${ts}.${raw}`).digest('hex');
const nowSec = () => Math.floor(Date.now() / 1000);
const RAW = JSON.stringify(body);
/** Request giả mang thân thô + header chữ ký như Express sau khi qua common/body-limits. */
const signedReq = (ts: string | number, signature: string, raw: string | null = RAW) => ({
  rawBody: raw === null ? undefined : Buffer.from(raw),
  headers: { 'x-gomdon-timestamp': String(ts), 'x-gomdon-signature': signature } as Record<string, string>,
});

describe('GomdonWebhookController — xác thực token chia sẻ', () => {
  const savedEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = savedEnv;
  });

  it('token đúng qua header → lưu event (gọi receive)', async () => {
    const { controller, webhook } = make(SECRET);
    await expect(controller.handle(body, SECRET, undefined)).resolves.toEqual({ result: true });
    expect(webhook.receive).toHaveBeenCalledWith(body, expect.anything());
  });

  it('token đúng qua ?token= hoặc path /webhooks/gomdon/<secret> → chấp nhận', async () => {
    const { controller, webhook } = make(SECRET);
    await controller.handle(body, undefined, SECRET);
    await controller.handleWithPathToken(SECRET, body, undefined);
    expect(webhook.receive).toHaveBeenCalledTimes(2);
  });

  it('thiếu token → 401, KHÔNG chạm DB/queue', async () => {
    const { controller, webhook } = make(SECRET);
    await expect(controller.handle(body, undefined, undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(webhook.receive).not.toHaveBeenCalled();
  });

  it('token sai (cùng/khác độ dài) → 401', async () => {
    const { controller, webhook } = make(SECRET);
    await expect(controller.handle(body, 'gomdon-secret-124', undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.handle(body, 'x', undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.handleWithPathToken('wrong', body, undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(webhook.receive).not.toHaveBeenCalled();
  });

  it('production chưa đặt GOMDON_WEBHOOK_SECRET → fail-closed 401 mọi request', async () => {
    process.env.NODE_ENV = 'production';
    const { controller, webhook } = make('');
    await expect(controller.handle(body, 'anything', undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.handleWithPathToken('anything', body, undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(webhook.receive).not.toHaveBeenCalled();
  });

  it('tài liệu: Gomdon chỉ coi HTTP 200 là nhận thành công (khác 200 → gửi lại sau 30 giây, tối đa 3 lần) → cả 2 route trả 200', () => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, GomdonWebhookController.prototype.handle)).toBe(200);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, GomdonWebhookController.prototype.handleWithPathToken)).toBe(200);
  });

  it('dev/test chưa đặt secret → cho qua (có cảnh báo) để thử nghiệm', async () => {
    process.env.NODE_ENV = 'test';
    const { controller, webhook } = make('');
    await controller.handle(body, undefined, undefined);
    expect(webhook.receive).toHaveBeenCalled();
  });
});

describe('GomdonWebhookController — xác thực kép: chữ ký HMAC (X-Gomdon-Signature) hoặc token', () => {
  const HMAC = 'gomdon-hmac-secret-456';
  const savedEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = savedEnv;
    jest.restoreAllMocks();
  });

  describe('(a) chữ ký', () => {
    it('chữ ký đúng + giờ lệch trong 300 giây, KHÔNG có token → nhận (khoá = GOMDON_WEBHOOK_HMAC_SECRET)', async () => {
      const { controller, webhook } = make(SECRET, HMAC);
      const ts = nowSec();
      await expect(controller.handle(body, undefined, undefined, 'application/json', signedReq(ts, sign(ts, RAW, HMAC)))).resolves.toEqual({ result: true });
      expect(webhook.receive).toHaveBeenCalledWith(body, { contentType: 'application/json' });
    });

    it('route /:token cũng nhận chữ ký đúng dù token trong đường dẫn sai/tuỳ ý', async () => {
      const { controller, webhook } = make(SECRET, HMAC);
      const ts = nowSec();
      await controller.handleWithPathToken('khong-phai-secret', body, undefined, undefined, signedReq(ts, sign(ts, RAW, HMAC)));
      expect(webhook.receive).toHaveBeenCalledTimes(1);
    });

    it('không đặt GOMDON_WEBHOOK_HMAC_SECRET → khoá ký rơi về GOMDON_WEBHOOK_SECRET', async () => {
      const { controller, webhook } = make(SECRET);
      const ts = nowSec();
      await controller.handle(body, undefined, undefined, undefined, signedReq(ts, sign(ts, RAW, SECRET)));
      expect(webhook.receive).toHaveBeenCalledTimes(1);
    });

    it('đặt khoá ký riêng thì chữ ký tính bằng token đường dẫn bị từ chối', async () => {
      const { controller, webhook } = make(SECRET, HMAC);
      const ts = nowSec();
      await expect(controller.handle(body, undefined, undefined, undefined, signedReq(ts, sign(ts, RAW, SECRET)))).rejects.toBeInstanceOf(UnauthorizedException);
      expect(webhook.receive).not.toHaveBeenCalled();
    });

    it('chữ ký sai / thân bị sửa sau khi ký / timestamp bị sửa → 401', async () => {
      const { controller, webhook } = make(SECRET, HMAC);
      const ts = nowSec();
      const good = sign(ts, RAW, HMAC);
      const bad = [
        signedReq(ts, good.replace(/^./, good[0] === 'a' ? 'b' : 'a')),
        signedReq(ts, good, RAW.replace('55', '56')),
        signedReq(ts + 1, good),
      ];
      for (const req of bad) {
        await expect(controller.handle(body, undefined, undefined, undefined, req)).rejects.toBeInstanceOf(UnauthorizedException);
      }
      expect(webhook.receive).not.toHaveBeenCalled();
    });

    it('chữ ký độ dài khác / không phải hex / chữ hoa → không ném lỗi lạ: sai thì 401, hex hoa đúng thì nhận', async () => {
      const { controller, webhook } = make(SECRET, HMAC);
      const ts = nowSec();
      const good = sign(ts, RAW, HMAC);
      for (const sig of ['', 'abc', 'zz'.repeat(32), good + 'ff', good.slice(0, -2)]) {
        await expect(controller.handle(body, undefined, undefined, undefined, signedReq(ts, sig))).rejects.toBeInstanceOf(UnauthorizedException);
      }
      expect(webhook.receive).not.toHaveBeenCalled();
      await controller.handle(body, undefined, undefined, undefined, signedReq(ts, good.toUpperCase()));
      expect(webhook.receive).toHaveBeenCalledTimes(1);
    });

    it('lệch giờ quá 300 giây (cả quá khứ và tương lai) → 401 dù chữ ký đúng; đúng biên 300 giây vẫn nhận', async () => {
      const fixed = 1_800_000_000;
      jest.spyOn(Date, 'now').mockReturnValue(fixed * 1000);
      const { controller, webhook } = make(SECRET, HMAC);
      for (const ts of [fixed - 301, fixed + 301, fixed - 86_400]) {
        await expect(controller.handle(body, undefined, undefined, undefined, signedReq(ts, sign(ts, RAW, HMAC)))).rejects.toBeInstanceOf(UnauthorizedException);
      }
      expect(webhook.receive).not.toHaveBeenCalled();
      for (const ts of [fixed - 300, fixed + 300]) {
        await controller.handle(body, undefined, undefined, undefined, signedReq(ts, sign(ts, RAW, HMAC)));
      }
      expect(webhook.receive).toHaveBeenCalledTimes(2);
    });

    it('timestamp không phải số / thiếu một trong hai header → 401', async () => {
      const { controller } = make(SECRET, HMAC);
      const ts = nowSec();
      const sig = sign(ts, RAW, HMAC);
      const reqs = [
        signedReq('abc', sign('abc', RAW, HMAC)),
        { ...signedReq(ts, sig), headers: { 'x-gomdon-signature': sig } },
        { ...signedReq(ts, sig), headers: { 'x-gomdon-timestamp': String(ts) } },
      ];
      for (const req of reqs) {
        await expect(controller.handle(body, undefined, undefined, undefined, req)).rejects.toBeInstanceOf(UnauthorizedException);
      }
    });

    it('có header chữ ký nhưng không có thân thô (multipart) và không token → 401', async () => {
      const { controller, webhook } = make(SECRET, HMAC);
      const ts = nowSec();
      await expect(controller.handle(body, undefined, undefined, 'multipart/form-data', signedReq(ts, sign(ts, RAW, HMAC), null))).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(webhook.receive).not.toHaveBeenCalled();
    });
  });

  describe('(b) token song song với chữ ký', () => {
    it('chữ ký SAI nhưng token hợp lệ (header / ?token= / đường dẫn) → vẫn nhận', async () => {
      const { controller, webhook } = make(SECRET, HMAC);
      const ts = nowSec();
      const wrong = signedReq(ts, 'a'.repeat(64));
      await controller.handle(body, SECRET, undefined, undefined, wrong);
      await controller.handle(body, undefined, SECRET, undefined, wrong);
      await controller.handleWithPathToken(SECRET, body, undefined, undefined, wrong);
      expect(webhook.receive).toHaveBeenCalledTimes(3);
    });

    it('chữ ký lệch giờ nhưng token đúng → nhận; chữ ký lệch giờ và token sai → 401', async () => {
      const { controller, webhook } = make(SECRET, HMAC);
      const old = nowSec() - 3600;
      const req = signedReq(old, sign(old, RAW, HMAC));
      await controller.handleWithPathToken(SECRET, body, undefined, undefined, req);
      expect(webhook.receive).toHaveBeenCalledTimes(1);
      await expect(controller.handleWithPathToken('sai-token', body, undefined, undefined, req)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(webhook.receive).toHaveBeenCalledTimes(1);
    });

    it('cả chữ ký đúng lẫn token đúng → nhận (một lần)', async () => {
      const { controller, webhook } = make(SECRET, HMAC);
      const ts = nowSec();
      await controller.handleWithPathToken(SECRET, body, undefined, undefined, signedReq(ts, sign(ts, RAW, HMAC)));
      expect(webhook.receive).toHaveBeenCalledTimes(1);
    });

    it('token header sai nhưng token đường dẫn đúng → nhận (không rớt event vì một nguồn token lệch)', async () => {
      const { controller, webhook } = make(SECRET, HMAC);
      await controller.handleWithPathToken(SECRET, body, 'sai', undefined, undefined);
      expect(webhook.receive).toHaveBeenCalledTimes(1);
    });

    it('không có chữ ký, không có token → 401', async () => {
      const { controller, webhook } = make(SECRET, HMAC);
      await expect(controller.handle(body, undefined, undefined, undefined, { headers: {} })).rejects.toBeInstanceOf(UnauthorizedException);
      expect(webhook.receive).not.toHaveBeenCalled();
    });
  });

  describe('production, fail-closed', () => {
    it('chưa cấu hình secret nào → 401 mọi request, kể cả có chữ ký (không có khoá để kiểm)', async () => {
      process.env.NODE_ENV = 'production';
      const { controller, webhook } = make('', '');
      const ts = nowSec();
      await expect(controller.handle(body, 'x', undefined, undefined, signedReq(ts, sign(ts, RAW, 'x')))).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(controller.handleWithPathToken('x', body, undefined, undefined, undefined)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(webhook.receive).not.toHaveBeenCalled();
    });

    it('chỉ có GOMDON_WEBHOOK_HMAC_SECRET: chữ ký đúng nhận, token (không có secret để so) → 401', async () => {
      process.env.NODE_ENV = 'production';
      const { controller, webhook } = make('', HMAC);
      const ts = nowSec();
      await controller.handle(body, undefined, undefined, undefined, signedReq(ts, sign(ts, RAW, HMAC)));
      expect(webhook.receive).toHaveBeenCalledTimes(1);
      await expect(controller.handle(body, HMAC, undefined, undefined, undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('dev/test không có secret nào → vẫn cho qua (để thử nghiệm)', async () => {
      process.env.NODE_ENV = 'test';
      const { controller, webhook } = make('', '');
      await controller.handle(body, undefined, undefined, undefined, { headers: {} });
      expect(webhook.receive).toHaveBeenCalled();
    });
  });
});

describe('GomdonWebhookController — chữ ký qua HTTP thật, thân thô do common/body-limits giữ', () => {
  let app: INestApplication;
  let base: string;
  const HMAC = 'http-hmac-secret-789';
  const webhook = { receive: jest.fn().mockResolvedValue({ result: true }) };
  // Byte gốc có \/ và \uXXXX: JSON.stringify lại thân đã parse sẽ làm lệch chữ ký.
  const EXACT = '{"status":7,"order_id":55,"reason":"Giao h\\u00e0ng th\\u00e0nh c\\u00f4ng","note":"a\\/b","event_id":"6f1c2a9e-1"}';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [GomdonWebhookController],
      providers: [
        { provide: GomdonWebhookService, useValue: webhook },
        { provide: WebhookRejectCounterService, useValue: { record: jest.fn() } },
        { provide: ConfigService, useValue: { get: (k: string) => (k === 'GOMDON_WEBHOOK_HMAC_SECRET' ? HMAC : SECRET) } },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ bodyParser: false, logger: false });
    // Đường dẫn thật `/api/webhooks/gomdon*`: common/body-limits chỉ giữ thân thô cho nhóm route này.
    app.setGlobalPrefix('api');
    app.use(...createBodyParsers('test-access-secret-0123456789abcdef0123'), bodyParserErrorHandler, requestInputGuard);
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => webhook.receive.mockClear());

  const post = (path: string, raw: string, headers: Record<string, string>) =>
    fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: raw });

  it('chữ ký tính trên byte gốc → 200, body đã parse được chuyển cho service', async () => {
    const ts = nowSec();
    const res = await post('/api/webhooks/gomdon', EXACT, {
      'x-gomdon-timestamp': String(ts),
      'x-gomdon-signature': sign(ts, EXACT, HMAC),
    });
    expect(res.status).toBe(200);
    expect(webhook.receive).toHaveBeenCalledWith(expect.objectContaining({ status: 7, order_id: 55, note: 'a/b' }), expect.anything());
  });

  it('chữ ký tính trên bản JSON.stringify lại (không phải byte gốc) → 401', async () => {
    const ts = nowSec();
    const res = await post('/api/webhooks/gomdon', EXACT, {
      'x-gomdon-timestamp': String(ts),
      'x-gomdon-signature': sign(ts, JSON.stringify(JSON.parse(EXACT)), HMAC),
    });
    expect(res.status).toBe(401);
    expect(webhook.receive).not.toHaveBeenCalled();
  });

  it('không chữ ký, token đường dẫn đúng → 200 (cơ chế (b) vẫn chạy)', async () => {
    const res = await post(`/api/webhooks/gomdon/${SECRET}`, EXACT, {});
    expect(res.status).toBe(200);
    expect(webhook.receive).toHaveBeenCalledTimes(1);
  });

  it('không chữ ký, không token → 401', async () => {
    const res = await post('/api/webhooks/gomdon', EXACT, {});
    expect(res.status).toBe(401);
    expect(webhook.receive).not.toHaveBeenCalled();
  });
});

describe('UAT GOMDON-5: webhook hợp lệ không bị giới hạn 120 request/phút/IP', () => {
  it('controller bỏ throttle chung (như webhook Pancake) — chỉ token chia sẻ quyết định nhận hay không', () => {
    expect(Reflect.getMetadata('THROTTLER:SKIPdefault', GomdonWebhookController)).toBe(true);
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', GomdonWebhookController)).toBeUndefined();
  });
});

describe('UAT GOMDON-6: webhook gửi multipart/form-data (kiểu mọi API Gomdon) được đọc đúng', () => {
  let app: INestApplication;
  const webhook = { receive: jest.fn().mockResolvedValue({ result: true }) };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [GomdonWebhookController],
      providers: [
        { provide: GomdonWebhookService, useValue: webhook },
        { provide: WebhookRejectCounterService, useValue: { record: jest.fn() } },
        { provide: ConfigService, useValue: { get: () => SECRET } },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => webhook.receive.mockClear());

  it('form-data → body có đủ trường, kèm Content-Type để chẩn đoán', async () => {
    const fd = new FormData();
    fd.append('status', '3');
    fd.append('order_id', '9029');
    fd.append('order_code', '84850000009029');
    fd.append('order_customer_id', 'TUBU2026101379083');
    const res = await fetch(`${await app.getUrl()}/webhooks/gomdon/${SECRET}`, { method: 'POST', body: fd });
    expect(res.status).toBe(200);
    expect(webhook.receive).toHaveBeenCalledWith(
      { status: '3', order_id: '9029', order_code: '84850000009029', order_customer_id: 'TUBU2026101379083' },
      { contentType: expect.stringContaining('multipart/form-data') },
    );
  });

  it('JSON vẫn đọc như cũ', async () => {
    const res = await fetch(`${await app.getUrl()}/webhooks/gomdon`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-webhook-token': SECRET },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);
    expect(webhook.receive).toHaveBeenCalledWith(body, { contentType: 'application/json' });
  });

  it('form-data kèm FILE → từ chối (không nhận file trên route webhook)', async () => {
    const fd = new FormData();
    fd.append('status', '3');
    fd.append('f', new Blob(['x']), 'x.txt');
    const res = await fetch(`${await app.getUrl()}/webhooks/gomdon/${SECRET}`, { method: 'POST', body: fd });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(webhook.receive).not.toHaveBeenCalled();
  });
});

describe('GomdonWebhookController — đếm lần bị từ chối 401 (W184)', () => {
  const HMAC = 'gomdon-hmac-secret-456';
  const savedEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = savedEnv;
  });

  it('thiếu token → vẫn 401 đúng thông điệp cũ và record("gomdon") gọi đúng 1 lần', async () => {
    const { controller, record } = make(SECRET);
    await expect(controller.handle(body, undefined, undefined)).rejects.toThrow(new UnauthorizedException('Xác thực webhook không hợp lệ.'));
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith('gomdon');
  });

  it('token sai ở header, ?token= hoặc path → mỗi request bị từ chối đếm đúng 1 lần', async () => {
    const { controller, record } = make(SECRET);
    await expect(controller.handle(body, 'sai', undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.handle(body, undefined, 'sai')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.handleWithPathToken('sai', body, undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(record).toHaveBeenCalledTimes(3);
    expect(record.mock.calls.every((c) => c.length === 1 && c[0] === 'gomdon')).toBe(true);
  });

  it('chữ ký sai (không có token hợp lệ) → 401 và đếm đúng 1 lần', async () => {
    const { controller, record } = make(SECRET, HMAC);
    const ts = nowSec();
    await expect(controller.handle(body, undefined, undefined, undefined, signedReq(ts, sign(ts, RAW, 'khoa-sai')))).rejects.toThrow('Xác thực webhook không hợp lệ.');
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith('gomdon');
  });

  it('production chưa đặt secret → 401 đúng thông điệp cũ và đếm đúng 1 lần', async () => {
    process.env.NODE_ENV = 'production';
    const { controller, record, webhook } = make('');
    await expect(controller.handle(body, 'bat-ky', undefined)).rejects.toThrow(new UnauthorizedException('Webhook Gomdon chưa cấu hình bí mật ở production.'));
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith('gomdon');
    expect(webhook.receive).not.toHaveBeenCalled();
  });

  it('token đúng (header, ?token=, path) hoặc chữ ký đúng → record KHÔNG được gọi', async () => {
    const { controller, record } = make(SECRET, HMAC);
    await controller.handle(body, SECRET, undefined);
    await controller.handle(body, undefined, SECRET);
    await controller.handleWithPathToken(SECRET, body, undefined);
    const ts = nowSec();
    await controller.handle(body, undefined, undefined, undefined, signedReq(ts, sign(ts, RAW, HMAC)));
    expect(record).not.toHaveBeenCalled();
  });

  it('dev chưa đặt secret → cho qua và record KHÔNG được gọi', async () => {
    process.env.NODE_ENV = 'test';
    const { controller, record } = make('');
    await controller.handle(body, undefined, undefined);
    expect(record).not.toHaveBeenCalled();
  });

  it('secret, khoá ký và token đã gửi không xuất hiện ở bất kỳ đối số nào của record', async () => {
    const { controller, record } = make(SECRET, HMAC);
    const ts = nowSec();
    await controller.handle(body, 'token-la-gui-len', undefined).catch(() => undefined);
    await controller.handle(body, undefined, undefined, undefined, signedReq(ts, sign(ts, RAW, 'khoa-sai'))).catch(() => undefined);
    const dumped = JSON.stringify(record.mock.calls);
    for (const secret of [SECRET, HMAC, 'token-la-gui-len', 'khoa-sai']) expect(dumped).not.toContain(secret);
    expect(record.mock.calls.every((c) => c.length === 1 && c[0] === 'gomdon')).toBe(true);
  });
});
