import { Controller, Get, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async check() {
    const ts = new Date().toISOString();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', db: 'up', ts };
    } catch (err) {
      // Trả 503 khi DB down để Docker healthcheck/Caddy KHÔNG coi app là sẵn sàng
      // (tránh route traffic vào instance không truy vấn được DB).
      this.logger.error(`Health check: DB không truy vấn được — ${(err as Error).message}`);
      throw new ServiceUnavailableException({ status: 'error', db: 'down', ts });
    }
  }
}
