import { Body, Controller, Get, Logger, Post, HttpCode } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';

@Controller()
export class HealthController {
  private readonly logger = new Logger('DIAG');
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get('health')
  async check() {
    let db = 'down';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      db = 'up';
    } catch {
      db = 'down';
    }
    return { status: 'ok', db, ts: new Date().toISOString() };
  }

  /** Nhận log chẩn đoán từ client (debug login Zalo). Public, fire-and-forget. */
  @Public()
  @Post('diag')
  @HttpCode(200)
  diag(@Body() body: { tag?: string; msg?: string }) {
    this.logger.warn(`[CLIENT] ${body?.tag ?? ''}: ${String(body?.msg ?? '').slice(0, 500)}`);
    return { ok: true };
  }
}
