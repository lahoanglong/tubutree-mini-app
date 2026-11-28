import { BadRequestException, HttpException, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { EmailOtpMailer } from './email-otp.mailer';
import { EmailOtpService } from './email-otp.service';
import { MemoryEmailOtpStore, type EmailOtpStore } from './email-otp.store';
import {
  canonicalEmail,
  EMAIL_OTP_DAILY_PER_IP,
  EMAIL_OTP_DAILY_TOTAL,
  EMAIL_OTP_HOUR_MS,
  EMAIL_OTP_HOURLY_PER_EMAIL,
  EMAIL_OTP_HOURLY_PER_IP,
  EMAIL_OTP_MAX_WRONG,
  EMAIL_OTP_WRONG_PER_HOUR,
  emailIdentityHash,
  emailLoginZaloId,
  generateEmailOtp,
  hashEmailOtp,
  maskEmail,
  normalizeEmail,
} from './email-otp.rules';

const SECRET = 'access-secret-for-tests';

function makeService(opts: { store?: EmailOtpStore | null; configured?: boolean; sendFails?: boolean } = {}) {
  let now = Date.parse('2026-11-28T03:00:00Z');
  const clock = {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
  const store = opts.store === null ? undefined : (opts.store ?? new MemoryEmailOtpStore(clock.now));
  const sent: { to: string; code: string }[] = [];
  const mailer = {
    configured: jest.fn(() => opts.configured ?? true),
    send: jest.fn(async (to: string, code: string) => {
      if (opts.sendFails) throw new Error(`550 mailbox unavailable for message containing ${code}`);
      sent.push({ to, code });
    }),
  } as unknown as EmailOtpMailer;
  const config = { get: (k: string) => (k === 'JWT_ACCESS_SECRET' ? SECRET : undefined) } as unknown as ConfigService<never, true>;
  const svc = new EmailOtpService(config, mailer, store);
  const lastCode = () => sent[sent.length - 1]!.code;
  return { svc, sent, mailer, clock, lastCode, store };
}

async function rejection(p: Promise<unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpException) return { status: e.getStatus(), body: e.getResponse() as Record<string, unknown> };
    throw e;
  }
  throw new Error('không ném lỗi');
}

describe('email-otp.rules', () => {
  it('normalizeEmail: cắt khoảng trắng, chữ thường; chặn chuỗi rác và ký tự xuống dòng', () => {
    expect(normalizeEmail('  Khach.Hang@Gmail.COM ')).toBe('khach.hang@gmail.com');
    for (const bad of ['', 'abc', 'a@b', 'a b@x.com', 'a@x.com\r\nBcc: z@y.com', '.a@x.com', 'a..b@x.com', `${'a'.repeat(65)}@x.com`, 42, null]) {
      expect(normalizeEmail(bad)).toBeNull();
    }
  });

  it('+nhãn là cùng một hộp thư ở mọi nhà cung cấp; Gmail bỏ thêm dấu chấm; một danh tính cho mỗi hộp thư', () => {
    expect(canonicalEmail('a.b+shop@gmail.com')).toBe('ab@gmail.com');
    expect(canonicalEmail('ab@googlemail.com')).toBe('ab@gmail.com');
    expect(canonicalEmail('a.b+x@outlook.com')).toBe('a.b@outlook.com');
    expect(canonicalEmail('a.b@yahoo.com')).toBe('a.b@yahoo.com');
    expect(canonicalEmail('+only@x.com')).toBe('+only@x.com');
    expect(emailLoginZaloId('an+1@icloud.com')).toBe(emailLoginZaloId('an+2@icloud.com'));
    expect(emailLoginZaloId('a.b+shop@gmail.com')).toBe(emailLoginZaloId('ab@gmail.com'));
    expect(emailLoginZaloId('ab@gmail.com')).toMatch(/^email_[0-9a-f]{64}$/);
    expect(emailLoginZaloId('ab@gmail.com')).not.toContain('ab@');
  });

  it('mã luôn đúng 6 chữ số, ngẫu nhiên', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const c = generateEmailOtp();
      expect(c).toMatch(/^\d{6}$/);
      codes.add(c);
    }
    expect(codes.size).toBeGreaterThan(490);
  });

  it('băm gắn với bí mật máy chủ và hộp thư: cùng mã khác hộp thư/khác bí mật ra băm khác, không chứa mã thô', () => {
    const h = hashEmailOtp(SECRET, 'a@x.com', '123456');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain('123456');
    expect(hashEmailOtp(SECRET, 'b@x.com', '123456')).not.toBe(h);
    expect(hashEmailOtp('other-secret-value', 'a@x.com', '123456')).not.toBe(h);
    expect(hashEmailOtp(SECRET, 'a@x.com', '123456')).toBe(h);
  });

  it('maskEmail chỉ giữ 2 ký tự đầu', () => {
    expect(maskEmail('khachhang@gmail.com')).toBe('kh***@gmail.com');
  });
});

describe('EmailOtpService.request', () => {
  it('gửi mã 6 số tới đúng email đã chuẩn hoá; thân trả về không có mã', async () => {
    const { svc, sent } = makeService();
    const out = await svc.request(' Khach@Gmail.com ', 'ip1');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe('khach@gmail.com');
    expect(sent[0]!.code).toMatch(/^\d{6}$/);
    expect(out).toEqual({ email: 'khach@gmail.com', resendAfterSec: 60, expiresInSec: 600 });
    expect(JSON.stringify(out)).not.toContain(sent[0]!.code);
  });

  it('email sai định dạng → 400 EMAIL_INVALID, không gửi thư', async () => {
    const { svc, mailer } = makeService();
    const r = await rejection(svc.request('not-an-email', 'ip1'));
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('EMAIL_INVALID');
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('gửi lại trong 60 giây → 429 EMAIL_OTP_COOLDOWN kèm số giây còn lại; sau 60 giây gửi được, mã cũ hết hiệu lực', async () => {
    const { svc, clock, sent } = makeService();
    await svc.request('a@x.com', 'ip1');
    const first = sent[0]!.code;
    clock.advance(20_000);
    const r = await rejection(svc.request('a@x.com', 'ip1'));
    expect(r.status).toBe(429);
    expect(r.body.code).toBe('EMAIL_OTP_COOLDOWN');
    expect(r.body.retryAfterSec).toBe(40);
    clock.advance(40_000);
    await svc.request('a@x.com', 'ip1');
    expect(sent).toHaveLength(2);
    if (sent[1]!.code !== first) {
      expect((await rejection(svc.verify('a@x.com', first))).body.code).toBe('EMAIL_OTP_WRONG');
    }
  });

  it(`tối đa ${EMAIL_OTP_HOURLY_PER_EMAIL} mã/giờ cho một email (kể cả đổi IP) → 429 EMAIL_OTP_RATE_LIMITED`, async () => {
    const { svc, clock } = makeService();
    for (let i = 0; i < EMAIL_OTP_HOURLY_PER_EMAIL; i++) {
      await svc.request('a@x.com', `ip${i}`);
      clock.advance(61_000);
    }
    const r = await rejection(svc.request('a@x.com', 'ip-new'));
    expect(r.status).toBe(429);
    expect(r.body.code).toBe('EMAIL_OTP_RATE_LIMITED');
    clock.advance(60 * 60_000);
    await expect(svc.request('a@x.com', 'ip-new')).resolves.toBeTruthy();
  });

  it('Gmail đổi dấu chấm/+nhãn không né được trần theo email', async () => {
    const { svc } = makeService();
    await svc.request('ab@gmail.com', 'ip1');
    const r = await rejection(svc.request('a.b+1@gmail.com', 'ip1'));
    expect(r.body.code).toBe('EMAIL_OTP_COOLDOWN');
  });

  it(`tối đa ${EMAIL_OTP_HOURLY_PER_IP} mã/giờ cho một IP (nhiều email khác nhau)`, async () => {
    const { svc } = makeService();
    for (let i = 0; i < EMAIL_OTP_HOURLY_PER_IP; i++) await svc.request(`u${i}@x.com`, 'ip-shared');
    const r = await rejection(svc.request('late@x.com', 'ip-shared'));
    expect(r.body.code).toBe('EMAIL_OTP_RATE_LIMITED');
    await expect(svc.request('late@x.com', 'ip-other')).resolves.toBeTruthy();
  });

  it(`trần ${EMAIL_OTP_DAILY_TOTAL} thư/ngày toàn hệ thống bảo vệ tài khoản Gmail gửi thư; chạm trần thì báo lỗi vận hành một lần`, async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { svc } = makeService();
    for (let i = 0; i < EMAIL_OTP_DAILY_TOTAL; i++) await svc.request(`u${i}@x.com`, `ip${i}`);
    const r = await rejection(svc.request('one-more@x.com', 'ip-z'));
    expect(r.status).toBe(429);
    expect(String(r.body.message)).toContain('quá tải');
    await rejection(svc.request('two-more@x.com', 'ip-y'));
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]![0])).toContain(`trần ${EMAIL_OTP_DAILY_TOTAL}`);
    error.mockRestore();
  });

  it(`tối đa ${EMAIL_OTP_DAILY_PER_IP} mã/ngày cho một IP (qua nhiều giờ): một nguồn không tự tiêu hết trần chung`, async () => {
    const { svc, clock } = makeService();
    let sent = 0;
    while (sent < EMAIL_OTP_DAILY_PER_IP) {
      for (let i = 0; i < EMAIL_OTP_HOURLY_PER_IP && sent < EMAIL_OTP_DAILY_PER_IP; i++) await svc.request(`d${sent++}@x.com`, 'ip-day');
      clock.advance(EMAIL_OTP_HOUR_MS + 1);
    }
    const r = await rejection(svc.request('late@x.com', 'ip-day'));
    expect(r.body.code).toBe('EMAIL_OTP_RATE_LIMITED');
    expect(String(r.body.message)).toContain('giờ');
    await expect(svc.request('late@x.com', 'ip-other')).resolves.toBeTruthy();
  });

  it('SMTP chưa cấu hình hoặc không có kho Redis → 503 EMAIL_LOGIN_UNAVAILABLE', async () => {
    expect((await rejection(makeService({ configured: false }).svc.request('a@x.com', 'ip1'))).body.code).toBe('EMAIL_LOGIN_UNAVAILABLE');
    expect((await rejection(makeService({ store: null }).svc.request('a@x.com', 'ip1'))).body.code).toBe('EMAIL_LOGIN_UNAVAILABLE');
  });

  it('kho Redis lỗi/quá hạn → 503, không gửi thư', async () => {
    const errSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const broken: EmailOtpStore = {
      start: jest.fn().mockRejectedValue(new Error('Redis không phản hồi')),
      cancel: jest.fn(),
      verify: jest.fn().mockRejectedValue(new Error('Redis không phản hồi')),
    };
    const { svc, mailer } = makeService({ store: broken });
    await expect(svc.request('a@x.com', 'ip1')).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(svc.verify('a@x.com', '123456')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(mailer.send).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('gửi thư hỏng → 503 EMAIL_SEND_FAILED, huỷ mã và thời gian chờ (bấm gửi lại được ngay); log không chứa mã', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const store = new MemoryEmailOtpStore();
    const failing = makeService({ store, sendFails: true });
    const r = await rejection(failing.svc.request('a@x.com', 'ip1'));
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('EMAIL_SEND_FAILED');
    const logged = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('a***@x.com');
    expect(logged).not.toMatch(/\d{6}/);
    expect(logged).not.toContain('a@x.com');
    warn.mockRestore();
    const ok = makeService({ store });
    await expect(ok.svc.request('a@x.com', 'ip1')).resolves.toBeTruthy();
  });

  it('không bao giờ ghi mã vào log ở đường thành công', async () => {
    const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((m) => jest.spyOn(Logger.prototype, m).mockImplementation(() => undefined));
    const { svc, lastCode } = makeService();
    await svc.request('a@x.com', 'ip1');
    const code = lastCode();
    await svc.verify('a@x.com', code);
    for (const s of spies) {
      for (const call of s.mock.calls) expect(JSON.stringify(call)).not.toContain(code);
      s.mockRestore();
    }
  });
});

describe('EmailOtpService.verify', () => {
  it('mã đúng → trả email chuẩn hoá; dùng lại mã (replay) → 400 EMAIL_OTP_EXPIRED', async () => {
    const { svc, lastCode } = makeService();
    await svc.request('A@x.com', 'ip1');
    const code = lastCode();
    await expect(svc.verify(' a@X.com', code)).resolves.toBe('a@x.com');
    const replay = await rejection(svc.verify('a@x.com', code));
    expect(replay.status).toBe(400);
    expect(replay.body.code).toBe('EMAIL_OTP_EXPIRED');
  });

  it('hai lần xác minh đồng thời cùng mã: đúng một lần thắng', async () => {
    const { svc, lastCode } = makeService();
    await svc.request('a@x.com', 'ip1');
    const code = lastCode();
    const results = await Promise.allSettled([svc.verify('a@x.com', code), svc.verify('a@x.com', code)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('sai 4 lần báo số lần còn lại; sai lần thứ 5 huỷ mã (EMAIL_OTP_LOCKED); sau đó mã đúng cũng không dùng được', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { svc, lastCode } = makeService();
    await svc.request('a@x.com', 'ip1');
    const code = lastCode();
    const wrong = code === '000000' ? '111111' : '000000';
    for (const left of [4, 3, 2, 1]) {
      const r = await rejection(svc.verify('a@x.com', wrong));
      expect(r.body).toMatchObject({ code: 'EMAIL_OTP_WRONG', attemptsLeft: left });
      expect(String(r.body.message)).toContain(`${left} lần`);
    }
    const locked = await rejection(svc.verify('a@x.com', wrong));
    expect(locked.body.code).toBe('EMAIL_OTP_LOCKED');
    expect((await rejection(svc.verify('a@x.com', code))).body.code).toBe('EMAIL_OTP_EXPIRED');
    warn.mockRestore();
  });

  it(`xin mã mới không xoá lượt sai: ${EMAIL_OTP_WRONG_PER_HOUR} lần sai trong giờ (qua nhiều mã) thì không cấp mã mới tới hết giờ`, async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { svc, clock, lastCode } = makeService();
    const burn = async () => {
      await svc.request('a@x.com', 'ip1');
      const wrong = lastCode() === '000000' ? '111111' : '000000';
      for (let i = 0; i < EMAIL_OTP_MAX_WRONG; i++) await rejection(svc.verify('a@x.com', wrong));
      clock.advance(61_000);
    };
    for (let k = 0; k < EMAIL_OTP_WRONG_PER_HOUR / EMAIL_OTP_MAX_WRONG; k++) await burn();
    const r = await rejection(svc.request('a@x.com', 'ip2'));
    expect(r.body.code).toBe('EMAIL_OTP_RATE_LIMITED');
    clock.advance(EMAIL_OTP_HOUR_MS);
    await expect(svc.request('a@x.com', 'ip2')).resolves.toBeTruthy();
    warn.mockRestore();
  });

  it('mã hết hạn sau 10 phút', async () => {
    const { svc, clock, lastCode } = makeService();
    await svc.request('a@x.com', 'ip1');
    clock.advance(10 * 60_000 + 1);
    expect((await rejection(svc.verify('a@x.com', lastCode()))).body.code).toBe('EMAIL_OTP_EXPIRED');
  });

  it('mã của hộp thư này không đăng nhập được hộp thư khác', async () => {
    const { svc, lastCode } = makeService();
    await svc.request('a@x.com', 'ip1');
    expect((await rejection(svc.verify('b@x.com', lastCode()))).body.code).toBe('EMAIL_OTP_EXPIRED');
  });

  it('Gmail: xin mã bằng a.b@gmail.com, nhập ở ab@gmail.com vẫn đúng (cùng hộp thư)', async () => {
    const { svc, lastCode } = makeService();
    await svc.request('a.b@gmail.com', 'ip1');
    await expect(svc.verify('ab@gmail.com', lastCode())).resolves.toBe('ab@gmail.com');
  });

  it('email sai định dạng → 400', async () => {
    await expect(makeService().svc.verify('x', '123456')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('kho lưu đúng định danh băm của hộp thư, không lưu email thô; ngày theo giờ Việt Nam', async () => {
    const store: EmailOtpStore = { start: jest.fn().mockResolvedValue({ ok: true }), cancel: jest.fn(), verify: jest.fn().mockResolvedValue({ kind: 'ok' }) };
    const { svc } = makeService({ store });
    await svc.request('a@x.com', 'ip1', new Date('2026-11-28T18:30:00Z'));
    const arg = (store.start as jest.Mock).mock.calls[0][0];
    expect(arg.id).toBe(emailIdentityHash('a@x.com'));
    expect(JSON.stringify(arg)).not.toContain('a@x.com');
    expect(arg.day).toBe('2026-11-29');
  });
});
