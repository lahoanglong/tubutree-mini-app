import { Body, Controller, HttpCode, HttpStatus, Logger, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { CspLogGate, normalizeCspReports } from './csp-report';

/**
 * Nơi trình duyệt gửi báo cáo vi phạm CSP của web (report-uri / report-to). Không lưu DB: chỉ một dòng warn gọn cho mỗi vi phạm lạ.
 * Parser riêng (application/csp-report, application/reports+json, trần 32kb) gắn ở bootstrap trước parser chung.
 */
@Controller('csp-report')
export class CspReportController {
  private readonly logger = new Logger('CspReport');
  private readonly gate = new CspLogGate();

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  receive(@Body() body: unknown): void {
    for (const v of normalizeCspReports(body)) {
      const { log, summary } = this.gate.admit(v);
      if (summary > 0) this.logger.warn(`Lược ${summary} báo cáo CSP lặp hoặc vượt trần trong 60 giây trước.`);
      if (log) this.logger.warn(`CSP chặn ${v.directive}: ${v.blocked} tại ${v.document || '?'}`);
    }
  }
}
