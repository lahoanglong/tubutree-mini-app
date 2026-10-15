import { createServer, type AddressInfo, type Server } from 'node:net';
import { Logger } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import type { AlertMessage } from './ops-alerts';
import { OpsEmailService } from './ops-email.service';
import { classifySmtpError } from './ops-email-error';

/**
 * Đường SMTP THẬT của nodemailer (không thay transport) nhưng chỉ nói chuyện với máy chủ giả trên 127.0.0.1 do chính spec
 * dựng — không có kết nối ra ngoài, không email thật. Kiểm cấu hình truyền cho nodemailer đúng tên/ý nghĩa, và mật khẩu
 * không bao giờ bị gửi qua đường không mã hoá.
 */
type FakeReplies = Partial<Record<'auth' | 'mail' | 'rcpt' | 'dataEnd', string>>;

function fakeSmtp(replies: FakeReplies = {}) {
  const lines: string[] = [];
  const server: Server = createServer((sock) => {
    let inData = false;
    let buf = '';
    sock.write('220 fake ESMTP\r\n');
    sock.on('error', () => undefined);
    sock.on('data', (d) => {
      buf += d.toString('utf8');
      for (let i = buf.indexOf('\r\n'); i >= 0; i = buf.indexOf('\r\n')) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        lines.push(line);
        if (inData) {
          if (line === '.') {
            inData = false;
            sock.write(`${replies.dataEnd ?? '250 queued'}\r\n`);
          }
          continue;
        }
        const cmd = line.toUpperCase();
        if (cmd.startsWith('EHLO')) sock.write('250-fake\r\n250 AUTH PLAIN LOGIN\r\n');
        else if (cmd === 'STARTTLS') sock.write('454 TLS not available\r\n');
        else if (cmd.startsWith('AUTH')) sock.write(`${replies.auth ?? '235 ok'}\r\n`);
        else if (cmd.startsWith('MAIL FROM')) sock.write(`${replies.mail ?? '250 ok'}\r\n`);
        else if (cmd.startsWith('RCPT TO')) sock.write(`${replies.rcpt ?? '250 ok'}\r\n`);
        else if (cmd === 'DATA') {
          inData = true;
          sock.write('354 go\r\n');
        } else if (cmd === 'QUIT') {
          sock.write('221 bye\r\n');
          sock.end();
        } else sock.write('250 ok\r\n');
      }
    });
  });
  return new Promise<{ port: number; lines: string[]; close: () => Promise<void> }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: (server.address() as AddressInfo).port,
        lines,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

const MESSAGE: AlertMessage = {
  status: 'ALERT',
  title: '⚠️ Sự cố vận hành',
  summary: 'x',
  problems: [{ key: 'pancake.stuck', message: '2 đơn quá 30 phút chưa lên Pancake: TUBU1, TUBU2' }],
  generatedAt: '2026-10-15T07:05:00.000Z',
};

const service = (env: Record<string, string>) =>
  new OpsEmailService({ get: (k: string) => env[k] ?? '' } as never, { opsHealthState: { upsert: jest.fn(), findUnique: jest.fn() } } as never);

describe('OpsEmailService qua SMTP giả trên localhost', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('gửi thật qua nodemailer SMTP: máy chủ nhận đủ người gửi, hai người nhận và thư có hai phần văn bản/HTML', async () => {
    const smtp = await fakeSmtp();
    try {
      const svc = service({
        OPS_ALERT_EMAIL_TO: 'ops@tubutree.test; ceo@tubutree.test',
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: String(smtp.port),
        SMTP_FROM: 'Tubu Tree <alerts@tubutree.test>',
        NODE_ENV: 'production',
      });
      await expect(svc.sendAlert(MESSAGE)).resolves.toBe('DONE');
      const sent = smtp.lines.join('\n');
      expect(sent).toMatch(/MAIL FROM:<alerts@tubutree\.test>/i);
      expect(sent).toMatch(/RCPT TO:<ops@tubutree\.test>/i);
      expect(sent).toMatch(/RCPT TO:<ceo@tubutree\.test>/i);
      expect(sent).toContain('Auto-Submitted: auto-generated');
      expect(sent).toContain('Content-Type: text/plain');
      expect(sent).toContain('Content-Type: text/html');
    } finally {
      await smtp.close();
    }
  });

  it('có tài khoản mà máy chủ không nâng được lên TLS: từ chối gửi, KHÔNG gửi lệnh AUTH (mật khẩu không đi dạng thô), lỗi tạm thời (RETRY)', async () => {
    const smtp = await fakeSmtp();
    try {
      const svc = service({
        OPS_ALERT_EMAIL_TO: 'ops@tubutree.test',
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: String(smtp.port),
        SMTP_USER: 'mailer-user',
        SMTP_PASS: 'hunter2-pass',
        SMTP_FROM: 'alerts@tubutree.test',
      });
      await expect(svc.sendAlert(MESSAGE)).resolves.toBe('RETRY');
      expect(smtp.lines.some((l) => /^AUTH/i.test(l))).toBe(false);
      expect(smtp.lines.some((l) => l.includes('hunter2-pass') || l.includes(Buffer.from('hunter2-pass').toString('base64')))).toBe(false);
    } finally {
      await smtp.close();
    }
  });

  it('máy chủ không có ai nghe: lỗi kết nối được trả về gọn, không ném, không treo', async () => {
    const smtp = await fakeSmtp();
    const { port } = smtp;
    await smtp.close();
    const svc = service({ OPS_ALERT_EMAIL_TO: 'ops@tubutree.test', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(port), SMTP_FROM: 'alerts@tubutree.test' });
    await expect(svc.sendAlert(MESSAGE)).resolves.toBe('RETRY');
    const test = await svc.sendTest();
    expect(test).toMatchObject({ ok: false, reason: 'SEND_FAILED', kind: 'TRANSIENT' });
    expect(!test.ok && test.error).toContain('ECONNREFUSED');
  });

  it('máy chủ từ chối người nhận (550 thật qua nodemailer) → BLOCKED: đúng một lần gửi, không tự gửi lại', async () => {
    const smtp = await fakeSmtp({ rcpt: '550 5.1.1 User unknown' });
    try {
      const svc = service({ OPS_ALERT_EMAIL_TO: 'ops@tubutree.test', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.port), SMTP_FROM: 'alerts@tubutree.test' });
      await expect(svc.sendAlert(MESSAGE)).resolves.toBe('BLOCKED');
      expect(smtp.lines.filter((l) => /^RCPT TO/i.test(l))).toHaveLength(1);
    } finally {
      await smtp.close();
    }
  });

  it('máy chủ tạm từ chối (421/451 thật qua nodemailer) → RETRY như cũ', async () => {
    for (const mail of ['451 4.3.0 try again later', '421 4.3.2 service not available']) {
      const smtp = await fakeSmtp({ mail });
      try {
        const svc = service({ OPS_ALERT_EMAIL_TO: 'ops@tubutree.test', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.port), SMTP_FROM: 'alerts@tubutree.test' });
        await expect(svc.sendAlert(MESSAGE)).resolves.toBe('RETRY');
      } finally {
        await smtp.close();
      }
    }
  });
});

/**
 * Hình dạng lỗi THẬT của nodemailer 10 (code, responseCode, response) cho từng kiểu trả lời của máy chủ — để bộ phân loại
 * không chỉ đúng với lỗi tự dựng. Xác thực đi qua `ignoreTLS` vì máy chủ giả không có TLS (dịch vụ thật luôn đòi TLS trước AUTH).
 */
describe('classifySmtpError với lỗi thật của nodemailer', () => {
  async function failure(replies: FakeReplies, opts: { auth?: boolean } = {}) {
    const smtp = await fakeSmtp(replies);
    try {
      const t = createTransport({
        host: '127.0.0.1',
        port: smtp.port,
        ignoreTLS: true,
        ...(opts.auth ? { auth: { user: 'mailer-user', pass: 'hunter2-pass' } } : {}),
        connectionTimeout: 3000,
        greetingTimeout: 3000,
        socketTimeout: 3000,
      });
      try {
        await t.sendMail({ from: 'alerts@tubutree.test', to: 'ops@tubutree.test', subject: 's', text: 't' });
        return null;
      } catch (e) {
        return e as Error & { code?: string; responseCode?: number };
      } finally {
        t.close();
      }
    } finally {
      await smtp.close();
    }
  }

  it.each([
    ['535 sai mật khẩu → AUTH', { auth: '535 5.7.8 Username and Password not accepted' }, 'AUTH'],
    ['534 cần mật khẩu ứng dụng → AUTH', { auth: '534 5.7.9 Application-specific password required' }, 'AUTH'],
    ['454 thử đăng nhập quá nhiều → TRANSIENT', { auth: '454 4.7.0 Too many login attempts, please try again later' }, 'TRANSIENT'],
  ] as const)('xác thực: %s → %s', async (_n, replies, kind) => {
    const e = await failure(replies, { auth: true });
    expect(e?.code).toBe('EAUTH');
    expect(classifySmtpError(e)).toBe(kind);
  });

  it.each([
    ['550 người nhận không tồn tại → PERMANENT', { rcpt: '550 5.1.1 User unknown' }, 'PERMANENT'],
    ['553 địa chỉ nhận sai → PERMANENT', { rcpt: '553 5.1.3 Mailbox name not allowed' }, 'PERMANENT'],
    ['554 cấm relay → PERMANENT', { rcpt: '554 5.7.1 Relay access denied' }, 'PERMANENT'],
    ['554 thư bị từ chối ở MAIL FROM → PERMANENT', { mail: '554 5.7.1 Sender rejected' }, 'PERMANENT'],
    ['554 thư bị từ chối sau DATA → PERMANENT', { dataEnd: '554 5.7.1 Message rejected as spam' }, 'PERMANENT'],
    ['450 hộp thư bận → TRANSIENT', { rcpt: '450 4.2.1 Mailbox busy' }, 'TRANSIENT'],
    ['451 lỗi cục bộ → TRANSIENT', { mail: '451 4.3.0 Local error' }, 'TRANSIENT'],
    ['421 dịch vụ tạm ngưng → TRANSIENT', { mail: '421 4.3.2 Service not available' }, 'TRANSIENT'],
    ['452 hết dung lượng → TRANSIENT', { dataEnd: '452 4.3.1 Insufficient storage' }, 'TRANSIENT'],
  ] as const)('gửi thư: %s → %s', async (_n, replies, kind) => {
    const e = await failure(replies);
    expect(e).not.toBeNull();
    expect(classifySmtpError(e)).toBe(kind);
  });

  it('không có ai nghe → ECONNREFUSED/ECONNECTION thuộc loại tạm thời', async () => {
    const smtp = await fakeSmtp();
    const { port } = smtp;
    await smtp.close();
    const t = createTransport({ host: '127.0.0.1', port, connectionTimeout: 3000 });
    const e = await t.sendMail({ from: 'a@x.test', to: 'b@x.test', subject: 's', text: 't' }).catch((err: unknown) => err);
    t.close();
    expect(classifySmtpError(e)).toBe('TRANSIENT');
  });
});
