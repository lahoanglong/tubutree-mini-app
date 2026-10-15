import { createHmac } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';
import { PrismaService } from '../../prisma/prisma.service';
import type { Env } from '../../config/env.validation';
import { OPS_EMAIL_KEYS, resolveOpsEmailConfig, type OpsEmailConfig } from '../../config/ops-email-config';
import type { AlertMessage } from './ops-alerts';
import { alertEmail, emailEnvLabel, OPS_EMAIL_APP_NAME, scrubSecrets, testEmail, type AlertEmail } from './ops-email';
import { classifySmtpError, isSmtpFailureKind, smtpFailureHint, type SmtpFailureKind } from './ops-email-error';
import { EMAIL_BLOCK_KEY, EMAIL_STATE_KEY, recordEmailDelivery, type EmailDeliveryResult } from './ops-state';

type Ready = Extract<OpsEmailConfig, { state: 'ready' }>;

/** Phần của nodemailer Transporter mà dịch vụ dùng — test thay bằng bản giả hoặc jsonTransport, không bao giờ nối SMTP thật. */
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
export type MailTransportFactory = (smtp: Ready['smtp']) => MailTransport;

export const OPS_MAIL_TRANSPORT = Symbol('OPS_MAIL_TRANSPORT');

/** Quá hạn này thì bỏ lượt gửi: ba hạn chờ của nodemailer cộng dồn vẫn có thể kéo dài, cron 5 phút không được kẹt theo. */
export const EMAIL_SEND_TIMEOUT_MS = 30_000;

export function smtpTransportOptions(smtp: Ready['smtp']) {
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

const defaultFactory: MailTransportFactory = (smtp) => createTransport(smtpTransportOptions(smtp));

/** Trạng thái kênh email trong ảnh chụp sức khoẻ vận hành (admin xem ở màn Sức khoẻ hệ thống). */
export interface EmailChannelState {
  state: 'DISABLED' | 'READY' | 'MISCONFIGURED';
  recipients: number;
  /** Lỗi cấu hình theo khoá (không kèm giá trị). */
  issues: string[];
  lastOkAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  /** Loại lỗi gần nhất (null = chưa có lỗi, hoặc lỗi cấu hình không phải SMTP). AUTH/PERMANENT: không tự gửi lại liên tục. */
  lastErrorKind: SmtpFailureKind | null;
  /** Lời chỉ cách sửa cho lỗi AUTH/PERMANENT, không chứa giá trị cấu hình nào. */
  lastErrorHint: string | null;
}

export type TestEmailResult =
  | { ok: true; recipients: number }
  | { ok: false; reason: 'DISABLED' | 'MISCONFIGURED'; error: string }
  | { ok: false; reason: 'SEND_FAILED'; error: string; kind: SmtpFailureKind };

type DeliveryResult = { ok: true } | { ok: false; error: string; kind: SmtpFailureKind; fingerprint: string };

/**
 * Kết quả một lượt gửi email báo động cho cron:
 *  - DONE: đã gửi được, hoặc không có gì để gửi (chưa cấu hình / cấu hình hỏng — gửi lại cũng không khá hơn);
 *  - RETRY: lỗi tạm thời (mạng, quá hạn, 4xx) — lượt kiểm sau gửi lại;
 *  - BLOCKED: lỗi vĩnh viễn (sai xác thực, 5xx) — KHÔNG tự gửi lại; xem `blockLifted()`.
 */
export type EmailAlertOutcome = 'DONE' | 'RETRY' | 'BLOCKED';

export const DISABLED_EMAIL_STATE: EmailChannelState = {
  state: 'DISABLED',
  recipients: 0,
  issues: [],
  lastOkAt: null,
  lastErrorAt: null,
  lastError: null,
  lastErrorKind: null,
  lastErrorHint: null,
};

const DISABLED_HINT = 'Chưa cấu hình email báo động: đặt OPS_ALERT_EMAIL_TO, SMTP_HOST và SMTP_FROM (docs/GO-LIVE-KEYS.md mục 8).';
const ERROR_MAX = 300;

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
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

/**
 * Kênh email của báo động vận hành (SMTP qua nodemailer). Chỉ lo việc GỬI; quyết định gửi lúc nào (mở sự cố, việc mới,
 * nhắc lại, đã ổn) nằm ở OpsHealthService dùng chung với webhook. Mọi lỗi (cấu hình, mạng, SMTP, ghi DB) được nuốt tại đây:
 * gọi hàm này không bao giờ ném — cron sức khoẻ, webhook và request của người dùng không thể bị email làm hỏng.
 */
@Injectable()
export class OpsEmailService {
  private readonly logger = new Logger(OpsEmailService.name);
  private readonly factory: MailTransportFactory;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
    @Optional() @Inject(OPS_MAIL_TRANSPORT) factory?: MailTransportFactory,
  ) {
    this.factory = factory ?? defaultFactory;
  }

  private resolve(): OpsEmailConfig {
    return resolveOpsEmailConfig(Object.fromEntries(OPS_EMAIL_KEYS.map((k) => [k, this.config.get(k, { infer: true })])));
  }

  private context() {
    return {
      appName: OPS_EMAIL_APP_NAME,
      envLabel: emailEnvLabel(this.config.get('OPS_ALERT_ENV_LABEL', { infer: true }), this.config.get('NODE_ENV', { infer: true })),
    };
  }

  /**
   * Gửi một lần báo động. Lỗi tạm thời → RETRY (cron gửi lại ở lượt kiểm sau). Lỗi vĩnh viễn (sai tài khoản/mật khẩu, máy
   * chủ từ chối hẳn) → BLOCKED: ghi lỗi nhưng KHÔNG bắt gửi lại, vì thử lại vài phút một lần với mật khẩu sai là đập vào
   * Gmail/Workspace cho tới khi tài khoản bị khoá.
   */
  async sendAlert(m: AlertMessage): Promise<EmailAlertOutcome> {
    try {
      const cfg = this.resolve();
      if (cfg.state === 'disabled') return 'DONE';
      if (cfg.state === 'misconfigured') {
        const error = `Cấu hình email chưa đủ: ${cfg.issues.map((i) => i.message).join(' ')}`;
        this.logger.warn(`Email báo động vận hành không gửi được: ${error}`);
        await this.record({ ok: false, error });
        return 'DONE';
      }
      const res = await this.deliver(cfg, alertEmail(m, this.context()));
      await this.record(res);
      if (res.ok) return 'DONE';
      if (res.kind === 'TRANSIENT') {
        this.logger.warn(`Email báo động vận hành lỗi: ${res.error} — gửi lại ở lượt kiểm sau.`);
        return 'RETRY';
      }
      this.logger.warn(
        `Email báo động vận hành lỗi vĩnh viễn (${res.kind}): ${res.error} — KHÔNG tự gửi lại cho tới khi đổi cấu hình, admin gửi email thử thành công hoặc có sự cố mới.`,
      );
      return 'BLOCKED';
    } catch (e) {
      this.logger.warn(`Email báo động vận hành lỗi không lường trước: ${e instanceof Error ? e.message : String(e)}`);
      return 'RETRY';
    }
  }

  /**
   * Một lượt gửi đã BLOCKED nay đáng thử lại chưa: cấu hình đã đổi so với lúc lỗi vĩnh viễn (sửa mật khẩu rồi deploy), hoặc
   * email thử của admin đã gửi được sau lỗi đó. Chỉ lỗi vĩnh viễn (hàng `alert.email.block`) mới làm mốc so sánh: lần gửi
   * thử lỗi tạm thời không đổi được mốc, nên không khoá lại một cấu hình mới chưa từng bị máy chủ từ chối. Cấu hình không
   * còn sẵn sàng thì cũng trả true để cron gọi sendAlert, nơi ghi nhận và nhả khoá. Đọc DB lỗi → false (cứ chờ).
   */
  async blockLifted(): Promise<boolean> {
    try {
      const cfg = this.resolve();
      if (cfg.state !== 'ready') return true;
      const [block, last] = await Promise.all([
        this.prisma.opsHealthState.findUnique({ where: { key: EMAIL_BLOCK_KEY } }),
        this.prisma.opsHealthState.findUnique({ where: { key: EMAIL_STATE_KEY } }),
      ]);
      if (!block?.lastErrorAt) return true;
      if (last?.lastOkAt && last.lastOkAt >= block.lastErrorAt) return true;
      const failedWith = (block.detail as { fingerprint?: unknown } | null)?.fingerprint;
      return failedWith !== this.fingerprint(cfg);
    } catch (e) {
      this.logger.warn(`Không đọc được trạng thái gửi email báo động: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  /** Hành động "gửi thử" của admin: không đụng trí nhớ chống báo lặp, chỉ ghi lần gửi gần nhất. */
  async sendTest(now = new Date()): Promise<TestEmailResult> {
    try {
      const cfg = this.resolve();
      if (cfg.state === 'disabled') return { ok: false, reason: 'DISABLED', error: DISABLED_HINT };
      if (cfg.state === 'misconfigured') {
        return { ok: false, reason: 'MISCONFIGURED', error: `Cấu hình email chưa đủ: ${cfg.issues.map((i) => i.message).join(' ')}` };
      }
      const res = await this.deliver(cfg, testEmail(this.context(), now));
      await this.record(res);
      if (res.ok) return { ok: true, recipients: cfg.recipients.length };
      this.logger.warn(`Email thử báo động vận hành lỗi (${res.kind}): ${res.error}`);
      return { ok: false, reason: 'SEND_FAILED', error: res.error, kind: res.kind };
    } catch (e) {
      this.logger.warn(`Email thử báo động vận hành lỗi không lường trước: ${e instanceof Error ? e.message : String(e)}`);
      return { ok: false, reason: 'SEND_FAILED', error: 'Lỗi không lường trước khi gửi email thử.', kind: 'TRANSIENT' };
    }
  }

  async state(): Promise<EmailChannelState> {
    const cfg = this.resolve();
    if (cfg.state === 'disabled') return DISABLED_EMAIL_STATE;
    const row = await this.prisma.opsHealthState.findUnique({ where: { key: EMAIL_STATE_KEY } });
    const kind = (row?.detail as { kind?: unknown } | null)?.kind;
    const lastErrorKind = isSmtpFailureKind(kind) ? kind : null;
    return {
      state: cfg.state === 'ready' ? 'READY' : 'MISCONFIGURED',
      recipients: cfg.state === 'ready' ? cfg.recipients.length : 0,
      issues: cfg.state === 'misconfigured' ? cfg.issues.map((i) => i.message) : [],
      lastOkAt: row?.lastOkAt?.toISOString() ?? null,
      lastErrorAt: row?.lastErrorAt?.toISOString() ?? null,
      lastError: row?.lastError ?? null,
      lastErrorKind,
      lastErrorHint: smtpFailureHint(lastErrorKind),
    };
  }

  private async deliver(cfg: Ready, content: AlertEmail): Promise<DeliveryResult> {
    let transport: MailTransport | undefined;
    try {
      transport = this.factory(cfg.smtp);
      const { from } = cfg;
      await withTimeout(
        transport.sendMail({
          from: from.name ? { name: from.name, address: from.address } : from.address,
          to: cfg.recipients,
          subject: content.subject,
          text: content.text,
          html: content.html,
          // Thư máy gửi: báo cho hộp thư nhận đừng trả lời tự động (tránh vòng lặp auto-reply).
          headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' },
        }),
        EMAIL_SEND_TIMEOUT_MS,
      );
      return { ok: true };
    } catch (e) {
      return { ok: false, error: this.describeError(e, cfg), kind: classifySmtpError(e), fingerprint: this.fingerprint(cfg) };
    } finally {
      try {
        transport?.close();
      } catch {
        /* đóng kết nối là việc dọn dẹp, lỗi ở đây không đổi kết quả gửi */
      }
    }
  }

  /**
   * Dấu vân tay của cấu hình gửi (máy chủ, cổng, tài khoản, mật khẩu, người gửi, người nhận), lưu cùng lỗi vĩnh viễn để
   * biết cấu hình đã đổi chưa. HMAC khoá bằng JWT_ACCESS_SECRET: mật khẩu không thể dò ngược từ giá trị lưu trong DB.
   */
  private fingerprint(cfg: Ready): string {
    const key = String(this.config.get('JWT_ACCESS_SECRET', { infer: true }) ?? '');
    return createHmac('sha256', key).update(JSON.stringify([cfg.smtp, cfg.from, cfg.recipients])).digest('hex').slice(0, 32);
  }

  /** Một dòng, đã che tài khoản/mật khẩu SMTP — an toàn để log và lưu cho màn admin. */
  private describeError(e: unknown, cfg: Ready): string {
    const code = typeof (e as { code?: unknown } | null)?.code === 'string' ? (e as { code: string }).code : '';
    const message = e instanceof Error ? e.message : String(e);
    const secrets = [cfg.smtp.auth?.user ?? '', cfg.smtp.auth?.pass ?? ''];
    const line = scrubSecrets(`${code ? `${code}: ` : ''}${message}`, secrets).replace(/\s+/g, ' ').trim();
    return line.length > ERROR_MAX ? `${line.slice(0, ERROR_MAX - 1)}…` : line;
  }

  private async record(res: EmailDeliveryResult): Promise<void> {
    try {
      await recordEmailDelivery(this.prisma, res);
    } catch (e) {
      this.logger.warn(`Không ghi được trạng thái gửi email báo động: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
