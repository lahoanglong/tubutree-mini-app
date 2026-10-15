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

  it('chưa cấu hình → không tạo kết nối nào, coi như không cần gửi (true)', async () => {
    const { svc, factory } = setup({});
    await expect(svc.sendAlert(MESSAGE)).resolves.toBe(true);
    expect(factory).not.toHaveBeenCalled();
  });

  it('đủ cấu hình → một email gửi tới mọi người nhận, đóng kết nối, ghi lần gửi thành công', async () => {
    const { svc, sent, t, factory, rows } = setup();
    await expect(svc.sendAlert(MESSAGE)).resolves.toBe(true);
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

  it('SMTP lỗi → trả false (cron gửi lại), KHÔNG ném lỗi, cảnh báo và ghi lỗi không lộ tài khoản/mật khẩu', async () => {
    const { svc, rows, t } = setup(FULL_ENV, {
      sendMail: jest.fn().mockRejectedValue(Object.assign(new Error('Invalid login mailer-user / hunter2-pass: 535 5.7.8 rejected'), { code: 'EAUTH' })),
    });
    await expect(svc.sendAlert(MESSAGE)).resolves.toBe(false);
    expect(t.close).toHaveBeenCalledTimes(1);
    const logged = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('535 5.7.8');
    expect(logged).not.toContain('hunter2-pass');
    expect(logged).not.toContain('mailer-user');
    const row = rows.get('alert.email') as { lastError: string; lastErrorAt: Date };
    expect(row.lastErrorAt).toBeInstanceOf(Date);
    expect(row.lastError).toContain('EAUTH');
    expect(row.lastError).not.toContain('hunter2-pass');
    expect(row.lastError).not.toContain('mailer-user');
    expect(row.lastError.length).toBeLessThanOrEqual(500);
  });

  it('máy chủ SMTP treo → quá hạn thì bỏ, trả false, cron không bị kẹt', async () => {
    jest.useFakeTimers();
    try {
      const { svc, t } = setup(FULL_ENV, { sendMail: jest.fn(() => new Promise(() => undefined)) });
      const p = svc.sendAlert(MESSAGE);
      await jest.advanceTimersByTimeAsync(EMAIL_SEND_TIMEOUT_MS + 1000);
      await expect(p).resolves.toBe(false);
      expect(t.close).toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('ghi trạng thái vào DB lỗi cũng không làm hỏng việc gửi', async () => {
    const { svc, prisma, sent } = setup();
    prisma.opsHealthState.upsert.mockRejectedValue(new Error('db down'));
    await expect(svc.sendAlert(MESSAGE)).resolves.toBe(true);
    expect(sent).toHaveLength(1);
  });

  it('cấu hình dở dang lúc chạy → không gửi, không bắt gửi lại, ghi lỗi nêu khoá để màn Sức khoẻ hệ thống hiện', async () => {
    const { svc, factory, rows } = setup({ OPS_ALERT_EMAIL_TO: 'ops@tubutree.com', SMTP_FROM: 'a@tubutree.com' });
    await expect(svc.sendAlert(MESSAGE)).resolves.toBe(true);
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
    await expect(real.sendAlert(MESSAGE)).resolves.toBe(true);
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
    expect(r).toMatchObject({ ok: false, reason: 'SEND_FAILED' });
    expect(!r.ok && r.error).not.toContain('hunter2-pass');
    expect((rows.get('alert.email') as { lastError: string }).lastError).not.toContain('hunter2-pass');
  });
});

describe('OpsEmailService.state', () => {
  it('tắt: không người nhận, không lỗi', async () => {
    const { svc } = setup({});
    await expect(svc.state()).resolves.toEqual({ state: 'DISABLED', recipients: 0, issues: [], lastOkAt: null, lastErrorAt: null, lastError: null });
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
    });
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
    await expect(svc.sendAlert(MESSAGE)).resolves.toBe(true);
    await expect(svc.state()).resolves.toMatchObject({ state: 'DISABLED' });
  });
});
