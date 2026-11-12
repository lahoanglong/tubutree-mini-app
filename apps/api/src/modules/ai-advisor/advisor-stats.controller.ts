import { Controller, Get } from '@nestjs/common';
import type { AdvisorStatsDto } from '@tubutree/shared-types';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdvisorStatsService } from './advisor-stats.service';

@Roles('ADMIN')
@Controller('admin/ai-advisor')
export class AdvisorStatsController {
  constructor(private readonly stats: AdvisorStatsService) {}

  @Get('stats')
  getStats(): AdvisorStatsDto {
    return this.stats.snapshot();
  }
}
