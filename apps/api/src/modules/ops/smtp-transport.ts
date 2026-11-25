import { createTransport } from 'nodemailer';
import type { OpsEmailConfig } from '../../config/ops-email-config';

export type ReadySmtp = Extract<OpsEmailConfig, { state: 'ready' }>['smtp'];

/** Phần của nodemailer Transporter mà các dịch vụ email dùng — test thay bằng bản giả hoặc jsonTransport, không bao giờ nối SMTP thật. */
export interface MailTransport {
  sendMail(message: {
    from: string | { name: string; address: string };
    to: string[];
    subject: string;
    text: string;
    html: string;
    headers: Record<string, string>;
  }): Promise<unknown>;
  close(): void;
}
export type MailTransportFactory = (smtp: ReadySmtp) => MailTransport;

/** Token tiêm bản giả của MailTransportFactory (@Optional): không có thì nối SMTP thật bằng nodemailer. */
export const OPS_MAIL_TRANSPORT = Symbol('OPS_MAIL_TRANSPORT');

/** Quá hạn này thì bỏ lượt gửi: ba hạn chờ của nodemailer cộng dồn vẫn có thể kéo dài, cron 5 phút không được kẹt theo. */
export const EMAIL_SEND_TIMEOUT_MS = 30_000;

export function smtpTransportOptions(smtp: ReadySmtp) {
  return {
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    requireTLS: smtp.requireTLS,
    ...(smtp.auth ? { auth: smtp.auth } : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  };
}

export const defaultMailTransportFactory: MailTransportFactory = (smtp) => createTransport(smtpTransportOptions(smtp));

/** Thư máy gửi: báo cho hộp thư nhận đừng trả lời tự động (tránh vòng lặp auto-reply). */
export const AUTO_MAIL_HEADERS: Readonly<Record<string, string>> = { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' };

export async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`quá ${Math.round(ms / 1000)} giây không gửi xong`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
