import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { createTransport } from 'nodemailer';
import { PrismaService } from '../../prisma/prisma.service';
import type { AlertMessage } from './ops-alerts';
import { EMAIL_SEND_TIMEOUT_MS, OpsEmailService, smtpTransportOptions, type MailTransport } from './ops-email.service';

const FULL_ENV: Record<string, string> = {
  OPS_ALERT_EMAIL_TO: 'ops@tubutree.com; ceo@tubutree.com',
  SMTP_HOST: 'smtp.example.test',
  SMTP_PORT: '587',
  SMTP_SECURE: 'false',
  SMTP_USER: 'mailer-user',
  SMTP_PASS: 'hunter2-pass',
  SMTP_FROM: 'Tubu Tree <alerts@tubutree.com>',
  NODE_ENV: 'production',
};

const MESSAGE: AlertMessage = {
  status: 'ALERT',
  title: '⚠️ Sự cố vận hành',
  summary: '2 đơn quá 30 phút chưa lên Pancake: TUBU1, TUBU2',
  problems: [{ key: 'pancake.stuck', message: '2 đơn quá 30 phút chưa lên Pancake: TUBU1, TUBU2' }],
  generatedAt: '2026-10-15T07:05:00.000Z',
};

function setup(env: Record<string, string> = FULL_ENV, transport?: Partial<MailTransport>) {
  const sent: Record<string, unknown>[] = [];
  const t: MailTransport = {
    sendMail: jest.fn(async (msg: Record<string, unknown>) => {
      sent.push(msg);
      return {};
    }),
    close: jest.fn(),
    ...transport,
  } as MailTransport;
  const factory = jest.fn(() => t);
  const rows = new Map<string, Record<string, unknown>>();
  const prisma = {
    opsHealthState: {
      findUnique: jest.fn(async ({ where }: { where: { key: string } }) => rows.get(where.key) ?? null),
      upsert: jest.fn(async ({ where, create, update }: { where: { key: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        rows.set(where.key, { ...(rows.get(where.key) ?? create), ...update });
      }),
    },
  };
  const config = { get: (k: string) => env[k] ?? '' };
  const svc = new OpsEmailService(config as never, prisma as never, factory as never);
  return { svc, sent, t, factory, prisma, rows };
}

describe('OpsEmailService.sendAlert', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('chưa cấu hình → không tạo kết nối nào, coi như không cần gửi (DONE)', async () => {
    const { svc, factory } = setup({});
    await expect(svc.sendAlert(MESSAGE)).resolves.toBe('DONE');
    expect(factory).not.toHaveBeenCalled();
  });

  it('đủ cấu hình → một email gửi tới mọi người nhận, đóng kết nối, ghi lần gửi thành công', async () => {
    const { svc, sent, t, factory, rows } = setup();
    await expect(svc.sendAlert(MESSAGE)).resolves.toBe('DONE');
    expect(factory).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      from: { name: 'Tubu Tree', address: 'alerts@tubutree.com' },
      to: ['ops@tubutree.com', 'ceo@tubutree.com'],
      subject: '[Tubu Tree · production] Sự cố vận hành: 1 vấn đề cần xử lý',
    });
    expect(String(sent[0]!.text)).toContain('TUBU1, TUBU2');
    expect(String(sent[0]!.html)).toContain('TUBU1, TUBU2');
    expect(t.close).toHaveBeenCalledTimes(1);
    expect(rows.get('alert.email')).toMatchObject({ lastOkAt: expect.any(Date) });
    expect(rows.get('alert.email')).not.toHaveProperty('lastError');
  });

  it('nhãn môi trường đặt tay thay NODE_ENV trong tiêu đề', async () => {
    const { svc, sent } = setup({ ...FULL_ENV, OPS_ALERT_ENV_LABEL: 'staging' });
    await svc.sendAlert(MESSAGE);
    expect(String(sent[0]!.subject)).toMatch(/^\[Tubu Tree · staging\]/);
  });

  it('SMTP lỗi tạm thời → RETRY (cron gửi lại), KHÔNG ném lỗi, cảnh báo và ghi lỗi không lộ tài khoản/mật khẩu', async () => {
    const { svc, rows, t } = setup(FULL_ENV, {
      sendMail: jest.fn().mockRejectedValue(Object.assign(new Error('Connection timeout for mailer-user / hunter2-pass'), { code: 'ETIMEDOUT' })),
    });
    await expect(svc.sendAlert(MESSAGE)).resolves.toBe('RETRY');
    expect(t.close).toHaveBeenCalledTimes(1);
    const logged = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('ETIMEDOUT');
    expect(logged).toContain('gửi lại ở lượt kiểm sau');
    expect(logged).not.toContain('hunter2-pass');
    expect(logged).not.toContain('mailer-user');
    const row = rows.get('alert.email') as { lastError: string; lastErrorAt: Date; detail: { kind: string } };
    expect(row.lastErrorAt).toBeInstanceOf(Date);
    expect(row.lastError).toContain('ETIMEDOUT');
    expect(row.lastError).not.toContain('hunter2-pass');
    expect(row.lastError).not.toContain('mailer-user');
    expect(row.lastError.length).toBeLessThanOrEqual(500);
    expect(row.detail.kind).toBe('TRANSIENT');
  });

  describe('lỗi vĩnh viễn → BLOCKED (không tự gửi lại liên tục)', () => {
    const permanent = (props: Record<string, unknown>, message: string) => ({ sendMail: jest.fn().mockRejectedValue(Object.assign(new Error(message), props)) });

    it('sai xác thực (EAUTH 535) → BLOCKED, ghi lỗi + loại AUTH, không lộ bí mật, nói rõ không gửi lại', async () => {
      const { svc, rows, t } = setup(
        FULL_ENV,
        permanent({ code: 'EAUTH', responseCode: 535, response: '535 5.7.8 rejected' }, 'Invalid login mailer-user / hunter2-pass: 535 5.7.8 rejected'),
      );
      await expect(svc.sendAlert(MESSAGE)).resolves.toBe('BLOCKED');
      expect(t.close).toHaveBeenCalledTimes(1);
      const logged = warn.mock.calls.map((c) => String(c[0])).join('\n');
      expect(logged).toContain('KHÔNG tự gửi lại');
      expect(logged).toContain('535 5.7.8');
      expect(logged).not.toContain('hunter2-pass');
      expect(logged).not.toContain('mailer-user');
      const row = rows.get('alert.email') as { lastError: string; detail: { kind: string; fingerprint: string } };
      expect(row.lastError).toContain('EAUTH');
      expect(JSON.stringify(row)).not.toContain('hunter2-pass');
      expect(JSON.stringify(row)).not.toContain('mailer-user');
      expect(row.detail.kind).toBe('AUTH');
      expect(row.detail.fingerprint).toMatch(/^[0-9a-f]{32}$/);
    });

    it('máy chủ từ chối hẳn (550 người nhận không có) → BLOCKED, loại PERMANENT', async () => {
      const { svc, rows } = setup(FULL_ENV, permanent({ code: 'EENVELOPE', responseCode: 550, response: '550 5.1.1 User unknown' }, "Can't send mail - all recipients were rejected: 550 5.1.1 User unknown"));
      await expect(svc.sendAlert(MESSAGE)).resolves.toBe('BLOCKED');
      expect((rows.get('alert.email') as { detail: { kind: string } }).detail.kind).toBe('PERMANENT');
    });

    it.each([
      ['hết thời gian chờ', { code: 'ETIMEDOUT' }],
      ['ECONNECTION', { code: 'ECONNECTION' }],
      ['ESOCKET', { code: 'ESOCKET' }],
      ['DNS', { code: 'EDNS' }],
      ['421 tạm ngưng', { code: 'ECONNECTION', responseCode: 421 }],
      ['450 hộp thư bận', { code: 'EENVELOPE', responseCode: 450 }],
      ['EAUTH + 454 thử đăng nhập quá nhiều', { code: 'EAUTH', responseCode: 454 }],
    ])('lỗi tạm thời (%s) → RETRY như cũ, không bị chặn', async (_n, props) => {
      const { svc, rows } = setup(FULL_ENV, permanent(props, 'x'));
      await expect(svc.sendAlert(MESSAGE)).resolves.toBe('RETRY');
      expect((rows.get('alert.email') as { detail: { kind: string } }).detail.kind).toBe('TRANSIENT');
    });

    it('tạo kết nối ném lỗi lạ (không phải lỗi SMTP) → RETRY', async () => {
      const rows = new Map<string, Record<string, unknown>>();
      const prisma = { opsHealthState: { findUnique: jest.fn(), upsert: jest.fn(async ({ where, create }: { where: { key: string }; create: Record<string, unknown> }) => void rows.set(where.key, create)) } };
      const svc = new OpsEmailService({ get: (k: string) => FULL_ENV[k] ?? '' } as never, prisma as never, (() => {
        throw new Error('socket exploded');
      }) as never);
      await expect(svc.sendAlert(MESSAGE)).resolves.toBe('RETRY');
    });
  });

  it('máy chủ SMTP treo → quá hạn thì bỏ, trả false, cron không bị kẹt', async () => {
    jest.useFakeTimers();
    try {
      const { svc, t } = setup(FULL_ENV, { sendMail: jest.fn(() => new Promise(() => undefined)) });
      const p = svc.sendAlert(MESSAGE);
      await jest.advanceTimersByTimeAsync(EMAIL_SEND_TIMEOUT_MS + 1000);
      await expect(p).resolves.toBe('RETRY');
      expect(t.close).toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('ghi trạng thái vào DB lỗi cũng không làm hỏng việc gửi', async () => {
    const { svc, prisma, sent } = setup();
    prisma.opsHealthState.upsert.mockRejectedValue(new Error('db down'));
    await expect(svc.sendAlert(MESSAGE)).resolves.toBe('DONE');
    expect(sent).toHaveLength(1);
  });

  it('cấu hình dở dang lúc chạy → không gửi, không bắt gửi lại, ghi lỗi nêu khoá để màn Sức khoẻ hệ thống hiện', async () => {
    const { svc, factory, rows } = setup({ OPS_ALERT_EMAIL_TO: 'ops@tubutree.com', SMTP_FROM: 'a@tubutree.com' });
    await expect(svc.sendAlert(MESSAGE)).resolves.toBe('DONE');
    expect(factory).not.toHaveBeenCalled();
    expect((rows.get('alert.email') as { lastError: string }).lastError).toContain('SMTP_HOST');
  });

  it('thông điệp RECOVERED cũng gửi, tiêu đề đã ổn', async () => {
    const { svc, sent } = setup();
    await svc.sendAlert({ status: 'RECOVERED', title: '✅ Vận hành đã ổn trở lại', summary: 'Hết sự cố.', problems: [], generatedAt: MESSAGE.generatedAt });
    expect(String(sent[0]!.subject)).toBe('[Tubu Tree · production] Vận hành đã ổn trở lại');
  });

  it('chạy được với nodemailer thật (jsonTransport): ra thư MIME đủ người gửi, người nhận, UTF-8, văn bản và HTML', async () => {
    const json = createTransport({ jsonTransport: true });
    const real = new OpsEmailService(
      { get: (k: string) => FULL_ENV[k] ?? '' } as never,
      { opsHealthState: { upsert: jest.fn(), findUnique: jest.fn() } } as never,
      () => json as never,
    );
    const spy = jest.spyOn(json, 'sendMail');
    await expect(real.sendAlert(MESSAGE)).resolves.toBe('DONE');
    const info = (await (spy.mock.results[0]!.value as Promise<{ message: string }>)).message;
    const mail = JSON.parse(info) as { from: { name: string; address: string }; to: { address: string }[]; subject: string; text: string; html: string };
    expect(mail.from).toEqual({ name: 'Tubu Tree', address: 'alerts@tubutree.com' });
    expect(mail.to.map((a) => a.address)).toEqual(['ops@tubutree.com', 'ceo@tubutree.com']);
    expect(mail.subject).toContain('Sự cố vận hành');
    expect(mail.text).toContain('TUBU1');
    expect(mail.html).toContain('<h2');
  });
});

describe('OpsEmailService.sendTest', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('gửi email thử tới mọi người nhận và báo thành công', async () => {
    const { svc, sent } = setup();
    await expect(svc.sendTest()).resolves.toEqual({ ok: true, recipients: 2 });
    expect(String(sent[0]!.subject)).toBe('[Tubu Tree · production] Email thử báo động vận hành');
  });

  it('chưa cấu hình → DISABLED nói rõ phải đặt biến nào, không kết nối', async () => {
    const { svc, factory } = setup({});
    const r = await svc.sendTest();
    expect(r).toMatchObject({ ok: false, reason: 'DISABLED' });
    expect(!r.ok && r.error).toContain('OPS_ALERT_EMAIL_TO');
    expect(factory).not.toHaveBeenCalled();
  });

  it('cấu hình dở dang → MISCONFIGURED nêu khoá còn thiếu', async () => {
    const { svc } = setup({ ...FULL_ENV, SMTP_HOST: '' });
    const r = await svc.sendTest();
    expect(r).toMatchObject({ ok: false, reason: 'MISCONFIGURED' });
    expect(!r.ok && r.error).toContain('SMTP_HOST');
  });

  it('SMTP từ chối → SEND_FAILED, lỗi đã che bí mật, và ghi vào trạng thái kênh', async () => {
    const { svc, rows } = setup(FULL_ENV, { sendMail: jest.fn().mockRejectedValue(new Error('auth failed for hunter2-pass')) });
    const r = await svc.sendTest();
    expect(r).toMatchObject({ ok: false, reason: 'SEND_FAILED', kind: 'TRANSIENT' });
    expect(!r.ok && r.error).not.toContain('hunter2-pass');
    expect((rows.get('alert.email') as { lastError: string }).lastError).not.toContain('hunter2-pass');
  });

  it('SMTP từ chối vì sai xác thực → SEND_FAILED loại AUTH (để người dùng biết kiểm SMTP_USER/SMTP_PASS)', async () => {
    const { svc } = setup(FULL_ENV, {
      sendMail: jest.fn().mockRejectedValue(Object.assign(new Error('Invalid login: 535 5.7.8 hunter2-pass'), { code: 'EAUTH', responseCode: 535 })),
    });
    const r = await svc.sendTest();
    expect(r).toMatchObject({ ok: false, reason: 'SEND_FAILED', kind: 'AUTH' });
    expect(JSON.stringify(r)).not.toContain('hunter2-pass');
  });
});

describe('OpsEmailService.state', () => {
  it('tắt: không người nhận, không lỗi', async () => {
    const { svc } = setup({});
    await expect(svc.state()).resolves.toEqual({
      state: 'DISABLED',
      recipients: 0,
      issues: [],
      lastOkAt: null,
      lastErrorAt: null,
      lastError: null,
      lastErrorKind: null,
      lastErrorHint: null,
    });
  });

  it('dở dang: liệt kê lỗi cấu hình (không có giá trị bí mật)', async () => {
    const { svc } = setup({ ...FULL_ENV, SMTP_HOST: '' });
    const s = await svc.state();
    expect(s.state).toBe('MISCONFIGURED');
    expect(s.issues.join(' ')).toContain('SMTP_HOST');
    expect(JSON.stringify(s)).not.toContain('hunter2-pass');
  });

  it('sẵn sàng: số người nhận và lần gửi/lỗi gần nhất đọc từ DB', async () => {
    const { svc, rows } = setup();
    rows.set('alert.email', { lastOkAt: new Date('2026-10-15T01:00:00Z'), lastErrorAt: new Date('2026-10-15T02:00:00Z'), lastError: 'ETIMEDOUT' });
    await expect(svc.state()).resolves.toEqual({
      state: 'READY',
      recipients: 2,
      issues: [],
      lastOkAt: '2026-10-15T01:00:00.000Z',
      lastErrorAt: '2026-10-15T02:00:00.000Z',
      lastError: 'ETIMEDOUT',
      lastErrorKind: null,
      lastErrorHint: null,
    });
  });

  it('lỗi vĩnh viễn đã lưu: trả loại lỗi và lời chỉ cách sửa (không có bí mật); lỗi tạm thời không có lời chỉ', async () => {
    const { svc, rows } = setup();
    rows.set('alert.email', {
      lastErrorAt: new Date('2026-10-15T02:00:00Z'),
      lastError: 'EAUTH: Invalid login: 535 5.7.8 rejected',
      detail: { kind: 'AUTH', fingerprint: 'abc' },
    });
    const auth = await svc.state();
    expect(auth.lastErrorKind).toBe('AUTH');
    expect(auth.lastErrorHint).toContain('Lỗi xác thực SMTP — kiểm tra SMTP_USER/SMTP_PASS');
    expect(JSON.stringify(auth)).not.toContain('hunter2-pass');
    expect(JSON.stringify(auth)).not.toContain('abc');

    rows.set('alert.email', { lastErrorAt: new Date('2026-10-15T02:00:00Z'), lastError: 'ETIMEDOUT', detail: { kind: 'TRANSIENT', fingerprint: 'abc' } });
    await expect(svc.state()).resolves.toMatchObject({ lastErrorKind: 'TRANSIENT', lastErrorHint: null });
  });

  it('detail lạ hoặc hỏng không làm ảnh chụp sức khoẻ đổ', async () => {
    const { svc, rows } = setup();
    rows.set('alert.email', { lastErrorAt: new Date(), lastError: 'x', detail: { kind: 'WHATEVER' } });
    await expect(svc.state()).resolves.toMatchObject({ lastErrorKind: null, lastErrorHint: null });
    rows.set('alert.email', { lastErrorAt: new Date(), lastError: 'x', detail: 'chuỗi' });
    await expect(svc.state()).resolves.toMatchObject({ lastErrorKind: null });
  });
});

describe('OpsEmailService.blockLifted', () => {
  const T = (h: number) => new Date(`2026-10-15T0${h}:00:00Z`);
  const blockedRow = (svc: OpsEmailService, rows: Map<string, Record<string, unknown>>) => {
    return svc.sendAlert(MESSAGE).then(() => rows.get('alert.email')!);
  };
  const failAuth = () => ({ sendMail: jest.fn().mockRejectedValue(Object.assign(new Error('Invalid login'), { code: 'EAUTH', responseCode: 535 })) });

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('cấu hình vẫn y nguyên và chưa ai gửi thử được → vẫn chặn', async () => {
    const { svc, rows } = setup(FULL_ENV, failAuth());
    await blockedRow(svc, rows);
    await expect(svc.blockLifted()).resolves.toBe(false);
  });

  it('đổi mật khẩu (cấu hình khác lúc lỗi) → mở chặn, kể cả khi đổi đúng một ký tự', async () => {
    const { rows, svc } = setup(FULL_ENV, failAuth());
    await blockedRow(svc, rows);
    const fixed = new OpsEmailService({ get: (k: string) => ({ ...FULL_ENV, SMTP_PASS: 'hunter2-pasS' })[k] ?? '' } as never, {
      opsHealthState: { findUnique: jest.fn(async () => rows.get('alert.email')) },
    } as never);
    await expect(fixed.blockLifted()).resolves.toBe(true);
  });

  it.each<[string, Record<string, string>]>([
    ['người nhận', { OPS_ALERT_EMAIL_TO: 'other@tubutree.com' }],
    ['máy chủ', { SMTP_HOST: 'smtp2.example.test' }],
    ['cổng', { SMTP_PORT: '465', SMTP_SECURE: 'true' }],
    ['tài khoản', { SMTP_USER: 'other-user' }],
    ['địa chỉ gửi', { SMTP_FROM: 'noreply@tubutree.com' }],
  ])('đổi %s → mở chặn', async (_n, change) => {
    const { rows, svc } = setup(FULL_ENV, failAuth());
    await blockedRow(svc, rows);
    const changed = new OpsEmailService({ get: (k: string) => ({ ...FULL_ENV, ...change })[k] ?? '' } as never, {
      opsHealthState: { findUnique: jest.fn(async () => rows.get('alert.email')) },
    } as never);
    await expect(changed.blockLifted()).resolves.toBe(true);
  });

  it('khoá bí mật khác (xoay JWT_ACCESS_SECRET) cũng chỉ làm thử lại một lần — không làm lộ gì', async () => {
    const { rows, svc } = setup({ ...FULL_ENV, JWT_ACCESS_SECRET: 'secret-one-0123456789' }, failAuth());
    await blockedRow(svc, rows);
    expect(JSON.stringify(rows.get('alert.email'))).not.toContain('hunter2-pass');
    const other = new OpsEmailService({ get: (k: string) => ({ ...FULL_ENV, JWT_ACCESS_SECRET: 'secret-two-0123456789' })[k] ?? '' } as never, {
      opsHealthState: { findUnique: jest.fn(async () => rows.get('alert.email')) },
    } as never);
    await expect(other.blockLifted()).resolves.toBe(true);
  });

  it('admin gửi email thử thành công (lastOkAt mới hơn lastErrorAt) → mở chặn', async () => {
    const { rows, svc } = setup(FULL_ENV, failAuth());
    const row = await blockedRow(svc, rows);
    rows.set('alert.email', { ...row, lastErrorAt: T(1), lastOkAt: T(2) });
    await expect(svc.blockLifted()).resolves.toBe(true);
    rows.set('alert.email', { ...row, lastErrorAt: T(3), lastOkAt: T(2) });
    await expect(svc.blockLifted()).resolves.toBe(false);
  });

  it('cấu hình không còn sẵn sàng (tắt/dở dang) → true để cron gọi sendAlert và nhả khoá', async () => {
    const { rows, svc } = setup(FULL_ENV, failAuth());
    await blockedRow(svc, rows);
    const off = new OpsEmailService({ get: () => '' } as never, { opsHealthState: { findUnique: jest.fn(async () => rows.get('alert.email')) } } as never);
    await expect(off.blockLifted()).resolves.toBe(true);
  });

  it('đọc DB lỗi → giữ chặn (false), không ném', async () => {
    const svc = new OpsEmailService({ get: (k: string) => FULL_ENV[k] ?? '' } as never, { opsHealthState: { findUnique: jest.fn().mockRejectedValue(new Error('db down')) } } as never);
    await expect(svc.blockLifted()).resolves.toBe(false);
  });
});

describe('smtpTransportOptions', () => {
  it('truyền cấu hình SMTP, kèm ba hạn chờ ngắn để máy chủ treo không giữ cron', () => {
    const o = smtpTransportOptions({ host: 'h.test', port: 465, secure: true, requireTLS: false, auth: { user: 'u', pass: 'p' } });
    expect(o).toMatchObject({ host: 'h.test', port: 465, secure: true, requireTLS: false, auth: { user: 'u', pass: 'p' } });
    expect(o.connectionTimeout).toBeLessThanOrEqual(15_000);
    expect(o.greetingTimeout).toBeLessThanOrEqual(15_000);
    expect(o.socketTimeout).toBeLessThanOrEqual(30_000);
  });

  it('không có tài khoản thì không gửi trường auth', () => {
    expect(smtpTransportOptions({ host: 'h.test', port: 25, secure: false, requireTLS: false })).not.toHaveProperty('auth');
  });
});

describe('OpsEmailService trong Nest', () => {
  it('Nest dựng được dịch vụ không cần nhà cung cấp transport (dùng SMTP mặc định) và không đụng mạng khi chưa cấu hình', async () => {
    const mod = await Test.createTestingModule({
      providers: [
        OpsEmailService,
        { provide: ConfigService, useValue: { get: () => '' } },
        { provide: PrismaService, useValue: { opsHealthState: { findUnique: jest.fn(), upsert: jest.fn() } } },
      ],
    }).compile();
    const svc = mod.get(OpsEmailService);
    await expect(svc.sendAlert(MESSAGE)).resolves.toBe('DONE');
    await expect(svc.state()).resolves.toMatchObject({ state: 'DISABLED' });
  });
});
