import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

/**
 * Global filter: map Prisma errors → HTTP nhất quán, không lộ chi tiết DB.
 * P2025 (record not found) → 404
 * P2002 (unique violation)  → 409
 * P2003 (FK violation)      → 400
 * P2034 (transaction conflict) → 409
 * Còn lại → 500 (log raw).
 */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<{ method?: string; originalUrl?: string; url?: string }>();
    const res = ctx.getResponse<Response>();
    const map: Record<string, { status: number; message: string }> = {
      P2025: { status: HttpStatus.NOT_FOUND, message: 'Không tìm thấy bản ghi.' },
      P2002: { status: HttpStatus.CONFLICT, message: 'Dữ liệu trùng (vi phạm ràng buộc duy nhất).' },
      P2003: { status: HttpStatus.BAD_REQUEST, message: 'Tham chiếu không hợp lệ.' },
      P2034: { status: HttpStatus.CONFLICT, message: 'Xung đột giao dịch, vui lòng thử lại.' },
    };
    const known = map[exception.code];
    // Log MỌI Prisma error mapped — trước đây P2025 nuốt im lặng → không debug được khi
    // P2025 thực ra là invariant violation trong internal caller (affiliate.createCommissionForOrder,
    // loyalty.creditOrderPoints…) thay vì 404 hợp lệ của public endpoint.
    const route = `${req?.method ?? '?'} ${req?.originalUrl ?? req?.url ?? '?'}`;
    if (known) {
      this.logger.warn(`Prisma ${exception.code} on ${route}: ${exception.message}`);
      res.status(known.status).json({ statusCode: known.status, message: known.message, code: exception.code });
      return;
    }
    this.logger.error(`Prisma ${exception.code} on ${route}: ${exception.message}`);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Lỗi cơ sở dữ liệu.',
      code: exception.code,
    });
  }
}
