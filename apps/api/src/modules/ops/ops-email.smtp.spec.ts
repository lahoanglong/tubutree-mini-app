import { createServer, type AddressInfo, type Server } from 'node:net';
import { Logger } from '@nestjs/common';
import type { AlertMessage } from './ops-alerts';
import { OpsEmailService } from './ops-email.service';

/**
 * Đường SMTP THẬT của nodemailer (không thay transport) nhưng chỉ nói chuyện với máy chủ giả trên 127.0.0.1 do chính spec
 * dựng — không có kết nối ra ngoài, không email thật. Kiểm cấu hình truyền cho nodemailer đúng tên/ý nghĩa, và mật khẩu
 * không bao giờ bị gửi qua đường không mã hoá.
 */
function fakeSmtp() {
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
            sock.write('250 queued\r\n');
          }
          continue;
        }
        const cmd = line.toUpperCase();
        if (cmd.startsWith('EHLO')) sock.write('250-fake\r\n250 AUTH PLAIN LOGIN\r\n');
        else if (cmd === 'STARTTLS') sock.write('454 TLS not available\r\n');
        else if (cmd.startsWith('AUTH')) sock.write('235 ok\r\n');
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
      await expect(svc.sendAlert(MESSAGE)).resolves.toBe(true);
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

  it('có tài khoản mà máy chủ không nâng được lên TLS: từ chối gửi, KHÔNG gửi lệnh AUTH (mật khẩu không đi dạng thô), trả false', async () => {
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
      await expect(svc.sendAlert(MESSAGE)).resolves.toBe(false);
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
    await expect(svc.sendAlert(MESSAGE)).resolves.toBe(false);
    const test = await svc.sendTest();
    expect(test).toMatchObject({ ok: false, reason: 'SEND_FAILED' });
    expect(!test.ok && test.error).toContain('ECONNREFUSED');
  });
});
