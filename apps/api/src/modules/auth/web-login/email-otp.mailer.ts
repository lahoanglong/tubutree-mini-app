import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.validation';
import { OPS_EMAIL_KEYS, resolveSmtpSenderConfig, type SmtpSenderConfig } from '../../../config/ops-email-config';
import {
  AUTO_MAIL_HEADERS,
  defaultMailTransportFactory,
  OPS_MAIL_TRANSPORT,
  withTimeout,
  type MailTransport,
  type MailTransportFactory,
} from '../../ops/smtp-transport';
import { EMAIL_OTP_TTL_MS } from './email-otp.rules';

/** Thư mã đăng nhập phải tới nhanh hoặc báo lỗi nhanh: khách đang chờ trên màn nhập mã. */
export const EMAIL_OTP_SEND_TIMEOUT_MS = 15_000;

export interface EmailOtpMessage {
  subject: string;
  text: string;
  html: string;
}

/** Thư ngắn, một việc: mã to dễ đọc, hạn dùng, câu bỏ qua nếu không phải mình. Không có link (khách không phải bấm gì, khó giả mạo). */
export function emailOtpMessage(code: string): EmailOtpMessage {
  const minutes = Math.round(EMAIL_OTP_TTL_MS / 60_000);
  const subject = `${code} là mã đăng nhập Tubu Tree của bạn`;
  const text = [
    'Chào bạn,',
    '',
    `Mã đăng nhập Tubu Tree của bạn: ${code}`,
    `Mã dùng một lần, hết hạn sau ${minutes} phút.`,
    '',
    'Nếu bạn không yêu cầu đăng nhập, hãy bỏ qua thư này. Tubu Tree không bao giờ hỏi mã này qua điện thoại hay tin nhắn.',
    '',
    'Tubu Tree',
  ].join('\n');
  const html = [
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1c1917;max-width:480px;margin:0 auto;padding:24px 16px">',
    '<p style="margin:0 0 4px;font-size:18px;font-weight:bold;color:#14532d">Tubu Tree</p>',
    '<p style="margin:0 0 16px">Mã đăng nhập của bạn:</p>',
    `<p style="margin:0 0 16px;font-size:32px;font-weight:bold;letter-spacing:8px;color:#14532d">${code}</p>`,
    `<p style="margin:0 0 16px">Mã dùng một lần, hết hạn sau ${minutes} phút.</p>`,
    '<p style="margin:0;font-size:13px;color:#57534e">Nếu bạn không yêu cầu đăng nhập, hãy bỏ qua thư này. Tubu Tree không bao giờ hỏi mã này qua điện thoại hay tin nhắn.</p>',
    '</div>',
  ].join('');
  return { subject, text, html };
}

/** Gửi thư mã đăng nhập qua cùng SMTP với email báo động vận hành (SMTP_*), không cần OPS_ALERT_EMAIL_TO. */
@Injectable()
export class EmailOtpMailer {
  private readonly factory: MailTransportFactory;

  constructor(
    private readonly config: ConfigService<Env, true>,
    @Optional() @Inject(OPS_MAIL_TRANSPORT) factory?: MailTransportFactory,
  ) {
    this.factory = factory ?? defaultMailTransportFactory;
  }

  private resolve(): SmtpSenderConfig {
    return resolveSmtpSenderConfig(Object.fromEntries(OPS_EMAIL_KEYS.map((k) => [k, this.config.get(k, { infer: true })])));
  }

  configured(): boolean {
    return this.resolve().state === 'ready';
  }

  /** Ném lỗi khi chưa cấu hình hoặc gửi hỏng; người gọi quyết định trả gì cho khách. Lỗi không bao giờ chứa mã. */
  async send(to: string, code: string): Promise<void> {
    const cfg = this.resolve();
    if (cfg.state !== 'ready') throw new Error(`SMTP chưa sẵn sàng (${cfg.state})`);
    const msg = emailOtpMessage(code);
    let transport: MailTransport | undefined;
    try {
      transport = this.factory(cfg.smtp);
      await withTimeout(
        transport.sendMail({
          from: { name: cfg.from.name ?? 'Tubu Tree', address: cfg.from.address },
          to: [to],
          subject: msg.subject,
          text: msg.text,
          html: msg.html,
          headers: { ...AUTO_MAIL_HEADERS },
        }),
        EMAIL_OTP_SEND_TIMEOUT_MS,
      );
    } finally {
      try {
        transport?.close();
      } catch {
        /* đóng kết nối là dọn dẹp, không đổi kết quả gửi */
      }
    }
  }
}
