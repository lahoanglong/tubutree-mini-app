import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AffiliateLinkLedgerService } from './affiliate-link-ledger.service';

export class RecomputeLinkStatsDto {
  /** Mặc định true: chỉ xem trước các link lệch, không ghi gì. Gửi `false` để ghi lại. */
  @IsOptional() @IsBoolean() dryRun?: boolean;
}

/** Tính lại số đơn/doanh số của link CTV từ sổ hoa hồng (affiliate-link-ledger.service.ts). Chỉ ADMIN: ghi số liệu CTV. */
@ApiTags('admin-affiliate-links')
@Roles('ADMIN')
@Controller('admin/affiliate-links')
export class AffiliateLinkLedgerController {
  constructor(private readonly ledger: AffiliateLinkLedgerService) {}

  @Post('recompute')
  @HttpCode(200)
  recompute(@CurrentUser('sub') adminId: string, @Body() dto: RecomputeLinkStatsDto) {
    return this.ledger.recompute(adminId, { dryRun: dto.dryRun });
  }
}
