import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.validation';
import { vnDateKey } from '../../../common/vn-time';
import { EmailOtpMailer } from './email-otp.mailer';
import {
  EMAIL_OTP_DAILY_TOTAL,
  EMAIL_OTP_MAX_WRONG,
  EMAIL_OTP_RESEND_COOLDOWN_MS,
  EMAIL_OTP_TTL_MS,
  emailIdentityHash,
  generateEmailOtp,
  hashEmailOtp,
  maskEmail,
  normalizeEmail,
} from './email-otp.rules';
import { EMAIL_OTP_STORE, type EmailOtpLimit, type EmailOtpStore } from './email-otp.store';

export const INVALID_EMAIL_MESSAGE = 'Email chưa đúng định dạng. Bạn kiểm tra lại giúp Tubu nhé.';
export const EMAIL_LOGIN_UNAVAILABLE_MESSAGE = 'Đăng nhập bằng Email đang tạm ngưng. Bạn thử lại sau ít phút nhé.';
export const EMAIL_SEND_FAILED_MESSAGE = 'Chưa gửi được mã tới email này. Bạn kiểm tra lại địa chỉ hoặc thử lại sau ít phút nhé.';
export const OTP_EXPIRED_MESSAGE = 'Mã đã hết hạn hoặc đã dùng. Bấm "Gửi lại mã" để nhận mã mới.';
export const OTP_LOCKED_MESSAGE = `Bạn nhập sai quá ${EMAIL_OTP_MAX_WRONG} lần. Bấm "Gửi lại mã" để nhận mã mới.`;
export const otpWrongMessage = (left: number) => `Mã chưa đúng. Bạn còn ${left} lần thử.`;

function limitMessage(reason: EmailOtpLimit, retryAfterSec: number): string {
  if (reason === 'cooldown') return `Bạn đợi ${retryAfterSec} giây rồi bấm gửi lại mã nhé.`;
  if (reason === 'daily_cap') return 'Đăng nhập bằng Email đang quá tải. Bạn thử lại sau hoặc đăng nhập bằng Zalo nhé.';
  const minutes = Math.max(1, Math.ceil(retryAfterSec / 60));
  const wait = minutes >= 90 ? `${Math.ceil(minutes / 60)} giờ` : `${minutes} phút`;
  return `Bạn yêu cầu mã quá nhiều lần. Thử lại sau khoảng ${wait} nhé.`;
}

export interface EmailOtpRequestResult {
  email: string;
  /** Giây phải đợi trước khi bấm "Gửi lại mã". */
  resendAfterSec: number;
  expiresInSec: number;
}

/**
 * Mã đăng nhập 6 số gửi qua email (web). Mã chỉ nằm trong Redis dưới dạng băm, không bao giờ được ghi log hay trả về API: chỉ hộp
 * thư của khách thấy mã. Đăng nhập xong cấp đúng cặp token như Zalo (AuthService.loginWithVerifiedEmail).
 */
@Injectable()
export class EmailOtpService {
  private readonly logger = new Logger(EmailOtpService.name);
  /** Ngày đã báo chạm trần chung (mỗi tiến trình báo một lần mỗi ngày, không ghi một dòng cho mỗi lượt bị từ chối). */
  private dailyCapReported: string | null = null;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly mailer: EmailOtpMailer,
    @Optional() @Inject(EMAIL_OTP_STORE) private readonly store?: EmailOtpStore,
  ) {}

  private secret(): string {
    return this.config.get('JWT_ACCESS_SECRET', { infer: true });
  }

  private emailOrThrow(raw: unknown): string {
    const email = normalizeEmail(raw);
    if (!email) throw new BadRequestException({ statusCode: 400, error: 'Bad Request', code: 'EMAIL_INVALID', message: INVALID_EMAIL_MESSAGE });
    return email;
  }

  private unavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException({ statusCode: 503, error: 'Service Unavailable', code: 'EMAIL_LOGIN_UNAVAILABLE', message: EMAIL_LOGIN_UNAVAILABLE_MESSAGE });
  }

  async request(rawEmail: unknown, ipKey: string, now = new Date()): Promise<EmailOtpRequestResult> {
    const email = this.emailOrThrow(rawEmail);
    const store = this.store;
    if (!store || !this.mailer.configured()) throw this.unavailable();

    const slot = { id: emailIdentityHash(email), ip: ipKey, day: vnDateKey(now) };
    const code = generateEmailOtp();
    let started;
    try {
      started = await store.start({ ...slot, codeHash: hashEmailOtp(this.secret(), email, code) });
    } catch (err) {
      this.logger.error(`Kho mã email lỗi khi cấp mã cho ${maskEmail(email)}: ${err instanceof Error ? err.message : err}`);
      throw this.unavailable();
    }
    if (!started.ok) {
      if (started.reason === 'daily_cap' && this.dailyCapReported !== slot.day) {
        this.dailyCapReported = slot.day;
        this.logger.error(`Đăng nhập Email chạm trần ${EMAIL_OTP_DAILY_TOTAL} thư ngày ${slot.day}: khách mới không nhận được mã tới hết ngày`);
      }
      const retryAfterSec = Math.max(1, Math.ceil(started.retryAfterMs / 1000));
      throw new HttpException(
        {
          statusCode: 429,
          error: 'Too Many Requests',
          code: started.reason === 'cooldown' ? 'EMAIL_OTP_COOLDOWN' : 'EMAIL_OTP_RATE_LIMITED',
          message: limitMessage(started.reason, retryAfterSec),
          retryAfterSec,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    try {
      await this.mailer.send(email, code);
    } catch (err) {
      // Lời lỗi SMTP có thể kèm nguyên thư bị từ chối: che mọi dãy 6 số để mã không bao giờ vào log.
      const detail = err instanceof Error ? err.message.replace(/\d{6}/g, '******') : 'lỗi không rõ';
      this.logger.warn(`Gửi mã đăng nhập tới ${maskEmail(email)} thất bại: ${detail}`);
      await store.cancel(slot).catch(() => undefined);
      throw new ServiceUnavailableException({ statusCode: 503, error: 'Service Unavailable', code: 'EMAIL_SEND_FAILED', message: EMAIL_SEND_FAILED_MESSAGE });
    }
    return { email, resendAfterSec: Math.round(EMAIL_OTP_RESEND_COOLDOWN_MS / 1000), expiresInSec: Math.round(EMAIL_OTP_TTL_MS / 1000) };
  }

  /** Mã đúng thì trả email đã chuẩn hoá (mã bị xoá ngay, dùng một lần); sai/hết hạn thì ném 400 kèm mã lỗi ổn định cho web. */
  async verify(rawEmail: unknown, code: string): Promise<string> {
    const email = this.emailOrThrow(rawEmail);
    const store = this.store;
    if (!store) throw this.unavailable();
    let res;
    try {
      res = await store.verify(emailIdentityHash(email), hashEmailOtp(this.secret(), email, code));
    } catch (err) {
      this.logger.error(`Kho mã email lỗi khi xác minh ${maskEmail(email)}: ${err instanceof Error ? err.message : err}`);
      throw this.unavailable();
    }
    if (res.kind === 'ok') return email;
    if (res.kind === 'wrong') {
      throw new BadRequestException({ statusCode: 400, error: 'Bad Request', code: 'EMAIL_OTP_WRONG', message: otpWrongMessage(res.attemptsLeft), attemptsLeft: res.attemptsLeft });
    }
    if (res.kind === 'locked') {
      this.logger.warn(`Mã đăng nhập email của ${maskEmail(email)} bị huỷ sau ${EMAIL_OTP_MAX_WRONG} lần sai`);
      throw new BadRequestException({ statusCode: 400, error: 'Bad Request', code: 'EMAIL_OTP_LOCKED', message: OTP_LOCKED_MESSAGE });
    }
    throw new BadRequestException({ statusCode: 400, error: 'Bad Request', code: 'EMAIL_OTP_EXPIRED', message: OTP_EXPIRED_MESSAGE });
  }
}
