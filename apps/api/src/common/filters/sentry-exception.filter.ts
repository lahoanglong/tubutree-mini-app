import { ArgumentsHost, Catch } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { captureServerError } from '../../config/sentry';

/**
 * Bắt mọi exception chưa có filter riêng: báo Sentry nếu là 5xx rồi giao lại cho BaseExceptionFilter,
 * nên phản hồi cho khách giống hệt khi không có filter này.
 */
@Catch()
export class SentryExceptionFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    captureServerError(exception);
    super.catch(exception, host);
  }
}
