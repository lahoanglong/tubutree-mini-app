import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

/**
 * Global filter: map Prisma errors → HTTP nhất quán, không lộ chi tiết DB.
 * P2025 (record not found) → 404
 * P2002 (unique violation)  → 409
 * P2003 (FK violation)      → 400
 * P2034 (transaction conflict) → 409
 * Còn lại (PrismaClientKnownRequestError khác) → 500 (log raw).
 *
 * Ngoài PrismaClientKnownRequestError, Prisma còn có thể ném:
 * - PrismaClientInitializationError: mất kết nối DB / DB restart giữa lúc chạy.
 * - PrismaClientValidationError: sai kiểu/thiếu field khi build query.
 * - PrismaClientUnknownRequestError, PrismaClientRustPanicError: lỗi engine không rõ nguyên nhân.
 * Các loại này KHÔNG khớp instanceof PrismaClientKnownRequestError — nếu không bắt riêng sẽ
 * rơi về handler mặc định của Nest, mất format {statusCode,code,message} nhất quán và mất log
 * qua logger riêng của filter này.
 */
@Catch(
  Prisma.PrismaClientKnownRequestError,
  Prisma.PrismaClientValidationError,
  Prisma.PrismaClientInitializationError,
  Prisma.PrismaClientUnknownRequestError,
  Prisma.PrismaClientRustPanicError,
)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(
    exception:
      | Prisma.PrismaClientKnownRequestError
      | Prisma.PrismaClientValidationError
      | Prisma.PrismaClientInitializationError
      | Prisma.PrismaClientUnknownRequestError
      | Prisma.PrismaClientRustPanicError,
    host: ArgumentsHost,
  ): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<{ method?: string; originalUrl?: string; url?: string }>();
    const res = ctx.getResponse<Response>();
    const route = `${req?.method ?? '?'} ${req?.originalUrl ?? req?.url ?? '?'}`;

    if (!(exception instanceof Prisma.PrismaClientKnownRequestError)) {
      // Không có `code` ổn định để phân loại (Init/Validation/Unknown/RustPanic) — log đầy đủ,
      // trả 500 chung, không lộ chi tiết lỗi thật ra ngoài.
      this.logger.error(`Prisma ${exception.constructor.name} on ${route}: ${exception.message}`, exception.stack);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'INTERNAL_ERROR',
        message: 'Đã có lỗi xảy ra, vui lòng thử lại sau.',
      });
      return;
    }

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
